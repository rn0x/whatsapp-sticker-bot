import { useState, useCallback, useEffect } from "react";
import { useApp } from "../ctx.js";

// السجلات — فلترة حسب المستوى، بحث، عرض مصغّر
export default function LogsPage() {
  const { token } = useApp();
  const [level, setLevel] = useState("");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState(null);

  const load = useCallback(async () => {
    const r = await window.api.invoke("logs:list", { token, level: level || undefined, query: query || undefined, limit: 200 });
    if (r.ok) setQ(r.data);
  }, [token, level, query]);

  useEffect(() => { load(); }, [load]);

  // تحديث تلقائي كل 5 ثوانٍ
  useEffect(() => {
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const toneOf = { INFO: "muted", WARN: "warn", ERROR: "danger" };

  return (
    <div className="stack">
      <div className="toolbar">
        <label className="field inline">
          <span>المستوى</span>
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">الكل</option>
            <option>INFO</option>
            <option>WARN</option>
            <option>ERROR</option>
          </select>
        </label>
        <label className="field inline grow">
          <span>بحث</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="كلمة بحث…" />
        </label>
      </div>

      <section className="card">
        <div className="card-body">
          <pre className="log-view">
            {(q?.rows || []).map((l) => (
              <div key={l.id} className={`log-line log-${l.level}`}>
                <span className="log-time">{fmt(l.created_at)}</span>
                <span className="log-level">{l.level}</span>
                [{l.scope || ""}] {l.message} {l.meta_json ? `· ${trunc(l.meta_json)}` : ""}
              </div>
            ))}
          </pre>
        </div>
      </section>
    </div>
  );
}

function fmt(d) {
  if (!d) return "";
  const t = new Date(d);
  return t.toLocaleString("ar");
}

function trunc(s) {
  return String(s).length > 120 ? String(s).slice(0, 120) + "…" : s;
}