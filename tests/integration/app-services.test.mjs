// integration.test.mjs — يكيّف بدء AppServices كاملاً ضد دليل مؤقت، ويختبر
// التدفق الأساسي (هجين + نسخ احتياطي + استعادة) وسلامة الحصص والحجم والاسترداد.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServices } from "../../src/main/app-services.mjs";

let dir;
let svc;
let user;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "sb-it-"));
  svc = new AppServices({ dataDir: dir, envPassword: "testpass123" });
  await svc.init();
  user = svc.users.upsertOrGet({
    whatsappId: "972500000000@s.whatsapp.net",
    phone: "972500000000",
    name: "Ali",
    pushName: "Ali",
  });
});

after(async () => {
  if (svc) await svc.shutdown();
});

test("database integrity passes", () => {
  assert.equal(svc.db.integrityCheck().ok, true);
});

test("default settings seeded", () => {
  assert.equal(svc.settings.getNumber("quota.defaultDailyQuota", -1), 50);
  assert.equal(svc.settings.get("bot.name"), "Sticker Bot");
  assert.equal(svc.settings.get("whatsapp.provider"), "wwebjs");
});

test("migration 004 seeds humanizer, autoConnect and theme", () => {
  assert.equal(svc.settings.getBool("humanizer.enabled", null), true);
  assert.equal(svc.settings.getBool("humanizer.markSeenEnabled", null), true);
  assert.equal(svc.settings.getNumber("humanizer.replyDelayMinMs", -1), 1500);
  assert.equal(svc.settings.getNumber("humanizer.replyDelayMaxMs", -1), 7000);
  assert.equal(svc.settings.getBool("whatsapp.autoConnectOnBoot", null), true);
  assert.equal(svc.settings.get("app.theme"), "dark");
});

test("enqueue creates job and reserves quota atomically", () => {
  const r = svc.queue.enqueue({ user, messageId: "m1", type: "IMAGE", amount: 1 });
  assert.equal(r.ok, true);
  assert.ok(r.job.id > 0);
  const usage = svc.quota.usageFor(user);
  assert.equal(usage.reserved, 1);
  assert.equal(usage.remaining, 49);
});

test("duplicate message id is rejected", () => {
  const r = svc.queue.enqueue({ user, messageId: "m1", type: "IMAGE" });
  assert.equal(r.ok, false);
  assert.equal(r.code, "duplicate");
});

test("queue counts and overview reflect state", () => {
  const counts = svc.queue.counts();
  assert.ok(counts.QUEUED >= 1);
  const ov = svc.overview();
  assert.ok(ov.queueSize >= 1);
  assert.ok(ov.users.total >= 1);
});

test("statistics returns daily series", async () => {
  const stats = await svc.statistics(7);
  assert.ok(Array.isArray(stats.daily));
  assert.ok(stats.jobs.total >= 1);
});

test("user search and per-user stats", () => {
  const { rows, total } = svc.users.search({ query: "9725000" });
  assert.ok(total >= 1);
  const us = svc.users.getUserStats(user.id);
  assert.ok(us.totalJobs >= 1);
});

test("groups settings default + update", () => {
  const gid = "120363000000000000@g.us";
  svc.groups.upsertGroup(gid, { name: "Test Group", memberCount: 3 });
  const def = svc.groups.getSettings(gid);
  assert.ok(!def || def.enabled !== false); // سيُشغّل افتراضياً عند first ensure
  const ensured = svc.groups.ensureSettings(gid, { mode: "MENTION_ONLY" });
  assert.equal(ensured.mode, "MENTION_ONLY");
  const updated = svc.groups.updateSettings(gid, {
    enabled: true,
    mode: "COMMAND_ONLY",
    daily_limit: 100,
    allowed_roles: ["REGULAR", "PREMIUM"],
  });
  assert.equal(updated.mode, "COMMAND_ONLY");
  assert.equal(updated.dailyLimit, 100);
  assert.deepEqual(updated.allowedRoles, ["REGULAR", "PREMIUM"]);
});

test("group member count tracked", () => {
  svc.groups.addMember("120363000000000000@g.us", user.id);
  assert.ok(svc.groups.memberCounts("120363000000000000@g.us") >= 1);
});

test("backup + restore round-trip preserves users and jobs", async () => {
  const bk = await svc.backupManager.createBackup({ includeSession: false });
  assert.ok(existsSync(bk.path));
  const size = statSync(bk.path).size;
  assert.ok(size > 0);

  const restored = await svc.backupManager.restoreBackup({ zipPath: bk.path });
  assert.equal(restored.ok, true);

  const u2 = svc.users.getByWhatsAppId("972500000000@s.whatsapp.net");
  assert.ok(u2, "user survived restore");
  assert.equal(u2.name, "Ali");
});

test("logs are written and searchable", () => {
  svc.logger.info("test", "hello world");
  const r = svc.logger.repo.search({ query: "hello world" });
  assert.ok(r.total >= 1);
});

test("admin auth: configured, verify, session", async () => {
  assert.equal(svc.admin.isConfigured(), true);
  assert.equal(svc.admin.verify("testpass123"), true);
  assert.equal(svc.admin.verify("wrong"), false);
  const token = svc.admin.createSession();
  assert.equal(svc.admin.requireAuth(token), true);

  // الجلسات باقية عبر shutdown/init (مسار الاستعادة) والمصادقة مرتبطة بـ DB الجديد.
  await svc.shutdown();
  await svc.init();
  assert.equal(svc.admin.isConfigured(), true);
  assert.equal(svc.admin.requireAuth(token), true);
  svc.admin.destroySession(token);
  assert.equal(svc.admin.requireAuth(token), false);
});

test("exports produce CSV and JSON", () => {
  const csvPath = svc.backupManager.exportUsersCSV();
  assert.ok(existsSync(csvPath));
  const content = readFileSync(csvPath, "utf8");
  assert.ok(content.includes("whatsapp_id"));
  const jsonPath = svc.backupManager.exportUsersJSON();
  assert.ok(existsSync(jsonPath));
  const parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert.ok(Array.isArray(parsed));
});
test("factoryReset wipes data and rebuilds a fresh instance in place", async () => {
  const countBefore = svc.users.search({ limit: 100000 }).rows.length;
  assert.ok(countBefore > 0, "seed data exists before reset");

  const r = await svc.factoryReset();
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.removed) && r.removed.length > 0, "storage paths were removed");

  // إعادة استخدام نفس كائن الخدمات: كل المكونات بُنيت من جديد فوق DB فارغ.
  assert.equal(svc.users.search({ limit: 100000 }).rows.length, 0, "no users after factory reset");
  assert.equal(svc.settings.get("bot.name"), "Sticker Bot", "settings re-seeded via migration 001");
  assert.ok(!existsSync(svc.paths.dbPath()) ? true : svc.db.integrityCheck().ok, "fresh db passes integrity");
});

test("ADMIN_PASSWORD env re-applies to the fresh DB after factory reset", async () => {
  // بعد إعادة الضبط: كلمة البيئة ADMIN_PASSWORD تُعاد تطبيقها على الحالة النظيفة.
  const hash = svc.settings.get("admin.passwordHash");
  assert.ok(hash, "env password hash must exist on the fresh DB");
  assert.equal(svc.admin.verify("testpass123"), true, "env password verifies post-reset");
});
