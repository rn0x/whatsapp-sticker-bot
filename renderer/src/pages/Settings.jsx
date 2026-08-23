import { useState, useCallback, useEffect } from "react";
import { useApp } from "../ctx.js";
import { Switch } from "../components.jsx";

const MB = 1024 * 1024;

// الإعدادات — نموذج مرتب حسب الفئات مع شرح لكل إعداد.
// divisor: يُقسم القيمة المخزنة للعرض؛ unit: لاحقة الوحدة المعروضة.
const GROUPED = [
  {
    key: "bot", title: "البوت والملصق",
    fields: [
      { key: "bot.name", label: "اسم البوت", hint: "يُعرض في الحالة والجهاز المرتبط." },
      { key: "bot.stickerPack", label: "اسم مجموعة الملصق", hint: "يظهر تحت الملصقات عند تثبيتها." },
      { key: "bot.stickerAuthor", label: "اسم المؤلف", hint: "يظهر بجانب اسم المجموعة." },
    ],
  },
  {
    key: "quota", title: "الحصص",
    fields: [
      { key: "quota.defaultDailyQuota", label: "الحصة اليومية الافتراضية", type: "number", hint: "عدد المهام المسموحة لكل مستخدم في اليوم." },
      { key: "quota.mode", label: "وضع الحصة", hint: "نافذة متحركة · يوم ثابت · بلا حدود.", options: ["rolling_24h", "daily_fixed", "unlimited"] },
    ],
  },
  {
    key: "humanizer", title: "السلوك الإنساني",
    fields: [
      { key: "humanizer.enabled", label: "تفعيل السلوك الإنساني", type: "boolean", hint: "يضيف تأخيراً متنوعاً ويعطي انطباعاً بشرياً." },
      { key: "humanizer.typingEnabled", label: "مؤشر الكتابة", type: "boolean", hint: "إظهار «يكتب…» أثناء المعالجة." },
      { key: "humanizer.markSeenEnabled", label: "علامة القراءة", type: "boolean", hint: "تأخير ظهور علامة «تم القراءة»." },
      { key: "humanizer.replyDelayMinMs", label: "أقل تأخير للرد", type: "number", unit: "ms", hint: "الحد الأدنى لانتظار الرد." },
      { key: "humanizer.replyDelayMaxMs", label: "أقصى تأخير للرد", type: "number", unit: "ms", hint: "يُختار عشوائياً ضمن هذا النطاق." },
    ],
  },
  {
    key: "queue", title: "قائمة الانتظار",
    fields: [
      { key: "queue.maxMediaWorkers", label: "عمال المعالجة", type: "number", hint: "عدد المهام المتزامنة للتحويل." },
      { key: "queue.maxDownloadWorkers", label: "عمال التحميل", type: "number", hint: "عدد التنزيلات المتزامنة." },
      { key: "queue.maxQueueSize", label: "أقصى حجم للقائمة", type: "number", hint: "حد المهام المفتوحة إجمالاً." },
      { key: "queue.maxPendingJobsPerUser", label: "أقصى مهام معلقة لكل مستخدم", type: "number", hint: "يمنع المستخدم من إغراق الطابور." },
      { key: "queue.jobLeaseTimeoutMs", label: "مهلة استئجار المهمة", type: "number", divisor: 60000, unit: "د", hint: "إذا لم يُدفع القلب خلالها تُستعاد المهمة." },
      { key: "queue.jobHeartbeatIntervalMs", label: "نبض قلب العامل", type: "number", divisor: 1000, unit: "ث", hint: "فاصل تحديث نشاط العامل." },
      { key: "queue.maxRetries", label: "أقصى عدد محاولات", type: "number", hint: "كم مرة تُعاد المهمة الفاشلة مؤقتاً." },
      { key: "queue.retryBackoffBaseMs", label: "أساس التراجع", type: "number", divisor: 1000, unit: "ث", hint: "ازدياد التأخير بين المحاولات." },
    ],
  },
  {
    key: "media", title: "الوسائط",
    fields: [
      { key: "media.maxImageBytes", label: "أقصى حجم صورة", type: "number", divisor: MB, unit: "MB", hint: "الحد الأقصى لحجم الصورة الواردة." },
      { key: "media.maxVideoBytes", label: "أقصى حجم فيديو", type: "number", divisor: MB, unit: "MB", hint: "الحد الأقصى لحجم الفيديو الوارد." },
      { key: "media.maxVideoDurationSeconds", label: "أقصى مدة فيديو", type: "number", unit: "ث", hint: "يلزم بأن تبقى الملصقات خفيفة." },
      { key: "media.stickerMaxFps", label: "أقصى إطارات للملصق", type: "number", unit: "fps", hint: "إطارات أقل = حجم أصغر." },
      { key: "media.stickerQuality", label: "الجودة", type: "number", unit: "%", hint: "توازن الجودة مقابل الحجم." },
      { key: "media.stickerSize", label: "حجم الملصق", type: "number", unit: "px", hint: "512 هو معيار واتساب." },
    ],
  },
  {
    key: "storage", title: "التخزين",
    fields: [
      { key: "storage.cacheRetentionHours", label: "احتفاظ الذاكرة المؤقتة", type: "number", unit: "س", hint: "مدة بقاء الملفات المكررة على القرص." },
      { key: "storage.failedRetentionDays", label: "احتفاظ الفاشل", type: "number", unit: "ي", hint: "مدة بقاء مخرجات المهام الفاشلة." },
      { key: "storage.logsRetentionDays", label: "احتفاظ السجلات", type: "number", unit: "ي", hint: "كم من الزمن تُحفظ السجلات." },
      { key: "storage.cleanupIntervalMinutes", label: "فاصل التنظيف", type: "number", unit: "د", hint: "كل كم دقيقة تُمسح الملفات المنتهية." },
      { key: "storage.diskFreeSpaceThresholdMb", label: "عتبة مساحة القرص", type: "number", unit: "MB", hint: "تحذير عندما تقل المساحة الحرة عن الحد." },
    ],
  },
  {
    key: "whatsapp", title: "واتساب",
    fields: [
      { key: "whatsapp.provider", label: "موفر الاتصال", hint: "wwebjs يمرّ عبر متصفح حقيقي (موصى به لتفادي الحظر).", options: ["wwebjs"] },
      { key: "whatsapp.groupMode", label: "وضع المجموعات", hint: "متى يرد البوت في الجروبات (القيمة الافتراضية للمجموعات الجديدة).", options: [
        { value: "MENTION_ONLY", label: "بالإشارة فقط" },
        { value: "AUTO", label: "تلقائي" },
        { value: "COMMAND_ONLY", label: "بالأمر فقط" },
        { value: "OFF", label: "معطلة" },
      ] },
      { key: "whatsapp.autoReconnect", label: "إعادة الاتصال التلقائي", type: "boolean", hint: "محاولة ربط الجلسة تلقائياً عند الانقطاع." },
      { key: "whatsapp.autoConnectOnBoot", label: "اتصال تلقائي عند التشغيل", type: "boolean", hint: "صل بالجلسة المحفوظة فور فتح التطبيق." },
      { key: "whatsapp.sessionInstanceId", label: "معرف الجلسة", hint: "يعزل بيانات إقران الأجهزة." },
      { key: "whatsapp.instanceName", label: "اسم الجهاز المعروض", hint: "يظهر في واتساب ثم الأجهزة المرتبطة." },
    ],
  },
  {
    key: "history", title: "سجل المحادثات",
    fields: [
      { key: "history.enabled", label: "تفعيل سجل المحادثات", type: "boolean", hint: "حفظ الرسائل والوسائط لكل مستخدم داخل لوحة التحكم." },
      { key: "history.mediaRetentionDays", label: "الاحتفاظ بالوسائط المسجلة", type: "number", unit: "ي", hint: "بعدها تُحذف نسخ الوسائط من السجل تلقائياً." },
    ],
  },
  {
    key: "rateLimit", title: "الحدود",
    fields: [
      { key: "rateLimit.perUserPerMinute", label: "لكل مستخدم / دقيقة", type: "number", hint: "منع الإغراق من مستخدم واحد." },
      { key: "rateLimit.perGroupPerMinute", label: "لكل مجموعة / دقيقة", type: "number", hint: "منع الإغراق في الجروبات." },
      { key: "rateLimit.globalPerMinute", label: "الحد العام / دقيقة", type: "number", hint: "سقف إجمالي لجميع المستخدمين." },
      { key: "rateLimit.maxInvalidPerHour", label: "أقصى طلبات غير صالحة / ساعة", type: "number", hint: "يوقف من يكرر الملفات غير المدعومة." },
    ],
  },
  {
    key: "app", title: "عام",
    fields: [
      { key: "app.theme", label: "المظهر", hint: "اختر بين الليلي والنهاري.", options: ["dark", "light"] },
      { key: "app.language", label: "اللغة", options: ["ar", "en"] },
      { key: "app.autoUpdateEnabled", label: "تحديث تلقائي", type: "boolean", hint: "تحميل الإصدارات الجديدة تلقائياً." },
    ],
  },
];

// عرض القيمة المخزنة وفق الـ divisor (تُقسم للعرض) — للأرقام فقط.
function displayOf(f, v) {
  if (v === undefined || v === null) return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return f.divisor && f.divisor !== 1 ? Math.round((n / f.divisor) * 100) / 100 : n;
}

// تحويل قيمة العرض إلى القيمة المخزنة (تُضرب بالـ divisor).
function rawOf(f, v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return f.divisor && f.divisor !== 1 ? Math.round(n * f.divisor) : n;
}

export default function SettingsPage() {
  const { token } = useApp();
  const [data, setData] = useState(null);
  const [dirty, setDirty] = useState({});
  const [saved, setSaved] = useState("");
  const [resetWord, setResetWord] = useState("");
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    const r = await window.api.invoke("settings:getAll", { token });
    if (r.ok) setData(r.data);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function save(key, value) {
    const r = await window.api.invoke("settings:set", { token, key, value });
    if (!r.ok) { alert(r.error); return; }
    setSaved(key); setTimeout(() => setSaved(""), 1500);
    setData((d) => ({ ...d, [key]: value }));
    setDirty((d) => { const { [key]: _drop, ...rest } = d; return rest; });
    if (key === "app.theme") document.documentElement.setAttribute("data-theme", value);
  }

  function onKeyDown(f, e) {
    if (e.key === "Enter") {
      const raw = rawOf(f, dirty[f.key]);
      if (raw !== null) save(f.key, raw);
    }
  }

  // إعادة الضبط الكامل — حماية مزدوجة: كتابة RESET + تأكيد.
  async function factoryReset() {
    if (resetting) return;
    if (!confirm("إعادة الضبط الكامل؟ سيُحذف كل شيء نهائياً: المستخدمون، السجلات، الوسائط، النسخ الاحتياطية، وجلسة واتساب. لا يمكن التراجع عنها.")) return;
    setResetting(true);
    try {
      const r = await window.api.invoke("system:factory-reset", { token, confirmWord: resetWord });
      if (r.ok) {
        alert("تمت إعادة الضبط الكامل. يعمل النظام الآن كما لو كان جديداً.\nسيُعاد تحميل اللوحة.");
        window.location.reload();
      } else {
        alert(r.error || "تعذّرت عملية إعادة الضبط");
        setResetting(false);
      }
    } catch (err) {
      alert("تعذّرت عملية إعادة الضبط: " + (err?.message || err));
      setResetting(false);
    }
  }

  return (
    <div className="stack">
      {saved && <div className="toast">تم الحفظ</div>}
      {GROUPED.map((g) => (
        <section key={g.key} className="card">
          <header className="card-head"><h3>{g.title}</h3></header>
          <div className="card-body settings-form">
            {g.fields.map((f) => {
              const val = data?.[f.key];
              const isNum = f.type === "number";
              const isBool = f.type === "boolean";
              const isSel = !!f.options;
              const shown = displayOf(f, isNum ? (dirty[f.key] !== undefined ? dirty[f.key] : val) : val);
              const isDirty = dirty[f.key] !== undefined && (isNum ? rawOf(f, dirty[f.key]) !== val : dirty[f.key] !== val);
              return (
                <div key={f.key} className="field">
                  <span className="field-label">
                    {f.label} <small className="key-label" dir="ltr">({f.key})</small>
                  </span>
                  <div className="field-control">
                    {isSel ? (
                      <select
                        value={(() => {
                          const opts = f.options.map((o) => (typeof o === "object" ? o.value : o));
                          const cur = val === undefined ? "" : String(val);
                          return opts.includes(cur) ? cur : (opts.includes(cur.toUpperCase()) ? cur.toUpperCase() : "");
                        })()}
                        onChange={(e) => {
                          const v = e.target.value === "true" ? true : e.target.value === "false" ? false : e.target.value;
                          save(f.key, v);
                        }}
                      >
                        {f.options.map((o) => {
                          const val = typeof o === "object" ? o.value : o;
                          const label = typeof o === "object" ? o.label : o;
                          return <option key={val} value={val}>{label}</option>;
                        })}
                      </select>
                    ) : isBool ? (
                      <Switch checked={val === true} onChange={(v) => save(f.key, v)} />
                    ) : isNum ? (
                      <div className="num-wrap">
                        <input
                          type="number"
                          value={shown}
                          onChange={(e) => setDirty((d) => ({ ...d, [f.key]: e.target.value }))}
                          onKeyDown={(e) => onKeyDown(f, e)}
                          dir="ltr"
                        />
                        {f.unit && <span className="unit">{f.unit}</span>}
                        <button
                          className="btn btn-primary btn-sm setting-save"
                          disabled={!isDirty}
                          onClick={() => { const raw = rawOf(f, dirty[f.key]); if (raw !== null) save(f.key, raw); }}
                        >
                          حفظ
                        </button>
                      </div>
                    ) : (
                      <div className="num-wrap">
                        <input
                          type="text"
                          value={shown}
                          onChange={(e) => setDirty((d) => ({ ...d, [f.key]: e.target.value }))}
                          onKeyDown={(e) => onKeyDown(f, e)}
                        />
                        <button
                          className="btn btn-primary btn-sm setting-save"
                          disabled={!isDirty}
                          onClick={() => { if (dirty[f.key] !== undefined) save(f.key, dirty[f.key]); }}
                        >
                          حفظ
                        </button>
                      </div>
                    )}
                  </div>
                  {f.hint && <small className="setting-desc">{f.hint}</small>}
                  {isDirty && <small className="unsaved">غير محفوظ — اضغط حفظ أو Enter</small>}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <section className="card danger-card">
        <header className="card-head"><h3>منطقة الخطر — إعادة الضبط الكامل</h3></header>
        <div className="card-body">
          <p className="setting-desc">
            يمسح كل البيانات نهائياً ويعيد النظام لحالة التشغيل الأولى: المستخدمون، السجلات، الوسائط،
            قوائم الانتظار، النسخ الاحتياطية، وجلسة واتساب (تسجيل خروج كامل). لا يمكن استرجاع أي شيء بعدها.
          </p>
          <div className="num-wrap reset-line">
            <input
              type="text"
              className="reset-input"
              placeholder="اكتب RESET للتأكيد"
              value={resetWord}
              onChange={(e) => setResetWord(e.target.value)}
              dir="ltr"
            />
            <button
              className="btn btn-danger btn-sm"
              disabled={resetWord.trim() !== "RESET" || resetting}
              onClick={factoryReset}
            >
              {resetting ? "جارٍ إعادة الضبط…" : "إعادة الضبط الكامل"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}