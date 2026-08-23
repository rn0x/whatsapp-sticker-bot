// مكوّنات مشتركة: الشعار (ملصق بزاوية مقشورة)، مفتاح تبديل، عناصر مساعدة.
import {
  Download, Film, Layers, Send, Activity,
} from "lucide-react";

// شعار التطبيق: ملصق بزاوية مقشورة + شرارة خضراء.
export function AppMark({ size = 32 }) {
  return (
    <svg className="app-mark" width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="am-g" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--green)" />
          <stop offset="1" stopColor="var(--green-deep)" />
        </linearGradient>
      </defs>
      {/* جسد الملصق */}
      <path d="M10 4h22l12 12v26a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" fill="var(--paper-2)" stroke="var(--line)" strokeWidth="2.5" />
      {/* الزاوية المقشورة */}
      <path d="M32 4l12 12h-9a3 3 0 0 1-3-3V4Z" fill="var(--paper)" stroke="var(--line)" strokeWidth="2.5" strokeLinejoin="round" />
      {/* شرارة الستيكر */}
      <path d="M25 15l-10 13h8l-3 8 11-14h-8l2-7Z" fill="url(#am-g)" />
    </svg>
  );
}

export function LogoMark({ size = 20 }) {
  return <AppMark size={size} />;
}

// مفتاح تبديل ثنائي بنمط الواجهة.
export function Switch({ checked, onChange, onLabel = "نعم", offLabel = "لا", label }) {
  const current = !!checked;
  return (
    <label className="toggle switch">
      <input type="checkbox" checked={current} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true" />
      {label ? <span>{label}</span> : <span className={current ? "lbl-on" : "lbl-off"}>{current ? onLabel : offLabel}</span>}
    </label>
  );
}

// أيقونات مراحل خط الإنتاج.
export function StageIcon({ stage }) {
  const map = {
    download: Download,
    process: Layers,
    send: Send,
  };
  const Icon = map[stage] || Activity;
  return <Icon size={16} strokeWidth={2.2} />;
}

// تسمية خطوة خط الإنتاج.
export const PIPELINE_STAGES = [
  { key: "download", title: "الاستلام", sub: "تحميل الملف" },
  { key: "process", title: "المعالجة", sub: "تحويل لملصق" },
  { key: "send", title: "الإرسال", sub: "إلى المستخدم" },
];
export { Film };