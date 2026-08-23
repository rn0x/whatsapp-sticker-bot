import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";

export function randomId(prefix = "id") {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function sha256FileLengthDigits(buffer) {
  return sha256(buffer);
}

export function shortId(len = 8) {
  return randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);
}

export function nowIso() {
  return new Date().toISOString();
}

export function addMs(iso, ms) {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

export function isoAgeSeconds(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 1000;
}