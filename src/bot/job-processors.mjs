// JobProcessors — تنفيذ download + process للـ WorkerPool.
// تحميل: يحمّل ملف الوسيط، يحسب SHA-256، ينقله إلى staging.
// معالجة: تحقق + تحويل + كاش + إرسال + إكمال (مع استهلاك الحصة).
import { rename, unlink, readFile, copyFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../utils/time.mjs";
import { applyStickerMetadata } from "../media/sticker-meta.mjs";
import { BOT_TEXTS } from "./humanizer.mjs";

export function createJobHandlers({ adapter, queue, quota, users, groups, settings, logger, paths, cache, mediaEngine, validator, humanizer, messages }) {
  return {
    async download(job) {
      const user = users.getById(job.userId);
      if (!user) throw new Error("user not found");
      const chatId = job.groupId || user.whatsappId;
      const rawFile = paths.makeSubPath("incoming", `${job.messageId}.media`);
      await adapter.downloadMedia({ chatId, id: job.messageId }, rawFile);
      if (!existsSync(rawFile)) throw new Error("download produced no file");
      const buf = await readFile(rawFile);
      const hash = sha256(buf);
      const staged = join(paths.get("staging"), `job_${job.id}.media`);
      await rename(rawFile, staged);
      queue.setDownloaded(job.id, staged, hash);
      logger.info("worker", `downloaded job ${job.id}`, { size: fileSize(staged) });
      await storeHistoryMedia({ messages, paths, settings, logger, job, stagedPath: staged });
    },

    async process(job) {
      const user = users.getById(job.userId);
      if (!user) throw new Error("user not found");
      const chatId = job.groupId || user.whatsappId;
      const userForQuota = { id: user.id, role: user.role, quotaLimit: user.quotaLimit, quotaMode: user.quotaMode };

      // إشارة كتابة إنسانية قبل الإرسال المبدئي للإقرار.
      try { await humanizer?.sendTyping?.(chatId); } catch { /* خامل */ }

      // كاش الـ duplicates — أمان: يعيد الاستخدام لنفس المستخدم فقط.
      const hit = job.inputHash
        ? cache.getFresh(job.inputHash, { userId: user.id, allowOtherUsers: false })
        : null;

      let outputPath;
      let kind;

      if (hit && existsSync(hit.path)) {
        outputPath = hit.path;
        kind = hit.kind;
        logger.info("worker", `cache hit job ${job.id}`);
      } else {
        const validation = await validator.validate(job, job.type);
        if (!validation.ok) {
          await notifyInvalid(adapter, chatId, validation.reason, user, messages);
          throw permanentError(validation.reason);
        }
        let resolved;
        try {
          resolved = await mediaEngine.convert(job, { outputDir: paths.get("completed") });
        } catch (err) {
          // رفض نهائي من المحوّل (مثل تجاوز حد الحجم) — نُعلم المستخدم ولا نعيد المحاولة.
          if (err?.permanent) {
            const reason = String(err.message).split(":")[0];
            if (INVALID_MESSAGES[reason]) {
              await notifyInvalid(adapter, chatId, reason, user, messages);
            }
            throw permanentError(reason);
          }
          throw err;
        }
        outputPath = resolved.outputPath;
        kind = resolved.kind;
        applyStickerMetadataSafe(logger, outputPath, settings, user, users);
        if (job.inputHash) {
          cache.put({
            hash: job.inputHash,
            path: outputPath,
            kind,
            size: fileSize(outputPath),
            jobId: job.id,
            userId: user.id,
            retentionHours: settings.getNumber("storage.cacheRetentionHours", 6),
          });
        }
      }

      // Outbox: قبل الإرسال. نوقف إشارة الكتابة ثم نصمت كإنسان.
      try { await humanizer?.stopTyping?.(chatId); } catch { /* خامل */ }
      queue.markSending(job.id);

      const meta = userPackMeta(users, settings, user);
      const sent = await adapter.sendSticker(chatId, outputPath, meta);

      // سجل المحادثة: الملصق الصادر للوسيط المرتبط.
      if (messages) {
        try {
          const hist = job.messageId ? messages.findByMessageId(job.messageId) : null;
          const chatIdForHist = hist?.chatId || chatId;
          messages.insert({
            userId: user.id,
            chatId: chatIdForHist,
            direction: "OUT",
            type: "sticker",
            mime: "image/webp",
            mediaPath: outputPath,
            mediaSize: fileSize(outputPath),
            messageId: sent?.id?._serialized || sent?.id?.$1 || sent?.id?.id || null,
            jobId: job.id,
            adminSent: false,
          });
        } catch (err) {
          logger.warn("worker", "history sticker record failed", { err: err.message });
        }
      }

      // إكمال ضمن معاملة ذرّية → Consume quota
      queue.complete(job, job.outputPath || outputPath, sent?.id?._serialized || null);

      // إشعار النجاح — صيغة متناوبة، لا رسالة مكررة.
      try {
        const variants = BOT_TEXTS.done;
        const text = humanizer?.pick?.("done", variants) ?? variants[0];
        const done = await adapter.sendText(chatId, text);
        messages?.insert({ userId: user.id, chatId, direction: "OUT", type: "text", text, messageId: done?.id?._serialized || done?.id?.$1 || done?.id?.id || null, jobId: job.id, adminSent: false });
      } catch { /* خامل */ }

      // حذف المدخل من staging (Policy: Process → Send → Delete)
      try {
        if (job.inputPath && job.inputPath.startsWith(paths.get("staging"))) await unlink(job.inputPath);
      } catch { /* خامل */ }
    },
  };
}

const INVALID_MESSAGES = {
  unsupported_file: "unsupported_file",
  image_too_large: "image_too_large",
  video_too_large: "video_too_large",
  video_too_long: "video_too_long",
  unreadable_video: "unreadable_video",
  animated_sticker_too_large: "animated_sticker_too_large",
};

async function notifyInvalid(adapter, chatId, reason, user = null, messages = null) {
  try {
    const key = String(reason).split(":")[0];
    const text = BOT_TEXTS.invalid[key] || "لا يمكن معالجة هذا الملف حالياً.";
    const sent = await adapter.sendText(chatId, text);
    if (messages && user) {
      messages.insert({ userId: user.id, chatId, direction: "OUT", type: "text", text, messageId: sent?.id?._serialized || sent?.id?.$1 || sent?.id?.id || null, adminSent: false });
    }
  } catch { /* خامل */ }
}

// نسخ الوسيط إلى مجلد history للمعاينة/الاحتفاظ، مع توليد معاينة مصغرة للصور.
async function storeHistoryMedia({ messages, paths, settings, logger, job, stagedPath }) {
  if (!messages) return;
  if (!settings.getBool("history.enabled", true)) return;
  const rec = messages.findByMessageId(job.messageId);
  if (!rec) return;
  try {
    const hdir = paths.makeSubPath("history", safeDirName(rec.chatId));
    const dest = join(hdir, `${safeDirName(job.messageId)}.media`);
    await copyFile(stagedPath, dest);

    let thumbPath = null;
    if (job.type === "IMAGE") {
      try {
        const sharp = (await import("sharp")).default;
        thumbPath = join(hdir, `${safeDirName(job.messageId)}.thumb.webp`);
        await sharp(dest).resize(480, 480, { fit: "inside" }).webp({ quality: 70 }).toFile(thumbPath);
      } catch { /* بلا معاينة */ }
    }

    messages.attachMedia(rec.id, {
      mediaPath: dest,
      thumbPath,
      mediaSize: fileSize(dest),
      mime: rec.mime,
    });
    logger.info("worker", "history media saved", { id: rec.id, path: dest });
  } catch (err) {
    logger.warn("worker", "history media copy failed", { err: err.message });
  }
}

function safeDirName(s) {
  return String(s || "chat").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function applyStickerMetadataSafe(logger, outputPath, settings, user, users) {
  try {
    const meta = userPackMeta(users, settings, user);
    applyStickerMetadata(outputPath, meta.pack, meta.author);
  } catch (err) {
    logger.warn("media", "sticker metadata write failed (سيطبق بدون بيانات)", { err: err.message });
  }
}

// اسم مجموعة الملصقات والمؤلف لكل مستخدم: يخصصه المستخدم بأمر /اسم و/مؤلف،
// وإلا فالافتراضي العام bot.stickerPack/stickerAuthor.
function userPackMeta(users, settings, user) {
  const prefs = user ? users.getPrefs(user.id) : null;
  return {
    pack: prefs?.packName || settings.get("bot.stickerPack") || "Sticker Bot",
    author: prefs?.packAuthor || settings.get("bot.stickerAuthor") || "Sticker Bot",
  };
}

function permanentError(reason) {
  const e = new Error(reason);
  e.permanent = true;
  return e;
}

function fileSize(p) {
  return existsSync(p) ? statSync(p).size : 0;
}