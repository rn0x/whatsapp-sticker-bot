import { nowIso, addMs } from "../../utils/time.mjs";

export class CacheRepo {
  constructor(db) {
    this.db = db;
  }

  getFresh(hash, { allowOtherUsers = false, userId, now } = {}) {
    const nowIsoVal = now || nowIso();
    const base = `SELECT * FROM file_cache WHERE hash=? AND expires_at > ? AND path IS NOT NULL`;
    let row;
    if (allowOtherUsers) {
      row = this.db.prepare(base + " LIMIT 1").get(hash, nowIsoVal);
    } else {
      row = this.db.prepare(base + " AND (user_id IS NULL OR user_id=?) LIMIT 1").get(hash, nowIsoVal, userId);
    }
    return row ? { ...row, payload: undefined } : null;
  }

  put({ hash, path, kind, size, jobId, userId, retentionHours }) {
    const now = nowIso();
    const expires = addMs(now, retentionHours * 3600 * 1000);
    this.db.prepare(`
      INSERT INTO file_cache (hash, path, kind, size, job_id, user_id, created_at, expires_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(hash) DO UPDATE SET path=excluded.path, kind=excluded.kind,
        size=excluded.size, expires_at=excluded.expires_at
    `).run(hash, path, kind, size, jobId || null, userId || null, now, expires);
  }

  deleteExpired() {
    const now = nowIso();
    return this.db.prepare("DELETE FROM file_cache WHERE expires_at < ?").run(now).changes;
  }

  deleteById(id) {
    return this.db.prepare("DELETE FROM file_cache WHERE id=?").run(id).changes;
  }

  count() {
    return this.db.prepare("SELECT COUNT(*) AS c FROM file_cache").get().c;
  }
}