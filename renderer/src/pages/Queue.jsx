import { useState, useCallback } from "react";
import { useApp } from "../ctx.js";
import { useLiveData } from "../hooks/useLiveData.js";
import { Pause, Play, RotateCcw, Trash2, RefreshCw, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";

export default function QueuePage() {
  const { token } = useApp();
  const { t } = useTranslation("ui");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState(null);
  const [counts, setCounts] = useState(null);

  const load = useCallback(async () => {
    const filters = { sort: "id", order: "desc", limit: 200, ...(status ? { status } : {}) };
    const r = await window.api.invoke("queue:list", { token, filters });
    if (r.ok) setQ(r.data);
    const c = await window.api.invoke("queue:counts", { token });
    if (c.ok) setCounts(c);
  }, [token, status]);

  useLiveData(load, { interval: 2000 });

  async function act(channel) {
    const r = await window.api.invoke(channel, { token });
    if (r.ok) load();
  }

  const sum = counts ? Object.fromEntries(Object.entries(counts).filter(([k]) => ["QUEUED", "PROCESSING", "SENDING", "COMPLETED", "FAILED", "CANCELLED"].includes(k))) : {};

  return (
    <div className="stack">
      <div className="toolbar">
        <label className="field inline">
          <span>{t("الحالة")}</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("الكل")}</option>
            <option>QUEUED</option>
            <option>PROCESSING</option>
            <option>SENDING</option>
            <option>COMPLETED</option>
            <option>FAILED</option>
            <option>CANCELLED</option>
          </select>
        </label>
        <button className="btn" onClick={() => act("queue:pause")}><Pause size={14} /> {t("إيقاف مؤقت")}</button>
        <button className="btn" onClick={() => act("queue:resume")}><Play size={14} /> {t("استئناف")}</button>
        <button className="btn btn-warn" onClick={() => act("queue:retry-failed")}><RotateCcw size={14} /> {t("إعادة الفاشلة")}</button>
        <button className="btn btn-danger" onClick={() => act("queue:clear-failed")}><Trash2 size={14} /> {t("حذف الفاشلة")}</button>
        <button className="btn btn-ghost" onClick={load}><RefreshCw size={14} /> {t("تحديث")}</button>
      </div>

      <div className="grid cols-4">
        {Object.entries(sum).map(([k, v]) => (
          <div key={k} className="stat-card mini"><div className="stat-value">{v ?? 0}</div><div className="stat-label">{k}</div></div>
        ))}
      </div>

      <section className="card">
        <div className="card-body">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>ID</th><th>{t("النوع")}</th><th>{t("المستخدم")}</th><th>{t("الحالة")}</th><th>{t("المحاولة")}</th><th>{t("الأولوية")}</th><th>{t("أنشئت")}</th><th></th></tr>
              </thead>
              <tbody>
                {(q?.rows || []).map((j) => (
                  <tr key={j.id}>
                    <td>#{j.id}</td>
                    <td>{j.type}</td>
                    <td className="muted">{String(j.user_id || "").replace(/@.*/, "").slice(-10)}</td>
                    <td><BadgeStatus v={j.status} /></td>
                    <td>{j.attempt}/{j.max_attempts || "-"}</td>
                    <td>{j.priority}</td>
                    <td>{fmt(j.created_at)}</td>
                    <td>
                      {(j.status === "QUEUED" || j.status === "PROCESSING" || j.status === "SENDING") && (
                        <button className="btn btn-danger btn-sm" onClick={() => window.api.invoke("queue:cancel", { token, ids: [j.id] }).then(load)}><XCircle size={12} /> {t("إلغاء")}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function BadgeStatus({ v }) {
  const tone = { QUEUED: "info", PROCESSING: "warn", SENDING: "accent", COMPLETED: "ok", FAILED: "danger", CANCELLED: "muted" }[v] || "muted";
  return <span className={`badge badge-${tone}`}>{v}</span>;
}

function fmt(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString(i18n.language === "en" ? "en" : "ar");
}
