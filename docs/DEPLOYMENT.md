# DEPLOYMENT

## Development

```bash
npm install          # لا اعتماديات أصلية — node:sqlite مدمج
npm run dev          # Vite + Electron بنافذة واحدة (HMR)
```

## أول استلام رسائل

1. افتح التطبيق → صفحة **WhatsApp**.
2. اختر **QR** وامسح من الهاتف، **أو** **Pairing Code**: أدخل رقم الهاتف (مع رمز الدولة، بلا `+`/مسافات) → يظهر كود 8 رموز → الهاتف: Settings → Linked Devices → Link a device → **Link with phone number instead** → أدخل الكود.
3. الجلسة تُحفظ تلقائياً في `sessions`؛ عند إعادة التشغيل يتصل تلقائياً.

> ملاحظة: `requestPairingCode` يجب استدعاؤه بعد وصول `connection:"connecting"` — التطبيق يدير هذا بنفسه. إصدار Baileys مثبّت (7.0.0-rc14) وهو معروف الجودة.

## Production Build

```bash
npm run build:renderer
npm run dist:linux    # AppImage → release/
npm run dist:win      # NSIS installer → release/
```

- `electron-builder` يضم كل `src/` و`dist-renderer/`.
- قاعدة البيانات عبر `node:sqlite` المدمج — لا اعتماديات أصلية وبناء أبسط (مهم للأنظمة ذات المسافات في مسار المشروع).
- `ffmpeg-static` يُنسخ إلى `resources/ffmpeg` عبر `extraResources`.

### متطلبات التطبيق

- Linux: نظام 64-bit مع GLibC حديث؛ AppImage يعمل على معظم التوزيعات.
- Windows: 64-bit (NSIS).
- ذاكرة: ~150–300MB Baseline (Electron + Baileys + sharp).
- القرص الصلب لعمل FFmpeg أثناء معالجة الفيديو.

### AppData

افتراضياً في `<Electron appData>/whatsapp-sticker-bot`؛ أو اضبط `APP_DATA_DIR` في `.env`.

## البيئة

`postinstall` (إعادة البناء) يحتاج أدوات build (gcc/g++/make/python3). إن لم تتوفر على Windows استخدم:

```bash
npm i -g windows-build-tools   # أو
npm install --build-from-source
```

## النظام التشغيلي

- لا خادم. لا حواجب. التطبيق يعمل محلياً بأذونات المستخدم العادية.
- للتشغيل المتواصل الطويل استخدم النظام نفسه أو cron/سجل النظام لإعادة التشغيل.