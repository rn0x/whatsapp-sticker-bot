// لغة كل مستخدم (ar/en) — تُضبط من واتساب عبر أمر /lang، وتُرجَع لاحقاً
// عند توليد ردود البوت. الفارغة ترجع إلى إعداد التطبيق app.language.
export const version = 10;
export const name = "user_lang";

export function up(db) {
  const cols = db.prepare("PRAGMA table_info(user_prefs)").all().map((c) => c.name);
  if (!cols.includes("lang")) {
    db.exec("ALTER TABLE user_prefs ADD COLUMN lang TEXT");
  }
}
