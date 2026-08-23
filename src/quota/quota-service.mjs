// QuotaService — كل حساب الحصة هنا. Reserve/Consume/Release داخل معاملات.
// وضع Rolling 24h يعتمد على سجلات quota_usage الموقعة بالوقت (لا عدّاد).

export class QuotaService {
  constructor({ db, usersRepo, settings, quotaRepo }) {
    this.db = db;
    this.users = usersRepo;
    this.settings = settings;
    this.quota = quotaRepo;
  }

  resolveMode(user) {
    if (!user) return "unlimited";
    if (user.role === "ADMIN") return "unlimited";
    const limit = user.quotaLimit ?? user.quota_limit;
    const mode = user.quotaMode ?? user.quota_mode;
    return !mode || mode === "default" ? this.settings.get("quota.mode") || "rolling_24h" : mode;
  }

  limitFor(user) {
    if (!user) return 0;
    if (user.role === "ADMIN") return Infinity;
    const mode = this.resolveMode(user);
    if (mode === "unlimited") return Infinity;
    const limit = user.quotaLimit ?? user.quota_limit;
    if (limit != null && limit > 0) return limit;
    return this.settings.getNumber("quota.defaultDailyQuota", 50);
  }

  windowStartIso(user, nowMs = Date.now()) {
    const mode = this.resolveMode(user);
    if (mode === "daily_fixed") {
      const d = new Date(nowMs);
      d.setHours(0, 0, 0, 0); // منتصف الليل المحلي
      return d.toISOString();
    }
    return new Date(nowMs - 24 * 3600 * 1000).toISOString(); // rolling 24h
  }

  usageFor(user, nowMs = Date.now()) {
    const win = this.windowStartIso(user, nowMs);
    const u = this.quota.usageForUser(user.id, win);
    const limit = this.limitFor(user);
    const remaining = limit === Infinity ? Infinity : Math.max(0, limit - u.total);
    return {
      used: u.used,
      reserved: u.reserved,
      total: u.total,
      limit,
      remaining,
      unlimited: limit === Infinity,
      windowStart: win,
    };
  }

  canReserve(user, amount = 1) {
    const s = this.usageFor(user);
    return { ok: s.remaining >= amount, ...s };
  }

  // يُستدعى داخل معاملة إنشاء Job — ذرّي بالكامل.
  reserveLocked(user, jobId, amount = 1) {
    this.quota.reserveLocked(user.id, jobId, amount);
  }

  consumeLocked(job, amount = 1) {
    this.quota.consumeLocked(job.id, job.userId, amount);
  }

  releaseLocked(job) {
    this.quota.releaseLocked(job.id);
  }

  resetForUser(userId) {
    this.quota.resetUser(userId);
  }

  // إلغاء حجوزات قديمة معلقة (الصيانة)
  releaseStale() {
    const olderThan = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    return this.quota.releaseStaleReservations(olderThan);
  }
}