# BACKUP — النسخ الاحتياطي والاستعادة والتصدير

## Backup

زر **Backup** في صفحة Backups ينشئ `backup-YYYY-MM-DD-HHmmss.zip` يحتوي:

1. **قاعدة البيانات** — snapshot ذرّي عبر `VACUUM INTO 'backup.db'` (بلا إيقاف التطبيق).
2. **الإعدادات** — `settings.json`.
3. **ملفات التنظيم** — عداد الإصدار وmanifest (format version, app version, date, checksums).
4. **الجلسة** — اختيارياً و**مشفرة فقط** (`AES-256-GCM` بمفتاح من `scrypt`) عند اختيار المستخدم.

لا يدخل في الـ zip: ملفات Media (حسب السياسة — نحذفها أصلاً)، ولا أي أسرار غير مشفرة.

سجل في جدول `backups` (filename, path, size, encrypted, status).

## Restore

التسلسل الصارم — الطلب 1..8 (القسم 34 من المواصفات):

1. تحقق من وجود الملف وصحة التوقيع.
2. تحقق من إصدار المانيفست (توافق بنية DB).
3. **نسخة احتياطية تلقائية للحالة الحالية** أولاً (احتياط أمان).
4. إيقاف Workers.
5. إيقاف WhatsApp Client.
6. استعادة الملفات (DB → migrate إذا لزم → إعدادات → جلسة).
7. `PRAGMA integrity_check` + فحص `schema_migrations`.
8. إعادة تشغيل النظام (Service bootstrap).

أي فشل في أي خطوة → تراجع تلقائي للحالة السابقة (استعادة نسخة ما قبل العملية) → رسالة واضحة في الواجهة. لا يُستأنف النظام ببيانات تالفة.

## Export

- Users → CSV / JSON (حقول عامة فقط: id, whatsapp_id, phone, name, role, status, إحصائيات).
- Statistics → CSV / JSON.
- **لا** يُصدَّر: جلسة WhatsApp، Media، أسرار.