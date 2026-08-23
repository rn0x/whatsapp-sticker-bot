// Rate Limiter متعدد المستويات — نافذة منزلقة في الذاكرة (مؤقتة، تُعاد صفراً عند إعادة التشغيل).
// المستويات: لكل مستخدم، لكل مجموعة، عام، وللملفات غير الصالحة.

export class RateLimiter {
  constructor({ cleanupMs = 60_000 } = {}) {
    this.buckets = new Map(); // key -> Array<timestamp>
    this.limits = new Map(); // key -> {limit, windowMs}
    this.cleanupMs = cleanupMs;
    this._timer = setInterval(() => this.prune(), this.cleanupMs);
    if (this._timer.unref) this._timer.unref();
  }

  setLimit(key, limit, windowMs) {
    this.limits.set(key, { limit, windowMs });
  }

  _bucket(key) {
    let b = this.buckets.get(key);
    if (!b) {
      b = [];
      this.buckets.set(key, b);
    }
    return b;
  }

  // يعيد عدد ما تبقى من الأحداث المسموحة (>=0) أو -1 إذا تجاوز.
  check(key, { limit, windowMs } = {}) {
    const cfg = this.limits.get(key) || { limit, windowMs };
    if (!cfg || cfg.limit === Infinity) return Infinity;
    const now = Date.now();
    const b = this._bucket(key);
    const cutoff = now - cfg.windowMs;
    while (b.length && b[0] <= cutoff) b.shift();
    const remaining = cfg.limit - b.length;
    if (remaining <= 0) return -1;
    return remaining;
  }

  // يسجل حدثاً ويعيد allowed/blocked
  hit(key, { limit, windowMs } = {}) {
    const allowed = this.check(key, { limit, windowMs });
    if (allowed < 0) return { allowed: false, remaining: 0 };
    this._bucket(key).push(Date.now());
    return { allowed: true, remaining: allowed - 1 };
  }

  prune() {
    const now = Date.now();
    for (const [key, b] of this.buckets) {
      const cfg = this.limits.get(key);
      const cutoff = now - (cfg ? cfg.windowMs : 60_000);
      while (b.length && b[0] <= cutoff) b.shift();
      if (b.length === 0) this.buckets.delete(key);
    }
  }

  dispose() {
    clearInterval(this._timer);
    this.buckets.clear();
    this.limits.clear();
  }
}