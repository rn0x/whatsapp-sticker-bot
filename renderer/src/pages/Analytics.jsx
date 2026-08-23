import { useState, useCallback } from "react";
import { useApp } from "../ctx.js";
import { useLiveData } from "../hooks/useLiveData.js";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function Analytics() {
  const { token } = useApp();
  const { t } = useTranslation("ui");
  const [range, setRange] = useState("week");
  const [a, setA] = useState(null);

  const load = useCallback(async () => {
    const r = await window.api.invoke("analytics:summary", { token, range });
    if (r.ok) setA(r);
  }, [token, range]);

  useLiveData(load, { interval: 10000 });

  const topLabels = { activeUsers: "النشطون", premiumUsers: "المميزون", mediaSent: "الوسائط" };

  return (
    <div className="stack">
      <div className="toolbar">
        <label className="field inline">
          <span>{t("الإطار الزمني")}</span>
          <select value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="day">{t("يوم")}</option>
            <option value="week">{t("أسبوع")}</option>
            <option value="month">{t("شهر")}</option>
          </select>
        </label>
        <button className="btn" onClick={load}><RefreshCw size={14} /> {t("تحديث")}</button>
      </div>

      <div className="grid cols-3">
        <div className="stat-card"><div className="stat-value">{a?.jobs ?? "…"}</div><div className="stat-label">{t("المهام")}</div></div>
        <div className="stat-card tone-ok"><div className="stat-value">{a?.success ?? "…"}</div><div className="stat-label">{t("النجاح")}</div></div>
        <div className="stat-card tone-danger"><div className="stat-value">{a?.failed ?? "…"}</div><div className="stat-label">{t("الفشل")}</div></div>
      </div>

      <div className="grid cols-3">
        {Object.entries(topLabels).map(([k, label]) => (
          <div key={k} className="stat-card"><div className="stat-value">{a?.[k] ?? "…"}</div><div className="stat-label">{t(label)}</div></div>
        ))}
        {typeof a?.successRate === "number" && (
          <div className="stat-card tone-accent"><div className="stat-value">{(a.successRate * 100).toFixed(1)}%</div><div className="stat-label">{t("نسبة النجاح")}</div></div>
        )}
      </div>

      <section className="card">
        <header className="card-head"><h3>{t("آخر الأخطاء")}</h3></header>
        <div className="card-body">
          {(a?.topErrors?.length)
            ? <ul className="error-list">{a.topErrors.map((e, i) => (<li key={i}><span className="muted-text mono">{e.stage}</span><span>{e.mode}</span><span className="muted-text">{e.count}×</span></li>))}</ul>
            : <div className="empty">{t("لا توجد بيانات كافية")}</div>}
        </div>
      </section>

      <section className="card">
        <header className="card-head"><h3>{t("تكرار الأخطاء")}</h3></header>
        <div className="card-body">
          {(a?.topErrors?.length)
            ? <ul className="error-list">{a.topErrors.map((e, i) => (<li key={i}><span>{e.error}</span><span className="muted-text">{e.count}×</span></li>))}</ul>
            : <div className="empty">{t("لا توجد أخطاء")}</div>}
        </div>
      </section>
    </div>
  );
}
