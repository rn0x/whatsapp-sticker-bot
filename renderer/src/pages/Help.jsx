import { useState } from "react";
import { BookText, Settings2, LifeBuoy } from "lucide-react";
import { useTranslation } from "react-i18next";

const SECTIONS = [
  { key: "intro", title: "مقدمة", body: "هذا الدليل يشرح كيفية استخدام لوحة تحكم مصنع الملصقات." },
  { key: "basics", title: "مفاهيم أساسية", body: "كل طلب مستخدم يُحوّل إلى مهمة تمر عبر خط المعالجة حتى التسليم على واتساب." },
  { key: "images", title: "معالجة الصور", body: "يُعاد تحجيم الصور لتتوافق مع حدود واتساب للملصقات قبل الإرسال." },
  { key: "queue", title: "قائمة الانتظار", body: "راقب المهام وأعد المحاولة أو احذف الفاشلة من صفحة قائمة الانتظار." },
  { key: "users", title: "المستخدمون", body: "يمكنك حظر المستخدمين أو ضبط حصصهم أو إرسال رسائل مباشرة لهم." },
];

export default function Help() {
  const { t } = useTranslation("ui");
  const [tab, setTab] = useState("docs");

  const tabs = [
    { key: "docs", label: t("التوثيق"), icon: BookText },
    { key: "settings", label: t("الإعدادات"), icon: Settings2 },
    { key: "support", label: t("الدعم"), icon: LifeBuoy },
  ];

  return (
    <div className="stack">
      <div className="tabs">
        {tabs.map((tb) => {
          const Icon = tb.icon;
          return <button key={tb.key} className={`tab ${tab === tb.key ? "active" : ""}`} onClick={() => setTab(tb.key)}><Icon size={15} /> {tb.label}</button>;
        })}
      </div>

      {tab === "docs" && (
        <div className="help-grid">
          <nav className="toc card">
            <div className="card-body">
              <ul>
                {SECTIONS.map((s) => <li key={s.key}><a href={`#${s.key}`}>{t(s.title)}</a></li>)}
              </ul>
            </div>
          </nav>
          <div className="doc card">
            <div className="card-body doc-body">
              {SECTIONS.map((s) => (
                <section key={s.key} id={s.key}>
                  <h3>{t(s.title)}</h3>
                  <p>{s.body}</p>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "settings" && (
        <section className="card">
          <header className="card-head"><h3>{t("الإعدادات")}</h3></header>
          <div className="card-body">
            <p>{t("تغيير اللغة")}</p>
            <p>{t("السمة")}</p>
            <p>{t("إعادة الضبط")}</p>
          </div>
        </section>
      )}

      {tab === "support" && (
        <section className="card">
          <header className="card-head"><h3>{t("الدعم")}</h3></header>
          <div className="card-body">
            <p>{t("الدعم التقني")}</p>
          </div>
        </section>
      )}
    </div>
  );
}
