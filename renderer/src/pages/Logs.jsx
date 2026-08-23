import { useState, useMemo, useCallback, useEffect } from "react";
import { useApp } from "../ctx.js";
import { RefreshCw, Search, Eraser, Download } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function Logs() {
  const { token } = useApp();
  const { t } = useTranslation("ui");
  const [level, setLevel] = useState("ALL");
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await window.api.invoke("logs:list", { token, level, limit: 500 });
    if (r.ok) setRows(r.rows);
    const s = await window.api.invoke("logs:stats", { token });
    if (s.ok) setStats(s);
  }, [token, level]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!term.trim()) return rows;
    const q = term.toLowerCase();
    return rows.filter((r) => (r.message || "").toLowerCase().includes(q) || (r.logger || "").toLowerCase().includes(q));
  }, [rows, term]);

  async function clear() {
    if (!confirm("سيتم حذف جميع السجلات. متابعة؟")) return;
    await window.api.invoke("logs:clear", { token });
    load();
  }

  async function exportCsv() {
    setBusy(true);
    const r = await window.api.invoke("logs:export", { token });
    if (r.ok) {
      const blob = new Blob([r.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "logs.csv"; a.click();
      URL.revokeObjectURL(url);
    }
    setBusy(false);
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <label className="field inline">
          <span>{t("المستوى")}</span>
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="ALL">{t("كل")}</option>
            <option value="INFO">{t("معلومة")}</option>
            <option value="WARN">{t("تحذير")}</option>
            <option value="ERROR">{t("خطأ")}</option>
          </select>
        </label>
        <label className="field inline grow">
          <span><Search size={13} /> {t("تصفية")}</span>
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t("اكتب للتصفية…")} />
        </label>
        <button className="btn" onClick={() => window.api.invoke("logs:reload", { token })}><RefreshCw size={14} /> {t("تحديث")}</button>
        <button className="btn btn-warn" onClick={clear}><Eraser size={14} /> {t("مسح")}</button>
        <button className="btn btn-ghost" onClick={exportCsv} disabled={busy}><Download size={14} /> {busy ? t("تحميل…") : t("تصدير")}</button>
      </div>

      {stats && (
        <div className="muted-text pad">
          {t("معلومة")}: {stats.byLevel?.INFO || 0} · {t("تحذير")}: {stats.byLevel?.WARN || 0} · {t("خطأ")}: {stats.byLevel?.ERROR || 0} · {t("الإجمالي")}: {stats.total || 0}
        </div>
      )}

      <section className="card">
        <div className="card-body">
          <div className="log-view">
            {filtered.length === 0 && <div className="empty">{t("لا توجد سجلات")}</div>}
            {filtered.map((r, i) => (
              <div key={i} className={`log-row lvl-${r.level}`}>
                <span className="log-time mono">{r.time}</span>
                <span className={`badge badge-${r.level === "ERROR" ? "danger" : r.level === "WARN" ? "warn" : "info"}`}>{r.level}</span>
                <span className="log-logger mono">{r.logger}</span>
                <span className="log-msg">{r.message}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
