// MediaEngine — تحويل الصور/الفيديو إلى ملصقات WebP. فصل كامل عن WhatsApp وQueue.
import sharp from "sharp";
import { join } from "node:path";
import { rename, unlink } from "node:fs/promises";
import { statSync, existsSync } from "node:fs";
import { runFfmpeg, probeMedia } from "./ffmpeg.mjs";

export class MediaEngine {
  constructor({ settings, logger }) {
    this.settings = settings;
    this.logger = logger;
  }

  stickerSize() {
    return this.settings.getNumber("media.stickerSize", 512);
  }

  quality() {
    return this.settings.getNumber("media.stickerQuality", 90);
  }

  // ينفذ التحويل حسب نوع الـ Job ونوع التحديد (قد يختلف عن تصنيف الرسالة)
  async convert(job, { outputDir, kindOverride } = {}) {
    const kind = kindOverride || (job.type === "IMAGE" ? "IMAGE" : "VIDEO");
    const size = this.stickerSize();
    const quality = this.quality();
    const stamp = Date.now();
    const base = `s_${job.id}_${stamp}`;

    if (kind === "IMAGE") {
      const outputPath = join(outputDir, `${base}.webp`);
      await sharp(job.inputPath)
        .rotate()
        // fit:"contain" = الحفاظ على نسبة الأبعاد كاملة دون قص أو تمطيط؛
        // الحشو حول الصورة شفاف ليُملا المربع 512×512.
        .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality, effort: 6 })
        .toFile(outputPath);
      return { outputPath, kind: "image", durationMs: null };
    }

    // فيديو/GIF → WebP متحرك
    // واتساب يرفض الملصق المتحرك إذا تجاوز ~500KB أو 10 ثوانٍ، وبعض الصيغ تُفلتَ
    // كملصق ثابت دون خطأ ظاهر. ننفّذ إعادة ترميز تدريجي (جودة/إطارات أقل) حتى
    // نرضي حد الحجم، ونقصّ الطول إلى حد الملصق المتحرك.
    // ملاحظة: واتساب يتعثّر بملفات ANMF ذات فترات إطارات غير منتظمة (مثل 12fps
    // = 83.33ms تُقوَّر إلى 83/84 بالتناوب). نلتزم بقيم fps تقسم 1000ms بالضبط:
    // 25→40ms، 20→50ms، 10→100ms، 8→125ms، ثم تحقّق بعد الإخراج من الوحدة.
    const outputPath = join(outputDir, `${base}.webp`);
    const maxDur = Math.min(
      this.settings.getNumber("media.maxVideoDurationSeconds", 30),
      this.settings.getNumber("media.maxAnimatedStickerSeconds", 10)
    );
    const fpsPool = [25, 20, 10, 8];
    const cfgFps = this.settings.getNumber("media.stickerMaxFps", 25);
    const fps = fpsPool.find((f) => f <= cfgFps) ?? fpsPool[fpsPool.length - 1];
    const maxBytes = this.settings.getNumber("media.maxAnimatedStickerBytes", 480000);

    const probe = await probeMedia(job.inputPath);
    const durSec = probe?.durationSec ?? null;
    const useT = durSec != null && durSec > maxDur ? ["-t", String(maxDur)] : [];

    // درجات تحوير: الأولى بالجودة المطلوبة، ثم نخفض حتى لا يتجاوز حد الحجم.
    // (الاتجاه الأهم: فيديو معقّد قد يحتاج جودة/إطارات أقل بكثير — واتساب يرفض
    // الملصق المتحرك فوق ~500KB بخطأ مبهم، لذا نخفض حتى ينطبق.)
    const tiers = [
      { q: this.quality(), fps, level: 6 },
      { q: 70, fps: Math.min(fps, 20), level: 7 },
      { q: 55, fps: Math.min(fps, 10), level: 7 },
      { q: 40, fps: 8, level: 7 },
      { q: 25, fps: 8, level: 7 },
      { q: 15, fps: 6, level: 7 },
      { q: 15, fps: 4, level: 7 },
    ];

    const started = Date.now();
    let lastErr = null;
    for (let i = 0; i < tiers.length; i++) {
      const { q, fps: f, level } = tiers[i];
      const tmp = i === 0 ? outputPath : join(outputDir, `${base}.a${i}.webp`);
      const vf = [
        // بدون قص وبدون تمطيط: نحافظ على نسبة الأبعاد كاملة، ثم نضيف حشواً
        // شفافاً حول المحتوى ليُملأ المربع 512×512 (contain بدل crop/fill).
        `scale=${size}:${size}:force_original_aspect_ratio=decrease`,
        `pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=black@0`,
        `format=yuva420p`,
        `fps=${f}`,
      ].join(",");
      const args = [
        "-y", "-hide_banner", "-i", job.inputPath,
        ...useT,
        "-an", "-vf", vf,
        "-loop", "0",
        "-c:v", "libwebp",
        "-quality", String(q),
        "-compression_level", String(level),
        "-preset", "default",
        tmp,
      ];
      try {
        await runFfmpeg(args, { timeoutMs: 180000 });
        const check = await validateAnimatedWebp(tmp);
        if (!check.ok) {
          lastErr = new Error(`animated sticker webp غير سليم: ${check.reason}`);
          if (tmp !== outputPath) await safeUnlink(tmp);
          continue;
        }
        if (fileSize(tmp) <= maxBytes) {
          if (tmp !== outputPath) await renameOut(tmp, outputPath);
          return { outputPath, kind: "animated", durationMs: Date.now() - started, quality: q, fps: f };
        }
        lastErr = new Error(`animated sticker ${fileSize(tmp)} bytes > limit ${maxBytes}`);
        if (tmp !== outputPath) await safeUnlink(tmp);
      } catch (err) {
        lastErr = err;
      }
    }
    // كل المحاولات فشلت أو تجاوزت الحد — نرفض نهائياً وليس retry.
    const e = new Error("animated_sticker_too_large");
    e.permanent = true;
    e.cause = lastErr;
    throw e;
  }
}

function fileSize(p) {
  try {
    return existsSync(p) ? statSync(p).size : 0;
  } catch {
    return 0;
  }
}

async function renameOut(from, to) {
  try {
    await rename(from, to);
  } catch (err) {
    const { copyFile, unlink: u } = await import("node:fs/promises");
    await copyFile(from, to);
    await u(from).catch(() => {});
  }
}

async function safeUnlink(p) {
  try {
    await unlink(p);
  } catch { /* خامل */ }
}

// يتحقق من أن WebP متحرك مقبول كملصق واتساب:
// أبعاد دقيقة 512×512، أكثر من إطار، حلقة لا نهائية.
// يُستخدم نفس مفكك libwebp (عبر sharp) الذي يستخدمه كروم/واتساب ويب.
// ملاحظة: التباين الطفيف في فترات الإطارات مقبول (أثبت ملفات أُرسلت بنجاح)،
// لذا لا نرفضها هنا — المشكل الحقيقي هو تجاوز ~500KB الذي يرفضه واتساب.
export async function validateAnimatedWebp(p) {
  let meta;
  try {
    meta = await sharp(p, { animated: true }).metadata();
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  if (meta.width !== 512 || (meta.pageHeight ?? meta.height) !== 512) {
    return { ok: false, reason: `dims ${meta.width}x${meta.pageHeight ?? meta.height}` };
  }
  if (!meta.pages || meta.pages < 2) {
    return { ok: false, reason: `frames ${meta.pages}` };
  }
  if (meta.loop !== 0) {
    return { ok: false, reason: `loop ${meta.loop}` };
  }
  return { ok: true };
}