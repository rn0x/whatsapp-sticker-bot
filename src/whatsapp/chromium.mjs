// chromium — يحسم مسار ثنائية Chromium في وضع التطوير والنسخة المعبأة.
// الترتيب: 1) PUPPETEER_EXECUTABLE_PATH 2) resourcesPath (package) 3) cache المشروع.
import { existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";

function isExecutablePath(candidate) {
  try {
    return !!candidate && existsSync(candidate) && statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function findChromeIn(root, maxDepth = 12) {
  const wanted = process.platform === "win32" ? "chrome.exe" : "chrome";
  function walk(dir, depth) {
    if (depth > maxDepth) return null;
    let entries = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return null;
    }
    for (const name of entries) {
      const p = join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(p).isDirectory();
      } catch { /* ignore */ }
      if (!isDir && name === wanted) return p;
    }
    for (const name of entries) {
      const p = join(dir, name);
      try {
        if (statSync(p).isDirectory()) {
          const hit = walk(p, depth + 1);
          if (hit) return hit;
        }
      } catch { /* ignore */ }
    }
    return null;
  }
  return walk(root, 0);
}

export function resolveChromium({ appRoot }) {
  const env = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (isExecutablePath(env)) return env;

  const resourcesPath = process.resourcesPath || process.APP_PACKAGE_ROOT || null;
  const candidates = [];
  if (resourcesPath) candidates.push(join(resourcesPath, "browser"));
  if (appRoot) candidates.push(join(appRoot, "browser", ".cache", "puppeteer"));

  for (const root of candidates) {
    if (!existsSync(root)) continue;
    const found = findChromeIn(root);
    if (found) return found;
  }
  return null; // سيستخدم puppeteer مساره الافتراضي
}