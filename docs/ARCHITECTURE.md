# ARCHITECTURE

## نظرة عامة

تطبيق Electron Desktop. `Main` يحمل كل منطق النظام (Bot/Queue/Media/Quota) و`Renderer` هو لوحة تحكم React (RTL). الاتصال عبر IPC محدود ومتحقق منه (`contextBridge` + قائمة قنوات معتمدة).

```
Electron Main
├── BotManager          — تنسيق السياقات (خاص، مجموعات، ترحيب، رسائل الحالة)
├── WhatsAppAdapter     — واجهة مجردة (QR/Pairing/رسائل/إرسال)
│   └── BaileysAdapter  — تنفيذ WebSocket (لا متصفح)
├── QueueService        — Persistent Queue + Claim + Lease + Retry + Outbox
├── Scheduler           — Fair Scheduling + أولويات
├── WorkerPool          — Download Workers + Media Processing Workers
├── QuotaManager        — Reserve/Consume/Release (Rolling 24h)
├── MediaEngine         — ImageProcessor (sharp) + VideoProcessor (ffmpeg)
├── CleanupWorker       — تنظيف الملفات القديمة/orphaned
├── HealthMonitor       — WA/DB/Queue/Disk/CPU/RAM
├── BackupManager       — زيب + تشفير اختياري للجلسة
└── SQLite (WAL)        — البيانات كلها (بدون تشغيل خادم)
```

## مبدأ الفصل (القسم الأهم)

```
WhatsApp → WhatsAppAdapter → BotService → QueueService → StickerJob → MediaEngine → FFmpeg/Sharp
```

- `WhatsAppAdapter` **لا يعرف شيئاً** عن FFmpeg.
- `MediaEngine` **لا يعرف شيئاً** عن WhatsApp.
- كل تواصل عبر `Job` (سجل في SQLite) + ملفات على القرص.
- تغيير مكتبة WhatsApp مستقبلاً = كتابة `Adapter` جديد فقط (الواجهة في `src/whatsapp/whatsapp-adapter.mjs`).

## البيانات

كل شيء في SQLite واحد (WAL, foreign_keys=ON, synchronous=FULL). التفاصيل في [DATABASE.md](./DATABASE.md).

## الطابور

Persistent. كل Job سجل في جدول `jobs`. لا يوجد طابور في RAM. آلية Claim ذرّية، Lease/Heartbeat، استرداد عند الإقلاع، Retry مع Backoff. التفاصيل في [QUEUE.md](./QUEUE.md).

## مسار المعالجة

1. رسالة Media (خاص/مجموعة) → Adapter → BotService
2. Validate (type/size/duration/hash)
3. Quota Reserve (معاملة ذرّية) + Rate Limit
4. إنشاء Job (status=QUEUED) → تنزيل → staging/ → job.input_path
5. Scheduler يختار المستخدم التالي بالفصل العادل → Worker يستولي (Claim)
6. Worker → MediaEngine → FFmpeg/Sharp → completed/
7. إرسال Sticker → Outbox (SENDING → COMPLETED) → Consume quota
8. Cleanup: حذف المدخل/الناتج حسب Retention

## الأرقام

- التسجيل: 100K مستخدم = صفوف في DB (مريح).
- الطابور: عشرات آلاف Jobs (فهارس + SQL).
- **المعالجة:** محكومة بـ CPU. Worker واحد: ~40–120 صورة/دقيقة، ~4–25 فيديو/دقيقة. أربعة Workers على 8 نوى ≈ 50–150 صورة/دقيقة أو 15–40 فيديو/دقيقة. لا Desktop يفرّغ طابوراً ضخماً في لحظة؛ النظام مستقر أمّا الطوابير تتراكم وتفرّغ بمعدل آمن.

## بنية المجلدات

```
src/
├── main/        إقلاع Electron + IPC + preload + config + windows
├── core/        database + migrations + repositories
├── bot/         bot-manager, message-router, rate-limiter, validator
├── whatsapp/    adapter/baileys/session-manager
├── queue/       queue-service, scheduler, worker-pool, outbox
├── media/       media-engine, image/video processors, ffmpeg, validator
├── quota/       quota-manager + modes
├── maintenance/ cleanup, cache, health, disk-guard
├── backup/      backup/restore/export
├── admin/       dashboard auth
└── utils/
renderer/        React app (RTL, i18n ar/en)
tests/           node:test unit + integration + fixtures
scripts/         load-test
```

## إقلاع منظم

```
Load Config → Open SQLite → Migrations → integrity_check → Stale Job Recovery
→ CleanupWorker → Queue Workers → WhatsApp Client → Push Dashboard
```

## Realtime UI

Main يدفع حالات التحديث إلى Renderer عبر `webContents.send` (tick كل 5 ثوانٍ + أحداث فورية). Renderer لا يملك وصولاً للشبكة/النظام مباشرة.

## Risks

الموثقة كاملة في [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#risks). أبرزها:
1. **حظر الحساب** — المكتبات غير الرسمية تخالف ToS؛ الخطر حقيقي ويتعلق بحجم الإرسال.
2. تثبيت إصدار Baileys إلزامي؛ البروتوكول يتغير و`405` يحدث عندما يقدم version قديم.
3. جلسات Multi-Device قد تتطلب اتصال الهاتف دورياً.
4. حدود الملصقات (حجم/مدة) غير موثقة رسمياً وتتغير.