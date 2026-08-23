# WhatsApp Sticker Bot

تطبيق سطح مكتب (Electron) لإدارة بوت ملصقات WhatsApp احترافي يعمل محلياً. متخصص فقط في:

- **Image → WhatsApp Sticker** (512×512 WebP)
- **Video / GIF → Animated Sticker** (WebP متحرك)

لا يحتاج المستخدم لأي أوامر في الخاص: يرسل صورة/فيديو ويتحول تلقائياً.

## المميزات الأساسية

- **Persistent Queue في SQLite** — كل Job مسجل في قاعدة البيانات، لا أثر في RAM.
- **استئناف كامل بعد Crash** — Lease + Heartbeat + Stale-Job Sweep على الإقلاع.
- **Quota Rolling 24h** — Reserve / Consume / Release بمعاملات ذرّية (لا تجاوز بالسرعة).
- **Rate Limiting** متعدد المستويات (مستخدم / مجموعة / عام).
- **Fair Scheduling** — لا يسمح لمستخدم واحد باحتكار الـ Workers.
- **Duplicate Detection** عبر SHA-256 Cache.
- **Group Modes** — OFF / MENTION_ONLY / COMMAND_ONLY / AUTO (الافتراضي MENTION_ONLY).
- **لوحة تحكم كاملة** — Dashboard, Queue, Users, Groups, Statistics, Logs, WhatsApp, Settings, Backups (تدعم العربية RTL).
- **Backup / Restore** مع خيار تشفير الجلسة.
- **QR + Pairing Code** تسجيل الدخول.
- **JavaScript فقط (ES Modules .mjs)** — بلا TypeScript.

## Requirements

- Node.js **≥ 22** (لتطوير البناء)
- نظام تشغيل: Linux x64 أو Windows x64 (macOS لاحقاً)
- حساب WhatsApp (رقم هاتف)
- لا يحتاج ffmpeg مثبتاً على النظام — يُرفق تلقائياً (`ffmpeg-static`)

## Installation

```bash
npm install
```

لا خطوة إعادة بناء native — قاعدة البيانات عبر `node:sqlite` المدمج في Electron.

## First Run / Development

```bash
npm run dev
```

- يفتح نافذة التطبيق وواجهة Vite للتطوير (HMR).
- اذهب إلى صفحة **WhatsApp** → اختر **QR** أو **Pairing Code** وسجّل الدخول مرة واحدة.
- الجلسة تُحفظ محلياً وتعيد الاتصال تلقائياً بعد إعادة التشغيل.

## Configuration

كل الإعدادات في **Settings** داخل التطبيق وتُحفظ في قاعدة البيانات. القالب البيئي في `.env.example`.

## Build (إنتاج)

```bash
npm run dist:linux   # AppImage
npm run dist:win     # NSIS Installer
```

المخرجات في `release/`.

## Data Location

البيانات افتراضياً في مجلد بيانات التطبيق (أو `APP_DATA_DIR`). البنية:

```
data/
├── incoming/        # وسائط مُستلمة قبل التحويل
├── staging/         # مدخلات Jobs منتظرة في الطابور
├── processing/      # أثناء المعالجة
├── completed/       # النواتج قبل الإرسال
├── failed/          # نواتج/مدخلات فشلت نهائياً (Retention)
├── cache/           # كاش الـ duplicates (أقصر Retention)
│── backups/         # النسخ الاحتياطية
│── exports/         # تصدير CSV/JSON
└── whatsapp-bot.db  # قاعدة SQLite (WAL)
```

## Backup / Restore

- **Backup:** صفحة Backups → زر Backup → إنشاء `backup-YYYY-MM-DD.zip` (DB + إعدادات + جلسة اختيارياً مشفرة).
- **Restore:** اختيار ملف → تحقق → نسخة احتياطية تلقائية للحالة الحالية → إيقاف Workers/WhatsApp → استعادة → فحص Integrity → إعادة تشغيل. أي فشل يعود للحالة السابقة تلقائياً.

## Troubleshooting

راجع [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) للمشاكل الشائعة (فقدان الاتصال، أخطاء SQLite، أخطاء FFmpeg، إلخ).

## Important Legal Note

المكتبة المستخدمة (Baileys) غير رسمية ولا تتوافق مع شروط WhatsApp. الاستخدام الكثيف قد يؤدي إلى حظر الرقم/الحساب. للاستخدام الرسمي والجماعي استخدم WhatsApp Business Cloud API. لا ملزَم بتبرير المخاطرة — طبيعتها موثقة في [ARCHITECTURE.md](./ARCHITECTURE.md#risks).