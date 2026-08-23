// حقوق كل مستخدم (تخصيص التحويل من داخل واتساب عبر الأوامر) +
// علم استقبال ترحيب البوت في كل مجموعة (لإرسال التعريف مرة واحدة فقط).
export const version = 8;
export const name = "user_prefs_and_group_welcome";

export function up(db) {
  // علم الترحاب لكل مجموعة — نتجنب إرسال التعريف كلما دخل البوت عنوة.
  const gcols = db.prepare("PRAGMA table_info(groups)").all().map((c) => c.name);
  if (!gcols.includes("bot_welcomed")) {
    db.exec("ALTER TABLE groups ADD COLUMN bot_welcomed INTEGER NOT NULL DEFAULT 0");
  }

  // تفضيلات/حقوق المستخدم: تحويل تلقائي + السماح بالصور (الافتراضي) والفيديوهات.
  db.exec(`
CREATE TABLE IF NOT EXISTS user_prefs (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  auto_convert  INTEGER NOT NULL DEFAULT 1, -- 1 = يحوّل له تلقائياً، 0 = بإذن أوامر فقط
  allow_image   INTEGER NOT NULL DEFAULT 1,
  allow_video   INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL
);
  `);
}