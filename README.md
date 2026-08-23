# WhatsApp Sticker Bot

<p align="center">
  <img src="build/icon.png" alt="WhatsApp Sticker Bot" width="128" />
</p>

<p align="center">
  <a href="https://github.com/rn0x/whatsapp-sticker-bot/releases"><img alt="Release" src="https://img.shields.io/github/v/release/rn0x/whatsapp-sticker-bot?label=release&color=25D366"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/rn0x/whatsapp-sticker-bot?color=25D366"></a>
  <a href="https://github.com/rn0x/whatsapp-sticker-bot/releases"><img alt="Platforms" src="https://img.shields.io/badge/platforms-linux%20%7C%20windows%20%7C%20macOS-25D366"></a>
</p>

تطبيق سطح مكتب (Electron) لإدارة **بوت ملصقات WhatsApp** يعمل محلياً على جهازك. يحوّل الصور إلى ملصقات (WebP 512×512) والفيديوهات/GIF إلى ملصقات متحركة تلقائياً، مع نظام طابور دائم، حصص يومية، ولوحة تحكم عربية كاملة.

> الوثائق التفصيلية في مجلد [docs](./docs).

---

## ✨ المميزات

- **طابور دائم في SQLite** — كل مهمة (Job) مسجّلة في قاعدة البيانات، لا أثر في الذاكرة.
- **استئناف كامل بعد الانهيار** — Lease + Heartbeat + مسح المهام العالقة عند الإقلاع.
- **حصص Rolling 24h** — حجز/استهلاك/تحرير بمعاملات ذرّية (دون تجاوز عند الضغط).
- **تقييد المعدل (Rate Limiting)** متعدد المستويات: مستخدم / مجموعة / عام.
- **جدولة عادلة (Fair Scheduling)** — لا يسمح لمستخدم واحد باحتكار المعالجات.
- **كشف التكرار** عبر كاش SHA-256.
- **أوضاع المجموعات** — `OFF` / `MENTION_ONLY` / `COMMAND_ONLY` / `AUTO`.
- **لوحة تحكم كاملة** (عربية RTL): Dashboard, Queue, Users, Groups, Statistics, Logs, WhatsApp, Settings, Backups.
- **نسخ احتياطي واستعادة** مع خيار تشفير جلسة البوت.
- **تسجيل دخول** عبر QR أو Pairing Code.
- **JavaScript فقط (ES Modules .mjs)** — بلا TypeScript.

---

## 📋 المتطلبات

- **Node.js ≥ 22** (للتطوير والبناء).
- نظام تشغيل: **Linux** x64 / **Windows** x64 (macOS مدعوم عبر السكربتات).
- رقم هاتف على **WhatsApp** لتسجيل الدخول.
- لا حاجة لتثبيت `ffmpeg` على النظام — يُرفق تلقائياً عبر `ffmpeg-static`.

---

## 📦 التثبيت من المصدر

```bash
git clone https://github.com/rn0x/whatsapp-sticker-bot.git
cd whatsapp-sticker-bot
npm install
```

لا توجد خطوة إعادة بناء لوحدات أصلية — قاعدة البيانات عبر `node:sqlite` المدمج في Electron.

---

## ▶️ التشغيل والتطوير

```bash
npm run dev        # يفتح نافذة التطبيق + واجهة Vite (HMR)
```

1. اذهب إلى صفحة **WhatsApp** في لوحة التحكم.
2. اختر **QR** أو **Pairing Code** وسجّل الدخول بحسابك مرة واحدة.
3. الجلسة تُحفظ محلياً وتعيد الاتصال تلقائياً بعد كل إعادة تشغيل.

---

## 🛠️ طريقة الاستخدام

### في المحادثة الخاصة
أرسل **صورة** أو **فيديو/ GIF** إلى البوت في الخاص فيتحوّل تلقائياً إلى ملصق ويرجع لك. يمكنك التحكم عبر الأوامر:

| الأمر (عربي/إنجليزي) | الوظيفة |
|---|---|
| `تفعيل` / `on` / `/on` | تشغيل التحويل التلقائي |
| `ايقاف` / `off` / `/off` | إيقاف التحويل التلقائي |
| `صورة` / `image` / `/image` | تبديل تحويل الصور |
| `فيديو` / `video` / `/video` | تبديل تحويل الفيديو |
| `حصتي` / `usage` / `/usage` | عرض حصتك المتبقية |
| `مساعدة` / `help` / `/help` | قائمة الأوامر |
| `اضبط` / `settings` / `/settings` | عرض إعداداتك |
| `اسم <الاسم>` / `/pack` | اسم مجموعة الملصقات |
| `مؤلف <الاسم>` / `/author` | اسم المؤلف الظاهر في الملصقات |

### في المجموعات
يدعم البوت أربعة أوضاع (يُعرض/يُبدَّل بأمر `القروب` أو `/group`):

- **`OFF`** — معطّل كلياً في المجموعة.
- **`MENTION_ONLY`** — يتحول الوسيط فقط إذا ذُكر البوت (`@البوت`).
- **`COMMAND_ONLY`** — يتحول فقط مع أمر صريح (`ستيكر`، `/sticker`…).
- **`AUTO`** — يتحول أي وسيط يُرسل في المجموعة تلقائياً (مستحسن للراحة).

> لتفعيل التحويل في المجموعة بدون إشارة: أرسل `القروب auto`.

### لوحة التحكم
تتضمن صفحات: **Dashboard** (الإحصاءات)، **Queue** (الطابور الحي)، **Users**، **Groups**، **Statistics**، **Logs**، **WhatsApp** (تسجيل الدخول)، **Settings** (كل الإعدادات)، **Backups** (النسخ الاحتياطي).

### النسخ الاحتياطي والاستعادة
صفحة **Backups** → زر Backup لإنشاء `backup-YYYY-MM-DD.zip` (قاعدة البيانات + الإعدادات + الجلسة اختيارياً مشفّرة). الاستعادة تتحقق من السلامة وتعود تلقائياً للحالة السابقة عند أي فشل.

---

## ⚙️ الإعدادات (`.env`)

انسخ `.env.example` إلى `.env` وعدّل القيم (كلها اختيارية ولها افتراضيات):

| المفتاح | الوصف | الافتراضي |
|---|---|---|
| `BOT_NAME` | اسم البوت المعروض | `Sticker Bot` |
| `STICKER_PACK` | اسم مجموعة الملصقات | `Sticker Bot` |
| `STICKER_AUTHOR` | اسم المؤلف | `Sticker Bot` |
| `GROUP_MODE` | وضع المجموعات الافتراضي | `auto` |
| `DEFAULT_DAILY_QUOTA` | الحصة اليومية | `50` |
| `QUOTA_MODE` | نمط الحصة | `rolling_24h` |
| `ADMIN_PASSWORD` | كلمة مرور لوحة التحكم | (تُضبط أول مرة) |

---

## 🏗️ البناء (إنتاج)

بعد `npm install` نفّذ سكربت البناء المناسب لمنصتك:

| السكربت | المخرج | المنصة |
|---|---|---|
| `npm run pack:deb` | `.deb` | Linux (Debian/Ubuntu) |
| `npm run pack:rpm` | `.rpm` | Linux (Fedora/RHEL) |
| `npm run pack:flatpak` | `.flatpak` | Linux |
| `npm run pack:snap` | `.snap` | Linux |
| `npm run pack:appimage` | `.AppImage` | Linux (محمول) |
| `npm run pack:tar` | `.tar.gz` | Linux (أرشيف) |
| `npm run pack:win` | `.exe` (NSIS) | Windows |
| `npm run pack:win:portable` | `.exe` محمول | Windows |
| `npm run pack:mac` | `.dmg` | macOS |

المخرجات في مجلد **`release/`**. السكربتات تعتمد على `npm run build` الذي يبني واجهة العرض (Vite).

> **ملاحظة:** حزمتا `flatpak` و`snap` تُبنى ضمن بيئة معزولة (sandbox)؛ قد تحتاج صلاحيات إضافية بسبب متصفح Chromium المدمج. الحزم الأكثر موثوقية هي `AppImage` و`deb` و`rpm`.

---

## 📥 التنزيل من صفحة الإصدارات

كل الإصدارات الرسمية تُنشر تلقائياً في **GitHub Releases** عند وسم إصدار (مثل `v1.0.0`):

👉 **https://github.com/rn0x/whatsapp-sticker-bot/releases**

تتوفر هناك حزم `deb` و`rpm` و`AppImage` و`flatpak` و`snap` و`tar.gz`، إضافة إلى مثبّت Windows.

---

## 📁 هيكل المشروع (مختصر)

```
src/
  main/         # نقطة دخول Electron + IPC + النوافذ
  bot/          # منطق البوت (BotManager، المعالجات، التقييد)
  whatsapp/     # محوّل wwebjs + متصفح Chromium
  media/        # محرك الوسائط (ffmpeg/sharp) والتحقق
  queue/        # خدمة الطابور ومجمّع المعالجات
  core/         # قاعدة البيانات والمستودعات والهجرات
  renderer/     # واجهة React (لوحة التحكم)
build/          # الأيقونات وموارد البناء
docs/           # الوثائق التفصيلية
scripts/        # أدوات (توليد الأيقونات، postinstall، إعداد المتصفح)
```

---

## 🤝 المساهمة

الإصدارات تُبنى عبر GitHub Actions عند كل وسم (`v*`). للتطوير المحلي اتبع خطوات "التثبيت من المصدر" و"التشغيل والتطوير"، وأرسل Pull Request بفرع واضح.

---

## ⚖️ الترخيص

هذا المشروع مرخّص تحت **MIT** — انظر ملف [LICENSE](./LICENSE).

---

## ⚠️ تنبيه قانوني

يعتمد البوت على مكتبة واتساب ويب غير رسمية، وهي لا تتوافق مع شروط خدمة WhatsApp. الاستخدام الكثيف قد يؤدي إلى **حظر الرقم/الحساب**. للاستخدام الرسمي والجماعي استخدم **WhatsApp Business Cloud API**. استخدم هذا التطبيق على مسؤوليتك الخاصة.
