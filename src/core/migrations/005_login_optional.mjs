import { nowIso } from "../../utils/time.mjs";

export const version = 5;
export const name = "login_optional_by_default";

// إلغاء اشتراط تسجيل الدخول افتراضياً — الواجهة تفتح مباشرة على لوحة التحكم.
// يبقى بإمكان المستخدم تفعيل الحماية لاحقاً من الإعدادات (admin.requireLogin) أو عبر ADMIN_PASSWORD.
export function up(db) {
  db.prepare(
    "UPDATE settings SET value_json=?, updated_at=? WHERE key='admin.requireLogin'"
  ).run(JSON.stringify({ value: false, type: "boolean" }), nowIso());
}