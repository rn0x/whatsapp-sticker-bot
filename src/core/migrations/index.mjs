import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso } from "../../utils/time.mjs";

const MIGRATIONS_DIR = fileURLToPath(new URL(".", import.meta.url));

export function listMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.+\.mjs$/.test(f))
    .sort();
}

export async function runMigrations(db) {
  const now = nowIso();
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)"
  );
  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((r) => r.version)
  );
  for (const file of listMigrations()) {
    const mod = await import(join(MIGRATIONS_DIR, file));
    const { version, name, up } = mod;
    if (applied.has(version)) continue;

    db.transaction(() => {
      up(db);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        version,
        name,
        now
      );
    });
  }
  return db.prepare("SELECT version, name FROM schema_migrations ORDER BY version").all();
}