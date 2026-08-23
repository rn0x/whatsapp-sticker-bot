import { nowIso } from "../../utils/time.mjs";

export const version = 3;
export const name = "seed_default_settings";

const DEFAULTS = {
  "bot.name": { value: "Sticker Bot", type: "string" },
  "bot.stickerPack": { value: "Sticker Bot", type: "string" },
  "bot.stickerAuthor": { value: "Sticker Bot", type: "string" },

  "quota.defaultDailyQuota": { value: 50, type: "number" },
  "quota.mode": { value: "rolling_24h", type: "string" }, // rolling_24h|daily_fixed|unlimited

  "queue.maxMediaWorkers": { value: 4, type: "number" },
  "queue.maxDownloadWorkers": { value: 2, type: "number" },
  "queue.maxQueueSize": { value: 100000, type: "number" },
  "queue.maxPendingJobsPerUser": { value: 50, type: "number" },
  "queue.jobLeaseTimeoutMs": { value: 600000, type: "number" },  // 10 min
  "queue.jobHeartbeatIntervalMs": { value: 30000, type: "number" },
  "queue.maxRetries": { value: 5, type: "number" },
  "queue.retryBackoffBaseMs": { value: 10000, type: "number" },  // 10s→30s→60s→120s

  "media.maxImageBytes": { value: 20 * 1024 * 1024, type: "number" },
  "media.maxVideoBytes": { value: 64 * 1024 * 1024, type: "number" },
  "media.maxVideoDurationSeconds": { value: 30, type: "number" },
  "media.stickerMaxFps": { value: 30, type: "number" },
  "media.stickerQuality": { value: 90, type: "number" },
  "media.stickerSize": { value: 512, type: "number" },

  "storage.cacheRetentionHours": { value: 6, type: "number" },
  "storage.failedRetentionDays": { value: 7, type: "number" },
  "storage.logsRetentionDays": { value: 30, type: "number" },
  "storage.cleanupIntervalMinutes": { value: 60, type: "number" },
  "storage.diskFreeSpaceThresholdMb": { value: 2000, type: "number" },

  "whatsapp.groupMode": { value: "AUTO", type: "string" },
  "whatsapp.autoReconnect": { value: true, type: "boolean" },
  "whatsapp.provider": { value: "wwebjs", type: "string" },
  "whatsapp.sessionInstanceId": { value: "primary", type: "string" },
  "whatsapp.instanceName": { value: "Sticker Bot", type: "string" },

  "rateLimit.perUserPerMinute": { value: 5, type: "number" },
  "rateLimit.perGroupPerMinute": { value: 10, type: "number" },
  "rateLimit.globalPerMinute": { value: 120, type: "number" },
  "rateLimit.maxInvalidPerHour": { value: 10, type: "number" },

  "admin.lockTimeoutMinutes": { value: 10, type: "number" },
  "admin.requireLogin": { value: false, type: "boolean" },

  "history.enabled": { value: true, type: "boolean" },
  "history.mediaRetentionDays": { value: 30, type: "number" },

  "app.language": { value: "ar", type: "string" },
  "app.autoUpdateEnabled": { value: false, type: "boolean" },
};

export function up(db) {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)"
  );
  const now = nowIso();
  db.transaction(() => {
    for (const [key, def] of Object.entries(DEFAULTS)) {
      insert.run(key, JSON.stringify(def), now);
    }
  });
}