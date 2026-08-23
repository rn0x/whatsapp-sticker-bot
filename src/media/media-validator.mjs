// التحقق من الوسائط قبل إنشاء Job وبعد التنزيل — خط الدفاع الأول.
import { readFileSync, statSync } from "node:fs";
import { probeMedia } from "./ffmpeg.mjs";

const MAGIC = [
  { m: [0xff, 0xd8, 0xff], ext: "jpg", kind: "IMAGE" },
  { m: [0x89, 0x50, 0x4e, 0x47], ext: "png", kind: "IMAGE" },
  { m: [0x42, 0x4d], ext: "bmp", kind: "IMAGE" },
  { m: [0x52, 0x49, 0x46, 0x46], ext: "webp", kind: "IMAGE" }, // RIFF..WEBP أو WEBP متحرك
  { m: [0x47, 0x49, 0x46, 0x38], ext: "gif", kind: "GIF" },
  { m: [0x1a, 0x45, 0xdf, 0xa3], ext: "mkv", kind: "VIDEO" },
  // mp4/mov/3gp/quicktime — حجم صندوق ftyp يختلف في الملفات الحقيقية، فنطابق "ftyp"
  // عند الإزاحة 4 بدل تثبيت حجم الصندوق.
  { m: [0x66, 0x74, 0x79, 0x70], at: 4, ext: "mp4", kind: "VIDEO" },
  // avi: RIFF بأي حجم صندوق
  { m: [0x41, 0x56, 0x49, 0x20], at: 8, ext: "avi", kind: "VIDEO" },
];

export function sniffType(inputPath) {
  let head;
  try {
    head = readFileSync(inputPath);
  } catch {
    return { kind: null, reason: "unreadable" };
  }
  const bytes = [...head.subarray(0, 16)];
  for (const t of MAGIC) {
    const at = t.at || 0;
    if (t.m.every((v, i) => bytes[at + i] === v)) return { kind: t.kind, reason: t.ext };
  }
  return { kind: null, reason: "unknown_type" };
}

export class MediaValidator {
  constructor({ settings, logger }) {
    this.settings = settings;
    this.logger = logger;
  }

  async validate(job, jobType) {
    const size = statSync(job.inputPath).size;
    if (jobType === "IMAGE") {
      const limit = this.settings.getNumber("media.maxImageBytes", 20 * 1024 * 1024);
      if (size > limit) return { ok: false, reason: `image_too_large:${Math.round(size / 1024 / 1024)}MB` };
    } else {
      const limit = this.settings.getNumber("media.maxVideoBytes", 64 * 1024 * 1024);
      if (size > limit) return { ok: false, reason: `video_too_large:${Math.round(size / 1024 / 1024)}MB` };
    }

    const sniff = sniffType(job.inputPath);
    if (!sniff.kind) {
      // صيغة غير مألوفة لدى الـ sniffer — نحاول عبر ffprobe؛ أي حاوية فيديو
      // يقرأها ffmpeg (webm, 3gp, mov, mkv…) تُقبل هنا.
      // لا نرفض الفيديو الطويل: المحرك يقصّه تلقائياً إلى حد الملصق المتحرك.
      const probe = await probeMedia(job.inputPath);
      if (probe && (probe.durationSec != null || probe.width)) {
        return { ok: true, kind: "VIDEO", durationSec: probe.durationSec ?? 0, probe };
      }
      return { ok: false, reason: "unsupported_file" };
    }

    // GIF: static → صورة، animated → فيديو
    if (sniff.kind === "GIF") {
      const probe = await probeMedia(job.inputPath);
      const anim = probe && probe.durationSec != null && probe.durationSec >= 0.1;
      return { ok: true, kind: anim ? "VIDEO" : "IMAGE", durationSec: probe?.durationSec ?? 0 };
    }
    if (sniff.kind === "IMAGE") return { ok: true, kind: "IMAGE" };

    // فيديو
    const probe = await probeMedia(job.inputPath);
    if (!probe || probe.durationSec == null) return { ok: false, reason: "unreadable_video" };
    // الفيديو الطويل لا يُرفض هنا — المحرك يقصّه إلى حد الملصق المتحرك (10ث).
    return { ok: true, kind: "VIDEO", durationSec: probe.durationSec, probe };
  }
}