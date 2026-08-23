// إنشاء وإدارة نافذة Electron الرئيسية بحماية أمنية كاملة.
import { BrowserWindow, shell, Menu } from "electron";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createMainWindow(preloadPath) {
  // التطوير = تشغيل خادم Vite فقط؛ أي تشغيل آخر (npm run start، أو معبّأ)
  // يعمل بوضع الإنتاج: بلا قوائم، بلا أدوات مطوّر، بلا تحديد نصوص.
  const isDev = !!process.env.VITE_DEV_SERVER_URL;

  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    title: "WhatsApp Sticker Bot",
    backgroundColor: "#0f1220",
    frame: false,
    titleBarStyle: "hidden",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: isDev,
    },
    show: false,
  });

  win.once("ready-to-show", () => win.show());

  // في غير وضع التطوير: إزالة القائمة وحجب مفاتيح أدوات المطوّر
  // (F12 / Ctrl+Shift+I / Cmd+Alt+I) والحافظة لا تكشف الاختصارات.
  if (!isDev) {
    Menu.setApplicationMenu(null);
    win.webContents.on("before-input-event", (event, input) => {
      const key = String(input.key || "").toLowerCase();
      const ctrlShiftI = input.control && input.shift && key === "i";
      const f12 = key === "f12";
      const macDev = process.platform === "darwin" && input.alt && key === "i";
      if (ctrlShiftI || f12 || macDev) event.preventDefault();
    });
  }

  // الروابط الخارجية تفتح في المتصفح، لا داخل النافذة
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
  const allowedNav = devServerUrl() || pathToFileURL(join(__dirname, "../../dist-renderer/index.html")).toString();
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(String(allowedNav))) event.preventDefault();
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    const indexHtml = join(__dirname, "../../dist-renderer/index.html");
    if (!existsSync(indexHtml)) {
      throw new Error("dist-renderer/index.html missing — شغّل npm run build:renderer أولاً أو استخدم npm run dev");
    }
    win.loadFile(indexHtml);
  }
  return win;
}

function devServerUrl() {
  return process.env.VITE_DEV_SERVER_URL || "";
}