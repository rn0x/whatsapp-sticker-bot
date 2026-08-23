import { useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "../ctx.js";
import { useLiveData } from "../hooks/useLiveData.js";
import {
  Trash2, FolderOpen, File, Video, Sticker, AlertTriangle, Download, XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";

const TYPE_HINTS = {
  image: "صورة",
  video: "فيديو",
  document: "ملف",
  sticker: "ملصق",
  audio: "صوت",
  text: "نص",
};

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(i18n.language === "en" ? "en" : "ar-EG-u-nu-latn", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
}

function fmtBytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i > 1 ? 1 : 0)} ${u[i]}`;
}

function MediaPreview({ m, token }) {
  const { t } = useTranslation("ui");
  const [state, setState] = useState({ loading: true, data: null, tooLarge: false, missing: false });

  useEffect(() => {
    let live = true;
    window.api.invoke("messages:media", { token, id: m.id }).then((r) => {
      if (!live) return;
      setState({
        loading: false,
        data: r?.hasMedia ? r.data : null,
        tooLarge: !!r?.tooLarge,
        missing: !!r?.missing,
        mime: r?.mime,
      });
    }).catch(() => live && setState({ loading: false, missing: true }));
    return () => { live = false; };
  }, [m.id, token]);

  if (state.loading) return <div className="media-placeholder">{t("جارٍ تحميل المعاينة…")}</div>;
  if (state.missing) return (
    <div className="media-placeholder"><AlertTriangle size={16} /> {t("الملف محذوف أو غير متوفر")}</div>
  );

  if (state.data) {
    const src = `data:${state.mime || "image/webp"};base64,${state.data}`;
    if (m.type === "video") return <video className="media-prev" src={src} controls preload="metadata" />;
    if (m.type === "sticker" || m.type === "image" || (state.mime || "").startsWith("image/")) {
      return <img className="media-prev" src={src} alt={t(TYPE_HINTS[m.type] || "وسيط")} loading="lazy" />;
    }
  }
  if (state.tooLarge) return (
    <div className="media-placeholder">{t("الوسيط كبير للمعاينة ({{type}})", { type: t(TYPE_HINTS[m.type]) })}</div>
  );

  const Icon = m.type === "video" ? Video : m.type === "sticker" ? Sticker : File;
  return (
    <div className="media-placeholder">
      <Icon size={20} /> {t(TYPE_HINTS[m.type] || "وسيط")}
    </div>
  );
}

export default function MessagesPage() {
  const { t } = useTranslation("ui");
  const { token } = useApp();
  const [convs, setConvs] = useState([]);
  const [sel, setSel] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const endRef = useRef(null);

  const loadConvs = useCallback(async () => {
    setLoadingConvs(true);
    const r = await window.api.invoke("messages:conversations", { token });
    if (r.ok) setConvs(r.conversations);
    setLoadingConvs(false);
  }, [token]);

  useLiveData(loadConvs, { interval: 5000 });

  const loadThread = useCallback(async (chatId) => {
    setLoadingMsgs(true);
    const r = await window.api.invoke("messages:list", { token, chatId, limit: 300, order: "desc" });
    if (r.ok) setMsgs(r.data.rows.slice().reverse());
    setLoadingMsgs(false);
  }, [token]);

  async function select(chatId) {
    setSel(chatId);
    setMsgs([]);
    await loadThread(chatId);
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  async function deleteMsg(id) {
    if (!confirm(t("حذف هذه الرسالة (وملفها إن وُجد)؟"))) return;
    const r = await window.api.invoke("messages:delete", { token, id });
    if (r.ok) { await loadThread(sel); await loadConvs(); }
  }

  async function clearChat(chatId) {
    if (!confirm(t("حذف كل رسائل هذه المحادثة وملفاتها نهائياً؟"))) return;
    const r = await window.api.invoke("messages:clear-chat", { token, chatId });
    if (r.ok) { setMsgs([]); await loadConvs(); }
  }

  async function openFile(id) {
    const r = await window.api.invoke("messages:open", { token, id });
    if (!r.ok && r.error) alert(r.error);
  }

  async function saveFile(id) {
    const r = await window.api.invoke("messages:save", { token, id });
    if (!r.ok && r.error) alert(r.error);
  }

  const [pendingRevoke, setPendingRevoke] = useState(null);
  const revokeTimer = useRef(null);

  function revokeEveryone(id) {
    if (pendingRevoke !== id) {
      setPendingRevoke(id);
      clearTimeout(revokeTimer.current);
      revokeTimer.current = setTimeout(() => setPendingRevoke(null), 4000);
      return;
    }
    clearTimeout(revokeTimer.current);
    setPendingRevoke(null);
    window.api.invoke("messages:delete-everyone", { token, id, whatsappConfirmed: true })
      .then((r) => {
        if (r.ok) alert(t("تم حذف الرسالة للجميع عند المستخدم ✓"));
        else alert(t("تعذّر الحذف للجميع: {{e}}", { e: r.error || t("خطأ غير معروف") }));
      })
      .catch((err) => alert(t("تعذّر تنفيذ الحذف: {{e}}", { e: err?.message || err })));
  }

  const selConv = convs.find((c) => c.chatId === sel);

  return (
    <div className="chat-layout">
      <aside className="chat-list">
        <div className="chat-list-head">
          <span className="muted-text">{t("المحادثات")}</span>
          <button className="btn btn-ghost btn-sm" onClick={loadConvs}>{t("تحديث")}</button>
        </div>
        {loadingConvs && <div className="empty">{t("جارٍ التحميل…")}</div>}
        {!loadingConvs && convs.length === 0 && (
          <div className="empty">{t("لا توجد محادثات بعد")}<br /><span className="empty-stem">{t("تظهر هنا رسائل البوت بعد أول تفاعل.")}</span></div>
        )}
        {convs.map((c) => (
          <button
            key={c.chatId}
            className={`chat-item ${sel === c.chatId ? "active" : ""}`}
            onClick={() => select(c.chatId)}
          >
            <div className="chat-item-top">
              <b>{c.isGroup ? (c.groupName || t("مجموعة")) : (c.userName || t("مستخدم"))}</b>
              <small>{fmtTime(c.lastAt)}</small>
            </div>
            <div className="chat-item-sub">
              <span>
                {c.isGroup && <i className="group-badge">{t("مجموعة")}</i>}
                {c.isGroup || !c.userPhone ? null : <em dir="ltr">{c.userPhone}</em>}
                {" "}{t(TYPE_HINTS[c.lastType] || "نص")} · {c.lastDirection === "IN" ? t("من المستخدم") : t("من البوت")}
              </span>
              <em>{c.count}</em>
            </div>
          </button>
        ))}
      </aside>

      <section className="chat-thread">
        {!sel && <div className="empty chat-empty">{t("اختر محادثة لعرض سجل الرسائل والوسائط.")}</div>}
        {sel && (
          <>
            <header className="chat-thead">
              <div>
                <b>{selConv?.isGroup ? (selConv?.groupName || t("مجموعة")) : (selConv?.userName || t("محادثة"))}</b>
                <small className="muted-text" dir="ltr">{sel}</small>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => clearChat(sel)}>
                  <Trash2 size={13} /> {t("حذف الكل")}
                </button>
              </div>
            </header>
            <div className="chat-body">
              {loadingMsgs && <div className="empty">{t("جارٍ التحميل…")}</div>}
              {!loadingMsgs && msgs.length === 0 && <div className="empty">{t("لا توجد رسائل في هذه المحادثة.")}</div>}
              {msgs.map((m) => (
                <div key={m.id} className={`bubble ${m.direction === "IN" ? "in" : "out"}`}>
                  <div className="bubble-meta">
                    <span>{m.direction === "IN" ? t("المستخدم") : t("البوت")}</span>
                    <span className="muted-text">{fmtTime(m.createdAt)}</span>
                  </div>
                  {m.type === "text" ? (
                    <p className="bubble-text">{m.text || t("(رسالة فارغة)")}</p>
                  ) : (
                    <div className="bubble-media">
                      <MediaPreview m={m} token={token} />
                      {m.text && <p className="bubble-text">{m.text}</p>}
                      <div className="media-meta muted-text">
                        {t(TYPE_HINTS[m.type] || m.type)}
                        {(m.mediaSize != null && m.mediaSize > 0) && <span> · {fmtBytes(m.mediaSize)}</span>}
                      </div>
                    </div>
                  )}
                  <div className="bubble-actions">
                    {m.mediaPath && (
                      <>
                        <button className="btn-ghost mini" title={t("إظهار الملف في الملفات")} onClick={() => openFile(m.id)}>
                          <FolderOpen size={13} /> {t("فتح")}
                        </button>
                        <button className="btn-ghost mini" title={t("حفظ الملف")} onClick={() => saveFile(m.id)}>
                          <Download size={13} /> {t("حفظ")}
                        </button>
                      </>
                    )}
                    {m.direction === "OUT" && (
                      <button
                        className={`btn-ghost mini danger ${pendingRevoke === m.id ? "confirming" : ""}`}
                        title={t("حذف الرسالة للجميع من واتساب (يصلح في فترة محدودة)")}
                        onClick={() => revokeEveryone(m.id)}
                      >
                        <XCircle size={13} /> {pendingRevoke === m.id ? t("تأكيد الحذف؟") : t("حذف للجميع")}
                      </button>
                    )}
                    <button className="btn-ghost mini danger" title={t("حذف الرسالة")} onClick={() => deleteMsg(m.id)}>
                      <Trash2 size={13} /> {t("حذف")}
                    </button>
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
