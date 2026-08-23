// Preload — تعريف window.api آمن للعرض، بدون nodeIntegration.
// CJS إلزامي: الساندبوكس لا يدعم ESM في السكربتات المسبقة.
const { contextBridge, ipcRenderer } = require("electron");

// قائمة بيضاء صارمة للقنوات — أي قناة غير مذكورة تُرفض.
const ALLOWED_INVOKE = new Set([
  "auth:status", "auth:login", "auth:logout", "auth:setup",
  "theme:get",
  "window:minimize", "window:toggle-maximize", "window:close",
  "overview:get",
  "stats:period", "stats:export-users",
  "queue:list", "queue:counts", "queue:pause", "queue:resume",
  "queue:retry-failed", "queue:cancel", "queue:clear-failed",
  "users:list", "users:get", "users:update", "users:delete",
  "users:block", "users:unblock", "users:reset-quota",
  "users:send-message", "users:send-media",
  "groups:list", "groups:refresh", "groups:settings", "groups:update-settings",
  "messages:conversations", "messages:list", "messages:delete", "messages:delete-everyone",
  "messages:clear-chat", "messages:clear-user", "messages:media", "messages:open", "messages:save",
  "settings:getAll", "settings:set",
  "whatsapp:status", "whatsapp:connect", "whatsapp:disconnect",
  "whatsapp:logout", "whatsapp:pairing",
  "backups:list", "backups:create", "backups:restore",
  "logs:list", "logs:stats", "logs:export", "logs:clear", "logs:reload",
  "system:factory-reset",
]);

const ALLOWED_EVENTS = new Set([
  "whatsapp:status", "whatsapp:qr", "overview:tick", "window:maximized",
]);

contextBridge.exposeInMainWorld("api", {
  // استدعاء قناة مع حمولة، مع رفض أي قناة غير مسموحة
  invoke(channel, payload) {
    if (!ALLOWED_INVOKE.has(channel)) {
      return Promise.reject(new Error(`IPC channel blocked: ${channel}`));
    }
    return ipcRenderer.invoke(channel, payload ?? {});
  },
  // اشتراك في أحداث مدفوعة من main؛ يُعيد دالة إلغاء الاشتراك
  on(channel, cb) {
    if (!ALLOWED_EVENTS.has(channel)) {
      throw new Error(`IPC event blocked: ${channel}`);
    }
    const listener = (_e, data) => cb(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});