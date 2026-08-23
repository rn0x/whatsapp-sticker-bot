import { nowIso } from "../../utils/time.mjs";

export class BackupsRepo {
  constructor(db) {
    this.db = db;
  }

  create({ filename, path, size, encrypted = false, note = null }) {
    const now = nowIso();
    const r = this.db.prepare(
      "INSERT INTO backups (filename, path, size, created_at, encrypted, status, note) VALUES (?,?,?,?,'created',?,?)"
    ).run(filename, path, size || null, now, encrypted ? 1 : 0, note);
    return this.get(r.lastInsertRowid);
  }

  get(id) {
    const r = this.db.prepare("SELECT * FROM backups WHERE id=?").get(id);
    return r ? { ...r, encrypted: !!r.encrypted } : null;
  }

  setStatus(id, status, note) {
    this.db.prepare("UPDATE backups SET status=?, note=? WHERE id=?").run(
      status,
      note ?? null,
      id
    );
    return this.get(id);
  }

  list(limit = 100) {
    return this.db.prepare("SELECT * FROM backups ORDER BY id DESC LIMIT ?").all(limit);
  }
}