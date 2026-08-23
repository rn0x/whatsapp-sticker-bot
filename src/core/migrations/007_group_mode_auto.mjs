// الوضع الافتراضي للمجموعات الجديدة = AUTO.
// يحدّث القيمة القديمة mention_only (الافتراضي السابق) دون المساس بالاختيار
// الصريح للمستخدم (OFF / MENTION_ONLY / COMMAND_ONLY).
export const version = 7;
export const name = "group_mode_auto_default";

export function up(db) {
  const now = new Date().toISOString();
  const row = db.prepare("SELECT value_json FROM settings WHERE key='whatsapp.groupMode'").get();
  const current = row ? (() => {
    try {
      const p = JSON.parse(row.value_json);
      return typeof p === "object" && p !== null && "value" in p ? p.value : p;
    } catch {
      return undefined;
    }
  })() : undefined;

  if (current !== undefined) {
    if (String(current).toLowerCase() === "mention_only") {
      db.prepare("UPDATE settings SET value_json=?, updated_at=? WHERE key='whatsapp.groupMode'")
        .run(JSON.stringify({ value: "AUTO" }), now);
    }
  } else {
    db.prepare("INSERT OR IGNORE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)")
      .run("whatsapp.groupMode", JSON.stringify({ value: "AUTO" }), now);
  }

  // تنظيف صفوف إعدادات تالفة (معرّف NULL) كانت تُنشأُ قبل إصلاح الواجهة.
  try {
    db.prepare("DELETE FROM group_settings WHERE group_id IS NULL").run();
  } catch { /* schema قديم بلا جدول */ }
}