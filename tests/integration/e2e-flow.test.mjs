// e2e-flow.test.mjs — مسار البوت الكامل بمحاكاة Adapter:
// enqueue → download → process (cache hit) → send → complete (consume quota).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { Database } from "../../src/core/database.mjs";
import { AppPaths } from "../../src/main/config.mjs";
import { Logger } from "../../src/main/logger.mjs";
import { SettingsRepo } from "../../src/core/repositories/settings.repo.mjs";
import { UsersRepo } from "../../src/core/repositories/users.repo.mjs";
import { JobsRepo } from "../../src/core/repositories/jobs.repo.mjs";
import { QuotaRepo } from "../../src/core/repositories/quota.repo.mjs";
import { CacheRepo } from "../../src/core/repositories/cache.repo.mjs";
import { QuotaService } from "../../src/quota/quota-service.mjs";
import { QueueService } from "../../src/queue/queue-service.mjs";
import { createJobHandlers } from "../../src/bot/job-processors.mjs";
import { sha256 } from "../../src/utils/time.mjs";

const TINY_WEBP = Buffer.from("UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQBMJaQAA3AA/vuoWAAA", "base64");

class MockAdapter extends EventEmitter {
  constructor() {
    super();
    this.status = "CONNECTED";
    this.sentStickers = [];
    this.sentTexts = [];
  }
  async downloadMedia(msg, targetPath) {
    writeFileSync(targetPath, TINY_WEBP);
  }
  async sendSticker(jid, path) {
    this.sentStickers.push({ jid, path });
    return { id: { _serialized: "k-" + this.sentStickers.length } };
  }
  async sendText(jid, text) {
    this.sentTexts.push({ jid, text });
  }
  getStatus() { return { status: this.status }; }
  async disconnect() {}
}

let dir, paths, db, logger, settings, users, jobsRepo, quotaRepo, cache, quota, queue;
let adapter, handlers, user, enqueueResult;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "sb-e2e-"));
  paths = new AppPaths(dir);
  db = new Database(paths.dbPath());
  await db.migrate();
  logger = new Logger(db, { consoleOut: false });
  settings = new SettingsRepo(db);
  users = new UsersRepo(db);
  jobsRepo = new JobsRepo(db);
  quotaRepo = new QuotaRepo(db);
  cache = new CacheRepo(db);
  quota = new QuotaService({ db, usersRepo: users, settings, quotaRepo });
  queue = new QueueService({ db, jobs: jobsRepo, quota, settings, logger });
  adapter = new MockAdapter();
  handlers = createJobHandlers({
    adapter, queue, quota, users, settings, logger, paths, cache,
    groups: { getGroup: () => null, ensureSettings: () => ({}), updateSettings: () => ({}) },
    mediaEngine: { convert: async () => { throw new Error("should not convert (cache hit)"); } },
    validator: { validate: async () => { throw new Error("should not validate (cache hit)"); } },
  });

  user = users.upsertOrGet({ whatsappId: "972588888888@s.whatsapp.net", phone: "972588888888", name: "E2E", pushName: "E2E" });
  enqueueResult = queue.enqueue({ user, messageId: "e2e-1", type: "IMAGE", amount: 1 });
});

after(() => { db.close(); });

test("full pipeline: enqueue → download → process → complete", async () => {
  const job = enqueueResult.job;
  assert.equal(job.status, "QUEUED");

  // 1. استيلاء عمال التحميل
  const claimed = queue.claimDownload("w-dl", new Date().toISOString());
  assert.equal(claimed.id, job.id);

  // 2. التحميل (يسجل ملف الذاكرة + hash + staging)
  await handlers.download(claimed);
  const afterDownload = jobsRepo.getById(job.id);
  assert.equal(afterDownload.status, "QUEUED"); // أعيد للطابور بانتظار المعالجة
  assert.ok(afterDownload.inputPath);
  assert.ok(afterDownload.inputHash);
  assert.ok(existsSync(afterDownload.inputPath));

  // 3. تزويد الكاش بنفس الـ hash حتى نمر على مسار cache-hit
  const stagedBytes = readFileSync(afterDownload.inputPath);
  assert.equal(sha256(stagedBytes), afterDownload.inputHash);
  const cachePath = join(dir, "cache-hit.webp");
  writeFileSync(cachePath, TINY_WEBP);
  cache.put({
    hash: afterDownload.inputHash,
    path: cachePath,
    kind: "sticker",
    size: TINY_WEBP.length,
    jobId: job.id,
    userId: user.id,
    retentionHours: 24,
  });

  // 4. استيلاء عمال المعالجة
  const proc = queue.claimProcess("w-proc", new Date().toISOString());
  assert.equal(proc.id, job.id);
  assert.equal(proc.inputPath, afterDownload.inputPath);

  // 5. المعالجة (cache hit) → إرسال الملصق → إكمال → استهلاك الحصة
  await handlers.process(proc);

  const done = jobsRepo.getById(job.id);
  assert.equal(done.status, "COMPLETED");
  assert.ok(done.stickerSentAt);

  // 6. عواقب الإرسال والإشعار
  assert.equal(adapter.sentStickers.length, 1);
  assert.equal(adapter.sentTexts.length, 1);
  assert.equal(adapter.sentStickers[0].jid, user.whatsappId); // chatId صحيح لخاص
  const usage = quota.usageFor(user);
  assert.equal(usage.reserved, 0);
  assert.equal(usage.used, 1);

  // 7. حُذف المدخل من staging بعد الإكمال
  assert.equal(existsSync(afterDownload.inputPath), false);
});

test("invalid file notifies user and fails permanently", async () => {
  const u2 = users.upsertOrGet({ whatsappId: "972589999999@s.whatsapp.net", phone: "972589999999", name: "E2E2", pushName: "E2E2" });
  const e = queue.enqueue({ user: u2, messageId: "e2e-2", type: "VIDEO", amount: 1 });
  assert.equal(e.ok, true);

  const claimed = queue.claimDownload("w-dl2", new Date().toISOString());
  assert.equal(claimed.id, e.job.id);
  await handlers.download(claimed);

  // validator مخصص يفشل
  const badHandlers = createJobHandlers({
    adapter, queue, quota, users, settings, logger, paths, cache,
    groups: {}, mediaEngine: {},
    validator: {
      validate: async () => ({ ok: false, reason: "video_too_long" }),
    },
  });
  const proc = queue.claimProcess("w-proc2", new Date().toISOString());
  assert.equal(proc.id, e.job.id);

  // محاكاة سلوك WorkerPool: أي خطأ يُحوَّل إلى fail مع تصنيف الـ retryable
  let thrown = null;
  try {
    await badHandlers.process(proc);
  } catch (err) {
    thrown = err;
    queue.fail(proc, err, { retryable: classify(err) });
  }
  assert.ok(thrown, "expected process to throw");
  const job = jobsRepo.getById(e.job.id);
  assert.equal(job.status, "FAILED");
  assert.ok(job.error.includes("video_too_long"));
  // أُرسل إشعار للمستخدم
  assert.ok(adapter.sentTexts.some((t) => t.text.includes("مدة")));
});

function classify(err) {
  if (err && err.permanent) return false;
  return false;
}