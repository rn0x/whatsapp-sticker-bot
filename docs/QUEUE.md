# QUEUE — طابور دائم

الطابور **في SQLite** حصراً. بعد إغلاق/انهيار التطبيق، كل Jobs بقيت كاملة (لا فقدان).

## الحالات

```
QUEUED → PROCESSING → SENDING → COMPLETED
   │         │           │
   │         └──(فشل)────┴──→ FAILED  (بعد استنفاد retries / خطأ غير قابل)
   │         └──(lease timeout)──→ QUEUED (re-queue)
   └────────────────────────────→ CANCELLED
```

## Claim الذرّي

Worker يطلب Job التالي بمعاملة `BEGIN IMMEDIATE`:

```sql
-- 1) اختر المستخدم الأكثر ظلماً (Fair Scheduling — §8 في ARCHITECTURE)
SELECT user_id FROM jobs
 WHERE status='QUEUED' AND (retry_at IS NULL OR retry_at<=:now)
 GROUP BY user_id
 ORDER BY MIN(COALESCE(us.last_served_at,0)), SUM(j.priority) DESC, MAX(j.created_at)
 LIMIT 1;

-- 2) استولي على أقدم Job له:
UPDATE jobs
   SET status='PROCESSING', worker_id=:w, locked_at=:now, started_at=:now
 WHERE id = (
   SELECT id FROM jobs
    WHERE user_id=:u AND status='QUEUED'
      AND (retry_at IS NULL OR retry_at<=:now)
    ORDER BY priority DESC, created_at ASC LIMIT 1)
 RETURNING *;
```

`BEGIN IMMEDIATE` = قفل كاتب واحد على SQLite أثناء المعاملة → لا يمكن لـ Worker آخر الاستيلاء على نفس الصف. لا Race.

## Lease / Heartbeat

- عند الاستيلاء: `worker_id` + `locked_at`.
- أثناء المعالجة، Worker يحدّث `heartbeat_at` كل `JOB_HEARTBEAT_INTERVAL_MS` (30s).
- **Sweeper** (يعمل كل دقيقة + عند الإقلاع): أي `PROCESSING`/`SENDING` مع `locked_at` أو `heartbeat_at` أقدم من `JOB_LEASE_TIMEOUT_MS` (10 دقائق) →
  - `PROCESSING` → يعود إلى `QUEUED` (مع `attempts+1`). إن بلغ `max_attempts` → `FAILED`.
  - `SENDING` → **لا يُعاد إرساله تلقائياً** — يُعلَّم `COMPLETED` مع `error='uncertain-send'` ويسجَّل للمراجعة (Outbox، انظر crash recovery أدناه).

## الاستئناف بعد الإقلاع

1. `integrity_check` على DB.
2. Sweep: كل `PROCESSING`/`SENDING` تصبح (حسب السياسة أعلاه) `QUEUED` أو `COMPLETED-uncertain`.
3. Workers تبدأ والطابور يكمل تلقائياً. لا Job مفقود.

## Retry (Exponential Backoff)

- فشل مؤقت (خطأ خادم، FFmpeg مؤقت، WhatsApp غير متصل): `retry_at = now + 10s → 30s → 60s → 120s` حتى `MAX_RETRIES`.
- خطأ نهائي (ملف غير صالح، مستخدم محظور، تجاوز حدود Media): `FAILED` فوراً بلا Retry.
- كل محاولة تُسجل في `job_attempts`.

## Outbox — Crash Safety عند الإرسال

الإرسال هو النقطة الوحيدة التي يمكن أن تنتج duplicate:

```
بعد نجاح encode:
  job.status='SENDING'           (سكبت قبل الإرسال، داخل معاملة)
  sendSticker(…)                 (غير ذرّي مع DB)
  → عند النجاح: status='COMPLETED', completed_at, sticker_message_id (معاملة)
  → عند الخطأ: رجوع إلى وضع retry
```

- Crash بين الإرسال الناجح وكتابة DB: `SENDING` (نادراً، نافذة ميلي-ثانية) → بعد lease-timeout يُعلَّم `COMPLETED` (uncertain) للمراجعة في لوحة التحكم بدل إعادة إرسال مزدوج أعمى.
- Crash بعد encode وقبل الإرسال: الإخراج موجود في `completed/`، recovery يتخطى الـ encode (idempotency بالمخرجات) ويعيد الإرسال — آمن.

## Idempotency

- `message_id` فريد — رسالة واحدة = Job واحد (حتى لو كررتها الأحداث).
- `input_hash` — كاش الـ duplicates.
- كل انتقالات الحالة ضمن معاملات.

## Backpressure

- `MAX_MEDIA_WORKERS` / `MAX_DOWNLOAD_WORKERS` — عدد العمليات المتزامنة محدود دائماً.
- `MAX_QUEUE_SIZE` — إذا امتلأ الطابور ترفض الرسائل الجديدة مع رسالة واضحة.
- `MAX_PENDING_JOBS_PER_USER` — لا يسمح لأحد بإغراق النظام.
- Disk Guard — إيقاف الاستقبال إذا كانت المساحة الحرة دون الحد.

## Fair Scheduling

لا يسمح لمستخدم واحد باحتكار الـ Workers:

1. عدّ المستخدمين ذوي `QUEUED` (استعلام GROUP BY مدعوم بفهرس `(status, user_id, created_at)`).
2. الترتيب بأقدم `us.last_served_at` → أكثر مستخدم خدمات أقل يخدم أولاً، ثم بأعلى مجموع أولوية.
3. يخدم Job واحد من ذلك المستخدم، ثم يعدّ `last_served_at`، ويذهب الدور لآخر.

بهذا، حتى لو أرسل المستخدم A 10,000 ملف، يحصل الجميع على دور بالتناوب.