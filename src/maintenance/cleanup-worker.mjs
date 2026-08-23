// CleanupWorker — صيانة دورية للملفات وقاعدة البيانات.
// لا يمسّ أي ملف مرتبط بجوب QUEUED/PROCESSING/SENDING.
import { readdir, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync, statSync } from "node:fs";
import { addMs } from "../utils/time.mjs";
import { rowToCamel } from "../utils/keys.mjs";
import { removeFiles } from "../core/repositories/messages.repo.mjs";

export class CleanupWorker {
  constructor({ db, queue, quota, settings, logger, paths, cache }) {
    this.db = db;
    this.queue = queue;
    this.quota = quota;
    this.settings = settings;
    this.logger = logger;
    this.paths = paths;
    this.cache = cache;
    this.timer = null;
  }

  start() {
    const interval = this.settings.getNumber("storage.cleanupIntervalMinutes", 60) * 60_000;
    this.timer = setInterval(() => this.run().catch((e) => this.logger.error("cleanup", "run failed", { err: e.message })), interval);
    if (this.timer.unref) this.timer.unref();
    this.logger.info("cleanup", `cleanup worker started (every ${interval / 60000}min)`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async run() {
    const started = Date.now();
    const deletedCache = this.cache.deleteExpired();
    const deletedLogs = this._deleteOldLogs();
    const releasedQuota = this.quota.releaseStale();
    const expiredHistory = this._expireHistory();
    const orphan = await this._orphanFiles();
    this.logger.info("cleanup", "run complete", {
      cache: deletedCache,
      logs: deletedLogs,
      quotaReleased: releasedQuota,
      historyMedia: expiredHistory,
      orphanFiles: orphan,
      ms: Date.now() - started,
    });
  }

  _deleteOldLogs() {
    const days = this.settings.getNumber("storage.logsRetentionDays", 30);
    return this.db.prepare("DELETE FROM logs WHERE created_at < ?").run(addMs(new Date().toISOString(), -days * 86400000)).changes;
  }

  // إزالة نسخ وسائط السجل التي تجاوزت مدة الاحتفاظ (history.mediaRetentionDays).
  _expireHistory() {
    if (!this.settings.getBool("history.enabled", true)) return 0;
    const days = this.settings.getNumber("history.mediaRetentionDays", 30);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const rows = this.db.prepare(
      "SELECT * FROM messages WHERE created_at < ? AND (media_path IS NOT NULL OR thumb_path IS NOT NULL)"
    ).all(cutoff).map(rowToCamel);
    for (const r of rows) removeFiles(r);
    if (rows.length) {
      const ids = rows.map((r) => r.id);
      this.db.prepare(`DELETE FROM messages WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
    }
    return rows.length;
  }

  // ملفات orphaned: في staging/completed/cache/processing لا تشير إليها أي سماعات حيّة.
  async _orphanFiles() {
    // سماعات حالية: input_path للصفوف الحية + cache paths + outputs للمكتمل حديثاً
    const liveInputs = new Set(
      this.db.prepare(
        "SELECT input_path FROM jobs WHERE status IN ('QUEUED','PROCESSING','SENDING') AND input_path IS NOT NULL"
      ).all().map((r) => r.input_path)
    );
    const cachePaths = new Set(this.db.prepare("SELECT path FROM file_cache").all().map((r) => r.path));
    const recentOutputs = new Set(
      this.db.prepare(
        "SELECT output_path FROM jobs WHERE completed_at > ? AND output_path IS NOT NULL"
      ).all(new Date(Date.now() - 86400000).toISOString()).map((r) => r.output_path)
    );

    let removed = 0;
    // staging: مدخلات الـ Jobs الحية فقط محفوظة؛ أي ملف آخر يتيم.
    const stagingFiles = await readdir(this.paths.get("staging")).catch(() => []);
    for (const f of stagingFiles) {
      const fp = join(this.paths.get("staging"), f);
      if (!liveInputs.has(fp) && isOlderThan(fp, 1)) {
        await unlink(fp).catch(() => {});
        removed++;
      }
    }
    // cache: الملفات المرتبطة فقط (CacheExpired تعالج الانتهاء).
    // completed: مخرجات ليست حديثة (Retention يوم واحد للأغراض).
    for (const dir of ["completed", "cache"]) {
      const files = await readdir(this.paths.get(dir)).catch(() => []);
      for (const f of files) {
        const fp = join(this.paths.get(dir), f);
        if (dir === "cache" && !cachePaths.has(fp)) {
          await unlink(fp).catch(() => {});
          removed++;
          continue;
        }
        if (dir === "completed" && !cachePaths.has(fp) && !recentOutputs.has(fp) && isOlderThan(fp, 1)) {
          await unlink(fp).catch(() => {});
          removed++;
        }
      }
    }
    return removed;
  }
}

function isOlderThan(filePath, days) {
  if (!existsSync(filePath)) return true;
  const mtime = statSync(filePath).mtimeMs;
  return Date.now() - mtime > days * 86400000;
}