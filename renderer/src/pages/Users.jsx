import { useState, useCallback, useEffect } from "react";
import { useApp } from "../ctx.js";
import { useLiveData } from "../hooks/useLiveData.js";
import { RefreshCw, Search, ArrowRight, Ban, ShieldCheck, RotateCcw, ImagePlus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";

export default function UsersPage() {
  const { token } = useApp();
  const { t } = useTranslation("ui");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState("list");

  const load = useCallback(async () => {
    const r = await window.api.invoke("users:list", { token, query: query || undefined, limit: 100 });
    if (r.ok) setQ(r.data);
  }, [token, query]);

  useLiveData(load, { interval: 5000 });

  async function open(id) {
    const r = await window.api.invoke("users:get", { token, id });
    if (r.ok) { setDetail(r.user); setTab("detail"); }
  }

  async function act(channel, id) {
    await window.api.invoke(channel, { token, id });
    load();
  }

  if (tab === "detail" && detail) {
    return <UserDetail user={detail} token={token} onBack={() => { setTab("list"); setDetail(null); }} onChanged={async () => { load(); const r = await window.api.invoke("users:get", { token, id: detail.id }); if (r.ok) setDetail(r.user); }} />;
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <label className="field inline grow">
          <span><Search size={13} /> {t("بحث")}</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("اسم، رقم، واتساب")} />
        </label>
        <button className="btn" onClick={load}><RefreshCw size={14} /> {t("تحديث")}</button>
      </div>

      <section className="card">
        <div className="card-body">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>{t("الاسم")}</th><th>{t("الرقم")}</th><th>{t("الحالة")}</th><th>{t("الدور")}</th><th>{t("الحصة")}</th><th>{t("آخر نشاط")}</th><th>{t("عدد المهام")}</th></tr>
              </thead>
              <tbody>
                {(q?.rows || []).map((u) => (
                  <tr key={u.id} onClick={() => open(u.id)} className="clickable">
                    <td>{u.name || u.push_name || "—"}</td>
                    <td className="muted" style={{ direction: "ltr" }}>{u.phone || "—"}</td>
                    <td><Badge v={u.status} tone={u.status === "BLOCKED" ? "danger" : "ok"} /></td>
                    <td><Badge v={u.role} tone={u.role === "PREMIUM" ? "accent" : "muted"} /></td>
                    <td>{u.quota_limit ?? "50"}</td>
                    <td>{rel(u.last_seen_at)}</td>
                    <td>{u.id ? <UserQuickStats id={u.id} token={token} /> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {q?.total > 100 && <div className="muted-text pad">{t("يوجد {{n}} مستخدم — حسّن البحث لعرضهم", { n: q.total })}</div>}
          </div>
        </div>
      </section>
    </div>
  );
}

function UserQuickStats({ id, token }) {
  const [n, setN] = useState(null);
  useEffect(() => {
    window.api.invoke("users:get", { token, id }).then((r) => r.ok && setN(r.user.stats?.total_jobs));
  }, [id, token]);
  return <span className="muted-text">{n ?? "…"}</span>;
}

function UserDetail({ user, token, onBack, onChanged }) {
  const { t } = useTranslation("ui");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function sendMessage() {
    if (!msg.trim()) return;
    setBusy(true);
    const r = await window.api.invoke("users:send-message", { token, id: user.id, text: msg.trim() });
    if (r.ok) setMsg("");
    setBusy(false);
  }

  async function doAct(channel, confirmMsg) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    const r = await window.api.invoke(channel, { token, id: user.id });
    if (r.ok) onChanged();
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <button className="btn" onClick={onBack}><ArrowRight size={14} /> {t("رجوع")}</button>
        <h3 style={{ margin: 0 }}>{user.name || user.push_name || t("مستخدم")}</h3>
        <span className="muted-text mono" style={{ direction: "ltr" }}>{user.phone}</span>
      </div>

      <section className="card">
        <div className="card-body user-grid">
          <div><label>{t("الحالة")}</label><Badge v={user.status} tone={user.status === "BLOCKED" ? "danger" : "ok"} /></div>
          <div><label>{t("الدور")}</label><Badge v={user.role} tone={user.role === "PREMIUM" ? "accent" : "muted"} /></div>
          <div><label>{t("الحصة اليومية")}</label><b>{user.quota_limit ?? 50}</b></div>
          <div><label>{t("مستعمل الآن")}</label><b>{user.quota?.used ?? 0}</b></div>
          <div><label>{t("إجمالي المهام")}</label><b>{user.stats?.total_jobs ?? 0}</b></div>
          <div><label>{t("نجحت")}</label><b>{user.stats?.successful ?? 0}</b></div>
          <div><label>{t("فشلت")}</label><b>{user.stats?.failed ?? 0}</b></div>
          <div><label>{t("آخر مهمة")}</label><b>{rel(user.stats?.last_job_at)}</b></div>
        </div>
      </section>

      <section className="card">
        <header className="card-head"><h3>{t("إرسال رسالة")}</h3></header>
        <div className="card-body">
          <div className="row">
            <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t("نص الرسالة…")} />
            <button className="btn btn-primary" onClick={sendMessage} disabled={busy || !msg.trim()}>{t("إرسال")}</button>
          </div>
        </div>
      </section>

      <section className="card">
        <header className="card-head"><h3>{t("إجراءات")}</h3></header>
        <div className="card-body row wrap">
          {user.status === "BLOCKED"
            ? <button className="btn btn-ok" onClick={() => doAct("users:unblock")}><ShieldCheck size={14} /> {t("فك الحظر")}</button>
            : <button className="btn btn-danger" onClick={() => doAct("users:block", t("تأكيد حظر المستخدم؟"))}><Ban size={14} /> {t("حظر")}</button>}
          <button className="btn btn-warn" onClick={() => doAct("users:reset-quota", t("إعادة تعيين الحصة"))}><RotateCcw size={14} /> {t("إعادة تعيين الحصة")}</button>
          <button className="btn btn-ghost" onClick={() => doAct("users:send-media")}><ImagePlus size={14} /> {t("إرسال وسائط…")}</button>
          <button className="btn btn-danger" onClick={() => doAct("users:delete", t("حذف المستخدم وجميع بياناته نهائياً؟"))}><Trash2 size={14} /> {t("حذف")}</button>
        </div>
      </section>
    </div>
  );
}

function Badge({ v, tone = "muted" }) {
  return <span className={`badge badge-${tone}`}>{v}</span>;
}

function rel(d) {
  const t = i18n.t;
  if (!d) return "—";
  const diff = Date.now() - new Date(d).getTime();
  if (diff < 60000) return t("الآن");
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return t("قبل {{n}} د", { n: mins });
  const h = Math.floor(mins / 60);
  if (h < 24) return t("قبل {{n}} س", { n: h });
  return t("قبل {{n}} ي", { n: Math.floor(h / 24) });
}
