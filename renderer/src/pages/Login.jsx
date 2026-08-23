import { useState } from "react";
import { AppMark } from "../components.jsx";
import { useTranslation } from "react-i18next";

export default function Login({ onLogin, onSetup, configured }) {
  const { t } = useTranslation("ui");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    const fn = configured ? onLogin : onSetup;
    const r = await fn(password);
    if (r && !r.ok) setError(r.error || t("حدث خطأ"));
    setBusy(false);
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-mark"><AppMark size={58} /></div>
        <h2>{t("مصنع الملصقات")}</h2>
        <p>{configured ? t("سجّل الدخول للوصول إلى لوحة التحكم") : t("أدخل كلمة مرور المسؤول لبدء الإعداد")}</p>
        <label className="field">
          <span>{t("كلمة المرور")}</span>
          <input
            type="password" value={password} autoFocus
            onChange={(e) => setPassword(e.target.value)} required minLength={4}
          />
        </label>
        {error && <div className="err-msg">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "…" : configured ? t("دخول") : t("تعيين كلمة المرور")}
        </button>
        <small className="muted-text center">WhatsApp Sticker Bot</small>
      </form>
    </div>
  );
}
