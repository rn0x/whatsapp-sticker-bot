// نصوص البوت بكلتا اللغتين. الهيكل متطابق بين BOT_AR و BOT_EN.
// Arabic source is the default; English mirrors it. Functions/arrays keep the
// same shape so the humanizer can pick by language at runtime.

export const BOT_AR = {
  welcome: (name) => [
    "مرحباً" + (name ? ` ${name}` : "") + "، أنا بوت صناعة الملصقات.\nما أستطيع تقديمه:\n- تحويل الصور إلى ملصقات جاهزة للتثبيت.\n- تحويل الفيديوهات وملفات GIF إلى ملصقات متحركة.\n\nطريقة الاستخدام:\n- في المحادثة الخاصة: أرسل الصورة أو الفيديو مباشرة وسأحوّله لك.\n- في المجموعات: اذكر البوت بإشارة (@) في رسالة الوسائط.\n\nأوامر مفيدة:\n- /help أو «مساعدة»: شرح مختصر للاستخدام.\n- /usage أو «حصتي»: معرفة حصتك المتبقية اليوم.\n- /اضبط أو «حقوقي»: تعديل إعداداتك الشخصية.\n\nلا أطلب أي بيانات إضافية، فقط أرسل الوسائط وسأقوم بالتحويل.",
    "أهلاً" + (name ? ` ${name}` : "") + "، سعيد بانضمامك.\nهذا البوت يحوّل الصور والفيديوهات وملفات GIF إلى ملصقات واتساب.\n\nكيف تستخدمه:\n- أرسل لي صورة أو فيديو في الخاص وسأعيده ملصقاً جاهزاً.\n- داخل المجموعات، أشِر إليّ (@) مع إرفاق الوسائط.\n\nالأوامر:\n- /help: ملخص سريع.\n- /usage: حصتك المتبقية.\n\nأرسل وسائطك وسأتكفل بالباقي.",
    "مرحباً بك. أنا بوت مخصص لتحويل الوسائط إلى ملصقات.\nالأسهل من ذلك:\n- الصور تتحول لملصقات ثابتة.\n- الفيديوهات القصيرة وملفات GIF تتحول لملصقات متحركة.\n- في المجموعات أستخدم إشارة @ للإشارة إليّ مع إرفاق الملف.\n\nالأوامر المتاحة: /help للشرح، و/usage لحصتك المتبقية.",
  ],
  help: (remaining, inGroup = false) => {
    const groupNote = inGroup
      ? "\n\nداخل المجموعة: البوت يعمل بحسب وضع المجموعة (تلقائي، أو بالإشارة، أو بالأمر فقط). الأوامر متاحة أيضاً: /usage لحصتك، و/اضبط لإعداداتك الشخصية."
      : "\n\nداخل المجموعات: اذكرني بالإشارة (@) أو اكتب «ستيكر» مع إرفاق الوسائط وسأحوّلها حسب وضع المجموعة.\nالأوامر: /usage لحصتك · /اضبط لإعداداتك الشخصية.";
    return [
      `أنا بوت تحويل الوسائط إلى ملصقات.\n\nكيفية الاستخدام:\n- الخاص: أرسل صورة أو فيديو أو GIF مباشرة.\n- المجموعات: اذكرني بالإشارة (@) مع إرفاق الوسائط.\n\nما يقبل به البوت:\n- صور: JPG, PNG, WEBP, GIF.\n- فيديو قصير حتى 30 ثانية.\n\nالأوامر:\n- /usage أو «حصتي»: حصتك المتبقية اليوم.\n- /اضبط أو «حقوقي»: إعدادات حسابك الشخصية.\n- /اسم <الاسم> · /مؤلف <الاسم>: تخصيص اسم مجموعة الملصقات والعنوان الظاهر.\nحالتك الآن: ${remaining === Infinity ? "حصتك غير محدودة" : `لديك ${remaining} حصة متبقية`}.${groupNote}`,
      `الأمر بسيط: وسائط في الداخل، ملصق في الخارج.\n\nأرسل صورة أو فيديو وسأحوّله إلى ملصق:\n- في الخاص: الإرسال المباشر كافٍ.\n- في المجموعات: ضع @ بجانب الملف، أو كلمة «ستيكر».\n- الصور لا تتجاوز 20 ميغابايت، والفيديو لا يتجاوز 64 ميغابايت و30 ثانية.\n\nالأوامر المتاحة:\n- /help: الشرح الحالي.\n- /usage: الحصة المتبقية.\n- /اضبط: إعداداتك الشخصية (تشغيل/إيقاف تحويل من يجيب).\n- /اسم و/مؤلف: تخصيص اسم مجموعة الملصقات والمؤلف.\nحالتك الآن: ${remaining === Infinity ? "غير محدودة" : `لديك ${remaining} حصة متبقية`}.${groupNote}`,
    ];
  },
  ackImage: [
    "حاضر، جارٍ تجهيز الملصق...",
    "وصلت الصورة، أعمل عليها الآن.",
    "تم الاستلام، لحظات وسأسلمك الملصق.",
  ],
  ackVideo: [
    "استلمت الفيديو، جارٍ تحويله إلى ملصق متحرك...",
    "الفيديو وصل، أعمل على تحويله حالاً.",
    "بصدد تجهيز الملصق المتحرك، انتظر قليلاً.",
  ],
  done: [
    "جاهز! هذا هو الملصق.",
    "تم إنشاء الملصق بنجاح.",
    "وصلني، وهذا هو الملصق النهائي.",
  ],
  quotaExhausted: [
    "وصلت للحد اليومي. تعود الحصة بعد 24 ساعة، حاول غداً.",
    "انتهت حصتك اليومية. تتجدد تلقائياً بعد يوم.",
  ],
  maxPending: [
    "لديك بعض المهام قيد المعالجة، انتظر حتى تنتهي ثم أرسل من جديد.",
    "أنا منهمك على طلباتك السابقة، أعطيني دقيقة.",
  ],
  paused: [
    "النظام متوقف مؤقتاً، حاول لاحقاً.",
  ],
  queueFull: [
    "النظام مزدحم حالياً، أعد المحاولة بعد قليل.",
  ],
  rateLimited: [
    "تمهّل قليلاً، لا أستطيع استقبال المزيد الآن.",
  ],
  invalid: {
    unsupported_file: "عذراً، هذا النوع غير مدعوم. أرسل صورة أو فيديو أو GIF.",
    image_too_large: "الصورة كبيرة جداً، يفضل أقل من 20 ميغابايت.",
    video_too_large: "الفيديو كبير جداً، يفضل أقل من 64 ميغابايت.",
    video_too_long: "مدة الفيديو تتجاوز الحد المسموح، أرسل مقطعاً أقصر.",
    unreadable_video: "تعذر قراءة الفيديو. جرب صيغة أخرى إن أمكن.",
    animated_sticker_too_large: "الملصق المتحرك كبير جداً. أرسل فيديو أقصر أو أقل تفاصيل.",
  },
  usage: (remaining) => [
    `حصتك اليوم: ${remaining === Infinity ? "غير محدودة" : `لديك ${remaining} حصة متبقية`}.`,
    `المتبقي لك اليوم: ${remaining === Infinity ? "بلا حدود" : `${remaining} حصة`}.`,
  ],
  settingsShown: (prefs) => {
    const s = (v) => (v === false || v === 0 ? "معطّل" : "مفعل");
    return [
      `إعداداتك الشخصية عندي:\n- التحويل التلقائي: ${s(prefs?.autoConvert)}.\n- تحويل الصور: ${s(prefs?.allowImage)}.\n- تحويل الفيديو: ${s(prefs?.allowVideo)}.\n- اسم مجموعة الملصقات: ${prefs?.packName || "افتراضي"}.\n- اسم المؤلف: ${prefs?.packAuthor || "افتراضي"}.\n\nلتغيّرها بالأوامر:\n- /on → تشغيل التحويل التلقائي\n- /off → إيقافه\n- /image → تبديل الصور\n- /video → تبديل الفيديو\n- /اسم <الاسم> → اسم مجموعة الملصقات\n- /مؤلف <الاسم> → اسم المؤلف\n- /usage → حصتك المتبقية`,
      `بطاقة حقوقك:\n- تحويل تلقائي: ${s(prefs?.autoConvert)}.\n- صورة: ${s(prefs?.allowImage)}.\n- فيديو: ${s(prefs?.allowVideo)}.\n- باك الملصقات: ${prefs?.packName || "افتراضي"}.\n- المؤلف: ${prefs?.packAuthor || "افتراضي"}.\n\nعدّلها بسهولة:\n/on أو /off للتحويل التلقائي، /image للصور، /video للفيديو، /اسم للاسم، /مؤلف للمؤلف.`,
    ];
  },
  autoOn: [
    "تمام، فعّلت لك التحويل التلقائي: أي صورة أو فيديو ترسله سيُحوَّل لملصق فوراً.",
    "مفعل، الآن أستقبل وسائطك وتحوّل تلقائياً.",
  ],
  autoOff: [
    "حسناً، أوقفت التحويل التلقائي. لن أحوّل إلا بأمر صريح (أرسل /on عند الحاجة).",
    "تم. لن يحوّل البوت ملفاتك تلقائياً بعد الآن؛ لأعيده أرسل /on.",
  ],
  autoOffReply: [
    "التحويل التلقائي عندك متوقف حالياً، أرسل /on لتفعيله إن أردت التحويل.",
  ],
  imageOn: [
    "فعّلت تحويل الصور لك.",
    "حاضر، الصور تُحوّل لك الآن.",
  ],
  imageOff: [
    "أوقفت تحويل الصور، لن أتعامل مع الصور حتى تعيدها بأمر /image.",
    "تم. تحويل الصور متوقف عندك.",
  ],
  imageOffReply: [
    "تحويل الصور متوقف في حسابك، أرسل /image لتفعيله.",
  ],
  videoOn: [
    "فعّلت تحويل الفيديو لك.",
    "تمام، الفيديوهات انحول الآن في حسابك.",
  ],
  videoOff: [
    "أوقفت تحويل الفيديو، لن أتعامل مع الفيديو حتى تعيده بأمر /video.",
    "تم. تحويل الفيديو متوقف عندك.",
  ],
  videoOffReply: [
    "تحويل الفيديو متوقف في حسابك، أرسل /video لتفعيله.",
  ],
  groupWelcome: (isAdmin, mode) => [
    `مرحباً بكم! أنا بوت تحويل الوسائط إلى ملصقات.\n\nطريقة العمل في هذه المجموعة:\n- أرسل صورة أو فيديو وسأحوّله لملصق جاهز.\n- وضع المجموعة الحالي: ${modeLabel(mode)}.\n\nأوامر مفيدة:\n- /help: شرح كامل.\n- /usage: حصتك المتبقية.\n- /اضبط: إعداداتك الشخصية.\n\n${isAdmin ? "ممتاز، أنا مشرف في المجموعة، سأعمل بسلاسة." : "ملاحظة: البوت ليس مشرفاً هنا؛ التحويل يعمل كالمعتاد، وإن لمست تنظيماً قد تحتاج صلاحيات إضافية."}`,
  ],
  groupExplain: [
    "أوضاع المجموعة (من صفحة المجموعات في التطبيق):\n- تلقائي: يحوّل كل صورة/فيديو يُرسَل في المجموعة.\n- بالإشارة فقط: يحوّل فقط ما يذكر البوت (@) أو يكتب @اسمه نصاً.\n- بالأمر فقط: يحوّل فقط ما ترفقه بكلمة محفّزة (ستيكر/ملصق/...) أو يشير للبوت.\n- معطلة: لا يعمل نهائياً.\n\nيمكنك أيضاً استدعاء الأوامر في أي وضع: /usage، /اضبط، /فيديو، /صورة، /on، /off.",
    "أنماط المجموعة الثلاثة:\n1) تلقائي — كل شيء يتحول.\n2) بالإشارة فقط — يشترط @اسم البوت مع الوسيط.\n3) بالأمر فقط — يشترط كلمة «ستيكر/ملصق» أو إشارة.\nأرسل /وضع هنا لمعرفة وضع هذه المجموعة الآن.",
  ],
  groupModeNow: (mode, enabled) => [
    `وضع هذه المجموعة: ${enabled === false || enabled === 0 ? "معطلة" : modeLabel(mode)}.\nلاستيضاح الأنماط أرسل /grouphelp أو اكتب «طريقة القروب».`,
  ],
  groupNeedMedia: [
    "أنا هنا لتحويل الوسائط إلى ملصقات، أرفق صورة أو فيديو مع رسالتك وسأحوّله.",
    "أرسل الوسيط مع الرسالة (صورة أو فيديو) وسأحوّله فوراً إلى ملصق.",
  ],
  packShown: (pack) => [
    `اسم مجموعة ملصقاتك حالياً: ${pack || "غير محدد (يُستخدم الافتراضي)"}.\nلتغيّره أرسل: /اسم <الاسم>`,
    `عنوان الـ باك عندك الآن: ${pack || "افتراضي"}.\nأرسل «اسم <الاسم>» لوضع اسم جديد.`,
  ],
  packSet: (pack) => [
    `حسناً، أصبح اسم مجموعة ملصقاتك: ${pack}.`,
    `تم حفظ الاسم: ${pack}.`,
  ],
  packReset: [
    "أعدت اسم الملصقات إلى الافتراضي.",
    "تم. سيظهر الآن الاسم الافتراضي في ملصقاتك.",
  ],
  packTooLong: ["الاسم طويل جداً، يفضل أقل من 64 حرفاً.", "الاسم تجاوز الحد المسموح (64 حرفاً)."],
  authorShown: (author) => [
    `اسم المؤلف في ملصقاتك حالياً: ${author || "غير محدد (يُستخدم الافتراضي)"}.\nلتغيّره أرسل: /مؤلف <الاسم>`,
    `المؤلف الظاهر عندك الآن: ${author || "افتراضي"}.\nأرسل «مؤلف <الاسم>» لوضع اسم جديد.`,
  ],
  authorSet: (author) => [
    `حسناً، أصبح اسم المؤلف: ${author}.`,
    `تم حفظ المؤلف: ${author}.`,
  ],
  authorReset: [
    "أعدت اسم المؤلف إلى الافتراضي.",
    "تم. سيظهر المؤلف الافتراضي في ملصقاتك.",
  ],
  authorTooLong: ["اسم المؤلف طويل جداً، يفضل أقل من 64 حرفاً.", "اسم المؤلف تجاوز الحد المسموح (64 حرفاً)."],
};

export const BOT_EN = {
  welcome: (name) => [
    "Hello" + (name ? ` ${name}` : "") + ", I'm the sticker-making bot.\nWhat I can do:\n- Turn images into ready-to-install stickers.\n- Turn videos and GIFs into animated stickers.\n\nHow to use:\n- In a private chat: just send the image or video and I'll convert it.\n- In groups: mention me with @ in a media message.\n\nUseful commands:\n- /help or \"help\": a short usage guide.\n- /usage or \"my quota\": see your remaining daily quota.\n- /settings or \"my rights\": change your personal settings.\n\nI ask for no extra details — just send the media and I'll convert it.",
    "Welcome" + (name ? ` ${name}` : "") + ", glad to have you.\nThis bot converts images, videos and GIFs into WhatsApp stickers.\n\nHow to use it:\n- Send me an image or video in private and I'll return a sticker.\n- Inside groups, mention me (@) with the attached media.\n\nCommands:\n- /help: quick summary.\n- /usage: your remaining quota.\n\nSend your media and I'll handle the rest.",
    "Welcome. I'm a bot dedicated to converting media into stickers.\nThe easy part:\n- Images become static stickers.\n- Short videos and GIFs become animated stickers.\n- In groups, mention me with @ along with the file.\n\nAvailable commands: /help for the guide, and /usage for your remaining quota.",
  ],
  help: (remaining, inGroup = false) => {
    const groupNote = inGroup
      ? "\n\nInside a group: the bot follows the group mode (auto, mention-only, or command-only). Commands also work: /usage for your quota, and /settings for your personal settings."
      : "\n\nInside groups: mention me with @ or write \"sticker\" with the attached media and I'll convert it per the group mode.\nCommands: /usage for your quota · /settings for your personal settings.";
    return [
      `I'm a bot that converts media into stickers.\n\nHow to use:\n- Private: send an image, video or GIF directly.\n- Groups: mention me with @ and attach the media.\n\nWhat the bot accepts:\n- Images: JPG, PNG, WEBP, GIF.\n- Short video up to 30 seconds.\n\nCommands:\n- /usage or \"my quota\": your remaining daily quota.\n- /settings or \"my rights\": your personal account settings.\n- /name <name> · /author <name>: customize the sticker pack name and displayed title.\nYour status now: ${remaining === Infinity ? "your quota is unlimited" : `you have ${remaining} quota remaining`}.${groupNote}`,
      `It's simple: media in, sticker out.\n\nSend an image or video and I'll convert it to a sticker:\n- Private: direct sending is enough.\n- Groups: put @ next to the file, or the word \"sticker\".\n- Images under 20 MB, video under 64 MB and 30 seconds.\n\nAvailable commands:\n- /help: current explanation.\n- /usage: remaining quota.\n- /settings: your personal settings (toggle auto-convert from replies).\n- /name and /author: customize the pack name and author.\nYour status now: ${remaining === Infinity ? "unlimited" : `you have ${remaining} quota remaining`}.${groupNote}`,
    ];
  },
  ackImage: [
    "On it, preparing your sticker...",
    "Got the image, working on it now.",
    "Received, your sticker will be ready in a moment.",
  ],
  ackVideo: [
    "Received the video, converting it to an animated sticker...",
    "Video arrived, converting it right away.",
    "Getting the animated sticker ready, give it a moment.",
  ],
  done: [
    "Done! Here is your sticker.",
    "Sticker created successfully.",
    "Received, and here is the final sticker.",
  ],
  quotaExhausted: [
    "You've hit the daily limit. The quota returns after 24 hours, try again tomorrow.",
    "Your daily quota is used up. It renews automatically after a day.",
  ],
  maxPending: [
    "You have some jobs in progress, wait for them to finish then send again.",
    "I'm busy with your earlier requests, give me a minute.",
  ],
  paused: [
    "The system is paused for now, try again later.",
  ],
  queueFull: [
    "The system is busy right now, please try again shortly.",
  ],
  rateLimited: [
    "Take it easy, I can't accept more right now.",
  ],
  invalid: {
    unsupported_file: "Sorry, this type isn't supported. Send an image, video or GIF.",
    image_too_large: "The image is too large, preferably under 20 MB.",
    video_too_large: "The video is too large, preferably under 64 MB.",
    video_too_long: "The video exceeds the allowed length, send a shorter clip.",
    unreadable_video: "Couldn't read the video. Try another format if possible.",
    animated_sticker_too_large: "The animated sticker is too large. Send a shorter or less detailed video.",
  },
  usage: (remaining) => [
    `Your quota today: ${remaining === Infinity ? "unlimited" : `you have ${remaining} quota remaining`}.`,
    `Remaining for you today: ${remaining === Infinity ? "unlimited" : `${remaining} quota`}.`,
  ],
  settingsShown: (prefs) => {
    const s = (v) => (v === false || v === 0 ? "disabled" : "enabled");
    return [
      `Your personal settings with me:\n- Auto-convert: ${s(prefs?.autoConvert)}.\n- Image conversion: ${s(prefs?.allowImage)}.\n- Video conversion: ${s(prefs?.allowVideo)}.\n- Sticker pack name: ${prefs?.packName || "default"}.\n- Author name: ${prefs?.packAuthor || "default"}.\n\nTo change them with commands:\n- /on → enable auto-convert\n- /off → disable it\n- /image → toggle images\n- /video → toggle videos\n- /name <name> → sticker pack name\n- /author <name> → author name\n- /usage → your remaining quota`,
      `Your rights card:\n- Auto-convert: ${s(prefs?.autoConvert)}.\n- Image: ${s(prefs?.allowImage)}.\n- Video: ${s(prefs?.allowVideo)}.\n- Sticker pack: ${prefs?.packName || "default"}.\n- Author: ${prefs?.packAuthor || "default"}.\n\nEdit easily:\n/on or /off for auto-convert, /image for images, /video for videos, /name for the name, /author for the author.`,
    ];
  },
  autoOn: [
    "Great, I enabled auto-convert for you: any image or video you send will be converted to a sticker immediately.",
    "Enabled, I now receive your media and convert it automatically.",
  ],
  autoOff: [
    "OK, I disabled auto-convert. I'll only convert on an explicit command (send /on when needed).",
    "Done. The bot won't auto-convert your files anymore; send /on to bring it back.",
  ],
  autoOffReply: [
    "Auto-convert is currently off for you, send /on to enable it if you want conversion.",
  ],
  imageOn: [
    "Enabled image conversion for you.",
    "Sure, images are now converted for you.",
  ],
  imageOff: [
    "Disabled image conversion, I won't handle images until you turn it back with /image.",
    "Done. Image conversion is off for you.",
  ],
  imageOffReply: [
    "Image conversion is off on your account, send /image to enable it.",
  ],
  videoOn: [
    "Enabled video conversion for you.",
    "Sure, videos are now converted on your account.",
  ],
  videoOff: [
    "Disabled video conversion, I won't handle video until you turn it back with /video.",
    "Done. Video conversion is off for you.",
  ],
  videoOffReply: [
    "Video conversion is off on your account, send /video to enable it.",
  ],
  groupWelcome: (isAdmin, mode) => [
    `Welcome! I'm a bot that converts media into stickers.\n\nHow this group works:\n- Send an image or video and I'll convert it into a ready sticker.\n- Current group mode: ${modeLabel(mode)}.\n\nUseful commands:\n- /help: full explanation.\n- /usage: your remaining quota.\n- /settings: your personal settings.\n\n${isAdmin ? "Great, I'm an admin in this group, I'll work smoothly." : "Note: the bot isn't an admin here; conversion works as usual, but you may need extra permissions if things get organized."}`,
  ],
  groupExplain: [
    "Group modes (from the Groups page in the app):\n- Auto: converts every image/video sent in the group.\n- Mention only: converts only what actually mentions the bot (@) or writes its @name as text.\n- Command only: converts only what you attach with a trigger word (sticker/...) or mention the bot.\n- Disabled: never works.\n\nYou can also call commands in any mode: /usage, /settings, /video, /image, /on, /off.",
    "The three group patterns:\n1) Auto — everything converts.\n2) Mention only — requires @botname with the media.\n3) Command only — requires the word \"sticker\" or a mention.\nSend /mode here to see this group's current mode.",
  ],
  groupModeNow: (mode, enabled) => [
    `This group's mode: ${enabled === false || enabled === 0 ? "disabled" : modeLabel(mode)}.\nFor pattern details send /grouphelp or write \"group method\".`,
  ],
  groupNeedMedia: [
    "I'm here to convert media into stickers, attach an image or video with your message and I'll convert it.",
    "Send the media with the message (image or video) and I'll convert it to a sticker right away.",
  ],
  packShown: (pack) => [
    `Your current sticker pack name: ${pack || "not set (default is used)"}.\nTo change it send: /name <name>`,
    `Your current pack title: ${pack || "default"}.\nSend \"name <name>\" to set a new name.`,
  ],
  packSet: (pack) => [
    `OK, your sticker pack name is now: ${pack}.`,
    `Name saved: ${pack}.`,
  ],
  packReset: [
    "Reset the sticker name to default.",
    "Done. The default name will now appear on your stickers.",
  ],
  packTooLong: ["The name is too long, preferably under 64 characters.", "The name exceeded the limit (64 characters)."],
  authorShown: (author) => [
    `Your current author name on stickers: ${author || "not set (default is used)"}.\nTo change it send: /author <name>`,
    `Your current displayed author: ${author || "default"}.\nSend \"author <name>\" to set a new name.`,
  ],
  authorSet: (author) => [
    `OK, the author name is now: ${author}.`,
    `Author saved: ${author}.`,
  ],
  authorReset: [
    "Reset the author name to default.",
    "Done. The default author will now appear on your stickers.",
  ],
  authorTooLong: ["The author name is too long, preferably under 64 characters.", "The author name exceeded the limit (64 characters)."],
};

// تسمية مقروءة لوضع المجموعة (خاصة بالبوت).
export function modeLabel(mode, lang = "ar") {
  const m = String(mode || "").toUpperCase();
  const ar = { OFF: "معطلة", MENTION_ONLY: "بالإشارة فقط", COMMAND_ONLY: "بالأمر فقط", AUTO: "تلقائي" };
  const en = { OFF: "Disabled", MENTION_ONLY: "Mention only", COMMAND_ONLY: "Command only", AUTO: "Auto" };
  const map = lang === "en" ? en : ar;
  if (m === "OFF" || m === "off") return map.OFF;
  if (m === "MENTION_ONLY") return map.MENTION_ONLY;
  if (m === "COMMAND_ONLY") return map.COMMAND_ONLY;
  if (m === "AUTO") return map.AUTO;
  return map.AUTO;
}
