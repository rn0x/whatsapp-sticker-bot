// إعدادات التشغيل والمسارات — لا تعتمد على Electron (يعمل في الاختبارات أيضاً).
// مسار البيانات يُحدد عبر APP_DATA_DIR أو افتراضياً: ./data في التطوير.

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { env } from "node:process";

export function defaultDataDir(appName = "whatsapp-sticker-bot") {
  return env.APP_DATA_DIR || join(process.cwd(), "data");
}

const DIRS = {
  incoming: "incoming",
  staging: "staging",
  processing: "processing",
  completed: "completed",
  failed: "failed",
  cache: "cache",
  temp: "temp",
  backups: "backups",
  exports: "exports",
  history: "history",
  data: ".",
  base: ".",
};

export class AppPaths {
  constructor(dataDir) {
    this.dataDir = resolve(dataDir);
    this.dirs = {};
    for (const [key, sub] of Object.entries(DIRS)) {
      this.dirs[key] = join(this.dataDir, sub);
    }
    this.ensure();
  }

  ensure() {
    for (const p of Object.values(this.dirs)) {
      mkdirSync(p, { recursive: true });
    }
  }

  get(key) {
    return this.dirs[key];
  }

  dbPath() {
    return join(this.dataDir, "whatsapp-bot.db");
  }

  makeSubPath(dir, ...parts) {
    // يهيّئ مساراً داخل مجلد معيّن
    return join(this.dirs[dir] || this.dataDir, ...parts);
  }
}

// إعدادات افتراضية من البيئة (تُخزّن فعلياً في جدول settings)
export function envDefaults() {
  return {
    adminPassword: env.ADMIN_PASSWORD || null,
    lockTimeoutMinutes: numEnv(env.LOCK_TIMEOUT_MINUTES, 10),
  };
}

function numEnv(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export { env };