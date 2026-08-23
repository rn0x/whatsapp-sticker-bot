// setup-browser: يثبّت Chromium (puppeteer) في cache محلي داخل المشروع
// حتى يلتقطه electron-builder عبر extraResources ويُستخدم في النسخة المعبأة.
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cacheRoot = join(root, "browser", ".cache");
mkdirSync(cacheRoot, { recursive: true });
process.env.PUPPETEER_CACHE_DIR = cacheRoot;

const puppeteerPkg = require("puppeteer/package.json");
const bin = typeof puppeteerPkg.bin === "string" ? puppeteerPkg.bin : puppeteerPkg.bin.puppeteer;
const cli = join(dirname(require.resolve("puppeteer/package.json")), bin);

const { status, error } = spawnSync(
  process.execPath,
  [cli, "browsers", "install", "chrome"],
  { stdio: "inherit", env: process.env }
);

if (error) {
  console.error("[setup-browser] failed to launch puppeteer CLI:", error.message);
  process.exit(1);
}
if (status !== 0) {
  console.warn(`[setup-browser] puppeteer browsers install exited ${status} — سيُستخدم chrome من path إذا وُجد.`);
} else {
  const puppeteer = require("puppeteer");
  const exe = await puppeteer.executablePath();
  console.log(`[setup-browser] Chromium ready at ${exe}`);
}
console.log("[setup-browser] done");