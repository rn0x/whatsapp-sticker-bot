import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { buildResources, DEFAULT_LANG } from "../../shared/i18n/index.mjs";

const STORAGE_KEY = "sb_lang";

function initialLang(): "ar" | "en" {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "ar" || saved === "en") return saved;
  }
  return DEFAULT_LANG;
}

const lng = initialLang();

i18n.use(initReactI18next).init({
  resources: buildResources(),
  lng,
  fallbackLng: DEFAULT_LANG,
  ns: ["ui", "app", "bot"],
  defaultNS: "ui",
  interpolation: { escapeValue: false },
  returnNull: false,
});

// يطبّق اتجاه ولغة المستند — قلب التبديل بين RTL/LTR.
export function applyLang(lang: "ar" | "en") {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
}
applyLang(lng);

// يحفظ اللغة ويطبّقها فوراً على المستند.
export function setLang(lang: "ar" | "en") {
  i18n.changeLanguage(lang);
  applyLang(lang);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* تجاهل */
  }
}

export default i18n;
