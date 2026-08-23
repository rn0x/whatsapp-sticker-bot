// BotManager — يربط WhatsAppAdapter بالـ Queue وMedia وQuota.
// الخصوصية: ردود قصيرة فقط؛ لا يرسل أي Media أو محتوى رسائل.
// السلوك: ردود متنوعة عبر Humanizer (صيغ متناوبة، إشارة كتابة، تأخير إنساني).

import { BOT_TEXTS } from "./humanizer.mjs";

const e = (arr) => arr[0];

export class BotManager {
  constructor({ adapter, queue, quota, users, groups, settings, logger, paths, rateLimiter, cache, mediaEngine, validator, humanizer, messages }) {
    this.adapter = adapter;
    this.queue = queue;
    this.quota = quota;
    this.users = users;
    this.groups = groups;
    this.settings = settings;
    this.logger = logger;
    this.paths = paths;
    this.rateLimiter = rateLimiter;
    this.cache = cache;
    this.mediaEngine = mediaEngine;
    this.validator = validator;
    this.humanizer = humanizer;
    this.messages = messages || null;
    this.botJid = null;
    this.botDigits = null;
    this._started = false;
  }

  start() {
    if (this._started) return;
    this._started = true;
    this.adapter.on("message", (m) => this.handleMessage(m));
    this.adapter.on("status", (s) => this._captureBotIdentity(s));
    this.adapter.on("group-join", (p) => this.handleGroupJoin(p).catch((err) =>
      this.logger.warn("bot", "group join handler failed", { err: err.message, chatId: p?.chatId })
    ));
    // قد نكون بدأنا بعد اكتمال الاتصال (فقدنا حدث CONNECTED) — نقرأ الحالة الحالية.
    const st = this.adapter.getStatus?.();
    if (st) this._captureBotIdentity(st);
    this.logger.info("bot", "BotManager started");
  }

  // يحفظ كل أشكال هوية البوت (رقم الهاتف ومعرّف LID والاسم) لأن إشارات الجروبات
  // قد ترد بصيغة @lid أو @s.whatsapp.net في 2026.
  _captureBotIdentity(s) {
    if (!s) return;
    this.botDigits = new Set();
    this.botNames = new Set();
    if (s.phone) {
      this.botJid = `${String(s.phone).replace(/\D/g, "")}@s.whatsapp.net`;
      this.botDigits.add(String(s.phone).replace(/\D/g, ""));
    }
    if (s.pushname) this.botNames.add(String(s.pushname).trim().toLowerCase());
    const botName = String(this.settings?.get("bot.name") || "").trim().toLowerCase();
    if (botName) this.botNames.add(botName);
    for (const id of [s.wid, s.lid]) {
      if (!id) continue;
      if (typeof id === "object" && (id._serialized || id.$1)) {
        const ser = id._serialized || id.$1;
        this.botDigits.add(String(ser).split("@")[0].replace(/\D/g, ""));
      } else {
        const base = String(id).split("@")[0];
        this.botDigits.add(base.replace(/\D/g, ""));
      }
    }
  }

  // يتعلَّم معرّف البوت «المنتظم» (regular LID) من أول إشارة نُسبت إليه نصياً
  // (اسمه أو رقمه أو كلمة «بوت») — لأن إشارات واتساب الحديثة تصل به ولا يطابق
  // معرّف LID المميز (privileged) الذي يملكه البوت عن نفسه.
  _learnBotMentionIds(msg) {
    if (!msg?.mentions?.length || !this.settings) return;
    const body = (msg.body || "").toLowerCase().trim();
    if (!body) return;
    const phoneDigits = this.botJid ? String(this.botJid).replace(/\D/g, "") : "";
    const named = [...(this.botNames || [])].some((n) => n && body.includes(n));
    const phoneMentioned = phoneDigits && body.includes(phoneDigits);
    const wordBot = /(?:^|[^\p{L}\p{N}_])بوت(?:$|[^\p{L}\p{N}_])/iu.test(body);
    if (!named && !phoneMentioned && !wordBot) return;
    const sender = msg.participantId ? String(serializeJid(msg.participantId) || "").split("@")[0].replace(/\D/g, "") : "";
    for (const j of msg.mentions) {
      const ser = serializeJid(j);
      const digits = ser ? String(ser).split("@")[0].replace(/\D/g, "") : "";
      if (!digits || digits.length < 7) continue;   // أرقام جيدة فقط
      if (sender && digits === sender) continue;     // لا نتعلم صاحب الرسالة
      if (this.botDigits?.has(digits)) continue;     // معروف مسبقاً
      if (!this.botDigits) this.botDigits = new Set();
      this.botDigits.add(digits);
    }
  }

  // هل معرّف ما يخص البوت؟ (بمقارنة الأرقام لتحمّل صيغ @lid/@s.whatsapp.net/@c.us)
  _idMatchesBot(jid) {
    if (!jid || !this.botDigits || this.botDigits.size === 0) return false;
    const ser = serializeJid(jid);
    const digits = String(ser || "").replace(/\D/g, "");
    return !!digits && this.botDigits.has(digits);
  }

  // البوت انضم إلى مجموعة: نسجّل المجموعة، نتحقق إن كان مسؤولاً، ونرسل
  // رسالة التعريف المختصرة مرة واحدة فقط.
  async handleGroupJoin(p) {
    if (!p?.chatId) return;
    const isBotAdded = (p.recipientIds || []).some((id) => this._idMatchesBot(id));
    if (!isBotAdded) return; // عضو عادي دخل — لا نتدخل في تعليق الأعضاء.

    const mode = (this.settings.get("whatsapp.groupMode") || "AUTO").toUpperCase();
    this.groups.ensureSettings(p.chatId, { mode });

    if (this.groups.isBotWelcomed(p.chatId)) return;

    let name = null;
    let isBotAdmin = false;
    try {
      if (typeof this.adapter.getGroupInfo === "function") {
        const info = await this.adapter.getGroupInfo(p.chatId);
        name = info?.name || null;
        isBotAdmin = !!info?.isBotAdmin;
      }
    } catch (err) {
      this.logger.warn("bot", "group info unavailable", { err: err.message, chatId: p.chatId });
    }
    this.groups.upsertGroup(p.chatId, { name });
    this.groups.markBotWelcomed(p.chatId);

    const text = msgFromVariants("groupWelcome", isBotAdmin, mode);
    await this.trySendWithTyping(p.chatId, text, null);
    this.logger.info("bot", "bot joined group + welcomed", { chatId: p.chatId, mode, isBotAdmin });
  }

  async handleMessage(msg) {
    try {
      await this.handleInner(msg);
      this.scheduleSeen(msg);
    } catch (err) {
      this.logger.error("bot", "handle error", { err: err.message, chatId: msg?.chatId });
    }
  }

  // علامة القراءة: تأجيل عشوائي كالإنسان، مقيّد بإعداد markSeenEnabled.
  scheduleSeen(msg) {
    if (!msg?.chatId || msg.fromMe) return;
    if (!this.settings.getBool("humanizer.markSeenEnabled", true)) return;
    if (typeof this.adapter.markAsRead !== "function") return;
    const delay = 500 + Math.random() * 2500;
    setTimeout(() => this.adapter.markAsRead(msg.chatId).catch(() => {}), delay);
  }

  async handleInner(msg) {
    if (msg.fromMe) return;
    const user = await this.ensureUser(msg);
    if (!user) return;
    if (user.status === "BLOCKED") return;

    if (msg.isGroup) return this.handleGroupMessage(msg, user);

    // الخاص
    const isMedia = msg.media && (msg.media.type === "image" || msg.media.type === "video");
    const firstContact = !user.welcomeSent;
    if (!isMedia && !firstContact) {
      this.recordIn(msg, user, msg.chatId);
      return this.handleTextCommand(msg, user);
    }
    if (isMedia) return this.handleMedia(msg, user, null);
    return undefined;
  }

  async ensureUser(msg) {
    const jid = msg.isGroup && msg.participantId ? msg.participantId : msg.chatId;
    const key = normalizeJid(jid);
    const user = this.users.upsertOrGet({
      whatsappId: key,
      phone: key.split("@")[0],
      name: msg.pushName || null,
      pushName: msg.pushName || null,
    });
    if (!user.welcomeSent) {
      await this.sendWelcome(user.whatsappId, msg.chatId, msg.pushName);
      this.users.setWelcomeSent(user.id);
      this.logger.info("bot", `new user onboarded`, { userId: user.id });
    }
    return user;
  }

  async sendWelcome(userWhatsAppId, chatId, pushName) {
    const limit = this.settings.getNumber("quota.defaultDailyQuota", 50);
    const user = this.users.getByWhatsAppId(userWhatsAppId);
    await this.humanDelay(chatId);
    const text = msgFromVariants("welcome", pushName || "", limit);
    await this.trySendWithTyping(chatId, text, user?.id || null);
  }

  // جدول الأوامر: مفتاح داخلي ← مجموعة مرادفات (إنجليزية/عربية/سلاشية).
  // الأوامر متاحة في الخاص وفي المجموعات معاً.
  static COMMANDS = {
    help: ["/help", "help", "مساعدة", "كيف", "الاوامر", "الأوامر", "تعليمات", "استخدام", "/start", "start", "ابدأ", "بدء", "اوامر", "الأمر"],
    usage: ["/usage", "usage", "حصتي", "حصتى", "المتبقي", "متبقي", "حصتك", "حصته", "الكوتا", "بطاقتي"],
    settings: ["/settings", "settings", "اضبط", "اعداداتي", "إعداداتي", "ضبط", "عداداتي", "/setting", "بروفايلي", "حقوقي"],
    enable: ["/on", "on", "تشغيل", "شغل", "تفعيل", "فعل", "فعّل", "فعلني", "تفعيلني", "سمح", "سمحلي", "ارسل لي", "تفضل"],
    disable: ["/off", "off", "ايقاف", "إيقاف", "قف", "قفل", "اغلق", "تعطيل", "تعطيلني", "اوقفني", "أوقفني", "اطفاء", "أطفئ", "بلاش"],
    video: ["/video", "video", "فيديو", "الفيديو", "فيديوهات", "حركة", "الحركة"],
    image: ["/image", "image", "صورة", "الصور", "صوره", "صور", "الصور", "الصورة"],
    group: ["/group", "group", "القروب", "المجموعة", "المجموعات", "طريقة القروب", "وضع القروب"],
    author: ["/author", "author", "مؤلف", "المؤلف", "المؤلفة", "اسم المؤلف", "كاتب", "الناشر"],
    pack: ["/pack", "pack", "/name", "باك", "الباك", "الباقة", "اسم", "/اسم", "اسم الملصقات", "عنوان الملصقات", "اسم الاستيكر", "اسم الباك", "كلمة الباك"],
  };

  // يحوّل نص الرسالة إلى { cmd, rest } إن كان أمراً معروفاً، وإلا null.
  parseCommand(body) {
    if (!body) return null;
    let t = String(body).trim().replace(/\s+/g, " ").replace(/\u200e|\u200f/g, "");
    let lower = t.toLowerCase();
    // إزالة توجيه اسم البوت في بداية السطر: "بوت ..." / "@name ..." / "name ..."
    const botName = String(this.settings?.get("bot.name") || "").trim().toLowerCase();
    for (const prefix of ["يا بوت ", "@" + botName + " ", botName + " ", "البوت ", "بوت ", "@bot "]) {
      if (lower.startsWith(prefix)) {
        t = t.slice(prefix.length).trim();
        lower = t.toLowerCase();
        break;
      }
    }
    const first = lower.split(/\s+/)[0];
    // نقبل الأمر بشرطة أو بدونها سواءً كان إنجليزياً أو عربياً:
    // /اضبط == اضبط، /usage == usage...
    const candidates = new Set([first]);
    if (first.startsWith("/") && first.length > 1) candidates.add(first.slice(1));
    else if (first) candidates.add("/" + first);
    for (const [name, aliases] of Object.entries(BotManager.COMMANDS)) {
      if (aliases.some((a) => candidates.has(a))) return { cmd: name, rest: t.slice(first.length).trim(), raw: t };
    }
    return null;
  }

  async handleTextCommand(msg, user, ctx = "dm") {
    const parsed = this.parseCommand(msg.body);
    if (!parsed) return;
    const { cmd } = parsed;
    const rest = parsed.rest.toLowerCase();
    const inGroup = ctx === "group";
    const pickText = (key, ...args) => {
      const item = BOT_TEXTS[key];
      const variants = typeof item === "function" ? item(...args) : item;
      return this.humanizer?.pick?.(key, variants) ?? e(variants);
    };

    let text = "";
    try {
      switch (cmd) {
        case "help": {
          const remaining = this.quota.usageFor(user).remaining;
          text = pickText("help", remaining, inGroup);
          break;
        }
        case "usage": {
          const remaining = this.quota.usageFor(user).remaining;
          text = pickText("usage", remaining);
          break;
        }
        case "settings": {
          const prefs = this.users.getPrefs(user.id);
          text = pickText("settingsShown", prefs, inGroup);
          break;
        }
        case "group": {
          const gs = msg.isGroup ? this.groups.getSettings(msg.chatId) : null;
          if (msg.isGroup && gs) {
            text = pickText("groupModeNow", gs.mode, gs.enabled);
          } else {
            text = pickText("groupExplain");
          }
          break;
        }
        case "enable": {
          this.users.updatePrefs(user.id, { autoConvert: true });
          text = pickText("autoOn");
          break;
        }
        case "disable": {
          this.users.updatePrefs(user.id, { autoConvert: false });
          text = pickText("autoOff");
          break;
        }
        case "video": {
          const want = wantToggle(rest, this.users.getPrefs(user.id).allowVideo);
          this.users.updatePrefs(user.id, { allowVideo: want });
          text = want ? pickText("videoOn") : pickText("videoOff");
          break;
        }
        case "image": {
          const want = wantToggle(rest, this.users.getPrefs(user.id).allowImage);
          this.users.updatePrefs(user.id, { allowImage: want });
          text = want ? pickText("imageOn") : pickText("imageOff");
          break;
        }
        case "pack": {
          const prefs = this.users.getPrefs(user.id);
          const val = (parsed.rest || "").trim();
          if (!val) {
            text = pickText("packShown", prefs?.packName || null);
            break;
          }
          if (isResetWord(val)) {
            this.users.updatePrefs(user.id, { packName: null });
            text = pickText("packReset");
            break;
          }
          if (val.length > 64) {
            text = pickText("packTooLong");
            break;
          }
          this.users.updatePrefs(user.id, { packName: val });
          text = pickText("packSet", val);
          break;
        }
        case "author": {
          const prefs = this.users.getPrefs(user.id);
          const val = (parsed.rest || "").trim();
          if (!val) {
            text = pickText("authorShown", prefs?.packAuthor || null);
            break;
          }
          if (isResetWord(val)) {
            this.users.updatePrefs(user.id, { packAuthor: null });
            text = pickText("authorReset");
            break;
          }
          if (val.length > 64) {
            text = pickText("authorTooLong");
            break;
          }
          this.users.updatePrefs(user.id, { packAuthor: val });
          text = pickText("authorSet", val);
          break;
        }
      }
    } catch (err) {
      this.logger.warn("bot", "command failed", { err: err.message, cmd });
    }
    if (text) await this.trySendWithTyping(msg.chatId, text, user.id);
  }

  // بطاقة الإعدادات الحقوقية للمستخدم — يعرضها عند طلب /اضبط أو /حقوقي.
  settingsText(prefs) {
    const state = (b) => (b === false ? "معطل" : "مفعل");
    const defaultPackName = this.settings.get("bot.stickerPack") || undefined;
    const defaultAuthor = this.settings.get("bot.stickerAuthor") || undefined;
    const pack = prefs?.packName || defaultPackName || "غير محدد";
    const author = prefs?.packAuthor || defaultAuthor || "غير محدد";
    return [
      "إعداداتك الشخصية عندي:\n" +
        `- التحويل التلقائي: ${state(prefs?.autoConvert)}.\n` +
        `- تحويل الصور: ${state(prefs?.allowImage)}.\n` +
        `- تحويل الفيديو: ${state(prefs?.allowVideo)}.\n` +
        `- اسم مجموعة الملصقات: ${pack}.\n` +
        `- اسم المؤلف: ${author}.\n\n` +
        "لتغييرها أرسل أحد الأوامر:\n" +
        "- /on أو «تفعيل»: تشغيل التحويل التلقائي.\n" +
        "- /off أو «ايقاف»: إيقاف التحويل التلقائي.\n" +
        "- /image أو «صورة»: تبديل تحويل الصور.\n" +
        "- /video أو «فيديو»: تبديل تحويل الفيديو.\n" +
        "- /اسم <الاسم> أو «اسم ...»: اسم مجموعة ملصقاتك.\n" +
        "- /مؤلف <الاسم> أو «مؤلف ...»: اسم المؤلف الظاهر في الملصقات.\n" +
        "- /usage أو «حصتي»: حصتك المتبقية.",
    ];
  }

  async handleMedia(msg, user, groupId) {
    const chatId = msg.chatId;

    // سجل المحادثة: نسجّل الوسيط الوارد قبل أي فحص.
    const histRec = this.recordIn(msg, user, chatId);

    // 0) حقوق المستخدم الشخصية (يضبطها بنفسه عبر /on /off /صورة /فيديو):
    //    تحويل تلقائي مفعل؟ وهل يسمح بهذا النوع أصلاً؟
    const prefs = this.users.getPrefs(user.id);
    if (prefs?.autoConvert === false) {
      await this.trySendWithTyping(chatId, msgFromVariants("autoOffReply"), user.id);
      return;
    }
    const wantVideo = msg.media.type === "video";
    if (prefs && (wantVideo ? prefs.allowVideo === false : prefs.allowImage === false)) {
      const text = wantVideo
        ? msgFromVariants("videoOffReply")
        : msgFromVariants("imageOffReply");
      await this.trySendWithTyping(chatId, text, user.id);
      return;
    }

    // 1) Rate limit per user
    const rl = this.rateLimiter.hit(`user:${user.id}`, {
      limit: this.settings.getNumber("rateLimit.perUserPerMinute", 5),
      windowMs: 60_000,
    });
    if (!rl.allowed) {
      await this.trySendWithTyping(chatId, msgFromVariants("rateLimited"), user.id);
      return;
    }
    const grl = this.rateLimiter.hit("global", {
      limit: this.settings.getNumber("rateLimit.globalPerMinute", 120),
      windowMs: 60_000,
    });
    if (!grl.allowed) {
      await this.trySendWithTyping(chatId, msgFromVariants("queueFull"), user.id);
      return;
    }

    // 2) نوع الوسائط → Job
    const type = msg.media.type === "video" ? "VIDEO" : "IMAGE";
    const priority = this.rolePriority(user);

    const res = this.queue.enqueue({
      user,
      messageId: msg.id,
      type,
      groupId,
      priority,
      amount: 1,
    });

    if (!res.ok) {
      if (res.code === "duplicate") return; // نفس الرسالة تتكرر في الحدث
      if (res.code === "quota_exceeded") {
        await this.trySendWithTyping(chatId, msgFromVariants("quotaExhausted"), user.id);
        return;
      }
      if (res.code === "max_pending") {
        await this.trySendWithTyping(chatId, msgFromVariants("maxPending"), user.id);
        return;
      }
      if (res.code === "queue_paused") {
        await this.trySendWithTyping(chatId, msgFromVariants("paused"), user.id);
        return;
      }
      if (res.code === "queue_full") {
        await this.trySendWithTyping(chatId, msgFromVariants("queueFull"), user.id);
        return;
      }
      return;
    }

    // ربط الـ Job بالسجل
    if (histRec) this.messages?.setJobId(histRec.id, res.job.id);

    // 3) إشعار البدء — صيغة متناوبة حسب النوع
    const ackKey = type === "VIDEO" ? "ackVideo" : "ackImage";
    await this.trySendWithTyping(chatId, msgFromVariants(ackKey), user.id);
  }

  async handleGroupMessage(msg, user) {
    const settings = this.groups.ensureSettings(msg.chatId, {
      mode: this.settings.get("whatsapp.groupMode") || "MENTION_ONLY",
    });
    if (!settings.enabled) {
      this.logger.info("bot", "group drop: disabled", { chatId: msg.chatId });
      return;
    }
    const mode = settings.mode;

    if (mode === "OFF" || mode === "off") {
      this.logger.info("bot", "group drop: off", { chatId: msg.chatId });
      return;
    }

    const isMedia = msg.media && (msg.media.type === "image" || msg.media.type === "video");
    const body = (msg.body || "").trim();

    // 1) الأوامر تعمل في أي وضع داخل المجموعة: /help، /usage، /اضبط، /فيديو...
    //    (الأوامر النصية فقط؛ الوسائط أولويتها التحويل حتى لو حملت تعليقاً).
    if (!isMedia && body && this.parseCommand(body)) {
      await this.handleTextCommand(msg, user, "group");
      return;
    }

    // 2) رسالة نصية بدون وسائط: إن وُجهت للبوت (إشارة/اسم/كلمة) نوضّح المطلوب.
    if (!isMedia) {
      if (this.isMentioned(msg) || this.isCommandForBot(msg)) {
        await this.trySendWithTyping(msg.chatId, msgFromVariants("groupNeedMedia"), user.id);
      } else {
        this.logger.info("bot", "group drop: not-media", { chatId: msg.chatId, type: msg.media?.type || msg.rawType || null });
      }
      return;
    }

    // 3) بوابات الوسائط حسب وضع المجموعة
    if (mode === "COMMAND_ONLY" && !this.isCommandForBot(msg)) {
      this.logger.info("bot", "group drop: no-command", { chatId: msg.chatId, body: body.slice(0, 40) });
      return;
    }
    if (mode === "MENTION_ONLY" && !this.isMentioned(msg)) {
      // ميزة أمان: وصلت إشارة فعلية (أي كان) لكننا لم نطابق البوت رقمياً/باسماً —
      // في وضع «بالإشارة فقط» نقبل الوسائط المشار إليها بدل إسقاطها، لضمان عمل
      // الإشارة حتى مع صيغ LID/صيغ واتساب الجديدة التي لا نعرف هويتها بعد.
      const realMentions = (msg.mentions || []).map(serializeJid).filter(Boolean);
      if (realMentions.length > 0) {
        this.logger.info("bot", "mention accepted via any-mention fallback", {
          chatId: msg.chatId,
          mentions: realMentions,
          botDigits: this.botDigits ? [...this.botDigits] : [],
        });
      } else {
        this.logger.info("bot", "group drop: no-mention", {
          chatId: msg.chatId,
          mentions: msg.mentions,
          body: body.slice(0, 60),
          botDigits: this.botDigits ? [...this.botDigits] : [],
          botNames: this.botNames ? [...this.botNames] : [],
        });
        return;
      }
    }

    // حد المجموعة اليومي
    const dailyLimit = settings.dailyLimit;
    if (dailyLimit != null && dailyLimit > 0 && this.groups.outstandingJobsInGroup(msg.chatId) >= dailyLimit) {
      await this.trySendWithTyping(msg.chatId, `تم تجاوز حد المجموعة اليومي (${dailyLimit}).`, user.id);
      return;
    }

    // قيد لكل مجموعة بالدقيقة
    const g = this.rateLimiter.hit(`group:${msg.chatId}`, {
      limit: this.settings.getNumber("rateLimit.perGroupPerMinute", 10),
      windowMs: 60_000,
    });
    if (!g.allowed) {
      await this.trySendWithTyping(msg.chatId, "تمهّل قليلاً في هذه المجموعة.", user.id);
      return;
    }

    this.groups.upsertGroup(msg.chatId, { name: null });
    this.groups.addMember(msg.chatId, user.id);

    await this.handleMedia(msg, user, msg.chatId);
  }

  // إشارة شرعية: هل ذُكر البوت في الرسالة؟ يُقارن الأرقام لأن الإشارات قد ترد
  // بصيغة @lid أو @s.whatsapp.net (2026). ويُعدّ «@اسم_البوت» نصاً إشارة صحيحة
  // لأن كثيراً من المستخدمين يكتبونها يدوياً بظنها إشارة فعلية. كما يلتقط:
  // - ذكر اسم البوت في النص بدون @ (كلمة مميزة خاصة بالبوت).
  // - كلمة «بوت» المنفردة، حسب مراجعة المستخدمين (»بوت ستكر / بوت حول هذا«).
  isMentioned(msg) {
    // نتعلَّم معرّف LID المنتظم للبوت من أول إشارة نسبة إليه نصياً (2026).
    this._learnBotMentionIds(msg);
    const mentions = msg.mentions || [];
    if (this.botDigits && this.botDigits.size && mentions.length) {
      const hit = mentions.some((j) => {
        // قد ترد الإشارة نصاً («96880000000@lid») أو كعنصر Wid كائن
        // (`{_serialized:'...@lid'}`) كما يحدث في واتساب ويب الحديث — نتعامل معهما.
        const ser = serializeJid(j);
        const base = String(ser).split("@")[0].replace(/\D/g, "");
        return !!base && this.botDigits.has(base);
      });
      if (hit) return true;
    }
    const body = (msg.body || "").trim();
    // نص قد يحمل الرقم كإشارة يدوية: «@966569697241» أو «966569697241» — نقارن برقم البوت مباشرة.
    if (this.botDigits && this.botDigits.size && body) {
      const numsInBody = (body.match(/\d{5,}/g) || []).map((n) => n.replace(/\D/g, ""));
      if (numsInBody.some((n) => this.botDigits.has(n))) return true;
    }
    const botName = String(this.settings.get("bot.name") || "").trim();
    if (botName) {
      const atRe = new RegExp(`@${escapeRegExp(botName)}\\b`, "iu");
      if (atRe.test(body)) return true;
      const wordRe = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escapeRegExp(botName)}(?:$|[^\\p{L}\\p{N}_])`, "iu");
      if (wordRe.test(body)) return true;
    }
    // اسم البوت الظاهر في واتساب (pushname) — قد يظهر في نص التعليق بدل الإعداد.
    const shownName = [...(this.botNames || [])].find((n) => n && n !== String(this.settings.get("bot.name") || "").trim().toLowerCase());
    if (shownName) {
      const wordRe = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escapeRegExp(shownName)}(?:$|[^\\p{L}\\p{N}_])`, "iu");
      if (wordRe.test(body)) return true;
    }
    if (/(?:^|[^\p{L}\p{N}_])بوت(?:$|[^\p{L}\p{N}_])/iu.test(body)) return true;
    return false;
  }

  // أمر صريح للبوت في المجموعة: إشارة، أو رسالة تبدأ باسم البوت أو بكلمة
  // محفّزة (ستيكر/ملصق/sticker...)، أو أمر بشرطة معروف.
  isCommandForBot(msg) {
    if (this.isMentioned(msg)) return true;
    const body = (msg.body || "").trim();
    if (!body) return false;
    const lower = body.toLowerCase();
    if (this.parseCommand(body)) return true;
    const botName = String(this.settings.get("bot.name") || "").trim().toLowerCase();
    const nameHit = botName
      ? lower.startsWith(botName) || lower.startsWith("بوت ") || lower.includes("@" + botName)
      : false;
    const triggers = ["sticker", "ستيكر", "ملصق", "كلاصق", "/sticker", "اصنع", "حول", "حوّل", "سويه", "سو لي"];
    const triggerHit = triggers.some((t) => lower.startsWith(t) || lower.includes(t));
    return nameHit || triggerHit;
  }

  // إشارة كتابة قصيرة + تأخير إنساني ثم الإرسال. يسجّل الرد الصادر في سجل المحادثات.
  async trySendWithTyping(chatId, text, userId = null) {
    try {
      await this.humanizer?.sendTyping?.(chatId);
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 800));
      await this.humanizer?.stopTyping?.(chatId);
      const sent = await this.adapter.sendText(chatId, text);
      this.recordOutText(chatId, text, userId, sent?.id?._serialized || sent?.id?.$1 || sent?.id?.id || null);
    } catch (err) {
      this.logger.warn("bot", "send failed", { err: err.message, chatId });
    }
  }

  // تسجيل رسالة صادرة (نصية) في السجل.
  recordOutText(chatId, text, userId = null, messageId = null) {
    if (!this.messages || !text) return;
    try {
      const uid = userId || this.userIdForChat(chatId);
      if (!uid) return;
      this.messages.insert({ userId: uid, chatId, direction: "OUT", type: "text", text, messageId, adminSent: false });
    } catch (err) {
      this.logger.warn("bot", "history record failed", { err: err.message });
    }
  }

  // تسجيل رسالة واردة (نص أو وسيط) في السجل. يُعيد معرّف السجل إن سجّل.
  recordIn(msg, user, chatId, extra = {}) {
    if (!this.messages || !user) return null;
    try {
      const isMedia = msg.media && msg.media.type;
      const rec = this.messages.insert({
        userId: user.id,
        chatId,
        direction: "IN",
        type: isMedia ? msg.media.type : "text",
        text: msg.body || null,
        mime: isMedia ? msg.media.mimeType || null : null,
        messageId: msg.id || null,
        mediaMeta: isMedia ? { durationSec: msg.media.seconds ?? null, originalType: msg.rawType || null } : null,
        ...extra,
      });
      return rec;
    } catch (err) {
      this.logger.warn("bot", "history record failed", { err: err.message });
      return null;
    }
  }

  // معرّف المستخدم المالك لمحادثة خاصة، أو null للمجموعات.
  userIdForChat(chatId) {
    if (!chatId || chatId.endsWith("@g.us")) return null;
    try {
      const u = this.users.getByPhone(chatId.split("@")[0]);
      return u?.id || null;
    } catch {
      return null;
    }
  }

  // تأخير الرد — بدون إشارة كتابة (يستخدمه sendWelcome).
  async humanDelay(chatId) {
    const ms = this.humanizer?.replyDelay() ?? 2000;
    await new Promise((r) => setTimeout(r, ms));
  }

  rolePriority(user) {
    const ranks = { USER: 0, PREMIUM: 10, ADMIN: 20 };
    return (ranks[user.role] || 0) + (user.priority || 0);
  }
}

function msgFromVariants(key, ...args) {
  const item = BOT_TEXTS[key];
  if (!item) return "";
  const variants = typeof item === "function" ? item(...args) : item;
  return variants[0];
}

function normalizeJid(jid) {
  const raw = String(jid || "").split(":")[0];
  if (!raw) return raw;
  const [base, server] = raw.split("@");
  if (!base) return raw;
  // @lid (معرّفات LID الجديدة) و @g.us تُحفظ كما هي — صالحة للإرسال مباشرة.
  if (server === "lid" || server === "g.us") return raw;
  return `${base}@s.whatsapp.net`;
}

// يحوّل الإشارة إلى صيغتها النصية مهما كان شكلها الوارد من واتساب:
// نص («9665...@lid») أو كائن Wid ({_serialized, $1, id}).
function serializeJid(j) {
  if (!j) return null;
  if (typeof j === "string") return j;
  return j._serialized || j.$1 || j.id || String(j);
}

// /video off /video مفيد: قيمة التبديل حسب النص المرفق (off/on/تفعيل/ايقاف)
// أو تبديل عن القيمة الحالية إن لم يُذكر اتجاه.
function wantToggle(rest, current) {
  if (!rest) return !current;
  const on = /(^|\s)(on|تفعيل|سمح|شغل|افتح|مفعل|نعم|يب)\b/i.test(rest) || rest.startsWith("+");
  const off = /(^|\s)(off|ايقاف|إيقاف|منع|عطل|قفل|لا|ما عاد|اطفاء|أطفئ|قف)\b/i.test(rest);
  if (on && !off) return true;
  if (off && !on) return false;
  return !current;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// كلمات تعني «أعد القيمة إلى الافتراضي» (لأمرَي /اسم و/مؤلف).
function isResetWord(v) {
  return /^(افتراضي|الافتراضي|الافتراضية|حذف|مسح|امسح|مسحه|امسحها|إزالة|ازالة|احذف|صفر|لا شي|لا شيء|default)$/iu.test(v.trim());
}