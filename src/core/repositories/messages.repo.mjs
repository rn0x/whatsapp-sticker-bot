// MessagesRepo — سجل المحادثات: حفظ الرسائل الواردة/الصادرة، سردها، حذفها،
// وإدارة الملفات المرتبطة (الوسائط والمعاينات) عند الحذف.
import { unlinkSync, existsSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { nowIso } from "../../utils/time.mjs";
import { rowToCamel, rowsToCamel } from "../../utils/keys.mjs";

const COLS = [
  "id", "user_id", "chat_id", "direction", "type", "text", "mime",
  "media_path", "thumb_path", "media_size", "media_meta", "message_id",
  "job_id", "admin_sent", "created_at",
].join(", ");

export class MessagesRepo {
  constructor(db) {
    this.db = db;
  }

  insert({ userId, chatId, direction, type, text = null, mime = null, mediaPath = null, thumbPath = null, mediaSize = null, mediaMeta = null, messageId = null, jobId = null, adminSent = false }) {
    const now = nowIso();
    const r = this.db.prepare(`
      INSERT INTO messages
        (user_id, chat_id, direction, type, text, mime, media_path, thumb_path, media_size, media_meta, message_id, job_id, admin_sent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING ${COLS}
    `).get(
      userId, chatId, direction, type, text ?? null, mime ?? null,
      mediaPath ?? null, thumbPath ?? null,
      mediaSize ?? null, mediaMeta ? JSON.stringify(mediaMeta) : null,
      messageId ?? null, jobId ?? null, adminSent ? 1 : 0, now
    );
    return rowToCamel(r);
  }

  getById(id) {
    const r = this.db.prepare(`SELECT ${COLS} FROM messages WHERE id=?`).get(id);
    return rowToCamel(r);
  }

  // مفاتيح رسالة واتساب لإعادة حذفها "للجميع": المعرف المباشر المسجّل في
  // messages.message_id، أو معرف المكتبة من الـ Job المرتبط (sticker_sent_at)
  // للمهام المكتملة قبل ربط المعرّف.
  waMessageKey(id) {
    const r = this.db.prepare(`
      SELECT m.id, m.chat_id, m.direction, m.message_id, m.job_id,
             j.sticker_sent_at AS job_sticker_key
      FROM messages m
      LEFT JOIN jobs j ON j.id = m.job_id
      WHERE m.id = ?
    `).get(Number(id));
    return r ? rowToCamel(r) : null;
  }

  // ربط الـ Job برسالة سبق تسجيلها.
  setJobId(id, jobId) {
    this.db.prepare("UPDATE messages SET job_id=? WHERE id=?").run(jobId ?? null, id);
    return this.getById(id);
  }

  // ربط ملف الوسيط برسالة سبق تسجيلها (يحدث بعد التنزيل).
  attachMedia(id, { mediaPath, thumbPath, mediaSize, mime, mediaMeta }) {
    const meta = mediaMeta ? JSON.stringify(mediaMeta) : null;
    this.db.prepare(`
      UPDATE messages SET media_path=?, thumb_path=?, media_size=?, mime=COALESCE(?, mime), media_meta=COALESCE(?, media_meta)
      WHERE id=?
    `).run(mediaPath ?? null, thumbPath ?? null, mediaSize ?? null, mime ?? null, meta, id);
    return this.getById(id);
  }

  // أحدث رسالة لكل محادثة (لصفحة المحادثات). يشمل الجروبات بأسمائها والمستخدمين.
  conversations({ limit = 100 } = {}) {
    const rows = this.db.prepare(`
      SELECT m.chat_id AS chatId,
             (SELECT user_id FROM messages c WHERE c.chat_id = m.chat_id ORDER BY created_at DESC, id DESC LIMIT 1) AS userId,
             m.type AS lastType, m.text AS lastText, m.created_at AS lastAt, m.direction AS lastDirection,
             CASE WHEN m.chat_id LIKE '%@g.us' THEN 1 ELSE 0 END AS isGroup,
             (SELECT g.name FROM groups g WHERE g.group_id = m.chat_id) AS groupName,
             (SELECT COUNT(*) FROM messages c WHERE c.chat_id = m.chat_id) AS count
      FROM messages m
      WHERE m.id = (SELECT id FROM messages WHERE chat_id = m.chat_id ORDER BY created_at DESC, id DESC LIMIT 1)
      ORDER BY m.created_at DESC
      LIMIT ?
    `).all(limit);
    const withUser = rows.map((r) => {
      const u = r.userId
        ? this.db.prepare("SELECT id, whatsapp_id, name, push_name, phone, status FROM users WHERE id=?").get(r.userId)
        : null;
      return { ...r, user: u || null };
    });
    return withUser.map((r) => ({
      chatId: r.chatId,
      userId: r.userId,
      isGroup: !!r.isGroup,
      groupName: r.groupName || null,
      userName: r.user?.name || r.user?.push_name || cleanPhone(r.user?.phone) || "مستخدم",
      userPhone: cleanPhone(r.user?.phone) || null,
      lastMessage: r.lastText || "",
      lastType: r.lastType,
      lastDirection: r.lastDirection,
      lastAt: r.lastAt,
      count: r.count,
    }));
  }

  listForChat({ chatId, userId, limit = 100, offset = 0, order = "desc" } = {}) {
    const where = [];
    const vals = [];
    if (chatId) { where.push("chat_id=?"); vals.push(chatId); }
    if (userId) { where.push("user_id=?"); vals.push(userId); }
    const dir = order === "asc" ? "ASC" : "DESC";
    const sql = `
      SELECT ${COLS} FROM messages
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY created_at ${dir}, id ${dir}
      LIMIT ? OFFSET ?`;
    const rows = this.db.prepare(sql).all(...vals, limit, offset);
    return {
      rows: rowsToCamel(rows).map((r) => (r.media_meta ? { ...r, mediaMeta: safeParse(r.media_meta) } : r)),
      total: this.db.prepare(
        `SELECT COUNT(*) AS c FROM messages ${where.length ? "WHERE " + where.join(" AND ") : ""}`
      ).get(...vals).c,
    };
  }

  // حذف رسالة واحدة + إزالة ملفاتها.
  deleteById(id) {
    const row = this.getById(id);
    if (!row) return null;
    this.db.prepare("DELETE FROM messages WHERE id=?").run(id);
    removeFiles(row);
    return row;
  }

  // حذف كل محادثة (حسب chatId أو userId) + إزالة ملفاتها.
  deleteFilesForChat(chatId) {
    const rows = this.db.prepare(`SELECT ${COLS} FROM messages WHERE chat_id=?`).all(chatId);
    for (const r of rows) removeFiles(rowToCamel(r));
    this.db.prepare("DELETE FROM messages WHERE chat_id=?").run(chatId);
    return rows.length;
  }

  deleteFilesForUser(userId) {
    const rows = this.db.prepare(`SELECT ${COLS} FROM messages WHERE user_id=?`).all(userId);
    for (const r of rows) removeFiles(rowToCamel(r));
    this.db.prepare("DELETE FROM messages WHERE user_id=?").run(userId);
    return rows.length;
  }

  // لربط الـ Job بالرسالة المرتبطة بمعرف واتساب.
  findByMessageId(messageId) {
    const r = this.db.prepare(`SELECT id FROM messages WHERE message_id=? ORDER BY id DESC LIMIT 1`).get(messageId);
    return r ? this.getById(r.id) : null;
  }

  countDays(lookup) {
    const t = nowIso();
    return this.db.prepare("SELECT COUNT(*) AS c FROM messages WHERE direction=? AND created_at>=?").get(lookup, t).c;
  }
}

function safeParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

// «966512345678@s.whatsapp.net» → «966512345678»
function cleanPhone(p) {
  if (!p) return null;
  return String(p).split("@")[0].split(":")[0].trim() || null;
}

// حذف ملف الوسيط والمعاينة إن وُجدا (يمسح النسخ من القرص كونها نسخاً للسجل).
export function removeFiles(row) {
  for (const key of ["mediaPath", "thumbPath"]) {
    const p = row?.[key];
    if (p && existsSync(p)) {
      try { unlinkSync(p); } catch { /* خامل */ }
    }
  }
  const mediaDir = row?.mediaPath ? dirname(row.mediaPath) : (row?.thumbPath ? dirname(row.thumbPath) : null);
  if (mediaDir && existsSync(mediaDir)) {
    try {
      if (readdirSync(mediaDir).length === 0) unlinkSync(mediaDir);
    } catch { /* خامل */ }
  }
}