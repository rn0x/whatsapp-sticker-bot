import { useEffect, useState } from "react";
import { Minimize, Square, Copy, X, Sun, Moon } from "lucide-react";
import { LogoMark } from "./components.jsx";

// شريط عنوان مخصص: سحب + إغلاق على اليسار + تبديل ليلي/نهاري + تصغير/تكبير.
export default function Titlebar() {
  const [maximized, setMaximized] = useState(false);
  const [theme, setTheme] = useState(null); // null = قيد التحميل

  useEffect(() => {
    const off = window.api?.on("window:maximized", ({ maximized: m }) => setMaximized(m));
    return () => off && off();
  }, []);

  // تحميل الثيم المحفوظ وتطبيقه على الحافة المستندية.
  useEffect(() => {
    window.api?.invoke("theme:get").then((r) => {
      if (r?.ok) {
        const t = r.theme;
        if (t === "light" || t === "dark") applyTheme(t);
        else { applyTheme("dark"); }
      } else {
        applyTheme("dark");
      }
    }).catch(() => applyTheme("dark"));
  }, []);

  function applyTheme(t) {
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);
  }

  async function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      await window.api.invoke("settings:set", { token: localStorage.getItem("sb_token") || null, key: "app.theme", value: next });
    } catch { /* اللوحة غير متاحة قبل تسجيل الدخول */ }
  }

  const invoke = (channel) => window.api?.invoke(channel).catch(() => {});

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <span className="titlebar-logo"><LogoMark size={18} /></span>
        <span className="titlebar-title">WhatsApp Sticker Bot</span>
      </div>

      <div className="titlebar-controls">
        {/* تبديل المظهر */}
        <button
          className="tb-btn tb-theme"
          title={theme === "dark" ? "الوضع النهاري" : "الوضع الليلي"}
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "تفعيل الوضع النهاري" : "تفعيل الوضع الليلي"}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <span className="tb-divider" />

        {/* تصغير */}
        <button
          className="tb-btn tb-min"
          title="تصغير"
          onClick={() => invoke("window:minimize")}
          aria-label="تصغير"
        >
          <Minimize size={15} />
        </button>
        {/* تكبير / استعادة */}
        <button
          className="tb-btn tb-max"
          title={maximized ? "استعادة الحجم" : "تكبير"}
          onClick={() => invoke("window:toggle-maximize")}
          aria-label={maximized ? "استعادة الحجم" : "تكبير"}
        >
          {maximized ? <Copy size={13} /> : <Square size={13} />}
        </button>
        {/* إغلاق — أقصى اليسار */}
        <button
          className="tb-btn tb-close"
          title="إغلاق"
          onClick={() => invoke("window:close")}
          aria-label="إغلاق"
        >
          <X size={15} />
        </button>
      </div>
    </header>
  );
}