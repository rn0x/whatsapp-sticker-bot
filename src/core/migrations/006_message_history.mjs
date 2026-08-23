export const version = 6;
export const name = "message_history";

// سجل المحادثات لكل مستخدم/محادثة — يحفظ الرسائل الواردة والصادرة
// مع نسخة من الوسائط (للمعاينة والحذف) بدون لمس بيانات الـ Jobs.
export function up(db) {
  db.exec(`
CREATE TABLE messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id      TEXT NOT NULL,               -- JID المستخدم أو المجموعة
  direction    TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  type         TEXT NOT NULL,               -- text|image|video|document|sticker|audio
  text         TEXT,
  mime         TEXT,
  media_path   TEXT,                        -- نسخة الوسيط داخل مجلد history
  thumb_path   TEXT,                        -- معاينة مصغرة (صور)
  media_size   INTEGER,
  media_meta   TEXT,                        -- JSON: filename/duration/filename
  message_id   TEXT,                        -- معرف واتساب الأصلي (لربط الملف)
  job_id       INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  admin_sent   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_messages_user_time  ON messages(user_id, created_at DESC);
CREATE INDEX idx_messages_chat_time  ON messages(chat_id, created_at DESC);
CREATE INDEX idx_messages_message_id ON messages(message_id);
`);

  // إعدادات السجل (لقواعد البيانات القائمة التي نُسّبت مسبقاً قبل هذا الإصدار).
  const insert = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)"
  );
  const now = new Date().toISOString();
  insert.run("history.enabled", JSON.stringify({ value: true, type: "boolean" }), now);
  insert.run("history.mediaRetentionDays", JSON.stringify({ value: 30, type: "number" }), now);
}