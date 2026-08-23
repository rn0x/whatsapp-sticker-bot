// unit-i18n-parity — ضمان توازن المفاتيح بين العربية والإنجليزية في كل مساحات الأسماء.
import { test } from "node:test";
import assert from "node:assert/strict";
import { UI_EN, APP_AR, APP_EN, BOT_AR, BOT_EN, buildResources } from "../../shared/i18n/index.mjs";
import { UI_A } from "../../shared/i18n/ui-a.mjs";
import { UI_B } from "../../shared/i18n/ui-b.mjs";

test("i18n: UI ar/en share the exact same key set", () => {
  const arKeys = new Set([...Object.keys(UI_A), ...Object.keys(UI_B)]);
  const enKeys = Object.keys(UI_EN);
  assert.deepEqual([...arKeys].sort(), [...enKeys].sort(), "UI ar/en key sets must match");
});

test("i18n: every English UI value is non-empty and actually translated", () => {
  const isLatinToken = (s) => /^[\x00-\x7F]+$/.test(s); // مفتاح بلا حروف عربية
  for (const [k, v] of Object.entries(UI_EN)) {
    assert.ok(typeof v === "string" && v.trim().length > 0, `empty english for ${k}`);
    // إن كان المفتاح عربياً فعلاً، يجب ألا تساوي ترجمته المفتاح (علامة نسيان الترجمة).
    if (!isLatinToken(k)) assert.notEqual(v, k, `english equals arabic key for ${k}`);
  }
});

test("i18n: UI_A / UI_B do not conflict on the same key", () => {
  const overlap = Object.keys(UI_A).filter((k) => k in UI_B);
  for (const k of overlap) {
    assert.equal(UI_A[k], UI_B[k], `conflicting value for shared key ${k}`);
  }
});

test("i18n: app namespace ar/en share the same key set", () => {
  const arKeys = Object.keys(APP_AR);
  const enKeys = Object.keys(APP_EN);
  assert.deepEqual([...arKeys].sort(), [...enKeys].sort(), "app ar/en key sets must match");
});

test("i18n: bot namespace ar/en share the same key set", () => {
  const arKeys = Object.keys(BOT_AR);
  const enKeys = Object.keys(BOT_EN);
  assert.deepEqual([...arKeys].sort(), [...enKeys].sort(), "bot ar/en key sets must match");
});

test("i18n: buildResources produces symmetric namespaces", () => {
  const res = buildResources();
  assert.deepEqual(Object.keys(res.ar.ui).sort(), Object.keys(res.en.ui).sort());
  assert.deepEqual(Object.keys(res.ar.app).sort(), Object.keys(res.en.app).sort());
  assert.deepEqual(Object.keys(res.ar.bot).sort(), Object.keys(res.en.bot).sort());
});
