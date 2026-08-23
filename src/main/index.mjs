// Electron main — نقطة الإقلاع: خدمات + نافذة + IPC + أحداث الدفع للواجهة.
import { app, ipcMain, dialog } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AppServices } from "./app-services.mjs";
import { createMainWindow } from "./windows.mjs";
import { IpcHub } from "./ipc/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

let services = null;
let mainWindow = null;
let pushTimer = null;

// حماية شاملة: أي خطأ غير متوقع يُسجّل ولا يُسقط العملية بصمت.
process.on("unhandledRejection", (reason) => {
  try { services?.logger?.error?.("core", "unhandledRejection", { err: String(reason?.message || reason) }); } catch { /* خامل */ }
});
process.on("uncaughtException", (err) => {
  try { services?.logger?.error?.("core", "uncaughtException", { err: err?.message || String(err) }); } catch { /* خامل */ }
});

async function startServices() {
  if (services) return services;
  const dataDir = process.env.APP_DATA_DIR || join(app.getPath("userData"), "data");
  services = new AppServices({ dataDir, envPassword: process.env.ADMIN_PASSWORD || null });
  await services.init();
  return services;
}

function createWindow() {
  const preloadPath = join(__dirname, "preload.cjs");
  mainWindow = createMainWindow(preloadPath);
  mainWindow.on("closed", () => { mainWindow = null; });
  // إخبار الواجهة بحالة التكبير لتحديث أيقونة زر التكبير/الاستعادة
  const sendMaxState = () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximizable()) {
      mainWindow.webContents.send("window:maximized", { maximized: mainWindow.isMaximized() });
    }
  };
  mainWindow.on("maximize", sendMaxState);
  mainWindow.on("unmaximize", sendMaxState);
  return mainWindow;
}

async function bootstrap() {
  const svc = await startServices();

  createWindow();

  new IpcHub({
    ipcMain,
    services: svc,
    getWindow: () => mainWindow,
    openFileDialog: async () => {
      if (!mainWindow) return null;
      const r = await dialog.showOpenDialog(mainWindow, {
        title: "اختر ملف وسائط",
        properties: ["openFile"],
        filters: [{ name: "Media", extensions: ["jpg", "jpeg", "png", "gif", "webp", "mp4", "mov", "mkv", "avi"] }],
      });
      return r.canceled ? null : r.filePaths[0];
    },
    saveFileDialog: async (defaultName) => {
      if (!mainWindow) return null;
      const r = await dialog.showSaveDialog(mainWindow, {
        title: "حفظ الملف",
        defaultPath: defaultName || "download",
      });
      return r.canceled ? null : r.filePath;
    },
  });

  // تمرير أحداث الـ Adapter + تحديث اللوحة إلى الواجهة
  const send = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  };
  svc.onAdapterEvents((adapter) => {
    adapter.on("status", (st) => send("whatsapp:status", st));
    adapter.on("qr", (qr) => send("whatsapp:qr", { qr }));
  });

  if (!pushTimer) {
    pushTimer = setInterval(() => {
      try { services && send("overview:tick", services.overview()); } catch { /* ignore */ }
    }, 2000);
    if (pushTimer.unref) pushTimer.unref();
  }
}

const shutdown = async () => {
  if (pushTimer) { clearInterval(pushTimer); pushTimer = null; }
  if (services) { await services.shutdown(); services = null; }
};

// نسخة واحدة فقط — SQLite WAL لا يتحمل عمليتين
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      await bootstrap();
    } catch (err) {
      console.error("bootstrap failed", err);
      dialog.showErrorBox("خطأ في بدء التشغيل", String(err?.message || err));
      app.exit(1);
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (mainWindow === null && app.isReady()) createWindow();
  });

  app.on("before-quit", () => { shutdown().catch(() => {}); });
}