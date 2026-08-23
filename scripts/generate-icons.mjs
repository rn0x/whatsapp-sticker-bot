// generate-icons.mjs — يولّد مجموعة أيقونات التطبيق من build/source-logo.svg.
// يعتمد على ImageMagick (magick) المثبّت في النظام.
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const build = join(root, "build");
const src = join(build, "source-logo.svg");
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];

function run(cmd) {
  console.log("›", cmd);
  execSync(cmd, { stdio: "inherit", cwd: root });
}

mkdirSync(join(build, "icons"), { recursive: true });

// أيقونة رئيسية 512
run(`magick -background none "${src}" -resize 512 "${join(build, "icon.png")}"`);

// مجموعة hicolor للـ linux/flatpak/snap
for (const s of sizes) {
  run(`magick -background none "${src}" -resize ${s} "${join(build, "icons", `${s}.png`)}"`);
}

// ويندوز .ico (متعدد الأحجام)
run(
  `magick ${sizes.map((s) => `"${join(build, "icons", `${s}.png`)}"`).join(" ")} "${join(build, "icon.ico")}"`
);

// ماك .icns (من PNG جاهز لتفادي مشاكل تفويض SVG)
run(`magick "${join(build, "icons", "512.png")}" "${join(build, "icon.icns")}"`);

console.log("✓ icons generated in build/");
