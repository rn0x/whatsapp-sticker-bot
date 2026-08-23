// اسم مجموعة الملصق والمؤلف لكل مستخدم (يتحكم بهما من واتساب عبر الأوامر
// /اسم و/مؤلف) — الفارغة ترجع إلى الإعدادات العامة bot.stickerPack/stickerAuthor.
export const version = 9;
export const name = "user_sticker_pack_author";

export function up(db) {
  const cols = db.prepare("PRAGMA table_info(user_prefs)").all().map((c) => c.name);
  if (!cols.includes("pack_name")) {
    db.exec("ALTER TABLE user_prefs ADD COLUMN pack_name TEXT");
  }
  if (!cols.includes("pack_author")) {
    db.exec("ALTER TABLE user_prefs ADD COLUMN pack_author TEXT");
  }
}