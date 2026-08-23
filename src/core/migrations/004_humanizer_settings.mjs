import { nowIso } from "../../utils/time.mjs";

export const version = 4;
export const name = "humanizer_and_theme_settings";

const DEFAULTS = {
  // ===== سلوك إنساني =====
  "humanizer.enabled": { value: true, type: "boolean" },
  "humanizer.typingEnabled": { value: true, type: "boolean" },
  "humanizer.markSeenEnabled": { value: true, type: "boolean" },
  "humanizer.replyDelayMinMs": { value: 1500, type: "number" },
  "humanizer.replyDelayMaxMs": { value: 7000, type: "number" },

  // ===== الاتصال =====
  "whatsapp.autoConnectOnBoot": { value: true, type: "boolean" },

  // ===== المظهر =====
  "app.theme": { value: "dark", type: "string" },
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