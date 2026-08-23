import { nowIso } from "../../utils/time.mjs";

export class SettingsRepo {
  constructor(db) {
    this.db = db;
  }

  get(key) {
    const r = this.db.prepare("SELECT value_json FROM settings WHERE key=?").get(key);
    if (!r) return undefined;
    const parsed = JSON.parse(r.value_json);
    return typeof parsed === "object" && parsed !== null && "value" in parsed ? parsed.value : parsed;
  }

  getAll() {
    const rows = this.db.prepare("SELECT key, value_json FROM settings").all();
    const out = {};
    for (const r of rows) {
      const parsed = JSON.parse(r.value_json);
      out[r.key] = typeof parsed === "object" && parsed !== null && "value" in parsed ? parsed.value : parsed;
    }
    return out;
  }

  set(key, value) {
    const now = nowIso();
    this.db.prepare(`
      INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
    `).run(key, JSON.stringify({ value }), now);
  }

  setMany(entries) {
    this.db.transaction(() => {
      for (const [k, v] of Object.entries(entries)) this.set(k, v);
    });
  }

  // قراءة مع نوع وتحقق أساسي
  getNumber(key, fallback) {
    const v = this.get(key);
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  }

  getBool(key, fallback) {
    const v = this.get(key);
    return typeof v === "boolean" ? v : fallback;
  }
}