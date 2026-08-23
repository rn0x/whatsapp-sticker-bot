import { nowIso } from "../../utils/time.mjs";

// لا يسجل محتوى رسائل أو أسرار — الطبقة العليا مسؤولة عن ذلك.
export class LogsRepo {
  constructor(db) {
    this.db = db;
  }

  add(level, scope, message, meta) {
    const safeLevel = ["INFO", "WARN", "ERROR"].includes(level) ? level : "INFO";
    this.db.prepare(
      "INSERT INTO logs (level, scope, message, meta_json, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(safeLevel, scope || null, String(message).slice(0, 2000), meta ? JSON.stringify(meta).slice(0, 4000) : null, nowIso());
  }

  info(scope, message, meta) { this.add("INFO", scope, message, meta); }
  warn(scope, message, meta) { this.add("WARN", scope, message, meta); }
  error(scope, message, meta) { this.add("ERROR", scope, message, meta); }

  search({ level, query, scope, limit = 200, offset = 0 } = {}) {
    const where = [];
    const vals = [];
    if (level) {
      where.push("level=?");
      vals.push(level);
    }
    if (scope) {
      where.push("scope=?");
      vals.push(scope);
    }
    if (query) {
      where.push("message LIKE ?");
      vals.push(`%${query}%`);
    }
    const sql = `
      SELECT * FROM logs
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY id DESC LIMIT ? OFFSET ?`;
    const rows = this.db.prepare(sql).all(...vals, limit, offset);
    const count = this.db.prepare(
      `SELECT COUNT(*) AS c FROM logs ${where.length ? "WHERE " + where.join(" AND ") : ""}`
    ).get(...vals);
    return { rows, total: count.c };
  }

  deleteOlderThan(iso) {
    return this.db.prepare("DELETE FROM logs WHERE created_at < ?").run(iso).changes;
  }

  recent(limit = 50) {
    return this.db.prepare("SELECT * FROM logs ORDER BY id DESC LIMIT ?").all(limit);
  }
}