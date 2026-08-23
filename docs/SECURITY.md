# SECURITY — نموذج الأمان

## Electron

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- `webSecurity` مفعّل
- `preload.js` فقط يعرّف `window.api` عبر `contextBridge`
- **لا قناة IPC عامة** — قائمة قنوات معتمدة تقبل فقط، كلها تمر getter منفصلة بتحقق من zod.
- CSP صارم في `index.html` (لا `unsafe-eval`، لا مصادر خارجية).
- لا `remote`، لا فتح نوافذ عشوائية، `will-navigate` مقيد.
- DevTools معطلة في الإنتاج.

## Dashboard Auth

- أول تشغيل → إعداد PIN/كلمة مرور.
- التخزين: `scrypt` (node:crypto) + salt ملحقة بقاعدة البيانات، لا نص واضح.
- جلسة برمز عشوائي آمن منتهي الصلاحية + قفل تلقائي بعد خمول (`LOCK_TIMEOUT_MINUTES`).
- جميع IPC الخاصة بالإدارة تتطلب جلسة صالحة (`requireAuth`).

## IPC

- تحقق schema لكل payload (zod) قبل أي عمل.
- قيود القيم (enum للأنواع، حد أقصى للأطوال).
- كل عمليات المستخدمين/الحصة يتم التحقق من الأذونات (Admin فقط للتعديل، ROLE/status).

## ملفات

- **Path traversal ممنوع**: كل المسارات تُبنى من `path.basename`/`path.join` مع فحص أن النتيجة داخل `data/`؛ لا تمرير مسار حر من الواجهة.
- التحقق بالـ MIME السحري والحجم.
- أسماء الملفات من أرقام/هاشات، لا من محتوى اعتباطي.

## Quota / Rate / Resource

- `MAX_QUEUE_SIZE`, `MAX_PENDING_JOBS_PER_USER`, `MAX_MEDIA_WORKERS`.
- Rate Limiting: user (5/min + الحصة)، group، global.
- Disk Guard: إيقاف استقبال Media تحت `DISK_FREE_SPACE_THRESHOLD_MB`.

## بيانات حساسة

- جلسات WhatsApp في `sessions` (payload JSON)، **لا تُعرض في UI أو logs**.
- اللوجات لا تسجل: محتوى الرسائل، مسارات Media، الأسرار، رموز QR (إلا عند الطلب الصريح).
- تعقيم `meta` في اللوجات بفلتر حساس.

## Backup

- لا أسرار في Backup غير مشفر.
- عند تضمين الجلسة: تشفير `AES-256-GCM` للمحتوى بمفتاح مُشتق من كلمة مرور عبر `scrypt` (`PBKDF2` عبر node:crypto).
- Restore يتحقق من صحة الملف والإصدار قبل أي استبدال.

## قائمة تحقق

- [x] لا `nodeIntegration` في renderer.
- [x] no `eval`/no TS.
- [x] كل IPC موثق ومتحقق.
- [x] غير إجباري على الآمن: الأنماط أعلاه إلزامية، لا قوالب Placeholder.