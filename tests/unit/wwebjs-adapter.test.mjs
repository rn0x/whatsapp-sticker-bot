// wwebjs-adapter.test.mjs — يفحص أن downloadMedia يعمل عند تمرير {chatId, id} فقط
// (كما يفعل JobProcessors) عبر سجل الرسائل الخام _heldMedia، دون اتصال حقيقي.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WWebJSAdapter } from "../../src/whatsapp/wwebjs-adapter.mjs";

function makeAdapter() {
  const logger = { info() {}, warn() {}, error() {} };
  return new WWebJSAdapter({ db: {}, sessionsRepo: {}, settings: {}, logger, paths: {} });
}

test("downloadMedia resolves raw message by id via _heldMedia", async () => {
  const adapter = makeAdapter();
  const payload = Buffer.from("Downloaded").toString("base64");
  const raw = { downloadMedia: async () => ({ data: payload }) };

  // محاكاة الوصول: الرسالة تحمل id، والعمال يمررون {chatId, id} فقط.
  adapter._holdRaw({ id: "media-1" }, raw);
  const target = join(mkdtempSync(join(tmpdir(), "sb-dl-")), "out.bin");
  const out = await adapter.downloadMedia({ chatId: "9725@s.whatsapp.net", id: "media-1" }, target);

  assert.equal(out, target);
  assert.equal(readFileSync(target).toString(), "Downloaded");
});

test("downloadMedia works when passing the raw message directly (_raw)", async () => {
  const adapter = makeAdapter();
  const raw = { downloadMedia: async () => ({ data: Buffer.from("direct").toString("base64") }) };
  const target = join(mkdtempSync(join(tmpdir(), "sb-dl2-")), "out.bin");
  await adapter.downloadMedia({ chatId: "x", _raw: raw }, target);
  assert.equal(readFileSync(target).toString(), "direct");
});

test("downloadMedia throws friendly error when media missing/expired", async () => {
  const adapter = makeAdapter();
  await assert.rejects(
    adapter.downloadMedia({ chatId: "x", id: "ghost" }, "/tmp/never.bin"),
    /media message expired or not found/
  );
});

test("held entries are evicted after 15 minutes", () => {
  const adapter = makeAdapter();
  const old = Date.now() - 16 * 60 * 1000;
  adapter._heldMedia.set("stale", { raw: {}, at: old });
  adapter._holdRaw({ id: "fresh" }, { downloadMedia: async () => ({ data: "x" }) });
  assert.equal(adapter._heldMedia.has("stale"), false);
  assert.equal(adapter._heldMedia.has("fresh"), true);
});