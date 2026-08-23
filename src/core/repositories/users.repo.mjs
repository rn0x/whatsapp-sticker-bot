import { nowIso } from "../../utils/time.mjs";
import { rowToCamel, rowsToCamel } from "../../utils/keys.mjs";

const USER_COLS = [
  "id", "whatsapp_id", "phone", "name", "push_name", "first_seen_at", "last_seen_at",
  "welcome_sent", "status", "role", "quota_limit", "quota_mode", "priority",
  "created_at", "updated_at",
].join(", ");

export class UsersRepo {
  constructor(db) {
    this.db = db;
  }

  getById(id) {
    const r = this.db.prepare(`SELECT ${USER_COLS} FROM users WHERE id=?`).get(id);
    return rowToCamel(r);
  }

  getByWhatsAppId(whatsappId) {
    const r = this.db.prepare(`SELECT ${USER_COLS} FROM users WHERE whatsapp_id=?`).get(whatsappId);
    return rowToCamel(r);
  }

  getByPhone(phone) {
    if (!phone) return null;
    const r = this.db.prepare(`SELECT ${USER_COLS} FROM users WHERE phone=?`).get(phone);
    return rowToCamel(r);
  }

  // find أو create — يسجّل first_seen وlast_seen.
  upsertOrGet({ whatsappId, phone, name, pushName }) {
    const now = nowIso();
    const insert = this.db.prepare(`
      INSERT INTO users (whatsapp_id, phone, name, push_name, first_seen_at, last_seen_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(whatsapp_id) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        push_name    = COALESCE(excluded.push_name, users.push_name),
        name         = COALESCE(excluded.name, users.name),
        updated_at   = excluded.updated_at
      RETURNING ${USER_COLS}
    `);
    const r = insert.get(whatsappId, phone || null, name || null, pushName || null, now, now, now, now);
    return rowToCamel(r);
  }

  touchLastSeen(id) {
    this.db.prepare("UPDATE users SET last_seen_at=? WHERE id=?").run(nowIso(), id);
  }

  setWelcomeSent(id) {
    this.db.prepare("UPDATE users SET welcome_sent=1 WHERE id=?").run(id);
  }

  update(id, fields) {
    const allowed = ["phone", "name", "push_name", "status", "role", "quota_limit", "quota_mode", "priority"];
    const sets = [];
    const vals = [];
    for (const k of allowed) {
      if (fields[k] !== undefined) {
        sets.push(`${k}=?`);
        vals.push(fields[k]);
      }
    }
    if (!sets.length) return this.getById(id);
    sets.push("updated_at=?");
    vals.push(nowIso(), id);
    this.db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id=?`).run(...vals);
    return this.getById(id);
  }

  setBlocked(id, blocked) {
    return this.update(id, { status: blocked ? "BLOCKED" : "ACTIVE" });
  }

  search({ query, status, role, sort, order, limit = 50, offset = 0 } = {}) {
    const where = [];
    const vals = [];
    if (query) {
      where.push(`(whatsapp_id LIKE ? OR phone LIKE ? OR name LIKE ?)`);
      const like = `%${query}%`;
      vals.push(like, like, like);
    }
    if (status) {
      where.push("status=?");
      vals.push(status);
    }
    if (role) {
      where.push("role=?");
      vals.push(role);
    }
    const sortCol = ["last_seen_at", "first_seen_at", "created_at", "id", "quota_limit"].includes(sort)
      ? sort : "id";
    const dir = order === "asc" ? "ASC" : "DESC";
    const sql = `
      SELECT ${USER_COLS} FROM users
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY ${sortCol} ${dir}
      LIMIT ? OFFSET ?`;
    const rows = this.db.prepare(sql).all(...vals, limit, offset);
    const countRow = this.db.prepare(
      `SELECT COUNT(*) AS c FROM users ${where.length ? "WHERE " + where.join(" AND ") : ""}`
    ).get(...vals);
    return { rows: rowsToCamel(rows), total: countRow.c };
  }

  getUserStats(id) {
    const r = this.db.prepare(`
      SELECT
        COUNT(*) AS total_jobs,
        SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) AS successful,
        SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN type='IMAGE' THEN 1 ELSE 0 END) AS images,
        SUM(CASE WHEN type='VIDEO' THEN 1 ELSE 0 END) AS videos,
        MAX(completed_at) AS last_job_at,
        AVG(CASE WHEN completed_at IS NOT NULL AND started_at IS NOT NULL
                 THEN (julianday(completed_at) - julianday(started_at)) * 86400000 END) AS avg_processing_ms
      FROM jobs WHERE user_id=?
    `).get(id);
    const quota = this.db.prepare(`
      SELECT COALESCE(SUM(amount),0) AS used FROM quota_usage WHERE user_id=?
    `).get(id);
    return { ...rowToCamel(r), quotaUsed: quota.used };
  }

  counts() {
    const r = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status='ACTIVE' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN role='PREMIUM' THEN 1 ELSE 0 END) AS premium,
        SUM(CASE WHEN status='BLOCKED' THEN 1 ELSE 0 END) AS blocked
      FROM users
    `).get();
    return { total: r.total || 0, active: r.active || 0, premium: r.premium || 0, blocked: r.blocked || 0 };
  }

  deleteUser(id) {
    this.db.prepare("DELETE FROM users WHERE id=?").run(id);
  }

  resetQuota(id) {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM quota_usage WHERE user_id=?").run(id);
      this.db.prepare("DELETE FROM quota_reservations WHERE user_id=?").run(id);
    });
  }

  // عند إنشاء/تأكيد جلسة مستخدم جديد
  ensureSchedule(id) {
    this.db.prepare("INSERT OR IGNORE INTO user_schedule (user_id, weight) VALUES (?, 1)").run(id);
  }

  // ===== حقوق/تفضيلات المستخدم (يغيّرها هو من واتساب عبر الأوامر) =====
  getPrefs(userId) {
    if (!userId) return null;
    const r = this.db.prepare("SELECT * FROM user_prefs WHERE user_id=?").get(userId);
    if (!r) return { userId, autoConvert: 1, allowImage: 1, allowVideo: 1, packName: null, packAuthor: null };
    return {
      userId: r.user_id,
      autoConvert: r.auto_convert === 1,
      allowImage: r.allow_image === 1,
      allowVideo: r.allow_video === 1,
      packName: r.pack_name || null,
      packAuthor: r.pack_author || null,
    };
  }

  updatePrefs(userId, fields = {}) {
    if (!userId) return this.getPrefs(userId);
    // نقبل المفاتيح camelCase (autoConvert) وsnake_case (auto_convert) معاً.
    const f = {
      auto_convert: fields.auto_convert !== undefined ? fields.auto_convert : fields.autoConvert,
      allow_image: fields.allow_image !== undefined ? fields.allow_image : fields.allowImage,
      allow_video: fields.allow_video !== undefined ? fields.allow_video : fields.allowVideo,
    };
    const now = nowIso();
    const cur = this.db.prepare("SELECT * FROM user_prefs WHERE user_id=?").get(userId);
    if (!cur) {
      this.db.prepare(
        "INSERT INTO user_prefs (user_id, auto_convert, allow_image, allow_video, pack_name, pack_author, updated_at) VALUES (?,?,?,?,?,?,?)"
      ).run(
        userId,
        f.auto_convert !== undefined ? (f.auto_convert ? 1 : 0) : 1,
        f.allow_image !== undefined ? (f.allow_image ? 1 : 0) : 1,
        f.allow_video !== undefined ? (f.allow_video ? 1 : 0) : 1,
        fields.pack_name !== undefined ? fields.pack_name : (fields.packName ?? null),
        fields.pack_author !== undefined ? fields.pack_author : (fields.packAuthor ?? null),
        now
      );
    } else {
      const next = { auto_convert: cur.auto_convert, allow_image: cur.allow_image, allow_video: cur.allow_video };
      for (const k of ["auto_convert", "allow_image", "allow_video"]) {
        if (f[k] !== undefined) next[k] = f[k] ? 1 : 0;
      }
      const packName = fields.pack_name !== undefined ? fields.pack_name : (fields.packName !== undefined ? fields.packName : cur.pack_name);
      const packAuthor = fields.pack_author !== undefined ? fields.pack_author : (fields.packAuthor !== undefined ? fields.packAuthor : cur.pack_author);
      this.db.prepare(
        "UPDATE user_prefs SET auto_convert=?, allow_image=?, allow_video=?, pack_name=?, pack_author=?, updated_at=? WHERE user_id=?"
      ).run(next.auto_convert, next.allow_image, next.allow_video, packName ?? null, packAuthor ?? null, now, userId);
    }
    return this.getPrefs(userId);
  }
}