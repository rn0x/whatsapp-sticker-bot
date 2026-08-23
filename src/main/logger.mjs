// Logger مركزي: يكتب في DB (جدول logs) + stdout.
// لا يسجل محتوى رسائل أو أسرار — المتصل مسؤول عن تمرير بيانات آمنة فقط.

import { LogsRepo } from "../core/repositories/logs.repo.mjs";

const SCRUB_KEYS = /(password|secret|token|session|payload_blob|cred|key|pairing|code)/i;

export class Logger {
  constructor(db, { consoleOut = true } = {}) {
    this.repo = new LogsRepo(db);
    this.consoleOut = consoleOut;
  }

  scrub(meta) {
    if (!meta) return undefined;
    if (typeof meta !== "object") return undefined;
    const out = {};
    for (const [k, v] of Object.entries(meta)) {
      if (SCRUB_KEYS.test(k)) continue;
      if (typeof v === "string" && v.length > 500) out[k] = v.slice(0, 500) + "...";
      else if (v && typeof v === "object") out[k] = this.scrub(v);
      else out[k] = v;
    }
    return out;
  }

  _write(level, scope, message, meta) {
    const safe = this.scrub(meta);
    try {
      this.repo.add(level, scope, message, safe);
    } catch {
      // لا نرمي خطأ من logger
    }
    if (this.consoleOut) {
      const stamp = new Date().toISOString();
      const line = `[${stamp}] ${level} ${scope ? `[${scope}]` : ""} ${message}`;
      if (level === "ERROR") console.error(line);
      else if (level === "WARN") console.warn(line);
      else console.log(line);
    }
  }

  info(scope, message, meta) {
    this._write("INFO", scope, message, meta);
  }

  warn(scope, message, meta) {
    this._write("WARN", scope, message, meta);
  }

  error(scope, message, meta) {
    this._write("ERROR", scope, message, meta);
  }
}