import { nowIso } from "../../utils/time.mjs";

export class SessionsRepo {
  constructor(db) {
    this.db = db;
  }

  get(instanceId) {
    const r = this.db.prepare("SELECT * FROM sessions WHERE instance_id=?").get(instanceId);
    if (!r) return null;
    let payload = null;
    try {
      payload = JSON.parse(r.payload_blob);
    } catch {
      payload = null;
    }
    return { instanceId: r.instance_id, provider: r.provider, payload, updatedAt: r.updated_at };
  }

  set(instanceId, provider, payload) {
    const now = nowIso();
    this.db.prepare(`
      INSERT INTO sessions (instance_id, provider, payload_blob, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(instance_id) DO UPDATE SET
        payload_blob=excluded.payload_blob, provider=excluded.provider, updated_at=excluded.updated_at
    `).run(instanceId, provider, JSON.stringify(payload), now);
  }

  delete(instanceId) {
    this.db.prepare("DELETE FROM sessions WHERE instance_id=?").run(instanceId);
  }

  list() {
    return this.db.prepare("SELECT instance_id, provider, updated_at FROM sessions").all();
  }
}