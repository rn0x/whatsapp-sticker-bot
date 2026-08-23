// نقطة دخول الكتالوج المشترك: يبني موارد i18next ويوفّر دوال بحث مباشرة.
import { BOT_AR, BOT_EN } from "./bot.mjs";
import { UI_A } from "./ui-a.mjs";
import { UI_B } from "./ui-b.mjs";
import { APP_EN } from "./app-en.mjs";

export { BOT_AR, BOT_EN, APP_EN };

export const LANGS = ["ar", "en"];
export const DEFAULT_LANG = "ar";
export const LANG_NAMES = { ar: "العربية", en: "English" };

export const UI_EN = { ...UI_A, ...UI_B };

// ar هو طابع الهوية: المفتاح العربي يُعاد كما هو.
export const UI_AR = Object.fromEntries(Object.keys(UI_EN).map((k) => [k, k]));
export const APP_AR = Object.fromEntries(Object.keys(APP_EN).map((k) => [k, k]));

export function buildResources() {
  return {
    ar: { ui: UI_AR, app: APP_AR, bot: BOT_AR },
    en: { ui: UI_EN, app: APP_EN, bot: BOT_EN },
  };
}

// بحث مباشر (للعمليّة الرئيسية والاختبارات) دون i18next.
export function lookupUI(lang, key) {
  if (lang === "en" && key in UI_EN) return UI_EN[key];
  return key;
}
export function lookupApp(lang, key) {
  if (lang === "en" && key in APP_EN) return APP_EN[key];
  return key;
}
export function pickBot(lang, key) {
  const table = lang === "en" ? BOT_EN : BOT_AR;
  return table[key];
}
