// توليد أيقونة التطبيق (512×512 PNG) في build/icon.png — يُستخدمها
// electron-builder لكل المنصات (AppImage/NSIS/DMG). قابل لإعادة التشغيل.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "build");
const outFile = join(outDir, "icon.png");

const svg = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1d4ed8"/>
      <stop offset="1" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bg)"/>
  <rect x="96" y="112" width="320" height="300" rx="36" fill="#ffffff"/>
  <circle cx="182" cy="222" r="34" fill="#0f1220" opacity="0.9"/>
  <circle cx="330" cy="222" r="34" fill="#0f1220" opacity="0.9"/>
  <path d="M190 300 q66 74 132 0" stroke="#0f1220" stroke-width="30" stroke-linecap="round" fill="none" opacity="0.9"/>
</svg>`;

const sharp = (await import("sharp")).default;
mkdirSync(outDir, { recursive: true });
await sharp(Buffer.from(svg)).resize(512, 512).png().toFile(outFile);
console.log("icon written:", outFile);