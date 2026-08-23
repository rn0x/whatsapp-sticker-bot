import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { runMigrations } from "./migrations/index.mjs";

const BUSY_RE = /database is locked|SQLITE_BUSY|database table is locked/i;

const DEFAULT_PRAGMAS = [
  "PRAGMA journal_mode=WAL;",
  "PRAGMA foreign_keys=ON;",
  "PRAGMA synchronous=FULL;",
  "PRAGMA busy_timeout=8000;",
];

export class Database {
  constructor(dbPath, { pragmas = DEFAULT_PRAGMAS } = {}) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.path = dbPath;
    this.raw = new DatabaseSync(dbPath);
    for (const p of pragmas) this.raw.exec(p);
  }

  prepare(sql) {
    return this.raw.prepare(sql);
  }

  exec(sql) {
    return this.raw.exec(sql);
  }

  // executes fn() داخل BEGIN IMMEDIATE مع إعادة محاولة عند القفل.
  // يدعم التعشيش: المعاملات الداخلية تُدمج في المعاملة الخارجية.
  transaction(fn) {
    this._depth = (this._depth || 0) + 1;
    if (this._depth > 1) {
      try {
        return fn();
      } finally {
        this._depth--;
      }
    }
    let lastErr;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        this.raw.exec("BEGIN IMMEDIATE");
        break;
      } catch (err) {
        lastErr = err;
        if (BUSY_RE.test(String(err.message || err)) && attempt < 7) {
          sleep(20 * (attempt + 1));
          continue;
        }
        throw err;
      }
    }
    try {
      const result = fn();
      this.raw.exec("COMMIT");
      this._depth--;
      return result;
    } catch (err) {
      this._depth--;
      try {
        this.raw.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  integrityCheck() {
    const row = this.raw.prepare("PRAGMA integrity_check").get();
    return { ok: row?.integrity_check === "ok", detail: row?.integrity_check };
  }

  // snapshot ذرّي عبر VACUUM INTO — يحتاج فارغاً أولاً.
  backupTo(outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    if (this.path !== ":memory:") {
      this.raw.exec(`VACUUM INTO '${outPath.replaceAll("'", "''")}'`);
    } else {
      throw new Error("cannot backup in-memory database");
    }
    return outPath;
  }

  async migrate() {
    return runMigrations(this);
  }

  close() {
    try {
      this.raw.close();
    } catch {
      /* ignore */
    }
  }
}

export function openDatabase(dbPath) {
  return new Database(dbPath);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}