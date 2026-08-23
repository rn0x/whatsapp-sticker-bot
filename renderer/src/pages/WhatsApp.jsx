import { useState, useCallback, useEffect } from "react";
import { QrCode as QRScene, Link2, Unplug, LogOut, CheckCircle2 } from "lucide-react";
import QRCode from "qrcode";
import { useApp } from "../ctx.js";
import { useTranslation } from "react-i18next";

export default function WhatsAppPage() {
  const { t } = useTranslation("ui");
  const { token, wa, setWa, refresh } = useApp();
  const [busy, setBusy] = useState("");
  const [pairingPhone, setPairingPhone] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    window.api.invoke("whatsapp:status", { token }).then((r) => {
      if (r.ok && r.data) setWa({ ...wa, ...r.data });
    });
  }, []);

  useEffect(() => {
    if (!wa?.qr) { setQrDataUrl(""); return; }
    let cancelled = false;
    QRCode.toDataURL(String(wa.qr), { width: 420, margin: 2, errorCorrectionLevel: "M" })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setQrDataUrl(""); });
    return () => { cancelled = true; };
  }, [wa?.qr]);

  async function act(name, fn) {
    setBusy(name);
    const r = await fn();
    if (!r?.ok && r?.error) alert(r.error);
    setBusy("");
    refresh();
  }

  async function requestPairing() {
    if (!pairingPhone.trim()) return;
    setBusy("pairing");
    const r = await window.api.invoke("whatsapp:pairing", { token, phone: pairingPhone });
    setBusy("");
    if (r.ok) setPairCode(r.code);
    else alert(r.error || t("فشل الطلب"));
  }

  const st = wa?.status || "DISCONNECTED";
  const tone = { CONNECTED: "ok", CONNECTING: "warn", AUTHENTICATING: "warn", DISCONNECTED: "danger", LOGOUT: "danger" }[st] || "muted";

  return (
    <div className="grid">
      <section className="card">
        <header className="card-head"><h3>{t("حالة الاتصال")}</h3></header>
        <div className="card-body center">
          <div className={`wa-big-status wa-${st}`}>
            <span className={`dot ${tone}`} />
            <b>{t(st)}</b>
          </div>
          {wa?.phone && <div className="muted-text" style={{ direction: "ltr" }}>{wa.phone}</div>}
        </div>
      </section>

      <section className="card">
        <header className="card-head"><h3>{t("الإجراءات")}</h3></header>
        <div className="card-body stack-actions">
          <button className={`btn btn-primary ${busy === "connect" ? "busy" : ""}`} disabled={st === "CONNECTED" || !!busy} onClick={() => act("connect", () => window.api.invoke("whatsapp:connect", { token }))}>
            {st === "CONNECTED" ? (<><CheckCircle2 size={14} /> {t("متصل بالفعل")}</>) : (<><QRScene size={14} /> {t("اتصال / إظهار QR")}</>)}
          </button>
          <button className={`btn ${busy === "disconnect" ? "busy" : ""}`} disabled={st === "DISCONNECTED" || !!busy} onClick={() => act("disconnect", () => window.api.invoke("whatsapp:disconnect", { token }))}>
            <Unplug size={14} /> {t("قطع الاتصال")}
          </button>
          <button className={`btn btn-danger ${busy === "logout" ? "busy" : ""}`} disabled={!!busy} onClick={() => { if (confirm(t("تسجيل الخروج نهائياً وحذف الجلسة؟"))) act("logout", () => window.api.invoke("whatsapp:logout", { token })); }}>
            <LogOut size={14} /> {t("تسجيل خروج")}
          </button>
        </div>
      </section>

      <section className="card span-2">
        <header className="card-head"><h3>{t("رمز الإقران (بديل QR)")}</h3></header>
        <div className="card-body">
          <p className="muted-text">{t("أدخل رقم هاتفك بصيغة دولية كاملة (بدون أصفار بادئة أو +):")}</p>
          <div className="row">
            <input value={pairingPhone} onChange={(e) => setPairingPhone(e.target.value.trim())} placeholder={t("مثال: 966569697241")} style={{ direction: "ltr" }} inputMode="numeric" />
            <button className="btn btn-warn" onClick={requestPairing} disabled={!!busy}><Link2 size={14} /> {t("إصدار الرمز")}</button>
          </div>
          {pairCode && (
            <div className="pair-code" dir="ltr">
              <b>{pairCode}</b>
              <small>{t("أدخله في الهاتف: واتساب → الأجهزة المرتبطة → ربط")}</small>
            </div>
          )}
        </div>
      </section>

      {(st === "CONNECTING" || st === "AUTHENTICATING") && (
        <section className="card span-4">
          <header className="card-head"><h3>{t("ربط جهاز جديد")}</h3></header>
          <div className="card-body center">
            <div className="wa-qr">
              {qrDataUrl ? (
                <>
                  <img src={qrDataUrl} alt="QR" className="qr-img" />
                  <small className="muted-text">{t("امسح الرمز من الهاتف: واتساب → الأجهزة المرتبطة → ربط جهاز")}</small>
                  <small className="muted-text">{t("يتجدد الرمز تلقائياً كل لحظات — أعد مسحه إن انتهت صلاحيته.")}</small>
                </>
              ) : <p>{t("بانتظار رمز QR…")}</p>}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
