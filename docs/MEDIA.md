# MEDIA — Media Engine وقطع الرسائل

## النطاق

- **الصور** (JPEG/PNG/WebP/BMP/GIF صورة مفردة) → Sticker WebP 512×512.
- **الفيديو / GIF** → Animated WebP 512×512، FPS محدود، مدة محدودة.

خصيصاً للبوت: لا وظائف أخرى (لا YouTube، لا ألعاب، لا AI).

## حدود (قابلة للضبط في Settings/Media — قيم متحفظة نظراً لأن حدود WhatsApp غير موثقة رسمياً)

- `MAX_IMAGE_BYTES` — افتراضياً 20MB.
- `MAX_VIDEO_BYTES` — 64MB.
- `MAX_VIDEO_DURATION_SECONDS` — 30s (نقوم بقصها للتأكيد ~10s).
- `STICKER_MAX_FPS` — 30 (بعض الهواتف تقبل أكثر، نتحفظ).
- `STICKER_QUALITY` — 90.
- الناتج: `512×512` وWebP (ثابت ≤ ~100KB، متحرك ≤ ~500KB) — التطبيق يضغط تلقائياً ضمن حدود آمنة.

## Image Processor (sharp)

```
sharp(input)
  .rotate()                              # احترام EXIF
  .resize(512, 512, { fit: "contain" })  # حفاظ على النسبة + حشو شفاف، لا قص
  .webp({ quality: STICKER_QUALITY, lossless: false })
  → output (.webp)
```

## Video / GIF Processor (ffmpeg)

```
ffmpeg -i input -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:...,fps=..."
```

الإعداد العملي:

```
scale=512:512:force_original_aspect_ratio=decrease  # حفاظ على النسبة، لا تمديد
pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000    # حشو شفاف حول المحتوى
fps=STICKER_MAX_FPS
trim للإطارات ≤ المدة المسموحة
-loop 0 ... ترميز:
  -c:v libwebp -lossless 0 -compression_level 6 -q:v 90 -preset default -loop 0 -an
نبذة: output.webp (متحرك)
```

`ffmpeg` عبر `ffmpeg-static` (يُرَقَّى في `extraResources`) مع fallback لأي `ffmpeg` في PATH.

## واجهة MediaEngine

```js
convert({ type, inputPath, outputDir, limits }) →
  { outputPath, kind: 'image'|'animated', durationMs }
```

لا معرفة بـ WhatsApp أو Queue. المستدعي (Worker) يفتقر إليها.

## Validation خط الدفاع الأول

قبل إنشاء Job:
- MIME (فحص سحري للمحتوى، لا الامتداد فقط)،
- حجم ملف،
- مدة الفيديو (ffprobe)،
- نوع الرسالة (image/video/document).

غير صالح → إجابة قصيرة ("الملف غير مدعوم…") وعدم إنشاء Job.

## ملاحظة أمان

لا تعديل أو تنفيذ خارج الوسائط. الفحص السحري يمنع تمرير ملفات غير وسائط. الحجم والمدة محدودان لحماية القرص والـ CPU.