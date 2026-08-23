// HealthMonitor — عينات دورية للنظام + تنبيهات + Disk Guard.
import os from "node:os";
import { statfs } from "node:fs/promises";

export class HealthMonitor {
  constructor({ queue, settings, logger, paths, adapter, onAlert }) {
    this.queue = queue;
    this.settings = settings;
    this.logger = logger;
    this.paths = paths;
    this.adapter = adapter;
    this.onAlert = onAlert; // (alert) => void
    this.timer = null;
    this.snapshot = null;
    this.lastCpuTimes = null;
    this.lastTick = 0;
    this.alerts = new Map();
    this.diskLow = false;
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), 5000);
    if (this.timer.unref) this.timer.unref();
    this.logger.info("health", "health monitor started");
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this._stopped = true;
  }

  async tick() {
    if (this._stopped) return;
    try {
      const snap = await this._collect();
      if (this._stopped) return;
      this.snapshot = snap;
      this._evaluateAlerts(snap);
    } catch (err) {
      if (this._stopped) return; // إهمال الأخطاء أثناء الإيقاف
      this.logger.error("health", "tick failed", { err: err.message });
    }
  }

  async _collect() {
    const cpu = await this._cpuPct();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    let disk;
    try {
      const s = await statfs(this.paths.dataDir);
      disk = {
        freeBytes: s.bavail * Number(s.bsize),
        totalBytes: s.blocks * Number(s.bsize),
      };
    } catch {
      disk = { freeBytes: 0, totalBytes: 0 };
    }
    const queueCounts = this.queue.counts();
    const wa = this.adapter?.getStatus?.();
    return {
      cpuPct: cpu,
      memFreeBytes: freeMem,
      memTotalBytes: totalMem,
      memUsedPct: Math.round((1 - freeMem / totalMem) * 100),
      disk,
      diskFreePct: Math.round((disk.freeBytes / (disk.totalBytes || 1)) * 100),
      uptimeMs: os.uptime() * 1000,
      processUptimeMs: Math.round(process.uptime() * 1000),
      queue: queueCounts,
      whatsapp: wa?.status || "UNKNOWN",
      intakePaused: this.queue.paused || this.queue.diskPaused,
    };
  }

  async _cpuPct() {
    const cpus = os.cpus();
    const total = cpus.reduce(
      (acc, c) => {
        acc.user += c.times.user;
        acc.nice += c.times.nice;
        acc.sys += c.times.sys;
        acc.idle += c.times.idle;
        return acc;
      },
      { user: 0, nice: 0, sys: 0, idle: 0 }
    );
    if (!this.lastCpuTimes) {
      this.lastCpuTimes = total;
      this.lastTick = Date.now();
      return 0;
    }
    const userDiff = total.user + total.nice + total.sys - (this.lastCpuTimes.user + this.lastCpuTimes.nice + this.lastCpuTimes.sys);
    const idleDiff = total.idle - this.lastCpuTimes.idle;
    this.lastCpuTimes = total;
    const sum = userDiff + idleDiff;
    if (sum <= 0) return 0;
    return Math.min(100, Math.round((userDiff / sum) * 100));
  }

  _evaluateAlerts(snap) {
    const alerts = [];

    const diskThreshold = this.settings.getNumber("storage.diskFreeSpaceThresholdMb", 2000);
    const diskFreeMb = Math.round(snap.disk.freeBytes / (1024 * 1024));
    if (snap.disk.freeBytes > 0 && diskFreeMb < diskThreshold) {
      if (!this.diskLow) {
        this.diskLow = true;
        this.queue.setDiskPaused(true);
        this.logger.warn("health", `disk low: ${diskFreeMb}MB < ${diskThreshold}MB — intake paused`);
      }
      alerts.push({ id: "disk_low", level: "ERROR", text: `مساحة القرص منخفضة: ${diskFreeMb} MB` });
    } else if (this.diskLow) {
      this.diskLow = false;
      this.queue.setDiskPaused(false);
      this.logger.info("health", "disk space recovered — intake resumed");
    }

    const maxQueue = this.settings.getNumber("queue.maxQueueSize", 100000);
    if (snap.queue.QUEUED > Math.floor(maxQueue * 0.9)) {
      alerts.push({ id: "queue_overload", level: "WARN", text: `الطابور كبير: ${snap.queue.QUEUED}` });
    }

    if (snap.whatsapp !== "CONNECTED") {
      alerts.push({ id: "whatsapp_down", level: "WARN", text: "WhatsApp غير متصل" });
    }

    if (snap.processUptimeMs > 120000 && snap.queue.PROCESSING === 0 && snap.queue.QUEUED > 0 && snap.whatsapp === "CONNECTED" && snap.cpuPct < 5) {
      alerts.push({ id: "workers_stuck", level: "WARN", text: "الطابور لا يتقدم — تحقق من الـ Workers" });
    }

    // إرسال التنبيهات الجديدة فقط
    for (const a of alerts) {
      const key = `${a.id}:${a.level}`;
      if (!this.alerts.has(key)) {
        this.alerts.set(key, a);
        this.logger.warn("health", `alert: ${a.text}`);
        this.onAlert?.(a);
      }
    }
    for (const key of [...this.alerts.keys()]) {
      if (!alerts.some((a) => `${a.id}:${a.level}` === key)) this.alerts.delete(key);
    }
  }

  getSnapshot() {
    return this.snapshot;
  }

  alertsList() {
    return [...this.alerts.values()];
  }
}