import React, { useEffect, useMemo, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { api, AppCtx, useApp } from "./ctx.js";
import { LogoMark } from "./components.jsx";
import Titlebar from "./Titlebar.jsx";
import {
  LayoutDashboard, ListOrdered, Users, MessagesSquare, BarChart3,
  MessageCircle, ScrollText, DatabaseBackup, Settings, LogOut, MessageSquareText,
} from "lucide-react";

// حالات WhatsApp
const WA_STATES = {
  CONNECTED: { label: "متصل", color: "#22c55e" },
  CONNECTING: { label: "جارٍ الاتصال...", color: "#eab308" },
  AUTHENTICATING: { label: "بانتظار المسح", color: "#eab308" },
  DISCONNECTED: { label: "غير متصل", color: "#ef4444" },
  LOGOUT: { label: "تسجيل خروج", color: "#ef4444" },
};

// ===== مكوّن أساسي: بطاقة =====
function Card({ title, children, actions, className = "" }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <h3>{title}</h3>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

// ===== شارات =====
function Badge({ children, tone = "muted" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function StatusBadge({ status }) {
  const tones = {
    QUEUED: "info", PROCESSING: "warn", SENDING: "accent",
    COMPLETED: "ok", FAILED: "danger", CANCELLED: "muted", STALE: "danger",
    ACTIVE: "ok", BLOCKED: "danger", PREMIUM: "accent", REGULAR: "muted",
    CONNECTED: "ok", CONNECTING: "warn", AUTHENTICATING: "warn",
    DISCONNECTED: "danger", LOGOUT: "danger",
  };
  return <Badge tone={tones[status] || "muted"}>{status}</Badge>;
}

// ===== جدول =====
function Tbl({ cols, rows, render, empty = "لا توجد بيانات" }) {
  if (!rows || rows.length === 0) return <div className="empty">{empty}</div>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i}>{cols.map((c) => <td key={c.key}>{c.cell ? c.cell(r) : render?.[c.key]?.(r)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ===== أزرار =====
function Btn({ children, onClick, tone = "", disabled, title }) {
  return (
    <button className={`btn btn-${tone}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

// ===== فورم عام =====
function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

// ===== أداة أرقام =====
// أرقام إنجليزية واضحة (u-nu-latn) مع تنسيق عربي (حسب دراسة المراجعة).
function fmtNum(n) {
  return new Intl.NumberFormat("ar-EG-u-nu-latn").format(n || 0);
}
function fmtBytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i > 1 ? 1 : 0)} ${u[i]}`;
}
function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("ar-EG-u-nu-latn");
}
function relTime(iso) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "الآن";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `قبل ${mins} د`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `قبل ${h} س`;
  return `قبل ${Math.floor(h / 24)} ي`;
}

// ===== ===== ===== الهيكل العام ===== ===== =====
// الصفحات
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import QueuePage from "./pages/Queue.jsx";
import UsersPage from "./pages/Users.jsx";
import GroupsPage from "./pages/Groups.jsx";
import MessagesPage from "./pages/Messages.jsx";
import StatsPage from "./pages/Stats.jsx";
import LogsPage from "./pages/Logs.jsx";
import WhatsAppPage from "./pages/WhatsApp.jsx";
import SettingsPage from "./pages/Settings.jsx";
import BackupsPage from "./pages/Backups.jsx";

const NAV = [
  { key: "dashboard", label: "لوحة التحكم", icon: LayoutDashboard },
  { key: "queue", label: "قائمة الانتظار", icon: ListOrdered },
  { key: "users", label: "المستخدمون", icon: Users },
  { key: "groups", label: "المجموعات", icon: MessagesSquare },
  { key: "messages", label: "المحادثات", icon: MessageSquareText },
  { key: "stats", label: "الإحصائيات", icon: BarChart3 },
  { key: "whatsapp", label: "واتساب", icon: MessageCircle },
  { key: "logs", label: "السجلات", icon: ScrollText },
  { key: "backups", label: "النسخ الاحتياطي", icon: DatabaseBackup },
  { key: "settings", label: "الإعدادات", icon: Settings },
];

function App() {
  const [page, setPage] = useState("dashboard");
  const [overview, setOverview] = useState(null);
  const [wa, setWa] = useState({ status: "DISCONNECTED" });
  const [token, setToken] = useState(null);
  const [authState, setAuthState] = useState({ configured: false, requireLogin: true, done: false });

  // المصادقة
  useEffect(() => {
    const saved = localStorage.getItem("sb_token");
    if (saved) setToken(saved);
    api.invoke("auth:status").then((r) => setAuthState({ configured: r.configured, requireLogin: r.requireLogin, done: true }));
  }, []);

  // السلوك الأصلي للتطبيق: منع قائمة السياق الافتراضية (فحص/نسخ) خارج الحقول.
  useEffect(() => {
    const block = (e) => {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable)) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", block);
    return () => document.removeEventListener("contextmenu", block);
  }, []);

  // الأحداث المباشرة
  useEffect(() => {
    const offs = [
      api.on("whatsapp:status", (st) => setWa((w) => ({ ...w, ...st }))),
      api.on("whatsapp:qr", ({ qr }) => setWa((w) => ({ ...w, qr }))),
      api.on("overview:tick", (o) => setOverview(o)),
    ];
    return () => offs.forEach((f) => f());
  }, []);

  // اعتماداسجل الدخول
  const login = useCallback(async (password) => {
    const r = await api.invoke("auth:login", { password });
    if (r.ok && r.token) { localStorage.setItem("sb_token", r.token); setToken(r.token); return { ok: true }; }
    return r;
  }, []);
  const setup = useCallback(async (password) => {
    const r = await api.invoke("auth:setup", { password });
    if (r.ok && r.token) {
      localStorage.setItem("sb_token", r.token);
      setToken(r.token);
      setAuthState({ configured: true, done: true });
    }
    return r;
  }, []);
  const logout = useCallback(async () => {
    if (token) await api.invoke("auth:logout", { token });
    localStorage.removeItem("sb_token");
    setToken(null);
  }, [token]);

  const ctx = useMemo(() => ({
    token, overview, wa, setWa, page, setPage, login, setup, logout,
    refresh: async () => {
      const r = await api.invoke("overview:get", { token });
      if (r.ok) setOverview(r.data);
      return r;
    },
  }), [token, overview, wa, page, login, setup, logout]);

  if (!authState.done) return (
    <div className="boot-wrap">
      <Titlebar />
      <div className="boot">جارٍ التحميل…</div>
    </div>
  );

  // إذا كان تسجيل الدخول غير مفعّل، نفتح لوحة التحكم مباشرةً بدون رمز
  const noLogin = authState.requireLogin === false;

  if (!noLogin && (!token || !authState.configured)) {
    return (
      <div className="boot-wrap">
        <Titlebar />
        <Login onLogin={login} onSetup={setup} configured={authState.configured} />
      </div>
    );
  }

  const Page = { dashboard: Dashboard, queue: QueuePage, users: UsersPage, groups: GroupsPage, messages: MessagesPage, stats: StatsPage, logs: LogsPage, whatsapp: WhatsAppPage, settings: SettingsPage, backups: BackupsPage }[page] || Dashboard;

  return (
    <AppCtx.Provider value={ctx}>
      <Titlebar />
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark"><LogoMark size={36} /></span>
            <div>
              <b>Sticker Bot</b>
              <small>مصنع الملصقات</small>
            </div>
          </div>
          <nav>
            {NAV.map((n) => {
              const Icon = n.icon;
              return (
                <button key={n.key} className={`nav-item ${n.key === page ? "active" : ""}`} onClick={() => setPage(n.key)}>
                  <span className="nav-icon"><Icon size={17} strokeWidth={2.2} /></span>
                  {n.label}
                </button>
              );
            })}
          </nav>
          <div className="sidebar-foot">
            <span className="wa-chip">
              <StatusBadge status={overview?.whatsapp || "DISCONNECTED"} />
            </span>
            {token && <Btn tone="ghost" onClick={logout}><LogOut size={14} /> خروج</Btn>}
          </div>
        </aside>
        <main className="main">
          <header className="topbar">
            <div>
              <div className="topbar-eyebrow">مصنع الملصقات — خلف الكواليس</div>
              <h1>{NAV.find((n) => n.key === page)?.label}</h1>
            </div>
            <div className="topbar-metrics">
              <span className="metric">
                <b>{overview?.queueSize ?? "…"}</b> في الانتظار
              </span>
              <span className="metric">
                <b>{overview?.processingNow ?? "…"}</b> قيد المعالجة
              </span>
              <span className="metric">
                <b>{fmtNum(overview?.users?.active)}</b> مستخدم نشط
              </span>
              <span className="metric">
                <b>{overview?.jobsToday ?? "…"}</b> مهمة اليوم
              </span>
            </div>
          </header>
          <div className="content">
            <Page />
          </div>
        </main>
      </div>
    </AppCtx.Provider>
  );
}

createRoot(document.getElementById("root")).render(<App />);