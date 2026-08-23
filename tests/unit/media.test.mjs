// media.test.mjs — اختبارات وسائط الصور/الفيديو: التعرف على الصيغة (sniff)،
// التحقق (validate)، والتحويل (convert). يعتمد على ffmpeg-static المضمّن.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, statSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
import sharp from "sharp";
import { sniffType, MediaValidator } from "../../src/media/media-validator.mjs";
import { MediaEngine, validateAnimatedWebp } from "../../src/media/media-engine.mjs";

const ffmpeg = require("ffmpeg-static");
const hasFfmpeg = Boolean(ffmpeg);

const dir = fsdir();
function fsdir() {
  const d = mkdtempSync(join(tmpdir(), "sb-media-"));
  return d;
}
function silentSettings() {
  return { getNumber: (k, d) => d, getBool: (k, d) => d };
}

function makeVideo(size = "0x20") {
  // mp4 بصندوق ftyp بحجم 0x20 (الأول 00 00 00 20 ftpy…) — يخالف الشرط القديم 0x18.
  execFileSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc=duration=1:size=480x640:rate=25",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", join(dir, "video.mp4"),
  ]);
  return join(dir, "video.mp4");
}

function makePng() {
  execFileSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=red:size=64x64",
    "-frames:v", "1", join(dir, "img.png"),
  ]);
  return join(dir, "img.png");
}

test("sniff: mp4 حقيقي (ftyp 0x20) يُصنَّف فيديو", { skip: !hasFfmpeg }, () => {
  const f = makeVideo();
  assert.equal(sniffType(f).kind, "VIDEO");
});

test("sniff: jpg/png ثابتة تبقى IMAGE", () => {
  const jpg = join(dir, "a.jpg");
  writeFileSync(jpg, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16)]));
  const png = join(dir, "b.png");
  writeFileSync(png, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(16)]));
  assert.equal(sniffType(jpg).kind, "IMAGE");
  assert.equal(sniffType(png).kind, "IMAGE");
});

test("validate: فيديو قصير يُقبل ومدته تُقرأ", { skip: !hasFfmpeg }, async () => {
  const f = makeVideo();
  const mv = new MediaValidator({ settings: silentSettings(), logger: console });
  const r = await mv.validate({ inputPath: f }, "VIDEO");
  assert.equal(r.ok, true);
  assert.equal(r.kind, "VIDEO");
  assert.ok(r.durationSec >= 1);
});

test("validate: فيديو طويل لا يُرفض — يُقصّ لاحقاً في التحويل", { skip: !hasFfmpeg }, async () => {
  const long = join(dir, "long.mp4");
  execFileSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc=duration=15:size=320x240:rate=10",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", long,
  ]);
  const mv = new MediaValidator({ settings: silentSettings(), logger: console });
  const r = await mv.validate({ inputPath: long }, "VIDEO");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.durationSec >= 15, `expected long duration, got ${r.durationSec}`);
});

test("convert: تحويل فيديو → WebP متحرك يُنتج ملفا", { skip: !hasFfmpeg }, async () => {
  const f = makeVideo();
  const me = new MediaEngine({ settings: silentSettings(), logger: console });
  const { outputPath, kind } = await me.convert({ id: "t1", inputPath: f, type: "VIDEO" }, { outputDir: dir });
  assert.equal(kind, "animated");
  assert.ok(statSync(outputPath).size > 0);
  const { sniffType: sniff2 } = await import("../../src/media/media-validator.mjs");
  // الناتج WebP (RIFF)
  assert.equal(sniff2(outputPath).kind, "IMAGE");
  assert.equal(sniff2(outputPath).reason, "webp");
});

test("convert: صورة غير مربعة تُحافظ على النسبة وتُحشى شفافاً (contain)", { skip: !hasFfmpeg }, async () => {
  const wide = join(dir, "wide.png");
  execFileSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=blue:size=640x360",
    "-frames:v", "1", wide,
  ]);
  const outS1 = join(dir, "outS1");
  mkdirSync(outS1, { recursive: true });
  const me = new MediaEngine({ settings: silentSettings(), logger: console });
  const { outputPath } = await me.convert({ id: "contain-img", inputPath: wide, type: "IMAGE" }, { outputDir: outS1 });
  const m = await sharp(outputPath).metadata();
  assert.equal(m.width, 512, "sticker must be exactly 512 wide");
  assert.equal(m.height, 512, "sticker must be exactly 512 tall");
  const { data, info } = await sharp(outputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const px = (x, y) => {
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  // 640x360 → 512x288 داخل 512x512: حافة علوية/سفلية شفافة (constrain وليس cover/fill)
  assert.equal(px(0, 0)[3], 0, "top-left must be transparent padding, not stretched/cropped");
  assert.equal(px(256, 4)[3], 0, "top edge must be transparent padding");
  assert.equal(px(256, 507)[3], 0, "bottom edge must be transparent padding");
  const mid = px(256, 256);
  assert.ok(mid[2] > 150 && mid[0] < 100, `center should be blue (kept ratio), got ${mid}`);
});

test("convert: فيديو غير مربع يُحافظ على النسبة ويُحشى شفافاً (contain)", { skip: !hasFfmpeg }, async () => {
  const land = join(dir, "land.mp4");
  execFileSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc=duration=1:size=640x360:rate=25",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", land,
  ]);
  const outS2 = join(dir, "outS2");
  mkdirSync(outS2, { recursive: true });
  const me = new MediaEngine({ settings: silentSettings(), logger: console });
  const { outputPath } = await me.convert({ id: "contain-vid", inputPath: land, type: "VIDEO" }, { outputDir: outS2 });
  const v = await validateAnimatedWebp(outputPath);
  assert.equal(v.ok, true, JSON.stringify(v));
  const m = await sharp(outputPath, { animated: true }).metadata();
  assert.equal(m.width, 512, "video sticker must be 512 wide");
  assert.equal(m.pageHeight, 512, "video sticker must be 512 tall");

  // قراءة أول إطار من الناتج المتحرك للتحقق من الحشو الشفاف وليس التمطيط/القص
  const { data, info } = await sharp(outputPath, { animated: true, page: 0 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pxF = (x, y) => {
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  // 640x360 → 512x288 داخل 512x512: حواف علوية/سفلية شفافة
  assert.equal(pxF(0, 0)[3], 0, "video: top-left must be transparent padding");
  assert.equal(pxF(256, 4)[3], 0, "video: top edge must be transparent padding");
  assert.equal(pxF(256, 507)[3], 0, "video: bottom edge must be transparent padding");
  // المنتصف فيه محتوى فعلي (من testsrc الملون) وليس شفافاً
  const midF = pxF(256, 256);
  assert.ok(midF[3] > 200, `video: center should hold content (non-transparent), got ${midF}`);
});

test("validate: ملف غير مدعوم يُرفض", async () => {
  const bin = join(dir, "bad.bin");
  writeFileSync(bin, Buffer.from("AAAAAAAAAAAAAAAA", "binary"));
  const mv = new MediaValidator({ settings: silentSettings(), logger: console });
  const r = await mv.validate({ inputPath: bin }, "VIDEO");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unsupported_file");
});

test("validate: صورة PNG تُقبل كـ IMAGE", () => {
  const png = join(dir, "b.png");
  writeFileSync(png, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(16)]));
  return (async () => {
    const mv = new MediaValidator({ settings: silentSettings(), logger: console });
    const r = await mv.validate({ inputPath: png }, "IMAGE");
    assert.equal(r.ok, true);
    assert.equal(r.kind, "IMAGE");
  })();
});

test("probe via ffmpeg (بدون ffprobe) يقيس مدة الفيديو", { skip: !hasFfmpeg }, async () => {
  const f = makeVideo();
  // SB_FORCE_FFMPEG_PROBE يجبر مسار استنتاج المعلومات من ملخص ffmpeg
  // (المستخدَم تلقائياً حيث لا يتوفر ffprobe، مثل النسخة المعبأة).
  const { probeMedia } = await import("../../src/media/ffmpeg.mjs");
  process.env.SB_FORCE_FFMPEG_PROBE = "1";
  const p = await probeMedia(f);
  delete process.env.SB_FORCE_FFMPEG_PROBE;
  assert.equal(p.durationSec, 1);
  assert.equal(p.width, 480);
  assert.equal(p.height, 640);
});

test("convert: فيديو مزدحم يُضغَط تلقائياً تحت حد الحجم (500KB)", { skip: !hasFfmpeg }, async () => {
  if (!ffmpeg) return;
  const busy = join(dir, "busy.mp4");
  execFileSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=duration=5:size=640x640:rate=30",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", busy,
  ]);
  const outDir = join(dir, "out");
  mkdirSync(outDir, { recursive: true });
  const me = new MediaEngine({ settings: silentSettings(), logger: console });
  const { outputPath, kind, quality } = await me.convert({ id: "busy", inputPath: busy, type: "VIDEO" }, { outputDir: outDir });
  assert.equal(kind, "animated");
  const size = statSync(outputPath).size;
  assert.ok(size <= 480000, `size ${size} should be ≤ 480000`);
  assert.ok(quality < 90, `quality should have been degraded, got ${quality}`); // شغّل الدرجات الأدنى
  const { sniffType: sniff3 } = await import("../../src/media/media-validator.mjs");
  assert.equal(sniff3(outputPath).reason, "webp");
});

test("convert: ناتج متحرك يُرضي واتساب (512²، loop=0، فترات موحّدة)", { skip: !hasFfmpeg }, async () => {
  const f = makeVideo();
  const outDir = join(dir, "out2");
  mkdirSync(outDir, { recursive: true });
  const me = new MediaEngine({ settings: silentSettings(), logger: console });
  const { outputPath } = await me.convert({ id: "wa", inputPath: f, type: "VIDEO" }, { outputDir: outDir });
  const v = await validateAnimatedWebp(outputPath);
  assert.equal(v.ok, true, JSON.stringify(v));
  const m = await sharp(outputPath, { animated: true }).metadata();
  assert.equal(m.width, 512);
  assert.equal(m.pageHeight, 512);
  assert.ok(m.pages > 1, `should be animated, pages=${m.pages}`);
  assert.equal(m.loop, 0);
  assert.equal(new Set(m.delay || []).size, 1, "frame delays must be uniform");
});

test("validateAnimatedWebp: يتحمّل تباين فترات الإطارات (واتساب قبِل مثلها)", { skip: !hasFfmpeg }, async () => {
  const src = join(dir, "uni.mp4");
  execFileSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc=duration=2:size=512x512:rate=25",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", src,
  ]);
  // fps=12 → 1000/12 = 83.33ms تُنقلب 83/84 بالتناوب (غير موحّد) — مقبول لأنه
  // أُرسل بنجاح فعلاً (مثل job 12). المرفوض الحقيقي هو تجاوز ~500KB.
  const mixed = join(dir, "mixed12.webp");
  execFileSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", src, "-an", "-vf", "scale=512:512,fps=12", "-loop", "0",
    "-c:v", "libwebp", "-quality", "80", "-compression_level", "6", mixed,
  ]);
  const m = await sharp(mixed, { animated: true }).metadata();
  assert.ok(new Set(m.delay || []).size > 1, "fixture must actually be non-uniform");
  const v = await validateAnimatedWebp(mixed);
  assert.equal(v.ok, true, JSON.stringify(v));
});

test("convert: فيديو طويل مزدحم ينضغط حتماً تحت 480KB (تراتيب عميقة)", { skip: !hasFfmpeg }, async () => {
  const busy = join(dir, "busyLong.mp4");
  execFileSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=duration=12:size=640x640:rate=30",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", busy,
  ]);
  const outDir = join(dir, "out3");
  mkdirSync(outDir, { recursive: true });
  const me = new MediaEngine({ settings: silentSettings(), logger: console });
  const { outputPath, kind, quality, fps } = await me.convert({ id: "long", inputPath: busy, type: "VIDEO" }, { outputDir: outDir });
  assert.equal(kind, "animated");
  const size = statSync(outputPath).size;
  assert.ok(size <= 480000, `size ${size} should be ≤ 480000`);
  assert.ok(quality <= 25, `should have hit deep tiers, got q${quality}@${fps}fps`);
  const v = await validateAnimatedWebp(outputPath);
  assert.equal(v.ok, true, JSON.stringify(v));
  const m = await sharp(outputPath, { animated: true }).metadata();
  const totalMs = (m.delay || []).reduce((a, b) => a + b, 0) || 0;
  assert.ok(totalMs <= 10200, `trimmed duration ${totalMs}ms should be ≤ ~10s`);
});