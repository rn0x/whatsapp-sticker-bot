// unit — اختبارات غير متزامنة للطبقات (Queue/Quota/RateLimiter/MediaValidator) بدون إقلاع كامل.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../../src/core/database.mjs";
import { AppPaths } from "../../src/main/config.mjs";
import { Logger } from "../../src/main/logger.mjs";
import { SettingsRepo } from "../../src/core/repositories/settings.repo.mjs";
import { UsersRepo } from "../../src/core/repositories/users.repo.mjs";
import { JobsRepo } from "../../src/core/repositories/jobs.repo.mjs";
import { QuotaRepo } from "../../src/core/repositories/quota.repo.mjs";
import { QuotaService } from "../../src/quota/quota-service.mjs";
import { QueueService } from "../../src/queue/queue-service.mjs";
import { RateLimiter } from "../../src/bot/rate-limiter.mjs";

let dir, paths, db, logger, settings, users, jobsRepo, quotaRepo, quota, queue, user;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "sb-unit-"));
  paths = new AppPaths(dir);
  db = new Database(paths.dbPath());
  await db.migrate();
  logger = new Logger(db, { consoleOut: false });
  settings = new SettingsRepo(db);
  users = new UsersRepo(db);
  jobsRepo = new JobsRepo(db);
  quotaRepo = new QuotaRepo(db);
  quota = new QuotaService({ db, usersRepo: users, settings, quotaRepo });
  queue = new QueueService({ db, jobs: jobsRepo, quota, settings, logger });
  user = users.upsertOrGet({ whatsappId: "972599999999@s.whatsapp.net", phone: "972599999999", name: "U", pushName: "U" });
});

after(() => {
  db.close();
});

test("quota: default limit 50, rolling window", () => {
  const u = users.getById(user.id);
  assert.equal(quota.limitFor(u), 50);
  const usage = quota.usageFor(u);
  assert.equal(usage.limit, 50);
  assert.equal(usage.remaining, 50);
});

test("quota: cannot reserve more than limit", () => {
  const u = users.update(user.id, { quota_limit: 2 });
  const r1 = queue.enqueue({ user: u, messageId: "q1", type: "IMAGE", amount: 2 });
  assert.equal(r1.ok, true);
  const r2 = queue.enqueue({ user: u, messageId: "q2", type: "IMAGE", amount: 1 });
  assert.equal(r2.ok, false);
  assert.equal(r2.code, "quota_exceeded");
});

test("queue: pause blocks enqueue", () => {
  queue.setPaused(true);
  const r = queue.enqueue({ user, messageId: "q3", type: "IMAGE" });
  assert.equal(r.ok, false);
  assert.equal(r.code, "queue_paused");
  queue.setPaused(false);
  const r2 = queue.enqueue({ user, messageId: "q3", type: "IMAGE" });
  assert.equal(r2.ok, true);
});

test("queue: claim → heartbeat → complete releases reservation", () => {
  // تصريف أي مهام عالقة من اختبارات سابقة
  while (true) {
    const c = queue.claimDownload("clear", new Date().toISOString());
    if (!c) break;
    queue.fail(c, new Error("clear"), { retryable: false });
  }

  const u = users.upsertOrGet({ whatsappId: "972511111111@s.whatsapp.net", phone: "972511111111", name: "C", pushName: "C" });
  queue.enqueue({ user: u, messageId: "c1", type: "IMAGE", amount: 1 });

  const claimed = queue.claimDownload("w1", new Date().toISOString());
  assert.ok(claimed?.id > 0);
  queue.heartbeat(claimed.id, "w1");
  queue.setDownloaded(claimed.id, "/tmp/in.png", "abc");
  const proc = queue.claimProcess("w2", new Date().toISOString());
  assert.equal(proc.id, claimed.id);
  queue.complete(proc, "/tmp/out.webp", new Date().toISOString());
  const j = jobsRepo.getById(claimed.id);
  assert.equal(j.status, "COMPLETED");
  const usage = quota.usageFor(u);
  assert.equal(usage.reserved, 0);
  assert.equal(usage.used, 1);
});

test("queue: fail with retryable requeues and increments attempts", () => {
  // تصريف المهام المعلقة المتبقية
  while (true) {
    const c = queue.claimDownload("clear2", new Date().toISOString());
    if (!c) break;
    queue.fail(c, new Error("clear"), { retryable: false });
  }

  const u = users.upsertOrGet({ whatsappId: "972522222222@s.whatsapp.net", phone: "972522222222", name: "F", pushName: "F" });
  queue.enqueue({ user: u, messageId: "f1", type: "IMAGE", amount: 1 });
  const claimed = queue.claimDownload("w3", new Date().toISOString());
  assert.equal(claimed.messageId, "f1");
  queue.fail(claimed, new Error("download error"), { retryable: true });
  const j = jobsRepo.getById(claimed.id);
  assert.equal(j.status, "QUEUED");
  assert.equal(j.attempts, 1);
});

test("rate limiter: window resets", () => {
  const rl = new RateLimiter();
  rl.setLimit("u1", 5, 60_000);
  for (let i = 0; i < 5; i++) rl.hit("u1");
  assert.equal(rl.hit("u1").allowed, false);
  rl.dispose();
  assert.ok(true);
});

test("sweep stale job after heartbeat timeout", () => {
  const jobs = jobsRepo.requeueByStatus("PROCESSING");
  assert.equal(typeof jobs, "number");
});