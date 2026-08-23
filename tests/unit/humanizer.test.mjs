// unit-humanizer — اختبارات Humanizer: تأخير، تناوب الصيغ، تعطيل، طي الخاصية.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../../src/core/database.mjs";
import { AppPaths } from "../../src/main/config.mjs";
import { Logger } from "../../src/main/logger.mjs";
import { SettingsRepo } from "../../src/core/repositories/settings.repo.mjs";
import { Humanizer, BOT_TEXTS } from "../../src/bot/humanizer.mjs";

let db, settings, logger, humanizer;

async function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), "sb-hum-"));
  const paths = new AppPaths(dir);
  const d = new Database(paths.dbPath());
  await d.migrate();
  return { d, paths };
}

test("humanizer: delayed reply within range, disabled returns 0", async () => {
  const { d, paths } = await makeDb();
  const s = new SettingsRepo(d);
  const l = new Logger(d, { consoleOut: false });
  const h = new Humanizer({ settings: s, logger: l });

  s.set("humanizer.replyDelayMinMs", 1000);
  s.set("humanizer.replyDelayMaxMs", 2000);
  for (let i = 0; i < 10; i++) {
    const ms = h.replyDelay(0);
    assert.ok(ms >= 1000 && ms <= 2000, `delay ${ms} out of range`);
  }

  s.set("humanizer.enabled", false);
  assert.equal(h.replyDelay(0), 0);
  d.close();
});

test("humanizer: pick rotates variants and is stable", async () => {
  const { d, paths } = await makeDb();
  const s = new SettingsRepo(d);
  const l = new Logger(d, { consoleOut: false });
  const h = new Humanizer({ settings: s, logger: l });

const a = h.pick("k1", ["x", "y", "z"]);
  const b = h.pick("k1", ["x", "y", "z"]);
  const c = h.pick("k1", ["x", "y", "z"]);
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.equal(h.pick("k2", ["x", "y", "z"]), "x");
  assert.equal(h.pick("k1", []), "");
  d.close();
});

test("humanizer: bot texts contain no emoji and have variants", () => {
  for (const [key, value] of Object.entries(BOT_TEXTS)) {
    if (typeof value === "function") continue;
    const texts = Array.isArray(value) ? value : Object.values(value);
    for (const t of texts) {
      assert.doesNotMatch(t, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, `emoji in ${key}`);
    }
  }
});

test("humanizer: welcome/help update المستخدم وتشرح الأوامر بلا إيموجي", () => {
  const welcome = BOT_TEXTS.welcome("سالم");
  const help = BOT_TEXTS.help(42);
  for (const t of [...welcome, ...help]) {
    assert.doesNotMatch(t, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, "emoji in dynamic text");
  }
  for (const w of welcome) {
    assert.match(w, /أوامر|الأوامر/, "welcome should list commands");
    assert.match(w, /ملصق|ملصقات/, "welcome should mention stickers");
  }
  for (const h of help) {
    assert.match(h, /42/, "help should include remaining quota");
  }
});

test("humanizer: replyDelay boosts with long body only when enabled", async () => {
  const { d, paths } = await makeDb();
  const s = new SettingsRepo(d);
  const l = new Logger(d, { consoleOut: false });
  const h = new Humanizer({ settings: s, logger: l });
  s.set("humanizer.replyDelayMinMs", 1000);
  s.set("humanizer.replyDelayMaxMs", 1000);

  const short = h.replyDelay(5);
  const long = h.replyDelay(140);
  s.set("humanizer.enabled", false);
  assert.equal(short, 1000);
  assert.equal(long > short, true, "long body should get extra thinking time");
  assert.equal(h.replyDelay(0), 0);
  d.close();
});