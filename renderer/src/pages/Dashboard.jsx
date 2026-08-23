import { Fragment, useState, useCallback } from "react";
import { useApp } from "../ctx.js";
import { useLiveData } from "../hooks/useLiveData.js";
import { Users, ListOrdered, CheckCircle2, XCircle, ArrowRight } from "lucide-react";
import { PIPELINE_STAGES, StageIcon } from "../components.jsx";
import { useTranslation } from "react-i18next";

export default function Dashboard() {
  const { token, overview, wa } = useApp();
  const { t } = useTranslation("ui");
  const [recent, setRecent] = useState(null);

  const load = useCallback(async () => {
    const r = await window.api.invoke("queue:list", { token, status: "", sort: "id", order: "desc", limit: 10 });
    if (r.ok) setRecent(r.data.rows);
  }, [token]);

  useLiveData(load, { interval: 2000 });

  const o = overview || {};
  const waSt = wa?.status || o.whatsapp || "DISCONNECTED";

  const cards = [
    { k: "المستخدمون", v: o.users?.total, sub: t("{{a}} نشط · {{p}} مميز", { a: o.users?.active || 0, p: o.users?.premium || 0 }), icon: Users, tone: "" },
    { k: "في قائمة الانتظار", v: o.queueSize, sub: `${o.processingNow || 0} ${t("قيد المعالجة")}`, icon: ListOrdered, tone: "amber" },
    { k: "نجاح اليوم", v: o.successToday, sub: t("من {{n}} مهمة", { n: o.jobsToday || 0 }), icon: CheckCircle2, tone: "ok" },
    { k: "فشل اليوم", v: o.failedToday, sub: t("إجمالي {{n}}", { n: o.jobsToday || 0 }), icon: XCircle, tone: "danger" },
  ];

  const activeIndex = o.processingNow > 0
    ? 1
    : o.queueSize > 0
      ? 0
      : o.successToday > 0
        ? 2
        : -1;

  return (
    <div className="grid">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.k} className={`stat-card ${c.tone ? "tone-" + c.tone : ""}`}>
            <div className="stat-icon"><Icon size={20} strokeWidth={2.2} /></div>
            <div>
              <div className="stat-value">{c.v ?? "…"}</div>
              <div className="stat-label">{t(c.k)}</div>
              <div className="stat-sub">{c.sub}</div>
            </div>
          </div>
        );
      })}

      <section className="card span-2">
        <header className="card-head"><h3>{t("حالة واتساب")}</h3></header>
        <div className="card-body wa-status">
          <span className={`dot ${waSt === "CONNECTED" ? "dot-ok" : waSt === "CONNECTING" || waSt === "AUTHENTICATING" ? "dot-warn" : "dot-bad"}`} />
          <span className="wa-state-label">{waSt}</span>
          {wa?.phone && <span className="muted-text mono">· {wa.phone}</span>}
        </div>
        {(o.alerts?.length ? o.alerts : []).map((a) => (
          <div key={a.id} className="card-body" style={{ color: "var(--warn)" }}>{a.text}</div>
        ))}
        {!o.alerts?.length && o.health && <div className="card-body muted-text">{t("النظام سليم")}</div>}
      </section>

      <section className="card span-2">
        <header className="card-head"><h3>{t("خط سير المهمة")}</h3></header>
        <div className="card-body">
          <div className="pipeline">
            {PIPELINE_STAGES.map((s, i) => (
              <Fragment key={s.key}>
                <div className={`pipe-station ${activeIndex === i ? "live" : ""}`}>
                  <span className="pipe-icon"><StageIcon stage={s.key} /></span>
                  <b>{t(s.title)}</b>
                  <small>{t(s.sub)}</small>
                </div>
                {i < PIPELINE_STAGES.length - 1 && (
                  <span className={`pipe-connector ${activeIndex >= i ? "active" : ""}`}>
                    <svg width="26" height="20" viewBox="0 0 26 20" fill="none">
                      <line x1="0" y1="10" x2="22" y2="10" stroke="currentColor" strokeWidth="2" />
                      <path d="M20 4l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </svg>
                  </span>
                )}
              </Fragment>
            ))}
          </div>
        </div>
      </section>

      <section className="card span-2">
        <header className="card-head"><h3>{t("أحدث المهام")}</h3></header>
        <div className="card-body">
          {recent?.length ? (
            <ul className="job-list">
              {recent.map((j) => (
                <li key={j.id}>
                  <div className="row">
                    <Badge v={j.type} />
                    <span className="muted-text">{fmtId(j.user_id)}</span>
                  </div>
                  <div className="row">
                    <span className={`dot ${j.status === "COMPLETED" ? "dot-ok" : j.status === "FAILED" ? "dot-bad" : "dot-warn"}`} />
                    <span className="muted-text">{j.status}</span>
                    <ArrowRight size={14} className="muted-text" />
                  </div>
                </li>
              ))}
            </ul>
          ) : <div className="empty">{t("لا توجد مهام بعد")}<br /><span className="empty-stem">{t("ستظهر المهام هنا لحظة إنشائها.")}</span></div>}
        </div>
      </section>
    </div>
  );
}

function Badge({ v }) {
  return <span className="badge badge-info">{v}</span>;
}

function fmtId(id) {
  if (!id) return "—";
  return String(id).replace(/@.*/, "").slice(-8);
}
