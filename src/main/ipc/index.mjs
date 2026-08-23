// IPC Hub — جميع قنوات window.api محجوزة هنا مع فحص الصلاحيات لكل قناة.
// الأمان: كل قناة ترفض المكالمات غير المسموحة سابقاً من preload، والمعالجات تتحقق من المصادقة.
import { resolve } from "node:path";
import { lookupApp, DEFAULT_LANG } from "../../../shared/i18n/index.mjs";

const PUBLIC_CHANNELS = new Set(["auth:status", "auth:login", "auth:setup", "theme:get", "window:minimize", "window:toggle-maximize", "window:close", "app:set-language"]);

// يترجم أي نصّ خطأ/رسالة عائد للواجهة حسب لغة التطبيق الحالية.
function getLang(services) {
  return services?.settings?.get?.("app.language") || DEFAULT_LANG;
}
function translateResult(result, lang) {
  if (result && typeof result === "object") {
    if (typeof result.error === "string") result.error = lookupApp(lang, result.error);
    if (typeof result.message === "string") result.message = lookupApp(lang, result.message);
  }
  return result;
}

// قائمة مفاتيح الإعدادات القابلة للتعديل من الواجهة فقط (يُقيّد النطاق).
const EDITABLE_SETTINGS = new Set([
  "bot.name", "bot.stickerPack", "bot.stickerAuthor",
  "quota.defaultDailyQuota", "quota.mode",
  "queue.maxMediaWorkers", "queue.maxDownloadWorkers", "queue.maxQueueSize",
  "queue.maxPendingJobsPerUser", "queue.jobLeaseTimeoutMs", "queue.jobHeartbeatIntervalMs",
  "queue.maxRetries", "queue.retryBackoffBaseMs",
  "media.maxImageBytes", "media.maxVideoBytes", "media.maxVideoDurationSeconds",
  "media.stickerMaxFps", "media.stickerQuality", "media.stickerSize",
  "storage.cacheRetentionHours", "storage.failedRetentionDays", "storage.logsRetentionDays",
  "storage.cleanupIntervalMinutes", "storage.diskFreeSpaceThresholdMb",
  "whatsapp.provider", "whatsapp.groupMode", "whatsapp.autoReconnect", "whatsapp.autoConnectOnBoot",
  "whatsapp.sessionInstanceId", "whatsapp.instanceName",
  "humanizer.enabled", "humanizer.typingEnabled", "humanizer.markSeenEnabled",
  "humanizer.replyDelayMinMs", "humanizer.replyDelayMaxMs",
  "rateLimit.perUserPerMinute", "rateLimit.perGroupPerMinute", "rateLimit.globalPerMinute",
  "rateLimit.maxInvalidPerHour", "admin.lockTimeoutMinutes",
  "history.enabled", "history.mediaRetentionDays",
  "app.language", "app.theme", "app.autoUpdateEnabled",
]);

export class IpcHub {
  constructor({ ipcMain, services, getWindow, openFileDialog, saveFileDialog }) {
    this.ipcMain = ipcMain;
    this.services = services;
    this.getWindow = getWindow;
    this.openFileDialog = openFileDialog || null;
    this.saveFileDialog = saveFileDialog || null;
    this._register();
  }

  _register() {
    const { ipcMain, services: s } = this;

    const def = (channel, fn) => ipcMain.handle(channel, async (event, payload = {}) => {
      const lang = getLang(s);
      try {
        if (!PUBLIC_CHANNELS.has(channel) && s.admin.loginRequired()) {
          const token = payload?.token;
          if (!token || !s.admin.requireAuth(token)) {
            return translateResult({ ok: false, error: "غير مصرّح: سجّل الدخول أولاً", code: "UNAUTHORIZED" }, lang);
          }
        }
        return translateResult(await fn(payload, event), lang);
      } catch (err) {
        s.logger?.error?.("ipc", `${channel} failed`, { err: err.message });
        return translateResult({ ok: false, error: err.message || "خطأ غير متوقع", code: err.code || "ERROR" }, lang);
      }
    });

    // ===== Window controls (عنوان مخصص) =====
    def("window:minimize", () => { this.getWindow?.()?.minimize?.(); return { ok: true }; });
    def("window:toggle-maximize", () => {
      const w = this.getWindow?.();
      if (!w) return { ok: false };
      if (w.isMaximized()) w.unmaximize();
      else w.maximize();
      return { ok: true, maximized: w.isMaximized() };
    });
    def("window:close", () => { this.getWindow?.()?.close?.(); return { ok: true }; });

    // ===== Auth =====
    def("auth:status", () => ({
      ok: true,
      configured: s.admin.isConfigured(),
      requireLogin: s.admin.loginRequired(),
      language: s.settings.get("app.language") || null,
      languageChosen: s.settings.get("app.languageChosen") === true,
    }));

    def("theme:get", () => ({
      ok: true,
      theme: s.settings.get("app.theme") || "dark",
    }));

    // ضبط لغة الواجهة في أول تشغيل (قبل تسجيل الدخول) — آمن ومقصور على ar/en.
    def("app:set-language", ({ value }) => {
      if (value !== "ar" && value !== "en") return translateResult({ ok: false, error: "قيمة غير مسموحة" }, lang);
      s.settings.set("app.language", value);
      s.settings.set("app.languageChosen", true);
      return { ok: true };
    });

    def("auth:login", ({ password }) => {
      if (!s.admin.verify(password)) return { ok: false, error: "كلمة المرور غير صحيحة" };
      const token = s.admin.createSession();
      return { ok: true, token };
    });

    def("auth:logout", ({ token }) => {
      s.admin.destroySession(token);
      return { ok: true };
    });

    def("auth:setup", ({ password }) => {
      if (s.admin.isConfigured()) return { ok: false, error: "كلمة المرور مُحدّدة مسبقاً" };
      s.admin.setPassword(password);
      const token = s.admin.createSession();
      return { ok: true, token };
    });

    // ===== Overview =====
    def("overview:get", () => ({ ok: true, data: s.overview() }));

    // ===== Statistics =====
    def("stats:period", async ({ days }) => {
      const d = Math.max(1, Math.min(90, Number(days) || 7));
      return { ok: true, data: await s.statistics(d) };
    });

    def("stats:export-users", ({ format = "csv" } = {}) => {
      return {
        ok: true,
        format: format === "json" ? "json" : "csv",
        csv: s.backupManager.exportUsersCSV(),
        json: s.backupManager.exportUsersJSON(),
      };
    });

    // ===== Queue =====
    def("queue:list", (p) => {
      const f = { ...(p.filters || p) };
      delete f.token;
      f.limit = Math.min(Number(f.limit) || 50, 500);
      f.offset = Math.max(Number(f.offset) || 0, 0);
      return { ok: true, data: s.queue.list(f) };
    });
    def("queue:counts", () => ({
      ok: true,
      ...s.queue.counts(),
      paused: s.queue.paused,
      diskPaused: s.queue.diskPaused,
    }));
    def("queue:pause", () => { s.queue.setPaused(true); return { ok: true }; });
    def("queue:resume", () => { s.queue.setPaused(false); return { ok: true }; });
    def("queue:retry-failed", () => ({ ok: true, requeued: s.queue.retryFailed() }));
    def("queue:cancel", ({ ids }) => { s.queue.cancelJobs(ids || []); return { ok: true }; });
    def("queue:clear-failed", () => { s.queue.clearFailed(); return { ok: true }; });

    // ===== Users =====
    def("users:list", (p) => {
      const f = { ...(p || {}) };
      delete f.token;
      f.limit = Math.min(Number(f.limit) || 50, 500);
      f.offset = Math.max(Number(f.offset) || 0, 0);
      return { ok: true, data: s.users.search(f) };
    });
    def("users:get", ({ id }) => {
      const u = s.users.getById(id);
      if (!u) return { ok: false, error: "المستخدم غير موجود" };
      const stats = s.users.getUserStats(id);
      const quota = s.quota.usageFor(u);
      const recentJobs = s.jobs.list({ userId: id, limit: 10 }).rows;
      return { ok: true, user: { ...u, stats, quota, recentJobs } };
    });
    def("users:update", ({ id, fields }) => {
      if (!fields || typeof fields !== "object") return { ok: false, error: "حقول غير صالحة" };
      const allowed = { role: 1, priority: 1, quota_limit: 1, quota_mode: 1, status: 1, name: 1, push_name: 1 };
      const clean = {};
      for (const [k, v] of Object.entries(fields)) if (allowed[k]) clean[k] = v;
      if (!Object.keys(clean).length) return { ok: false, error: "لا توجد حقول صالحة" };
      return { ok: true, user: s.users.update(id, clean) };
    });
    def("users:block", ({ id }) => ({ ok: true, user: s.users.setBlocked(id, true) }));
    def("users:unblock", ({ id }) => ({ ok: true, user: s.users.setBlocked(id, false) }));
    def("users:reset-quota", ({ id }) => { s.quota.resetForUser(id); return { ok: true }; });
    def("users:delete", ({ id }) => { s.users.deleteUser(id); return { ok: true }; });
    def("users:send-message", async ({ id, text }) => {
      const u = s.users.getById(id);
      if (!u) return { ok: false, error: "المستخدم غير موجود" };
      if (!text || typeof text !== "string" || !text.trim()) return { ok: false, error: "النص مطلوب" };
      const st = s.adapter?.getStatus?.();
      if (!st || st.status !== "CONNECTED") return { ok: false, error: "WhatsApp غير متصل", code: "ADAPTER_UNAVAILABLE" };
      await s.adapter.sendText(u.whatsappId, text.trim());
      return { ok: true };
    });
    def("users:send-media", async ({ id }) => {
      if (!this.openFileDialog) return { ok: false, error: "غير مدعوم على هذه المنصة" };
      const filePath = await this.openFileDialog();
      if (!filePath) return { ok: false, cancelled: true };
      const u = s.users.getById(id);
      if (!u) return { ok: false, error: "المستخدم غير موجود" };
      const st = s.adapter?.getStatus?.();
      if (!st || st.status !== "CONNECTED") return { ok: false, error: "WhatsApp غير متصل", code: "ADAPTER_UNAVAILABLE" };
      const kind = /\.(jpe?g|png|gif|webp)$/i.test(filePath) ? "image" : "video";
      await s.adapter.sendMedia(u.whatsappId, filePath, { kind });
      return { ok: true };
    });

    // ===== ===== Groups ====== =====
    def("groups:list", (p) => {
      const f = { ...(p || {}) };
      delete f.token;
      f.limit = Math.min(Number(f.limit) || 100, 500);
      return { ok: true, data: s.groups.list(f) };
    });
    def("groups:refresh", async () => {
      try {
        await s.syncGroups?.();
      } catch (err) {
        s.logger?.warn?.("ipc", "groups:refresh sync failed", { err: err.message });
      }
      return { ok: true, data: s.groups.list({ limit: 500 }) };
    });
    def("groups:settings", ({ id }) => {
      const g = s.groups.getGroup(id) || { group_id: id };
      const defaults = { mode: s.settings.get("whatsapp.groupMode") || "MENTION_ONLY" };
      const settings = s.groups.getSettings(id) || s.groups.ensureSettings(id, defaults);
      return { ok: true, group: g, settings };
    });
    def("groups:update-settings", ({ id, fields }) => {
      const allowed = { enabled: 1, mode: 1, daily_limit: 1, allowed_roles: 1 };
      const clean = {};
      for (const [k, v] of Object.entries(fields || {})) {
        if (allowed[k]) clean[k] = k === "allowed_roles" ? (Array.isArray(v) ? v : [v]) : v;
      }
      if (!Object.keys(clean).length) return { ok: false, error: "لا توجد حقول صالحة" };
      const modes = ["OFF", "MENTION_ONLY", "COMMAND_ONLY", "AUTO"];
      if (clean.mode && !modes.includes(String(clean.mode).toUpperCase())) return { ok: false, error: "وضع غير صالح" };
      return { ok: true, settings: s.groups.updateSettings(id, clean) };
    });

    // ===== Settings =====
    def("settings:getAll", () => ({ ok: true, data: s.settings.getAll() }));
    def("settings:set", ({ key, value }) => {
      if (!EDITABLE_SETTINGS.has(key)) return { ok: false, error: "إعداد غير قابل للتعديل" };
      if (/^(queue\.|media\.|rateLimit\.)/.test(key)) {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "قيمة رقمية موجبة مطلوبة" };
        const max = /maxImageBytes|maxVideoBytes/.test(key) ? 512 * 1024 * 1024 : (key.endsWith("MaxFps") ? 60 : 100000);
        if (n > max) return { ok: false, error: "قيمة خارج النطاق المسموح" };
        value = Math.round(n);
      }
      if (/\.mode$/.test(key)) {
        const allowedModes = { "quota.mode": ["rolling_24h", "daily_fixed", "unlimited"], "app.language": ["ar", "en"] };
        if (allowedModes[key] && !allowedModes[key].includes(value)) return { ok: false, error: "قيمة غير مسموحة" };
      }
      s.settings.set(key, value);
      return { ok: true };
    });

    // ===== WhatsApp =====
    def("whatsapp:status", () => ({ ok: true, data: s.adapter?.getStatus?.() || null }));
    def("whatsapp:connect", async () => {
      if (s.adapter?.getStatus?.().status === "CONNECTED") return { ok: true, already: true };
      await s.adapter.connect();
      return { ok: true };
    });
    def("whatsapp:disconnect", async () => { await s.adapter.disconnect(); return { ok: true }; });
    def("whatsapp:logout", async () => { await s.adapter.logout(); return { ok: true }; });
    def("whatsapp:pairing", async ({ phone }) => {
      const st = s.adapter?.getStatus?.();
      if (!s.adapter?.client) {
        // الاتصال العادي ينتظر اكتمال الرابط (ready)؛ تدفق الإقران يبدأ العميل
        // في الخلفية عبر requestPairingCode نفسه.
      } else if (st?.status === "CONNECTED") {
        return { ok: false, error: "الجهاز متصل بالفعل — استخدم الإجراءات أوّلاً ثم حدّث الرمز", code: "ALREADY_CONNECTED" };
      }
      const code = await s.adapter.requestPairingCode(String(phone).replace(/[^\d]/g, ""));
      const formatted = code.replace(/(.{4})(?=.)/g, "$1-");
      return { ok: true, code: formatted };
    });

    // ===== Backups =====
    def("backups:list", () => ({ ok: true, backups: s.backups.list(100) }));
    def("backups:create", async ({ includeSession, passphrase }) => {
      const b = await s.backupManager.createBackup({ includeSession: !!includeSession, passphrase: passphrase || null });
      return { ok: true, backup: b };
    });
    def("backups:restore", async ({ path }) => {
      if (!path || typeof path !== "string") return { ok: false, error: "مسار مطلوب" };
      const abs = resolve(path);
      const backupDir = s.paths.get("backups");
      if (!abs.startsWith(backupDir)) return { ok: false, error: "مسار خارج مجلد النسخ الاحتياطي" };
      const result = await s.backupManager.restoreBackup({ zipPath: abs, passphrase: null });
      return { ok: true, result };
    });

    // ===== إعادة الضبط الكامل =====
    // يتطلب كلمة التأكيد «RESET» حمايةً من التنفيذ الخاطئ (يمسح كل شيء نهائياً).
    // المصادقة يتولاها الـ wrapper أعلاه عبر s.admin.
    def("system:factory-reset", async ({ confirmWord = "" }) => {
      if (String(confirmWord).trim() !== "RESET") {
        return { ok: false, error: "اكتب كلمة التأكيد RESET للتنفيذ.", code: "NEEDS_CONFIRM" };
      }
      const result = await s.factoryReset();
      return { ok: true, result };
    });

    // ===== Messages (سجل المحادثات) =====
    def("messages:conversations", (p) => ({
      ok: true,
      conversations: s.messages.conversations({ limit: Math.min(Number(p?.limit) || 100, 500) }),
    }));
    def("messages:list", (p) => {
      const f = {
        chatId: p?.chatId || null,
        userId: Number(p?.userId) || null,
        limit: Math.min(Number(p?.limit) || 100, 500),
        offset: Math.max(Number(p?.offset) || 0, 0),
        order: p?.order === "asc" ? "asc" : "desc",
      };
      return { ok: true, data: s.messages.listForChat(f) };
    });
    def("messages:delete", ({ id }) => {
      const removed = s.messages.deleteById(Number(id));
      return removed ? { ok: true } : { ok: false, error: "الرسالة غير موجودة" };
    });
    // حذف رسالة صادرة "للجميع" من واتساب لدى المستخدم (revoke)، دون حذف سجل الخادم.
    def("messages:delete-everyone", async ({ id, whatsappConfirmed = false }) => {
      if (!whatsappConfirmed) {
        return { ok: false, error: "يجب تأكيد النية: انقر مرة ثانية لتأكيد الحذف للجميع.", code: "NEEDS_CONFIRM" };
      }
      const m = s.messages.waMessageKey(Number(id));
      if (!m || m.direction !== "OUT") return { ok: false, error: "الرسالة غير موجودة أو غير صادرة", code: "NOT_OUT" };
      const key = m.messageId || m.jobStickerKey;
      if (!key) {
        return { ok: false, error: "لا يتوفر معرّف رسالة واتساب لهذه الرسالة", code: "NO_MSG_KEY" };
      }
      const st = s.adapter?.getStatus?.();
      if (!st || st.status !== "CONNECTED") {
        return { ok: false, error: "WhatsApp غير متصل — تعذّر حذف الرسالة عند المستخدم", code: "NOT_CONNECTED" };
      }
      try {
        await s.adapter.revokeMessage(key);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err?.message || "فشل حذف الرسالة", code: err?.code || "REVOKE_FAILED" };
      }
    });
    def("messages:clear-chat", ({ chatId }) => {
      const count = s.messages.deleteFilesForChat(String(chatId));
      return { ok: true, removed: count };
    });
    def("messages:clear-user", ({ userId }) => {
      const count = s.messages.deleteFilesForUser(Number(userId));
      return { ok: true, removed: count };
    });
    def("messages:media", async ({ id }) => {
      const m = s.messages.getById(Number(id));
      if (!m) return { ok: false, error: "الرسالة غير موجودة" };
      const { readFile, stat } = await import("node:fs/promises");
      const path = m.thumbPath || m.mediaPath;
      if (!path) return { ok: true, hasMedia: false, type: m.type };
      try {
        const st = await stat(path);
        const MAX = 8 * 1024 * 1024;
        if (st.size > MAX) return { ok: true, hasMedia: true, tooLarge: true, size: st.size, mime: m.mime };
        const buf = await readFile(path);
        return {
          ok: true,
          hasMedia: true,
          data: buf.toString("base64"),
          mime: m.thumbPath ? "image/webp" : (m.mime || "application/octet-stream"),
          size: st.size,
          type: m.type,
        };
      } catch {
        return { ok: true, hasMedia: false, type: m.type, missing: true };
      }
    });
    def("messages:open", async ({ id }) => {
      const m = s.messages.getById(Number(id));
      if (!m || !m.mediaPath) return { ok: false, error: "لا يوجد ملف مرتبط" };
      const electron = await import("electron").catch(() => null);
      const shell = electron?.shell;
      if (!shell || typeof shell.showItemInFolder !== "function") {
        return { ok: false, error: "غير مدعوم على هذه المنصة" };
      }
      try {
        const { existsSync } = await import("node:fs");
        if (!existsSync(m.mediaPath)) return { ok: false, error: "الملف محذوف من القرص" };
        shell.showItemInFolder(m.mediaPath);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });
    def("messages:save", async ({ id }) => {
      if (!this.saveFileDialog) return { ok: false, error: "غير مدعوم على هذه المنصة" };
      const m = s.messages.getById(Number(id));
      if (!m) return { ok: false, error: "الرسالة غير موجودة" };
      const path = m.mediaPath || m.thumbPath;
      if (!path) return { ok: false, error: "لا يوجد ملف مرتبط بهذه الرسالة" };
      const { existsSync } = await import("node:fs");
      if (!existsSync(path)) return { ok: false, error: "الملف محذوف من القرص" };
      const dest = await this.saveFileDialog(suggestFileName(m));
      if (!dest) return { ok: true, cancelled: true };
      const { copyFile } = await import("node:fs/promises");
      await copyFile(path, dest);
      return { ok: true, saved: dest };
    });

    // ===== Logs =====
    def("logs:list", (p) => {
      const f = { ...(p || {}) };
      delete f.token;
      f.limit = Math.min(Number(f.limit) || 200, 1000);
      f.offset = Math.max(Number(f.offset) || 0, 0);
      return {
        ok: true,
        data: s.logger.repo.search(f),
      };
    });

    def("logs:stats", () => {
      const stats = s.logger.repo.stats();
      return { ok: true, ...stats };
    });

    def("logs:export", () => {
      const rows = s.logger.repo.all();
      const header = ["id", "created_at", "level", "scope", "message", "meta_json"];
      const esc = (v) => {
        const s = v === undefined || v === null ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [header.join(",")];
      for (const r of rows) lines.push(header.map((h) => esc(r[h])).join(","));
      return { ok: true, csv: lines.join("\n") };
    });

    def("logs:clear", () => {
      const n = s.logger.repo.clearAll();
      return { ok: true, deleted: n };
    });

    def("logs:reload", () => ({ ok: true }));
  }
}

export { EDITABLE_SETTINGS };

// اسم مقترح عند حفظ ملف من السجل — يفضّل الاسم الأصلي في media_meta.
function suggestFileName(m) {
  const meta = safeParseMeta(m.mediaMeta);
  if (typeof meta?.filename === "string" && meta.filename) return meta.filename;
  const extByMime = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "video/mp4": ".mp4" };
  const ext = extByMime[m.mime] || "";
  return `${m.type || "file"}_${m.id}${ext}`;
}

function safeParseMeta(str) {
  try { return str ? JSON.parse(str) : null; } catch { return null; }
}