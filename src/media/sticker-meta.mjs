// إضافة بيانات EXIF الخاصة بملصقات WhatsApp (Pack/Author) إلى ملف WebP
// عبر إدراج chunk من نوع EXIF بعد VP8X — الصيغة المعتمدة في ملصقات WhatsApp.
import { openSync, readSync, writeSync, closeSync, readFileSync } from "node:fs";

const EXIF_HEADER = Buffer.from("Exif\x00\x00", "ascii");

export function applyStickerMetadata(filePath, pack, author) {
  const data = readFileSync(filePath);
  if (data.length < 12) throw new Error("invalid webp");
  const riff = data.subarray(0, 4).toString("ascii");
  const webp = data.subarray(8, 12).toString("ascii");
  if (riff !== "RIFF" || webp !== "WEBP") throw new Error("not a webp file");

  const exifPayload = buildExif(pack || "Sticker Bot", author || "Sticker Bot");
  const chunk = Buffer.alloc(8 + exifPayload.length + (exifPayload.length % 2 === 1 ? 1 : 0));
  chunk.write("EXIF", 0, "ascii");
  chunk.writeUInt32LE(exifPayload.length, 4);
  exifPayload.copy(chunk, 8);
  if (exifPayload.length % 2 === 1) chunk[chunk.length - 1] = 0;

  // إيجاد موضع بداية رأس VP8X
  let offset = 12;
  let insert = -1;
  while (offset + 8 <= data.length) {
    const tag = data.subarray(offset, offset + 4).toString("ascii");
    const size = data.readUInt32LE(offset + 4);
    if (tag === "VP8X") {
      insert = offset;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (insert === -1) throw new Error("no VP8X chunk");

  // إزالة EXIF موجود مسبقاً
  let clean = data;
  offset = 12;
  const kept = [Buffer.from(data.subarray(0, 12))];
  const seen = new Set();
  while (offset + 8 <= data.length) {
    const tag = data.subarray(offset, offset + 4).toString("ascii");
    const size = data.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size % 2);
    if (tag === "EXIF" || seen.has(tag)) {
      offset = end;
      continue;
    }
    seen.add(tag);
    kept.push(Buffer.from(data.subarray(offset, end)));
    offset = end;
  }
  clean = Buffer.concat(kept);

  // إعادة تجميع مع إدراج chunk الـ EXIF بعد VP8X
  const out = [clean.subarray(0, insert + 8 + clean.readUInt32LE(insert + 4) + (clean.readUInt32LE(insert + 4) % 2)), chunk];
  const rest = clean.subarray(insert + 8 + clean.readUInt32LE(insert + 4) + (clean.readUInt32LE(insert + 4) % 2));
  out.push(rest);
  const combined = Buffer.concat(out);
  combined.writeUInt32LE(combined.length - 8, 4);

  const fd = openSync(filePath, "w");
  try {
    writeSync(fd, combined);
  } finally {
    closeSync(fd);
  }
}

function buildExif(pack, author) {
  const encoder = new TextEncoder().encode;
  const ascii = (s) => Buffer.from(String(s), "ascii");
  const utf8 = (s) => Buffer.from(String(s), "utf8");

  // TIFF header (LE)
  const tiff = Buffer.alloc(8);
  tiff.write("II*\x00", 0, "ascii");
  tiff.writeUInt32LE(8, 4); // offset of IFD0

  const tagCount = 2; // Make + Model
  const ifd = Buffer.alloc(2 + tagCount * 12 + 4);
  ifd.writeUInt16LE(tagCount, 0); // عدد الدالات
  ifd.writeUInt16LE(0x010f, 2);   // Make = pack
  ifd.writeUInt16LE(0x04, 4);     // ASCII
  ifd.writeUInt32LE(pack.length + 1, 8);
  ifd.writeUInt32LE(8, 12);       // offset of strings (after ifd)
  ifd.writeUInt16LE(0x0110, 14);  // Model = author
  ifd.writeUInt16LE(0x04, 16);    // ASCII
  ifd.writeUInt32LE(author.length + 1, 20);
  ifd.writeUInt32LE(8 + pack.length + 1, 24);
  ifd.writeUInt32LE(0, 28);       // next IFD = none

  const strings = Buffer.alloc(pack.length + 1 + author.length + 1);
  strings.write(pack, 0, "ascii");
  strings.write(author, pack.length + 1, "ascii");

  return Buffer.concat([EXIF_HEADER, tiff, ifd, strings]);
}