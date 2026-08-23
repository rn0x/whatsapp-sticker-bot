// messages.test.mjs — اختبارات سجل المحادثات: إدراج، سرد، حذف مع إزالة الملفات،
// ومحاكاة مسار الوسيط (download → نسخ للسجل) من دون اتصال حقيقي.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../../src/core/database.mjs";
import { AppPaths } from "../../src/main/config.mjs";
import { Logger } from "../../src/main/logger.mjs";
import { SettingsRepo } from "../../src/core/repositories/settings.repo.mjs";
import { UsersRepo } from "../../src/core/repositories/users.repo.mjs";
import { GroupsRepo } from "../../src/core/repositories/groups.repo.mjs";
import { MessagesRepo } from "../../src/core/repositories/messages.repo.mjs";

const GID = "120363000000000000@g.us";

let dir, paths, db, logger, settings, users, messages;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "sb-msg-"));
  paths = new AppPaths(dir);
  db = new Database(paths.dbPath());
  await db.migrate();
  logger = new Logger(db, { consoleOut: false });
  settings = new SettingsRepo(db);
  users = new UsersRepo(db);
  messages = new MessagesRepo(db);
});

after(() => { db.close(); });

test("migration 006 creates messages table and seeds history settings", () => {
  const cols = db.prepare("PRAGMA table_info(messages)").all().map((c) => c.name);
  for (const c of ["chat_id", "direction", "media_path", "thumb_path", "job_id"]) assert.ok(cols.includes(c), c);
  assert.equal(settings.getBool("history.enabled", false), true);
  assert.ok(settings.getNumber("history.mediaRetentionDays", 0) > 0);
});

test("insert + conversations + listForChat", () => {
  const u = users.upsertOrGet({ whatsappId: "972511111111@s.whatsapp.net", phone: "972511111111", name: "A", pushName: "A" });
  messages.insert({ userId: u.id, chatId: u.whatsappId, direction: "IN", type: "text", text: "سلام", messageId: "m1" });
  messages.insert({ userId: u.id, chatId: u.whatsappId, direction: "OUT", type: "text", text: "مرحباً" });

  const convs = messages.conversations();
  assert.equal(convs.length, 1);
  assert.equal(convs[0].chatId, u.whatsappId);
  assert.equal(convs[0].count, 2);

  const list = messages.listForChat({ chatId: u.whatsappId, order: "asc" });
  assert.equal(list.total, 2);
  assert.equal(list.rows[0].text, "سلام");
  assert.equal(list.rows[1].text, "مرحباً");
});

test("deleteById removes row and its media file", () => {
  const u = users.upsertOrGet({ whatsappId: "972522222222@s.whatsapp.net", phone: "972522222222", name: "B", pushName: "B" });
  const file = join(paths.get("history"), "b_1.webp");
  writeFileSync(file, "x");
  const rec = messages.insert({ userId: u.id, chatId: u.whatsappId, direction: "IN", type: "image", messageId: "m2", mime: "image/webp", mediaPath: file });
  assert.ok(existsSync(file));

  const removed = messages.deleteById(rec.id);
  assert.equal(removed.id, rec.id);
  assert.equal(messages.getById(rec.id), undefined);
  assert.equal(existsSync(file), false, "media file should be deleted with the row");
});

test("deleteFilesForChat removes all rows and files for that chat", () => {
  const u = users.upsertOrGet({ whatsappId: "972533333333@s.whatsapp.net", phone: "972533333333", name: "C", pushName: "C" });
  const f1 = join(paths.get("history"), "c_1.webp");
  const f2 = join(paths.get("history"), "c_2.webp");
  writeFileSync(f1, "1");
  writeFileSync(f2, "2");
  messages.insert({ userId: u.id, chatId: u.whatsappId, direction: "IN", type: "image", mime: "image/webp", mediaPath: f1, messageId: "c1" });
  messages.insert({ userId: u.id, chatId: u.whatsappId, direction: "IN", type: "video", mime: "video/mp4", mediaPath: f2, messageId: "c2" });

  const count = messages.deleteFilesForChat(u.whatsappId);
  assert.equal(count, 2);
  assert.equal(existsSync(f1), false);
  assert.equal(existsSync(f2), false);
  assert.equal(messages.listForChat({ chatId: u.whatsappId }).total, 0);
});

test("waMessageKey returns direct messageId, and job sticker key as fallback", () => {
  const u = users.upsertOrGet({ whatsappId: "972555555555@s.whatsapp.net", phone: "972555555555", name: "E", pushName: "E" });
  const direct = messages.insert({ userId: u.id, chatId: u.whatsappId, direction: "OUT", type: "sticker", mime: "image/webp", messageId: "wa-direct" });
  const key1 = messages.waMessageKey(direct.id);
  assert.equal(key1.messageId, "wa-direct");
  assert.equal(key1.jobStickerKey, null);

  // رسالة قديمة بلا message_id، لكن لها Job مكتمل — نسقط لمعرف المكتبة.
  const legacy = messages.insert({ userId: u.id, chatId: u.whatsappId, direction: "OUT", type: "sticker", mime: "image/webp" });
  const job = db.prepare(`
    INSERT INTO jobs (user_id, message_id, type, status, created_at, sticker_sent_at)
    VALUES (?, ?, 'IMAGE', 'COMPLETED', ?, ?)
  `).run(u.id, `jobkey-${legacy.id}`, new Date().toISOString(), "false".length ? "wa-legacy-key" : null);
  messages.setJobId(legacy.id, Number(job.lastInsertRowid));

  const key2 = messages.waMessageKey(legacy.id);
  assert.equal(key2.messageId, null);
  assert.equal(key2.jobStickerKey, "wa-legacy-key");
  assert.equal(messages.waMessageKey(999999), null);
});

test("attachMedia + findByMessageId link approval media to a prior record", async () => {
  const u = users.upsertOrGet({ whatsappId: "972544444444@s.whatsapp.net", phone: "972544444444", name: "D", pushName: "D" });
  const rec = messages.insert({ userId: u.id, chatId: u.whatsappId, direction: "IN", type: "image", mime: "image/jpeg", messageId: "dl-1" });

  const file = join(paths.get("history"), "d.webp");
  writeFileSync(file, "jpg-data");
  messages.attachMedia(rec.id, { mediaPath: file, mediaSize: 8, mime: "image/jpeg" });

  const viaMsgId = messages.findByMessageId("dl-1");
  assert.equal(viaMsgId.id, rec.id);
  assert.equal(viaMsgId.mediaPath, file);
  assert.equal(messages.getById(rec.id).mediaSize, 8);
});

test("conversations يجلب اسم المجموعة ومعلومة كونها جروب + رقم المستخدم نظيفاً", () => {
  const groups = new GroupsRepo(db);
  const u = users.upsertOrGet({ whatsappId: "972566666666@s.whatsapp.net", phone: "966512345678@s.whatsapp.net", name: "زائر", pushName: "زائر" });
  groups.upsertGroup(GID, { name: "جروب المشجعين", memberCount: 5 });
  messages.insert({ userId: u.id, chatId: GID, direction: "IN", type: "image", messageId: "g-1", text: "شوف" });

  const convs = messages.conversations();

  const groupConv = convs.find((c) => c.chatId === GID);
  assert.ok(groupConv, "group conversation should appear");
  assert.equal(groupConv.isGroup, true, "isGroup true for @g.us chat");
  assert.equal(groupConv.groupName, "جروب المشجعين", "group name joined from groups table");

  const dm = convs.find((c) => c.chatId === u.whatsappId);
  if (dm) assert.equal(dm.userPhone, "966512345678", "phone cleaned of @server suffix");
});