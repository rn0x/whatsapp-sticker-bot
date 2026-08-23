export interface Feature {
  title: string;
  desc: string;
  icon: string;
}
export interface FaqItem {
  q: string;
  a: string;
}
export interface UiDict {
  metaTitle: string;
  metaDescription: string;
  nav: { download: string; features: string; screenshots: string; faq: string; github: string };
  hero: { badge: string; title: string; subtitle: string; cta: string; allPlatforms: string; secondary: string };
  download: {
    title: string;
    subtitle: string;
    btn: string;
    size: string;
    soon: string;
    windows: string;
    macos: string;
    linux: string;
    deb: string;
    rpm: string;
    appimage: string;
    flatpak: string;
    snap: string;
    targz: string;
  };
  featuresTitle: string;
  features: Feature[];
  platformsTitle: string;
  platformsSubtitle: string;
  screenshotsTitle: string;
  faqTitle: string;
  faq: FaqItem[];
  footer: { license: string; madeBy: string; rights: string; version: string; source: string };
}

export const ui: Record<"ar" | "en", UiDict> = {
  ar: {
    metaTitle: "WhatsApp Sticker Bot — حوّل صورك وفيديوهاتك إلى ملصقات واتساب",
    metaDescription:
      "مدير سطح مكتب لبوت ملصقات واتساب: تحويل تلقائي للصور والفيديو إلى ملصقات WebP، طابور دائم، حصص، استرداد من الأعطال، ولوحة تحكم. مجاني ومفتوح المصدر برخصة MIT.",
    nav: { download: "تحميل", features: "المميزات", screenshots: "لقطات", faq: "الأسئلة", github: "GitHub" },
    hero: {
      badge: "مجاني ومفتوح المصدر",
      title: "WhatsApp Sticker Bot",
      subtitle:
        "حوّل صورك وفيديوهاتك إلى ملصقات واتساب بلمسة، مع مدير سطح مكتب يدير الطابور والحصص والاسترداد محلياً وبدون تعقيد.",
      cta: "تحميل مجاني",
      allPlatforms: "كل المنصات",
      secondary: "عرض على GitHub",
    },
    download: {
      title: "حمّل للمنصة المناسبة",
      subtitle: "يُكتشف نظامك تلقائياً ويُبرز الزر المناسب لك.",
      btn: "تحميل",
      size: "الحجم",
      soon: "قريباً",
      windows: "ويندوز",
      macos: "ماك",
      linux: "لينكس",
      deb: "Debian / Ubuntu",
      rpm: "Fedora / RHEL",
      appimage: "AppImage",
      flatpak: "Flatpak",
      snap: "Snap",
      targz: "أرشيف Tarball",
    },
    featuresTitle: "مميزات",
    features: [
      { title: "تحويل تلقائي", desc: "حوّل الصور والفيديو والـ GIF إلى ملصقات WebP متحركة أو ثابتة تلقائياً.", icon: "wand" },
      { title: "طابور دائم", desc: "طابور تحميل ومعالجة يتحمّل الانقطاعات ويستأنف بعد الأعطال.", icon: "queue" },
      { title: "حصص يومية", desc: "حدود استهلاك لكل مستخدم ومجموعة مع حماية من الإساءة.", icon: "gauge" },
      { title: "استرداد من الأعطال", desc: "نسخ احتياطي تلقائي واستعادة آمنة لبياناتك وجلستك.", icon: "shield" },
      { title: "لوحة تحكم", desc: "واجهة عربية محلية لإدارة المستخدمين والرسائل والإعدادات.", icon: "layout" },
      { title: "نسخ احتياطي مشفّر", desc: "صدّر قاعدة البيانات والإعدادات والجلسة مع تشفير اختياري.", icon: "lock" },
      { title: "أوضاع المجموعات", desc: "تحكم كامل: إيقاف، إشارة فقط، أمر فقط، أو تلقائي.", icon: "users" },
      { title: "عربي وإنجليزي", desc: "دعم كامل للاتجاه RTL واللغة العربية في الواجهة.", icon: "globe" },
    ],
    platformsTitle: "يدعم كل المنصات",
    platformsSubtitle: "نفس التطبيق على ويندوز وماك ولينكس، بحزم رسمية لكل مدير.",
    screenshotsTitle: "لقطات من التطبيق",
    faqTitle: "الأسئلة الشائعة",
    faq: [
      { q: "هل التطبيق مجاني؟", a: "نعم، مجاني تماماً ومفتوح المصدر برخصة MIT." },
      { q: "هل يحتاج اتصالاً بالإنترنت؟", a: "نعم، البوت يعمل عبر واتساب ويب فيحتاج إنترنت، لكن بياناتك تبقى محلية على جهازك." },
      { q: "هل بياناتي خاصة؟", a: "نعم، كل المعالجة محلية؛ لا تُرفع صورك أو جلستك إلى أي خادم خارجي." },
      { q: "ما الفرق بين الأوضاع؟", a: "إيقاف (لا يرد)، إشارة فقط (عند الإشارة)، أمر فقط (برسالة أمر)، تلقائي (يحوّل كل صورة).", },
      { q: "كيف أحدّث التطبيق؟", a: "حمّل أحدث إصدار من صفحة الإصدارات؛ إعداداتك وبياناتك تبقى محفوظة." },
    ],
    footer: { license: "رخصة MIT", madeBy: "صُنع بواسطة", rights: "كل الحقوق محفوظة", version: "الإصدار", source: "المصدر" },
  },
  en: {
    metaTitle: "WhatsApp Sticker Bot — Turn images & videos into WhatsApp stickers",
    metaDescription:
      "A desktop manager for a WhatsApp sticker bot: automatic image/video to WebP stickers, a persistent queue, quotas, crash recovery and a dashboard. Free and open source under the MIT license.",
    nav: { download: "Download", features: "Features", screenshots: "Screenshots", faq: "FAQ", github: "GitHub" },
    hero: {
      badge: "Free & open source",
      title: "WhatsApp Sticker Bot",
      subtitle:
        "Turn your images and videos into WhatsApp stickers in a click, with a desktop manager that handles the queue, quotas and recovery locally.",
      cta: "Download free",
      allPlatforms: "All platforms",
      secondary: "View on GitHub",
    },
    download: {
      title: "Download for your platform",
      subtitle: "Your OS is detected automatically and the right button is highlighted.",
      btn: "Download",
      size: "Size",
      soon: "Soon",
      windows: "Windows",
      macos: "macOS",
      linux: "Linux",
      deb: "Debian / Ubuntu",
      rpm: "Fedora / RHEL",
      appimage: "AppImage",
      flatpak: "Flatpak",
      snap: "Snap",
      targz: "Tarball",
    },
    featuresTitle: "Features",
    features: [
      { title: "Automatic conversion", desc: "Convert images, video and GIF into static or animated WebP stickers automatically.", icon: "wand" },
      { title: "Persistent queue", desc: "A download and processing queue that survives interruptions and resumes after crashes.", icon: "queue" },
      { title: "Daily quotas", desc: "Per-user and per-group usage limits with abuse protection.", icon: "gauge" },
      { title: "Crash recovery", desc: "Automatic backups and safe restore of your data and session.", icon: "shield" },
      { title: "Dashboard", desc: "A local Arabic-first UI to manage users, messages and settings.", icon: "layout" },
      { title: "Encrypted backup", desc: "Export the database, settings and session with optional encryption.", icon: "lock" },
      { title: "Group modes", desc: "Full control: off, mention-only, command-only, or automatic.", icon: "users" },
      { title: "Arabic & English", desc: "Full RTL support and Arabic language in the interface.", icon: "globe" },
    ],
    platformsTitle: "Every platform supported",
    platformsSubtitle: "The same app on Windows, macOS and Linux, with official packages for each.",
    screenshotsTitle: "App screenshots",
    faqTitle: "Frequently asked questions",
    faq: [
      { q: "Is the app free?", a: "Yes, completely free and open source under the MIT license." },
      { q: "Does it need internet?", a: "Yes, the bot runs over WhatsApp Web so it needs internet, but your data stays local on your machine." },
      { q: "Is my data private?", a: "Yes, all processing is local; your images and session are never uploaded to any external server." },
      { q: "What are the modes?", a: "Off (no reply), mention-only, command-only, or automatic (converts every image)." },
      { q: "How do I update?", a: "Download the latest release from the releases page; your settings and data are preserved." },
    ],
    footer: { license: "MIT License", madeBy: "Made by", rights: "All rights reserved", version: "Version", source: "Source" },
  },
};

export function t(lang: "ar" | "en"): UiDict {
  return ui[lang] ?? ui.ar;
}
