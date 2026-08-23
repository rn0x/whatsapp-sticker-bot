import { nowIso } from "../../utils/time.mjs";
import { rowToCamel, rowsToCamel } from "../../utils/keys.mjs";

const JOB_COLS = [
  "id", "user_id", "group_id", "message_id", "type", "status", "priority",
  "input_path", "input_hash", "output_path", "output_exists", "attempts", "max_attempts",
  "retry_at", "worker_id", "locked_at", "heartbeat_at", "reserved_amount",
  "sticker_sent_at", "error", "created_at", "started_at", "completed_at", "failed_at",
].join(", ");

export class JobsRepo {
  constructor(db) {
    this.db = db;
  }

  create(job) {
    const now = job.created_at || nowIso();
    const r = this.db.prepare(`
      INSERT INTO jobs (
        user_id, group_id, message_id, type, status, priority, input_path, input_hash,
        output_path, attempts, max_attempts, retry_at, reserved_amount, created_at
      ) VALUES (
        :userId, :groupId, :messageId, :type, 'QUEUED', :priority, :inputPath, :inputHash,
        NULL, 0, :maxAttempts, NULL, :reservedAmount, :now
      )
      RETURNING ${JOB_COLS}
    `).get({
      userId: job.userId,
      groupId: job.groupId || null,
      messageId: job.messageId,
      type: job.type,
      priority: job.priority || 0,
      inputPath: job.inputPath || null,
      inputHash: job.inputHash || null,
      maxAttempts: job.maxAttempts || 5,
      reservedAmount: job.reservedAmount || 1,
      now,
    });
    return rowToCamel(r);
  }

  getById(id) {
    const r = this.db.prepare(`SELECT ${JOB_COLS} FROM jobs WHERE id=?`).get(id);
    return rowToCamel(r);
  }

  findByMessageId(messageId) {
    const r = this.db.prepare(`SELECT ${JOB_COLS} FROM jobs WHERE message_id=?`).get(messageId);
    return rowToCamel(r);
  }

  pendingForUser(userId) {
    return this.db.prepare(
      `SELECT COUNT(*) AS c FROM jobs WHERE user_id=? AND status IN ('QUEUED','PROCESSING','SENDING')`
    ).get(userId).c;
  }

  queueSize() {
    return this.db.prepare(`SELECT COUNT(*) AS c FROM jobs WHERE status='QUEUED'`).get().c;
  }

  processingCount() {
    return this.db.prepare(
      `SELECT COUNT(*) AS c FROM jobs WHERE status IN ('PROCESSING','SENDING')`
    ).get().c;
  }

  countsByStatus() {
    const rows = this.db.prepare(
      `SELECT status, COUNT(*) AS c FROM jobs GROUP BY status`
    ).all();
    const out = { QUEUED: 0, PROCESSING: 0, SENDING: 0, COMPLETED: 0, FAILED: 0, CANCELLED: 0 };
    for (const r of rows) out[r.status] = r.c;
    return out;
  }

  // ===== Claim (ذرّي داخل معاملة BEGIN IMMEDIATE عند مستوى الخدمة) =====
  // يُستدعى داخل db.transaction().
  _claimNextLocked(workerId, ts) {
    const cand = this.db.prepare(`
      WITH cands AS (
        SELECT j.user_id
        FROM jobs j
        WHERE j.status='QUEUED' AND (j.retry_at IS NULL OR j.retry_at <= :ts)
        GROUP BY j.user_id
      )
      SELECT c.user_id AS userId
      FROM cands c
      LEFT JOIN user_schedule us ON us.user_id = c.user_id
      ORDER BY COALESCE(us.last_served_at, '') ASC
      LIMIT 1
    `).get({ ts });

    if (!cand) return null;

    const row = this.db.prepare(`
      UPDATE jobs SET
        status='PROCESSING',
        worker_id=:w,
        locked_at=:ts,
        heartbeat_at=:ts,
        started_at=COALESCE(started_at,:ts),
        attempts=attempts+1,
        retry_at=NULL
      WHERE id = (
        SELECT id FROM jobs
        WHERE user_id=:u AND status='QUEUED' AND (retry_at IS NULL OR retry_at<=:ts)
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
      )
      RETURNING ${JOB_COLS}
    `).get({ w: workerId, ts, u: cand.userId });

    if (!row) return null;

    this.db.prepare(`
      INSERT INTO user_schedule (user_id, last_served_at, weight)
      VALUES (?, ?, 1)
      ON CONFLICT(user_id) DO UPDATE SET last_served_at=excluded.last_served_at
    `).run(cand.userId, ts);

    return rowToCamel(row);
  }

  claimNext(workerId, ts) {
    return this.db.transaction(() => this._claimNextLocked(workerId, ts || nowIso()));
  }

  touchHeartbeat(id, workerId) {
    this.db.prepare("UPDATE jobs SET heartbeat_at=? WHERE id=? AND worker_id=?").run(nowIso(), id, workerId);
  }

  setInputDownloaded(id, inputPath, inputHash) {
    this.db.prepare("UPDATE jobs SET input_path=?, input_hash=? WHERE id=?").run(inputPath, inputHash, id);
  }

  markSending(id) {
    this.db.prepare("UPDATE jobs SET status='SENDING' WHERE id=?").run(id);
  }

  completeJob(id, outputPath, stickerSentAt) {
    const now = nowIso();
    this.db.prepare(`
      UPDATE jobs SET status='COMPLETED', completed_at=?, output_path=?, output_exists=1,
        sticker_sent_at=?, worker_id=NULL, locked_at=NULL, heartbeat_at=NULL, error=NULL
      WHERE id=?
    `).run(now, outputPath, stickerSentAt || null, id);
  }

  setOutputStaged(id, outputPath) {
    this.db.prepare("UPDATE jobs SET output_path=?, output_exists=1 WHERE id=?").run(outputPath, id);
  }

  // تسجيل محاولة (لجدول job_attempts)
  recordAttempt(jobId, attempt, status, error) {
    this.db.prepare(
      "INSERT INTO job_attempts (job_id, attempt, status, error, started_at, finished_at) VALUES (?,?,?,?,?,?)"
    ).run(jobId, attempt, status, error || null, nowIso(), nowIso());
  }

  // فشل: retryable مع retryAt → QUEUED لاحقاً، أو نهائي → FAILED
  failJob(id, error, { retryable = false, retryAt = null, maxAttempts } = {}) {
    const now = nowIso();
    const job = this.getById(id);
    if (!job) return null;
    let status;
    let extraSet = "";
    if (retryable && job.attempts < (maxAttempts || job.maxAttempts)) {
      status = "QUEUED";
      extraSet = `retry_at=?, status='QUEUED', worker_id=NULL, locked_at=NULL, heartbeat_at=NULL`;
    } else {
      status = "FAILED";
      extraSet = `failed_at=?, status='FAILED', worker_id=NULL, locked_at=NULL, heartbeat_at=NULL, error=?`;
    }
    const payload = retryable ? [retryAt] : [now, String(error).slice(0, 2000)];
    this.db.prepare(`UPDATE jobs SET ${extraSet} WHERE id=?`).run(...payload, id);
    return { id, status };
  }

  requeue(id, { resetAttempts = false } = {}) {
    const sql = resetAttempts
      ? `UPDATE jobs SET status='QUEUED', retry_at=NULL, attempts=0, worker_id=NULL, locked_at=NULL, heartbeat_at=NULL, error=NULL, failed_at=NULL WHERE id=?`
      : `UPDATE jobs SET status='QUEUED', retry_at=NULL, worker_id=NULL, locked_at=NULL, heartbeat_at=NULL, error=NULL, failed_at=NULL WHERE id=?`;
    this.db.prepare(sql).run(id);
  }

  requeueByStatus(status) {
    return this.db.transaction(() => {
      const ids = this.db.prepare("SELECT id FROM jobs WHERE status=?").all(status).map((r) => r.id);
      for (const id of ids) this.requeue(id, { resetAttempts: true });
      return ids.length;
    });
  }

  cancelByIds(ids) {
    if (!ids?.length) return 0;
    return this.db.prepare(
      `UPDATE jobs SET status='CANCELLED', worker_id=NULL, locked_at=NULL, heartbeat_at=NULL
       WHERE id IN (${ids.map(() => "?").join(",")}) AND status IN ('QUEUED','FAILED','COMPLETED')`
    ).run(...ids).changes;
  }

  clearFailedFiles(now) {
    // يعيد مسارات الحالات التي يمكن حذف ملفاتها فعلياً
  }

  // ===== Sweep / Recovery =====
  // PROCESSING/SENDING التي تجاوزت lease-timeout.
  sweepStale(leaseTimeoutMs) {
    const ts = nowIso();
    const staleBefore = new Date(Date.now() - leaseTimeoutMs).toISOString();
    return this.db.transaction(() => {
      const stale = this.db.prepare(`
        SELECT id, status, attempts, max_attempts FROM jobs
        WHERE status IN ('PROCESSING','SENDING')
          AND COALESCE(heartbeat_at, locked_at, started_at, created_at) < ?
      `).all(staleBefore);
      const recovered = [];
      for (const s of stale) {
        if (s.status === "PROCESSING") {
          if (s.attempts >= s.max_attempts) {
            this.db.prepare(
              `UPDATE jobs SET status='FAILED', failed_at=?, worker_id=NULL, locked_at=NULL, heartbeat_at=NULL, error='lease-timeout-max-attempts'
               WHERE id=?`
            ).run(ts, s.id);
            recovered.push({ id: s.id, from: "PROCESSING", to: "FAILED" });
          } else {
            this.db.prepare(
              `UPDATE jobs SET status='QUEUED', retry_at=NULL, worker_id=NULL, locked_at=NULL, heartbeat_at=NULL, error='lease-timeout-requeued'
               WHERE id=?`
            ).run(s.id);
            recovered.push({ id: s.id, from: "PROCESSING", to: "QUEUED" });
          }
        } else {
          // SENDING بعد فاصل زمني = إرسال غير مؤكد. لا نعيد الإرسال أعمى.
          this.db.prepare(
            `UPDATE jobs SET status='COMPLETED', completed_at=?, worker_id=NULL, locked_at=NULL,
             heartbeat_at=NULL, error='uncertain-send-review' WHERE id=?`
          ).run(ts, s.id);
          recovered.push({ id: s.id, from: "SENDING", to: "COMPLETED" });
        }
      }
      return recovered;
    });
  }

  // عند الإقلاع: لا workers حيّ، كل PROCESSING → QUEUED، SENDING → COMPLETED غير مؤكد.
  recoverOnStartup() {
    return this.db.transaction(() => {
      const rows = this.db.prepare(
        `SELECT id, status FROM jobs WHERE status IN ('PROCESSING','SENDING')`
      ).all();
      const ts = nowIso();
      for (const r of rows) {
        if (r.status === "PROCESSING") {
          this.db.prepare(
            `UPDATE jobs SET status='QUEUED', retry_at=NULL, worker_id=NULL, locked_at=NULL, heartbeat_at=NULL, error='recovered-after-restart' WHERE id=?`
          ).run(r.id);
        } else {
          this.db.prepare(
            `UPDATE jobs SET status='COMPLETED', completed_at=?, worker_id=NULL, locked_at=NULL, heartbeat_at=NULL, error='uncertain-send-review' WHERE id=?`
          ).run(ts, r.id);
        }
      }
      return rows.map((r) => ({ id: r.id, from: r.status, to: r.status === "PROCESSING" ? "QUEUED" : "COMPLETED" }));
    });
  }

  // ===== قائمة الطابور (صفحة Queue) =====
  list({ status, type, userId, groupId, query, sort, order, limit = 50, offset = 0 } = {}) {
    const where = [];
    const vals = [];
    if (status && status !== "ALL") {
      where.push("j.status=?");
      vals.push(status);
    }
    if (type) {
      where.push("j.type=?");
      vals.push(type);
    }
    if (userId) {
      where.push("j.user_id=?");
      vals.push(userId);
    }
    if (groupId) {
      where.push("j.group_id=?");
      vals.push(groupId);
    }
    if (query) {
      where.push("(j.id LIKE ? OR u.name LIKE ? OR u.phone LIKE ? OR u.whatsapp_id LIKE ?)");
      const like = `%${query}%`;
      vals.push(like, like, like, like);
    }
    const sortCol = ["id", "created_at", "completed_at", "priority", "attempts"].includes(sort) ? sort : "id";
    const dir = order === "asc" ? "ASC" : "DESC";
    const sql = `
      SELECT j.*, u.name AS user_name, u.phone AS user_phone, u.whatsapp_id AS user_whatsapp_id
      FROM jobs j LEFT JOIN users u ON u.id = j.user_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY ${sortCol} ${dir}
      LIMIT ? OFFSET ?`;
    const rows = this.db.prepare(sql).all(...vals, limit, offset);
    const count = this.db.prepare(
      `SELECT COUNT(*) AS c FROM jobs j LEFT JOIN users u ON u.id = j.user_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}`
    ).get(...vals);
    return { rows: rowsToCamel(rows), total: count.c };
  }

  // ===== إحصائيات =====
  statsForPeriod(fromIso, toIso) {
    const r = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN type='IMAGE' THEN 1 ELSE 0 END) AS images,
        SUM(CASE WHEN type='VIDEO' THEN 1 ELSE 0 END) AS videos,
        AVG(CASE WHEN completed_at IS NOT NULL AND started_at IS NOT NULL
                 THEN (julianday(completed_at) - julianday(started_at)) * 86400000 END) AS avg_processing_ms,
        MAX(id) AS max_id
      FROM jobs WHERE created_at >= ? AND created_at <= ?
    `).get(fromIso, toIso);
    return rowToCamel(r);
  }

  dailyCounts(days) {
    const from = new Date(Date.now() - days * 86400000).toISOString();
    return this.db.prepare(`
      SELECT substr(created_at,1,10) AS day,
             COUNT(*) AS total,
             SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) AS completed
      FROM jobs WHERE created_at >= ?
      GROUP BY substr(created_at,1,10) ORDER BY day ASC
    `).all(from);
  }

  avgProcessingMs() {
    const r = this.db.prepare(`
      SELECT AVG(CASE WHEN completed_at IS NOT NULL AND started_at IS NOT NULL
                 THEN (julianday(completed_at) - julianday(started_at)) * 86400000 END) AS avg
      FROM jobs WHERE status='COMPLETED'
    `).get();
    return r.avg || 0;
  }

  usersWithJobs() {
    return this.db.prepare(`SELECT COUNT(DISTINCT user_id) AS c FROM jobs`).get().c;
  }
}