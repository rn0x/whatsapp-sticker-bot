import { useState, useCallback } from "react";
import { useApp } from "../ctx.js";
import { useLiveData } from "../hooks/useLiveData.js";

// الإحصائيات — مخطط بسيط بالأعمدة + بطاقات
export default function StatsPage() {
  const { token } = useApp();
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    const r = await window.api.invoke("stats:period", { token, days });
    if (r.ok) setData(r.data);
  }, [token, days]);

  useLiveData(load, { interval: 5000 });

  if (!data) return <div className="empty">تحميل…</div>;

  const j = data.jobs || {};
  const daily = data.daily || [];
  const max = Math.max(1, ...daily.map((d) => d.total || 0));

  const cards = [
    { k: "مهام الفترة", v: j.total },
    { k: "نجحت", v: j.completed, tone: "ok" },
    { k: "فشلت", v: j.failed, tone: "danger" },
    { k: "متوسط المعالجة", v: ms(j.avg_processing_ms || data.avgProcessingMs) },
    { k: "مستخدمون نشطون", v: data.activeUsers },
    { k: "إجمالي المستخدمين", v: data.users?.total },
  ];

  return (
    <div className="stack">
      <div className="toolbar">
        <label className="field inline">
          <span>الفترة</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>اليوم</option>
            <option value={7}>أسبوع</option>
            <option value={30}>شهر</option>
            <option value={90}>ثلاثة أشهر</option>
          </select>
        </label>
      </div>

      <div className="grid cols-3">
        {cards.map((c) => (
          <div key={c.k} className={`stat-card mini ${c.tone ? "tone-" + c.tone : ""}`}>
            <div className="stat-value">{c.v ?? 0}</div>
            <div className="stat-label">{c.k}</div>
          </div>
        ))}
      </div>

      <section className="card">
        <header className="card-head"><h3>المهام اليومية</h3></header>
        <div className="card-body">
          <div className="chart">
            {daily.map((d) => (
              <div key={d.day} className="chart-col" title={`${d.day}: ${d.total} (نجح ${d.completed})`}>
                <div className="chart-bar" style={{ height: `${Math.max(4, (d.total / max) * 100)}%` }} />
                <small>{shortDay(d.day)}</small>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function ms(v) {
  if (!v) return "—";
  if (v < 1000) return `${Math.round(v)} ms`;
  return `${(v / 1000).toFixed(1)} ث`;
}

function shortDay(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}