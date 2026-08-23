import { useState, useCallback } from "react";
import { useApp } from "../ctx.js";
import { useLiveData } from "../hooks/useLiveData.js";
import { DatabaseBackup, KeyRound, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";

export default function BackupsPage() {
  const { t } = useTranslation("ui");
  const { token } = useApp();
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState("");
  const [includeSession, setIncludeSession] = useState(false);
  const [passphrase, setPassphrase] = useState("");

  const load = useCallback(async () => {
    const r = await window.api.invoke("backups:list", { token });
    if (r.ok) setList(r.backups);
  }, [token]);

  useLiveData(load, { interval: 5000 });

  async function create() {
    setBusy("create");
    const r = await window.api.invoke("backups:create", { token, includeSession, passphrase: passphrase || undefined });
    setBusy("");
    if (!r.ok) alert(r.error); else load();
  }

  async function restore(path) {
    if (!confirm(t("استعادة هذا النسخ؟ سيتم إيقاف الخدمات مؤقتاً ثم إعادة تشغيلها."))) return;
    setBusy("restore");
    const r = await window.api.invoke("backups:restore", { token, path });
    setBusy("");
    if (!r.ok) alert(r.error);
    else { alert(t("تمت الاستعادة بنجاح")); load(); }
  }

  return (
    <div className="grid">
      <section className="card">
        <header className="card-head"><h3>{t("إنشاء نسخة")}</h3></header>
        <div className="card-body stack-actions">
          <label className="toggle">
            <input type="checkbox" checked={includeSession} onChange={(e) => setIncludeSession(e.target.checked)} />
            <span className="track" aria-hidden="true" />
            <span>{t("تضمين جلسة واتساب (اختياري)")}</span>
          </label>
          {includeSession && (
            <div className="row">
              <KeyRound size={16} className="muted-text" />
              <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder={t("كلمة مرور لتشفير الجلسة (اختياري)")} className="grow" />
            </div>
          )}
          <button className="btn btn-primary" onClick={create} disabled={!!busy}>
            <DatabaseBackup size={15} /> {busy === "create" ? t("جارٍ الإنشاء…") : t("إنشاء نسخة احتياطية")}
          </button>
        </div>
      </section>

      <section className="card span-3">
        <header className="card-head"><h3>{t("النسخ المتوفرة")}</h3></header>
        <div className="card-body">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>{t("الملف")}</th><th>{t("الحجم")}</th><th>{t("التاريخ")}</th><th>{t("مشفر")}</th><th>{t("الحالة")}</th><th></th></tr></thead>
              <tbody>
                {(list || []).map((b) => (
                  <tr key={b.id}>
                    <td style={{ direction: "ltr" }}>{b.filename}</td>
                    <td>{fmtBytes(b.size)}</td>
                    <td>{fmt(b.created_at)}</td>
                    <td>{b.encrypted ? t("نعم") : t("لا")}</td>
                    <td>{b.status}</td>
                    <td>
                      <button className="btn btn-sm" onClick={() => restore(b.path)} disabled={!!busy}>{t("استعادة")}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {busy === "restore" && <div className="muted-text pad">{t("جارٍ الاستعادة… قد يستغرق لحظات.")}</div>}
          </div>
        </div>
      </section>
    </div>
  );
}

function fmt(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString(i18n.language === "en" ? "en" : "ar");
}

function fmtBytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i > 1 ? 1 : 0)} ${u[i]}`;
}
