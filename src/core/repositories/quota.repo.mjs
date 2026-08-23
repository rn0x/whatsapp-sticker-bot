export class QuotaRepo {
  constructor(db) {
    this.db = db;
  }

  usedInWindow(userId, windowStartIso) {
    const r = this.db.prepare(
      `SELECT COALESCE(SUM(amount),0) AS s FROM quota_usage
       WHERE user_id=? AND consumed_at >= ?`
    ).get(userId, windowStartIso);
    return r.s;
  }

  reservedInWindow(userId, windowStartIso) {
    const r = this.db.prepare(
      `SELECT COALESCE(SUM(amount),0) AS s FROM quota_reservations
       WHERE user_id=? AND reserved_at >= ?`
    ).get(userId, windowStartIso);
    return r.s;
  }

  // يُستدعى داخل معاملة إنشاء Job (Begin IMMEDIATE) — جزء من Atomicity الحصة.
  reserveLocked(userId, jobId, amount) {
    this.db.prepare(
      "INSERT INTO quota_reservations (user_id, job_id, amount, reserved_at) VALUES (?,?,?,?)"
    ).run(userId, jobId, amount, new Date().toISOString());
  }

  // Consume: تحويل الحجز إلى استهلاك (داخل معاملة النجاح).
  consumeLocked(jobId, userId, amount) {
    const r = this.db.prepare(`
      INSERT INTO quota_usage (user_id, job_id, amount, consumed_at) VALUES (?,?,?,?)
      ON CONFLICT(job_id) DO NOTHING
    `).run(userId, jobId, amount, new Date().toISOString());
    this.db.prepare("DELETE FROM quota_reservations WHERE job_id=?").run(jobId);
    return r;
  }

  // Release: إلغاء حجز عند فشل داخلي/الغاء.
  releaseLocked(jobId) {
    this.db.prepare("DELETE FROM quota_reservations WHERE job_id=?").run(jobId);
  }

  // تعادل الحجز/الاستهلاك لاحظ أن الحجز قد يبقى لو فشل الاستهلاك؟ cell.
  usageForUser(userId, windowStartIso) {
    const used = this.usedInWindow(userId, windowStartIso);
    const reserved = this.reservedInWindow(userId, windowStartIso);
    return { used, reserved, total: used + reserved };
  }

  resetUser(userId) {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM quota_usage WHERE user_id=?").run(userId);
      this.db.prepare("DELETE FROM quota_reservations WHERE user_id=?").run(userId);
    });
  }

  releaseStaleReservations(olderThanIso) {
    // إلغاء حجوزات معلقة لـ Jobs انتهت/ألغيت دون Release
    const r = this.db.prepare(`
      DELETE FROM quota_reservations
      WHERE reserved_at < ? AND job_id NOT IN (SELECT id FROM jobs WHERE status IN ('QUEUED'))
    `).run(olderThanIso);
    return r.changes;
  }

  dailySeries(userId, days) {
    const from = new Date(Date.now() - days * 86400000).toISOString();
    return this.db.prepare(
      `SELECT substr(consumed_at,1,10) AS day, SUM(amount) AS amount
       FROM quota_usage WHERE user_id=? AND consumed_at>=? GROUP BY substr(consumed_at,1,10)`
    ).all(userId, from);
  }
}