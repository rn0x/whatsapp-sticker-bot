// AppServices — حاوية كل خدمات النظام والإقلاع المنظم.
// Sequence: config → db → migrations → integrity → recovery → cleanup → workers → whatsapp → bot → health.
import { Database } from "../core/database.mjs";
import { AppPaths } from "./config.mjs";
import { Logger } from "./logger.mjs";
import { SettingsRepo } from "../core/repositories/settings.repo.mjs";
import { UsersRepo } from "../core/repositories/users.repo.mjs";
import { GroupsRepo } from "../core/repositories/groups.repo.mjs";
import { JobsRepo } from "../core/repositories/jobs.repo.mjs";
import { QuotaRepo } from "../core/repositories/quota.repo.mjs";
import { CacheRepo } from "../core/repositories/cache.repo.mjs";
import { BackupsRepo } from "../core/repositories/backups.repo.mjs";
import { SessionsRepo } from "../core/repositories/sessions.repo.mjs";
import { MessagesRepo } from "../core/repositories/messages.repo.mjs";
import { QuotaService } from "../quota/quota-service.mjs";
import { QueueService } from "../queue/queue-service.mjs";
import { WorkerPool } from "../queue/worker-pool.mjs";
import { RateLimiter } from "../bot/rate-limiter.mjs";
import { MediaEngine } from "../media/media-engine.mjs";
import { MediaValidator } from "../media/media-validator.mjs";
import { BotManager } from "../bot/bot-manager.mjs";
import { createJobHandlers } from "../bot/job-processors.mjs";
import { CleanupWorker } from "../maintenance/cleanup-worker.mjs";
import { HealthMonitor } from "../maintenance/health-monitor.mjs";
import { Humanizer } from "../bot/humanizer.mjs";
import { AdminAuth } from "../admin/admin-auth.mjs";
import { BackupManager } from "../backup/backup-manager.mjs";
import { createAdapter } from "../whatsapp/whatsapp-adapter.mjs";
import { nowIso } from "../utils/time.mjs";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export class AppServices {
  constructor({ dataDir, envPassword } = {}) {
    this.dataDir = dataDir;
    this.envPassword = envPassword || null;
    this.paths = new AppPaths(dataDir);
  }

  async init() {
    // إعادة بناء كاملة — قابل للتكرار بعد shutdown (الاستعادة).
    this.db = new Database(this.paths.dbPath());
    await this.db.migrate();
    this.logger = new Logger(this.db);
    this.settings = new SettingsRepo(this.db);
    this.users = new UsersRepo(this.db);
    this.groups = new GroupsRepo(this.db);
    this.jobs = new JobsRepo(this.db);
    this.quotaRepo = new QuotaRepo(this.db);
    this.cache = new CacheRepo(this.db);
    this.backups = new BackupsRepo(this.db);
    this.sessionsRepo = new SessionsRepo(this.db);
    this.messages = new MessagesRepo(this.db);

    const integrity = this.db.integrityCheck();
    if (!integrity.ok) throw new Error(`database integrity failed: ${integrity.detail}`);

    this.quota = new QuotaService({ db: this.db, usersRepo: this.users, settings: this.settings, quotaRepo: this.quotaRepo });
    this.queue = new QueueService({ db: this.db, jobs: this.jobs, quota: this.quota, settings: this.settings, logger: this.logger });
    this.rateLimiter = new RateLimiter();
    this.humanizer = new Humanizer({ settings: this.settings, logger: this.logger });
    this.mediaEngine = new MediaEngine({ settings: this.settings, logger: this.logger });
    this.validator = new MediaValidator({ settings: this.settings, logger: this.logger });

    const integrityLog = integrity.ok ? "ok" : "FAILED";
    this.logger.info("core", "database ready", { integrity: integrityLog });

    // 1) استرداد الجوبات القديمة أولاً
    this.queue.recoverOnStartup();

    // 2) الـ Adapter + المعالجات + الـ Workers
    this.adapter = await createAdapter({
      db: this.db,
      sessionsRepo: this.sessionsRepo,
      settings: this.settings,
      logger: this.logger,
      paths: this.paths,
    });
    this.humanizer.setAdapter(this.adapter);

    this.handlers = createJobHandlers({
      adapter: this.adapter,
      queue: this.queue,
      users: this.users,
      groups: this.groups,
      settings: this.settings,
      logger: this.logger,
      paths: this.paths,
      cache: this.cache,
      mediaEngine: this.mediaEngine,
      validator: this.validator,
      humanizer: this.humanizer,
      messages: this.messages,
    });

    this.workers = new WorkerPool({
      queue: this.queue,
      settings: this.settings,
      logger: this.logger,
      downloadHandler: this.handlers.download,
      processHandler: this.handlers.process,
    });
    this.workers.start();

    // 3) الصيانة
    this.cleanup = new CleanupWorker({
      db: this.db, queue: this.queue, quota: this.quota,
      settings: this.settings, logger: this.logger, paths: this.paths, cache: this.cache,
    });
    this.cleanup.start();

    // 4) المراقبة
    this.health = new HealthMonitor({
      queue: this.queue, settings: this.settings, logger: this.logger,
      paths: this.paths, adapter: this.adapter,
      onAlert: (a) => this.logger.warn("health", a.text),
    });
    this.health.start();

    // 5) البوت
    this.bot = new BotManager({
      adapter: this.adapter, queue: this.queue, quota: this.quota, users: this.users,
      groups: this.groups, settings: this.settings, logger: this.logger, paths: this.paths,
      rateLimiter: this.rateLimiter, cache: this.cache, mediaEngine: this.mediaEngine,
      validator: this.validator, humanizer: this.humanizer, messages: this.messages,
    });
    this.bot.start();

    // مزامنة المجموعات عند كل اتصال جاهز — لظهورها فوراً في صفحة المجموعات.
    this.adapter.on("ready", () => {
      this.syncGroups().catch((err) => this.logger?.warn?.("groups", "sync failed", { err: err.message }));
    });

    // 6) المصادقة والنسخ الاحتياطي
    // نقل الجلسات المفعّلة عبر restore/init بدل تجديدها.
    const liveSessions = this.admin?.sessions || null;
    this.admin = new AdminAuth(this.settings, liveSessions);
    if (this.envPassword && !this._envHashApplied) {
      this.admin.setPassword(this.envPassword);
      this._envHashApplied = true;
    }

    this.backupManager = new BackupManager({
      db: this.db, settings: this.settings, logger: this.logger,
      paths: this.paths, backupsRepo: this.backups, sessionsRepo: this.sessionsRepo,
      services: this,
    });

    // إعادة تطبيق المستمعين على الـ Adapter الجديد (بعد Restore/init).
    if (this._adapterHooks && Array.isArray(this._adapterHooks)) {
      for (const hook of this._adapterHooks) hook(this.adapter);
    }

    this.logger.info("core", "AppServices ready");

    // الاتصال التلقائي عند التشغيل — فقط إذا وُجدت جلسة محفوظة (لا نفتح متصفحاً لأول مرة).
    const autoConnect = this.settings.getBool("whatsapp.autoConnectOnBoot", true);
    if (autoConnect && typeof this.adapter.hasSavedSession === "function" && this.adapter.hasSavedSession()) {
      this.logger.info("whatsapp", "auto-connecting with saved session");
      this.connectWhatsApp().catch((err) =>
        this.logger.warn("whatsapp", "auto-connect failed", { err: err.message })
      );
    }

    return this;
  }

  // تسجيل مستمعي أحداث الـ Adapter — يُعاد تشغيلهم تلقائياً بعد إعادة init.
  onAdapterEvents(hook) {
    if (!this._adapterHooks) this._adapterHooks = [];
    this._adapterHooks.push(hook);
    if (this.adapter) hook(this.adapter);
    return () => {
      const i = this._adapterHooks.indexOf(hook);
      if (i >= 0) this._adapterHooks.splice(i, 1);
    };
  }

  // ===== تشغيل WhatsApp =====
  async connectWhatsApp() {
    await this.adapter.connect();
  }

  // ===== مزامنة المجموعات من واتساب → قاعدة البيانات =====
  async syncGroups() {
    if (typeof this.adapter?.listChatGroups !== "function") return 0;
    const list = await this.adapter.listChatGroups();
    let n = 0;
    for (const g of list || []) {
      this.groups.upsertGroup(g.id, { name: g.name || null, memberCount: g.memberCount });
      n++;
    }
    if (n) this.logger.info("whatsapp", "groups synced", { count: n });
    return n;
  }

  // ===== لوحة التحكم: بيانات عامة =====
  overview() {
    const q = this.queue.counts();
    const u = this.users.counts();
    const today = new Date();
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const endToday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();
    const todayStats = this.jobs.statsForPeriod(startToday, endToday);
    const health = this.health?.getSnapshot?.() || null;
    const wa = this.adapter?.getStatus?.();
    const workers = this.workers?.status?.() || {};
    return {
      whatsapp: wa?.status || "DISCONNECTED",
      whatsappPhone: wa?.phone || null,
      qr: wa?.qr || null,
      users: u,
      jobsToday: todayStats.total || 0,
      successToday: todayStats.completed || 0,
      failedToday: todayStats.failed || 0,
      queue: q,
      processingNow: q.PROCESSING + q.SENDING,
      queueSize: q.QUEUED,
      workers,
      health,
      alerts: this.health?.alertsList?.() || [],
      uptimeMs: Math.round(process.uptime() * 1000),
      intakePaused: this.queue.paused || this.queue.diskPaused,
    };
  }

  async statistics(periodDays = 7) {
    const q = this.queue.counts();
    const users = this.users.counts();
    const from = new Date(Date.now() - periodDays * 86400000).toISOString();
    const to = new Date().toISOString();
    const jobs = this.jobs.statsForPeriod(from, to);
    const daily = this.jobs.dailyCounts(periodDays);
    return {
      users,
      jobs,
      daily: daily.map((d) => ({ day: d.day, total: d.total, completed: d.completed })),
      avgProcessingMs: this.jobs.avgProcessingMs(),
      activeUsers: this.jobs.usersWithJobs(),
      periodDays,
    };
  }

  // إيقاف منظم — يغلق DB. init() يعيد البناء عند الحاجة (Restore).
  async shutdown() {
    this.logger?.info?.("core", "shutting down");
    this.workers?.stop?.();
    this.cleanup?.stop?.();
    this.health?.stop?.();
    this.rateLimiter?.dispose?.();
    try {
      await this.adapter?.disconnect?.();
    } catch { /* ignore */ }
    try {
      this.db?.close?.();
    } catch { /* ignore */ }
  }

  // ===== إعادة الضبط الكامل =====
  // يمسح قاعدة البيانات وكل الوسائط/الجلسات/النسخ الاحتياطية ثم يعيد البناء من الصفر
  // (لأول استخدام). يقلد مسار restoreBackup: shutdown → wipe → init.
  async factoryReset() {
    this.logger?.info?.("core", "factory reset requested");
    await this.shutdown();
    // إعادة تطبيق كلمة مرور البيئة ADMIN_PASSWORD على الحالة النظيفة الجديدة.
    this._envHashApplied = false;
    const removed = this.wipeStorage();
    await this.init();
    this.logger.info("core", "factory reset completed", { removedCount: removed.length });
    return { ok: true, removed };
  }

  // يمسح الوسائط والجلسات والنسخ الاحتياطية وقاعدة البيانات على القرص.
  wipeStorage() {
    const removed = [];
    const emptied = [
      "incoming", "staging", "processing", "completed", "failed",
      "cache", "temp", "backups", "exports", "history",
    ];
    for (const key of emptied) {
      const p = this.paths.get(key);
      if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); removed.push(p); }
    }
    // جلسة واتساب (مجلد wwebjs_auth) — تسجيل الخروج الكامل.
    const auth = join(this.paths.get("data"), "wwebjs_auth");
    if (existsSync(auth)) { rmSync(auth, { recursive: true, force: true }); removed.push(auth); }
    // قاعدة البيانات مع ملفاتها الجانبية (-wal / -shm).
    const dbPath = this.paths.dbPath();
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = dbPath + suffix;
      if (existsSync(p)) { rmSync(p, { force: true }); removed.push(p); }
    }
    this.paths.ensure(); // نعيد إنشاء المجلدات الفارغة للعمل الجديد.
    return removed;
  }
}