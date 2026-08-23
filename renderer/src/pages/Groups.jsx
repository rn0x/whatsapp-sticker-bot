import { useState, useCallback, useEffect } from "react";
import { useApp } from "../ctx.js";
import { useLiveData } from "../hooks/useLiveData.js";
import { RefreshCw, Search } from "lucide-react";

// المجموعات — قائمة، إدارة إعدادات كل مجموعة (mode/enabled/الحصة/الأدوار)
const MODES = [
  ["OFF", "معطلة"],
  ["MENTION_ONLY", "بالإشارة فقط"],
  ["COMMAND_ONLY", "بالأمر فقط"],
  ["AUTO", "تلقائي"],
];
const ROLES = ["REGULAR", "PREMIUM"];

// شرح موجز لكل وضع — يظهر فوق الجدول ليعرف المستخدم الفرق بوضوح.
const MODE_HINTS = {
  OFF: "البوت لا يستقبل أي وسائط من هذه المجموعة.",
  MENTION_ONLY: "يحوّل فقط ما يُشار فيه للبوت فعلياً (@) أو يُكتب فيه @اسمه نصاً.",
  COMMAND_ONLY: "يحوّل فقط ما ترافقه كلمة محفّزة مثل «ستيكر» أو «ملصق» أو «اصنع»، أو إشارة للبوت.",
  AUTO: "يحوّل كل صورة/فيديو يُرسَل في المجموعة تلقائياً.",
};

export default function GroupsPage() {
  const { token } = useApp();
  const [q, setQ] = useState(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const r = await window.api.invoke("groups:list", { token, query: query || undefined, limit: 200 });
    if (r.ok) setQ(r.data);
  }, [token, query]);

  useLiveData(load, { interval: 5000 });

  const refresh = useCallback(async () => {
    const r = await window.api.invoke("groups:refresh", { token, query: query || undefined, limit: 200 });
    if (r.ok) setQ(r.data);
  }, [token, query]);

  return (
    <div className="stack">
      <div className="toolbar">
        <label className="field inline grow">
          <span><Search size={13} /> بحث</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="اسم المجموعة…" />
        </label>
        <button className="btn" onClick={refresh}><RefreshCw size={14} /> تحديث من واتساب</button>
      </div>

      <div className="mode-legend">
        <details>
          <summary className="mode-legend-summary"><span className="badge badge-info">شرح الأوضاع</span> كيف يعمل كل وضع؟</summary>
          <ul>
            <li><b>تلقائي:</b> {MODE_HINTS.AUTO}</li>
            <li><b>بالإشارة فقط:</b> {MODE_HINTS.MENTION_ONLY}</li>
            <li><b>بالأمر فقط:</b> {MODE_HINTS.COMMAND_ONLY}</li>
            <li><b>معطلة:</b> {MODE_HINTS.OFF}</li>
          </ul>
          <p className="muted-text">
            الأوامر النصية تعمل في المجموعة بأي وضع: /help، /usage «حصتي»، /اضبط «حقوقي»، /فيديو، /صورة، /on، /off.
            عند دخول البوت مجموعة جديدة يرسل رسالة تعريف مختصرة ويُسجَّل تلقائياً.
          </p>
        </details>
      </div>

      <section className="card">
        <div className="card-body">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>المجموعة</th><th>المعرّف</th><th>الأعضاء</th><th>الوضع</th><th>التفعيل</th><th>الحصة اليومية</th><th>الأدوار المسموحة</th></tr></thead>
              <tbody>
                {(q?.rows || []).map((g) => <GroupRow key={g.groupId ?? g.group_id} g={g} token={token} onChanged={load} />)}
              </tbody>
            </table>
            {!q?.rows?.length && <div className="empty">لا توجد مجموعات بعد</div>}
          </div>
        </div>
      </section>
    </div>
  );
}

function GroupRow({ g, token }) {
  const [settings, setSettings] = useState(null);
  const [dailyStr, setDailyStr] = useState("");
  const [saveErr, setSaveErr] = useState("");

  async function loadSettings() {
    const r = await window.api.invoke("groups:settings", { token, id: g.groupId ?? g.group_id });
    if (r.ok && r.settings) {
      setSettings(r.settings);
      setDailyStr(r.settings.daily_limit != null ? r.settings.daily_limit : (r.settings.dailyLimit ?? ""));
    }
  }

  useEffect(() => { loadSettings(); }, [g.groupId ?? g.group_id, token]);

  async function save(key, value) {
    setSaveErr("");
    // تحديث تفاؤلي فوري — الواجهة لا تنتظر الخادم كي لا تبقى "ثابتة".
    setSettings((prev) => {
      const base = prev || {};
      const next = { ...base, [key]: value };
      if (key === "allowed_roles") next.allowedRoles = value;
      return next;
    });
    const r = await window.api.invoke("groups:update-settings", { token, id: g.groupId ?? g.group_id, fields: { [key]: value } });
    if (r.ok && r.settings) {
      setSettings(r.settings);
      setDailyStr(r.settings.daily_limit != null ? r.settings.daily_limit : (r.settings.dailyLimit ?? ""));
    } else {
      setSaveErr(r?.error || "فشل الحفظ");
      loadSettings(); // إعادة القراءة الفعلية (تراجع عن التفاؤلي)
    }
  }

  // التخزين يعيد enabled كعدد صحيح (0/1) أو منطقي — نطبّعه بأمان للعرض.
  const enabled = settings == null || settings.enabled === 1 || settings.enabled === true;

  return (
    <tr>
      <td><b>{g.name || "بدون اسم"}</b></td>
      <td className="muted" style={{ direction: "ltr" }}>{g.groupId ?? g.group_id}</td>
      <td>{g.memberCount ?? "?"}</td>
      <td>
        <select value={settings?.mode || "MENTION_ONLY"} onChange={(e) => save("mode", e.target.value)}
          title={MODE_HINTS[settings?.mode] || ""}>
          {MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </td>
      <td>
        <label className="toggle switch" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={enabled} onChange={(e) => save("enabled", e.target.checked)} />
          <span className="track" aria-hidden="true" />
          <span className={enabled ? "lbl-on" : "lbl-off"}>{enabled ? "مفعّلة" : "معطلة"}</span>
        </label>
      </td>
      <td>
        <input
          type="number"
          value={dailyStr}
          onChange={(e) => setDailyStr(e.target.value)}
          onBlur={() => { const n = Number(dailyStr); if (dailyStr !== "" && Number.isFinite(n) && n >= 0) save("daily_limit", Math.round(n)); }}
          onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
          style={{ width: 80 }} placeholder="بلا حد"
        />
      </td>
      <td>
        <div className="row wrap" style={{ gap: 6 }}>
          {ROLES.map((r) => (
            <label key={r} className="toggle">
              <input
                type="checkbox"
                checked={(settings?.allowedRoles || ["REGULAR", "PREMIUM"]).includes(r)}
                onChange={(e) => {
                  const list = settings?.allowedRoles || ["REGULAR", "PREMIUM"];
                  const next = e.target.checked ? [...new Set([...list, r])] : list.filter((x) => x !== r);
                  save("allowed_roles", next.length ? next : ["REGULAR"]);
                }}
              />
              <span className="muted-text">{r}</span>
            </label>
          ))}
        </div>
        {saveErr && <small className="unsaved" style={{ display: "block" }}>{saveErr}</small>}
      </td>
    </tr>
  );
}