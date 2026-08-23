// QueueService — الطابور الدائم بالكامل في SQLite.
// مسؤول عن: الإنشاء مع الحجـز الذرّي، الاستيلاء (Download/Media)،
// الإكمال/الفشل مع الحصة، Sweep/Recovery، الإيقاف المؤقت، والإحصائيات.

import { nowIso } from "../utils/time.mjs";
import { rowToCamel } from "../utils/keys.mjs";

export class QueueService {
  constructor({ db, jobs, quota, settings, logger }) {
    this.db = db;
    this.jobs = jobs;
    this.quota = quota;
    this.settings = settings;
    this.logger = logger;
    this.paused = false;
    this.diskPaused = false;
  }

  // ===== Enqueue (ذرّي: فحص + إنشاء Job + حجز حصة) =====
  enqueue({ user, messageId, type, groupId = null, priority = 0, amount = 1 }) {
    const maxQueue = this.settings.getNumber("queue.maxQueueSize", 100000);
    const maxPending = this.settings.getNumber("queue.maxPendingJobsPerUser", 50);
    const allowedTypes = ["IMAGE", "VIDEO"];

    if (!allowedTypes.includes(type)) {
      return { ok: false, code: "invalid_type" };
    }
    if (this.paused || this.diskPaused) {
      return { ok: false, code: this.diskPaused ? "disk_paused" : "queue_paused" };
    }

    const existing = this.jobs.findByMessageId(messageId);
    if (existing) return { ok: false, code: "duplicate", job: existing };

    // Idempotency إضافي: تجنّب التضاعف عند تكرار الحدث
    if (this.jobs.queueSize() >= maxQueue) {
      return { ok: false, code: "queue_full" };
    }

    let created = null;
    const result = this.db.transaction(() => {
      const pending = this.jobs.pendingForUser(user.id);
      if (pending >= maxPending) return { ok: false, code: "max_pending", pending };

      const quotaCheck = this.quota.canReserve(user, amount);
      if (!quotaCheck.ok) {
        return { ok: false, code: "quota_exceeded", remaining: quotaCheck.remaining, quota: quotaCheck };
      }

      const job = this.jobs.create({
        userId: user.id,
        groupId,
        messageId,
        type,
        priority,
        maxAttempts: this.settings.getNumber("queue.maxRetries", 5),
        reservedAmount: amount,
      });
      this.quota.reserveLocked(user, job.id, amount);
      this.usersScheduleInit(user.id);
      return { ok: true, job };
    });
    return result || { ok: false, code: "unknown" };
  }

  usersScheduleInit(userId) {
    this.db.prepare("INSERT OR IGNORE INTO user_schedule (user_id, weight) VALUES (?, 1)").run(userId);
  }

  // ===== Claim — نوعان: Download (بلا input) و Media (بـ input) ====
  claimDownload(workerId, ts) {
    if (this.paused) return null;
    return this.db.transaction(() => this._claimLocked(workerId, ts || nowIso(), "j.input_path IS NULL"));
  }

  claimProcess(workerId, ts) {
    if (this.paused) return null;
    return this.db.transaction(() => this._claimLocked(workerId, ts || nowIso(), "j.input_path IS NOT NULL"));
  }

  _claimLocked(workerId, ts, whereExtra) {
    const cand = this.db.prepare(`
      WITH cands AS (
        SELECT j.user_id
        FROM jobs j
        WHERE j.status='QUEUED' AND (j.retry_at IS NULL OR j.retry_at <= :ts) AND ${whereExtra}
        GROUP BY j.user_id
      )
      SELECT c.user_id AS userId
      FROM cands c LEFT JOIN user_schedule us ON us.user_id = c.user_id
      ORDER BY COALESCE(us.last_served_at,'') ASC
      LIMIT 1
    `).get({ ts });
    if (!cand) return null;

    const row = this.db.prepare(`
      UPDATE jobs SET
        status='PROCESSING', worker_id=:w, locked_at=:ts, heartbeat_at=:ts,
        started_at=COALESCE(started_at,:ts), attempts=attempts+1, retry_at=NULL
      WHERE id = (
        SELECT id FROM jobs j
        WHERE j.user_id=:u AND j.status='QUEUED' AND (j.retry_at IS NULL OR j.retry_at<=:ts) AND ${whereExtra}
        ORDER BY j.priority DESC, j.created_at ASC LIMIT 1
      )
      RETURNING *
    `).get({ w: workerId, ts, u: cand.userId });
    if (!row) return null;

    this.db.prepare(`
      INSERT INTO user_schedule (user_id, last_served_at, weight) VALUES (?,?,1)
      ON CONFLICT(user_id) DO UPDATE SET last_served_at=excluded.last_served_at
    `).run(cand.userId, ts);

    return rowToCamel(row);
  }

  heartbeat(jobId, workerId) {
    this.jobs.touchHeartbeat(jobId, workerId);
  }

  setDownloaded(jobId, inputPath, inputHash) {
    this.db.transaction(() => {
      this.jobs.setInputDownloaded(jobId, inputPath, inputHash);
      this.jobs.requeue(jobId);
    });
  }

  markSending(jobId) {
    this.jobs.markSending(jobId);
  }

  markOutputStaged(jobId, outputPath) {
    this.jobs.setOutputStaged(jobId, outputPath);
  }

  // ===== إكمال: تحويل الحجز إلى استهلاك داخل معاملة =====
  complete(job, outputPath, stickerSentAt) {
    this.db.transaction(() => {
      this.jobs.recordAttempt(job.id, job.attempts, "COMPLETED", null);
      this.quota.consumeLocked(job, job.reservedAmount || 1);
      this.jobs.completeJob(job.id, outputPath, stickerSentAt);
    });
  }

  // الفشل: مؤقت → Requeue مع Backoff (يبقى الحجز)؛ نهائي → Release وسياسة الاستهلاك.
  fail(job, error, { retryable = false } = {}) {
    const maxAttempts = this.settings.getNumber("queue.maxRetries", 5);
    const res = this.jobs.failJob(job.id, error, {
      retryable,
      retryAt: retryable ? this._backoffTime(job.attempts) : null,
      maxAttempts,
    });
    this.jobs.recordAttempt(job.id, job.attempts, res.status, String(error).slice(0, 500));

    if (res.status === "FAILED") {
      this.db.transaction(() => {
        const consumeInvalid = this.settings.getBool("quota.countInvalidAsConsumed", false) && !retryable;
        if (consumeInvalid) this.quota.consumeLocked(job, job.reservedAmount || 1);
        else this.quota.releaseLocked(job);
      });
    }
    return res;
  }

  _backoffTime(attempt) {
    const delays = [10, 30, 60, 120, 300]; // ثوانٍ
    const idx = Math.min(Math.max(attempt - 1, 0), delays.length - 1);
    return new Date(Date.now() + delays[idx] * 1000).toISOString();
  }

  // ===== Relay / Recovery =====
  sweepStale() {
    const timeout = this.settings.getNumber("queue.jobLeaseTimeoutMs", 600000);
    const recovered = this.jobs.sweepStale(timeout);
    if (recovered.length) this.logger.warn("queue", `sweep: ${recovered.length} stale jobs recovered`);
    return recovered;
  }

  recoverOnStartup() {
    const recovered = this.jobs.recoverOnStartup();
    if (recovered.length) this.logger.warn("queue", `startup recovery: ${recovered.length} jobs requeued/marked`);
    return recovered;
  }

  setPaused(paused) {
    this.paused = paused;
    this.logger.info("queue", paused ? "queue paused" : "queue resumed");
  }

  setDiskPaused(paused) {
    this.diskPaused = paused;
    this.logger.warn("queue", paused ? "media intake paused (low disk)" : "media intake resumed (disk ok)");
  }

  // ===== إدارة من الواجهة =====
  retryFailed() {
    return this.jobs.requeueByStatus("FAILED");
  }

  cancelJobs(ids) {
    const affected = this.jobs.cancelByIds(ids);
    if (affected) {
      // تحرير الحجوزات المعلقة للـ Jobs الملغاة
      this.db.transaction(() => {
        for (const id of ids) {
          const j = this.jobs.getById(id);
          if (j) this.quota.releaseLocked(j);
        }
      });
    }
    return affected;
  }

  clearFailed() {
    // الحالة CANCELLED (تُبقي السجل من دون تفعيلها) بدل حذف مادي آمن
    const ids = this.jobs.list({ status: "FAILED", limit: 100000 }).rows.map((r) => r.id);
    return this.cancelJobs(ids);
  }

  list(filter) {
    const res = this.jobs.list(filter);
    return res;
  }

  counts() {
    return this.jobs.countsByStatus();
  }

  stats(fromIso, toIso) {
    return this.jobs.statsForPeriod(fromIso, toIso);
  }
}