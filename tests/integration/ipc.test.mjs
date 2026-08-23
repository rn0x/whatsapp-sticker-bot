// ipc.test.mjs — يفحص أن كل قناة IPC مسجلة بشكل صحيح وتعمل ضد الخدمات الحقيقية.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServices } from "../../src/main/app-services.mjs";
import { IpcHub } from "../../src/main/ipc/index.mjs";

// ipcMain وهمي يشغّل المعالجات مباشرة
function fakeIpc() {
  const handlers = new Map();
  return {
    ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) },
    async call(channel, payload) {
      if (!handlers.has(channel)) throw new Error(`no handler: ${channel}`);
      return handlers.get(channel)({ senderUrl: "file:///mock" }, payload || {});
    },
  };
}

let dir, svc, ipc, token;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "sb-ipc-"));
  svc = new AppServices({ dataDir: dir, envPassword: "admin123" });
  await svc.init();
  const f = fakeIpc();
  new IpcHub({ ipcMain: f.ipcMain, services: svc, getWindow: () => null, openFileDialog: null });
  ipc = f;
  token = svc.admin.createSession();
});

after(async () => { if (svc) await svc.shutdown(); });

test("auth channels are public and work", async () => {
  const status = await ipc.call("auth:status");
  assert.equal(status.configured, true);
  const login = await ipc.call("auth:login", { password: "admin123" });
  assert.equal(login.ok, true);
  assert.ok(login.token);
});

test("no-login default: fresh app (بدون كلمة مرور) يفتح بدون رمز", async () => {
  const d2 = mkdtempSync(join(tmpdir(), "sb-ipc-nologin-"));
  const svc2 = new AppServices({ dataDir: d2 });
  await svc2.init();
  try {
    const f2 = fakeIpc();
    new IpcHub({ ipcMain: f2.ipcMain, services: svc2, getWindow: () => null, openFileDialog: null });
    const status = await f2.call("auth:status");
    assert.equal(status.requireLogin, false);
    const ov = await f2.call("overview:get", {});
    assert.equal(ov.ok, true);
  } finally {
    await svc2.shutdown();
  }
});

test("theme:get is public and returns a theme", async () => {
  const t = await ipc.call("theme:get");
  assert.equal(t.ok, true);
  assert.ok(["dark", "light"].includes(t.theme));
});

test("dashboard is open without login (اللوحة مفتوحة بلا تسجيل)", async () => {
  const ov = await ipc.call("overview:get", {});
  assert.equal(ov.ok, true);
  const status = await ipc.call("auth:status");
  assert.equal(status.requireLogin, false);
});

test("overview + queue + users work with token", async () => {
  const ov = await ipc.call("overview:get", { token });
  assert.equal(ov.ok, true);
  assert.ok(ov.data.uptimeMs >= 0);

  const counts = await ipc.call("queue:counts", { token });
  assert.equal(counts.ok, true);

  const users = await ipc.call("users:list", { token, limit: 10 });
  assert.equal(users.ok, true);
});

test("enqueue a job through the raw service then inspect via IPC", async () => {
  const u = svc.users.upsertOrGet({ whatsappId: "972577777777@s.whatsapp.net", phone: "972577777777", name: "X", pushName: "X" });
  svc.queue.enqueue({ user: u, messageId: "ipc-1", type: "IMAGE" });
  const list = await ipc.call("queue:list", { token, filters: { limit: 10 } });
  assert.equal(list.ok, true);
  assert.ok(list.data.rows.length >= 1);
  assert.ok(list.data.rows.some((j) => j.messageId === "ipc-1"));
});

test("settings get + set with validation", async () => {
  const all = await ipc.call("settings:getAll", { token });
  assert.equal(all.ok, true);
  assert.ok("bot.name" in all.data);

  const bad = await ipc.call("settings:set", { token, key: "admin.passwordHash", value: "x" });
  assert.equal(bad.ok, false); // غير قابل للتعديل

  const good = await ipc.call("settings:set", { token, key: "bot.stickerPack", value: "Pack" });
  assert.equal(good.ok, true);
});

test("stats period + export users", async () => {
  const stats = await ipc.call("stats:period", { token, days: 7 });
  assert.equal(stats.ok, true);
  assert.ok(Array.isArray(stats.data.daily));
});

test("whatsapp status channel responds", async () => {
  const r = await ipc.call("whatsapp:status", { token });
  assert.equal(r.ok, true);
});

test("logs list channel responds", async () => {
  const r = await ipc.call("logs:list", { token, limit: 20 });
  assert.equal(r.ok, true);
});

test("backups list + create via IPC", async () => {
  const beforeBk = await ipc.call("backups:list", { token });
  assert.equal(beforeBk.ok, true);
  const created = await ipc.call("backups:create", { token, includeSession: false });
  assert.equal(created.ok, true);
  assert.ok(created.backup.path);
  assert.ok(existsSync(created.backup.path));
  const afterBk = await ipc.call("backups:list", { token });
  assert.ok(afterBk.backups.length >= beforeBk.backups.length + 1);
});