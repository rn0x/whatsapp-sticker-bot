import { useState } from "react";
import { useApp } from "../ctx.js";
import { useTranslation } from "react-i18next";

const LANGUAGES = ["ar", "en"];

export default function SettingsPage() {
  const { token, refresh } = useApp();
  const { t, i18n } = useTranslation("ui");
  const [language, setLanguage] = useState(i18n.language || "ar");
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "dark");
  const [status, setStatus] = useState("");

  async function save() {
    const r = await window.api.invoke("settings:set", { token, values: { "app.language": language, "app.theme": theme } });
    if (r.ok) {
      i18n.changeLanguage(language);
      document.documentElement.dir = language === "en" ? "ltr" : "rtl";
      document.documentElement.lang = language;
      localStorage.setItem("theme", theme);
      await window.api.invoke("theme:set", { token, theme });
      await refresh();
      setStatus(t("تم الحفظ"));
      setTimeout(() => setStatus(""), 2000);
    }
  }

  async function reset() {
    if (!confirm(t("تأكيد إعادة الضبط؟"))) return;
    const r = await window.api.invoke("settings:reset", { token });
    if (r.ok) { setStatus(t("تمت إعادة الضبط")); setTimeout(() => setStatus(""), 2000); }
    else setStatus(t("تعذّرت عملية إعادة الضبط: {{err}}", { err: r.error || "" }));
  }

  return (
    <div className="stack">
      <section className="card">
        <header className="card-head"><h3>{t("الواجهة")}</h3></header>
        <div className="card-body">
          <label className="field"><span>{t("اللغة")}</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => <option key={l} value={l}>{l === "ar" ? t("العربية") : t("English")}</option>)}
            </select>
          </label>
          <label className="field"><span>{t("السمة")}</span>
            <select value={theme} onChange={(e) => setTheme(e.target.value)}>
              <option value="dark">{t("ليلي")}</option>
              <option value="light">{t("نهاري")}</option>
            </select>
          </label>
        </div>
      </section>

      <div className="toolbar">
        <button className="btn btn-primary" onClick={save}>{t("حفظ الإعدادات")}</button>
        <button className="btn btn-warn" onClick={reset}>{t("إعادة الضبط")}</button>
      </div>

      <section className="card">
        <header className="card-head"><h3>{t("الإعدادات")}</h3></header>
        <div className="card-body row">
          <button className="btn btn-ghost" onClick={() => window.api.invoke("app:restart", { token })}>{t("إعادة تشغيل التطبيق")}</button>
          <button className="btn btn-danger" onClick={() => window.api.invoke("app:quit", { token })}>{t("إغلاق التطبيق")}</button>
          {status && <span className="ok-msg">{status}</span>}
        </div>
      </section>
    </div>
  );
}
