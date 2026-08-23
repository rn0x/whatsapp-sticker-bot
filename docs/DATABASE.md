# DATABASE

SQLite واحد — `whatsapp-bot.db` — عبر وحدة Node المدمجة **`node:sqlite` (`DatabaseSync`)** (لا حاجة لإعادة بناء native، حزمة خفيفة). مع:

- `PRAGMA journal_mode = WAL`
- `PRAGMA foreign_keys = ON`
- `PRAGMA synchronous = FULL`
- `PRAGMA busy_timeout = 5000`
- معاملات عبر `BEGIN IMMEDIATE` (كاتب واحد) حيث تتطلب الذرّية.

## الجداول

### users
| العمود | النوع | ملاحظة |
|---|---|---|
| id | INTEGER PK | |
| whatsapp_id | TEXT UNIQUE | JID مثل `97252…@c.us` |
| phone | TEXT | |
| name | TEXT | |
| push_name | TEXT | |
| first_seen_at | TEXT | ISO 8601 |
| last_seen_at | TEXT | |
| welcome_sent | INTEGER 0/1 | |
| status | TEXT | `ACTIVE` / `BLOCKED` |
| role | TEXT | `USER` / `PREMIUM` / `ADMIN` |
| quota_limit | INTEGER | يتجاوز الإعداد العام |
| quota_mode | TEXT | `default`/`rolling_24h`/`daily_fixed`/`unlimited`/`custom` |
| priority | INTEGER | أعلى = أسرع خدمة (من الخادم فقط) |
| created_at / updated_at | TEXT | |

الفهارس: `whatsapp_id` (UNIQUE), `phone`, `LOWER(name)`.

### groups
`id PK, group_id TEXT UNIQUE (JID "xxx@g.us"), name, added_at, member_count`

### group_settings
`group_id PK→groups, enabled 0/1, mode TEXT (OFF|MENTION_ONLY|COMMAND_ONLY|AUTO), daily_limit INTEGER NULL, allowed_roles TEXT (JSON)`

### group_members
`PK(group_id, user_id), joined_at` — تُملأ عند الحاجة (قائمة الأعضاء عند التنشيط).

### jobs — الطابور الدائم
| العمود | ملاحظة |
|---|---|
| id | PK |
| user_id | FK→users |
| group_id | FK→groups یا NULL |
| message_id | UNIQUE — idempotency key |
| type | `IMAGE` / `VIDEO` |
| status | `QUEUED`/`PROCESSING`/`SENDING`/`COMPLETED`/`FAILED`/`CANCELLED` |
| priority | INTEGER |
| input_path | NULL حتى يكتمل التنزيل |
| input_hash | SHA-256 (duplicate detection) |
| output_path | الناتج |
| attempts / max_attempts | |
| retry_at | وقت إعادة المحاولة (Backoff) |
| worker_id / locked_at / heartbeat_at | Lease/Heartbeat |
| reserved_amount | الحصة المحجوزة |
| times | created_at, started_at, completed_at, failed_at |
| error | نص الخطأ |

الفهارس: `(status, priority, created_at)`، `(status, created_at)`، `(status, user_id, created_at)` (fair scheduling)، `message_id` (UNIQUE)، `(input_hash, created_at)`.

### job_attempts
`id, job_id FK, attempt, status, error, started_at, finished_at`

### quota_usage — الحقيقة الوحيدة للحصة
`id, user_id FK, job_id UNIQUE, amount INTEGER, consumed_at`

الفهرس: `(user_id, consumed_at)` — هو ما يجعل **Rolling 24h** استعلاماً مباشراً.

### quota_reservations — الحجز قبل الاستهلاك
`id, user_id FK, job_id UNIQUE, amount, reserved_at` — الفهارس: `(user_id, reserved_at)`.

### file_cache — الـ duplicates
`id, hash UNIQUE, path, kind, size, job_id, user_id, created_at, expires_at` — الفهارس: `hash`, `expires_at`.

### settings
`key PK, value_json TEXT, updated_at`

### logs
`id, level (INFO/WARN/ERROR), scope, message, meta_json, created_at` — الفهارس: `(level, created_at)`, `(created_at)`.

### backups
`id, filename, path, size, created_at, encrypted, status, note`

### sessions — جلسات WhatsApp
`id, instance_id UNIQUE, provider, payload_blob (JSON مشفّر اختيارياً), updated_at`

### schema_migrations
`version PK, name, applied_at`

## العلاقات

```
users 1─* jobs               user 1─* quota_usage
users 1─* quota_reservations user 1─* job_attempts (عبر jobs)
groups 1─1 group_settings     groups 1─* group_members *─1 users
users 1─* file_cache
```

## Migrations

المجلد `src/core/migrations/` — كل ملف `NNN_name.mjs` يصدر `async up(db)` ينفذ داخل معاملة، ومسجل في `schema_migrations`. لا تعديل schema يدوي. جديد = ملف migration جديد.

## Atomicity

- **Claim:** `BEGIN IMMEDIATE` → `UPDATE … RETURNING` — يستولي worker واحد فقط على Job.
- **Reserve quota:** ضمن معاملة إنشاء Job: تحقق `limit - Σusage(window) - Σreservations(window) ≥ amount` ثم يحجز.
- **Consume:** `INSERT quota_usage + DELETE reservation` في معاملة واحدة عند النجاح.
- **Release:** `DELETE reservation` عند فشل داخلي.
- **Completion:** كتابة `completed_at` + `sticker_message_id` في معاملة واحدة بعد نجاح الإرسال.