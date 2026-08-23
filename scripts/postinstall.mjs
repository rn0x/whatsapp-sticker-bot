// postinstall: لا اعتماديات أصلية (node:sqlite مدمج). نتأكد فقط من وجود ffmpeg-static.
import { statSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static");

try {
  statSync(ffmpegPath);
  console.log(`[postinstall] ffmpeg binary OK: ${ffmpegPath}`);
} catch {
  console.warn("[postinstall] ffmpeg-static binary not found — سيعتمد التطبيق على ffmpeg في PATH عند الحاجة.");
}

// Chromium للنسخة المعبأة (electron-builder يجمعه عبر extraResources).
try {
  const script = new URL("./setup-browser.mjs", import.meta.url).pathname;
  const r = spawnSync(process.execPath, [script], { stdio: "inherit" });
  if (r.status !== 0) console.warn("[postinstall] setup-browser exited nonzero — Chrome قد يحتاج تثبيتاً يدوياً.");
} catch (err) {
  console.warn("[postinstall] setup-browser skipped:", err.message);
}

// wwebjs 1.34 مقابل WhatsApp Web الجديد (id._serialized -> id.$1): حقن backfill.
try {
  const script = new URL("./patch-wwebjs-serialized.mjs", import.meta.url).pathname;
  const r = spawnSync(process.execPath, [script], { stdio: "inherit" });
  if (r.status !== 0) console.warn("[postinstall] patch-wwebjs-serialized exited nonzero.");
} catch (err) {
  console.warn("[postinstall] patch-wwebjs-serialized skipped:", err.message);
}

console.log("[postinstall] done (no native modules needed — node:sqlite builtin).");