// تأمين المسارات ضد Path Traversal: كل مسار Media داخل dataDir.

import { resolve, parse } from "node:path";

export function safeJoin(root, ...parts) {
  const joined = resolve(root, ...parts);
  const base = resolve(root);
  if (joined !== base && !joined.startsWith(base + String.fromCharCode(47))) {
    throw new Error("path traversal blocked");
  }
  return joined;
}

export function safeFilename(name) {
  const base = parse(String(name || "")).base.replace(/[^a-zA-Z0-9_.-]/g, "_");
  if (!base || base === "." || base === "..") throw new Error("invalid filename");
  return base;
}