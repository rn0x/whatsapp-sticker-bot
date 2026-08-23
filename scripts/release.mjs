// release.mjs — ي automate إصداراً جديداً: يرفع الوسم الذي يطلق بناء Actions.
// الاستخدام:
//   npm run release -- 1.0.1          (إصدار صريح)
//   npm run release                   (يزيد الـ patch تلقائياً)
//   npm run release -- 1.1.0 "رسالة الالتزام"
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");
const REMOTE = "origin";
const REPO = "rn0x/whatsapp-sticker-bot";

function git(cmd) {
  return execSync(`git ${cmd}`, { cwd: root }).toString().trim();
}
function run(cmd) {
  execSync(cmd, { stdio: "inherit", cwd: root });
}

// 1) تحديد الإصدار الجديد
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const argVersion = process.argv[2];
let newVersion = argVersion;
if (!newVersion) {
  const [maj, min, pat] = pkg.version.split(".").map(Number);
  if ([maj, min, pat].some((n) => Number.isNaN(n))) {
    console.error(`✗ الإصدار الحالي غير صالح: ${pkg.version}`);
    process.exit(1);
  }
  newVersion = `${maj}.${min}.${pat + 1}`;
}
if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error("✗ يجب أن يكون الإصدار بصيغة x.y.z (مثل 1.0.1)");
  process.exit(1);
}

// 2) التأكد أننا على الفرع الرئيسي
const branch = git("rev-parse --abbrev-ref HEAD");
if (branch !== "main") {
  console.warn(`! تحذير: أنت على الفرع «${branch}» وليس main.`);
}

// 3) تحديث الإصدار في package.json
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`• الإصدار ← ${newVersion}`);

// 4) التزام ورفع التغييرات (إن وُجدت)
run("git add -A");
let hasChanges = false;
try {
  git("diff --cached --quiet");
} catch {
  hasChanges = true;
}
if (hasChanges) {
  const msg = process.argv[3] || `chore: release v${newVersion}`;
  run(`git commit -m "${msg}"`);
  run(`git push ${REMOTE} ${branch}`);
  console.log(`• تم الالتزام والرفع إلى ${branch}`);
} else {
  console.log("• لا تغييرات لالتزامها (تم تحديث الإصدار فقط).");
}

// 5) الوسم ورفعه — هذا ما يطلق بناء Actions
const tag = `v${newVersion}`;
if (git(`tag -l ${tag}`)) {
  console.error(`✗ الوسم ${tag} موجود مسبقاً. اختر إصداراً جديداً.`);
  process.exit(1);
}
run(`git tag ${tag}`);
run(`git push ${REMOTE} ${tag}`);

console.log(`\n✓ تم إطلاق الإصدار ${tag}`);
console.log(`  Actions : https://github.com/${REPO}/actions`);
console.log(`  Release : https://github.com/${REPO}/releases/tag/${tag}`);
console.log("  (يبني Actions: deb / rpm / AppImage / tar.gz / flatpak / exe / dmg)");
console.log("  (الـ snap يُبنى ويُرفع يدوياً — لا يدعمه CI)");
