import { useState } from "react";
import { AppMark } from "../components.jsx";

export default function Login({ onLogin, onSetup, configured }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    const fn = configured ? onLogin : onSetup;
    const r = await fn(password);
    if (r && !r.ok) setError(r.error || "حدث خطأ");
    setBusy(false);
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-mark"><AppMark size={58} /></div>
        <h2>مصنع الملصقات</h2>
        <p>{configured ? "سجّل الدخول للوصول إلى لوحة التحكم" : "أدخل كلمة مرور المسؤول لبدء الإعداد"}</p>
        <label className="field">
          <span>كلمة المرور</span>
          <input
            type="password" value={password} autoFocus
            onChange={(e) => setPassword(e.target.value)} required minLength={4}
          />
        </label>
        {error && <div className="err-msg">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "…" : configured ? "دخول" : "تعيين كلمة المرور"}
        </button>
        <small className="muted-text center">WhatsApp Sticker Bot</small>
      </form>
    </div>
  );
}