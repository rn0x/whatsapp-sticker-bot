// WWebJSAdapter — تنفيذ عقد WhatsAppAdapter عبر whatsapp-web.js (Puppeteer + WhatsApp Web).
// أفضلية الأمان: تشغيل WhatsApp Web حقيقي يقلل خطر الحظر مقارنة ب WebSocket خام.
import { EventEmitter } from "node:events";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import wwebjs from "whatsapp-web.js";
const { Client, RemoteAuth, MessageMedia } = wwebjs;
import { createWWebJSStore } from "./wwebjs-store.mjs";
import { resolveChromium } from "./chromium.mjs";

const STICKER_TYPES = new Set(["sticker", "image", "video", "document"]);
const IMAGE_RE = /image\/(jpe?g|png|webp|gif)/i;
const VIDEO_RE = /video\/|application\/mxf|image\/gif/i;

// إلى الصيغة التي يقبلها wwebjs للإرسال:
// - @s.whatsapp.net (عنوان خادم) يُترجم إلى @c.us للمحادثات الخاصة
// - @lid و @g.us تُترك كما هي (واي-جي-إس يدعمها أصلية)
function toSendableJid(jid) {
  const s = String(jid || "").split(":")[0];
  if (!s) return s;
  if (s.endsWith("@s.whatsapp.net")) return `${s.replace(/@s\.whatsapp\.net$/, "")}@c.us`;
  return s;
}

// WhatsApp Web أزالت id._serialized لصالح id.$1 — نعيدها أينما وُجدت
// على كائن الرسالة/المعرّف حتى لا تكسر الاستدعاءات الداخلية (downloadMedia وغيرها).
function backfillSerialized(obj) {
  if (!obj || typeof obj !== "object") return;
  const scan = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { for (const x of o) scan(x); return; }
    if (o._serialized == null && o.$1 != null) {
      try { o._serialized = o.$1; } catch { /* جاهل بالقراءة فقط */ }
    }
    for (const k of Object.keys(o)) {
      if (k === "_serialized" || k === "members") continue;
      const v = o[k];
      if (v && typeof v === "object" && (v.$1 != null || v._serialized != null)) scan(v);
    }
  };
  scan(obj);
}

export class WWebJSAdapter extends EventEmitter {
  constructor({ db, sessionsRepo, settings, logger, paths }) {
    super();
    this.sessions = sessionsRepo;
    this.settings = settings;
    this.logger = logger;
    this.paths = paths;
    this.client = null;
    this.status = "DISCONNECTED";
    this.phone = null;
    this.wid = null;
    this.lid = null;
    this.pushname = null;
    this.qr = null;
    this.pairingCode = null;
    this.instanceId = "primary";
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._closing = false;
    this._dark = false; // غير مستخدم — للحفاظ على التتبع مستقبلاً
    // مرجع الرسائل الخام بالمعرف — يسمح بـ downloadMedia للرسائل التي وصلت مؤخراً
    // (العمال في نفس العملية؛ الرسالة تبقى صالحة للتنزيل بضع دقائق).
    this._heldMedia = new Map(); // id -> { raw, at }

    // آخر أسطر سجل صفحة واتساب ويب (حلقي) لتوضيح أخطاء الإرسال المضغوطة مثل "t".
    this._pageNotes = []; // [{at, type, text}]
  }

  _notePage(type, text) {
    this._pageNotes.push({ at: Date.now(), type, text: String(text).slice(0, 300) });
    if (this._pageNotes.length > 40) this._pageNotes.splice(0, this._pageNotes.length - 40);
  }

  // يرفق بأي خطأ إرسال ما التقطته الصفحة قريباً (قبل 20 ثانية) ليسهل قراءة السبب.
  _annotateSendError(err) {
    if (!err) return err;
    const now = Date.now();
    const near = this._pageNotes.filter((n) => now - n.at < 20000);
    if (!near.length) return err;
    const lines = near.map((n) => `[${n.type}] ${n.text}`).join(" || ");
    err.pageNotes = lines;
    if (!err.message || err.message.length <= 80) {
      try { err.message = `${err.message} — WA: ${lines.slice(0, 400)}`; } catch { /* read-only */ }
    }
    return err;
  }

  // ===== نشر الحالة =====
  _setStatus(status, extra = {}) {
    this.status = status;
    this.emit("status", { status, ...extra });
  }

  _emitEvent(name, payload) {
    this.emit("event", { name, payload });
  }

  _authDir() {
    return join(this.paths.get("data"), "wwebjs_auth");
  }

  // هل توجد جلسة محفوظة لهذا المثيل؟ (لقرار الاتصال التلقائي عند التشغيل)
  hasSavedSession() {
    try {
      const rec = this.sessions.get(`wwebjs:${this.instanceId}`);
      return !!(rec?.payload?.zipBase64);
    } catch {
      return false;
    }
  }

  // علامة قراءة بشرية — تُستدعى بتأخير عشوائي عبر Humanizer.
  async markAsRead(chatId) {
    if (!this.client || this.status !== "CONNECTED") return;
    try {
      if (typeof this.client.sendReadReceipt === "function") {
        await Promise.race([
          this.client.sendReadReceipt(toSendableJid(chatId)),
          new Promise((r) => setTimeout(r, 4000)),
        ]);
      }
    } catch { /* خامل */ }
  }

  // ===== الاتصال =====
  async connect() {
    if (this._connectPromise) return this._connectPromise;
    this._connectPromise = this._doConnect()
      .catch(async (err) => {
        this.logger.error("whatsapp", "connect failed", { err: err.message });
        this._setStatus("ERROR", { message: err.message });
        throw err;
      })
      .finally(() => { this._connectPromise = null; });
    return this._connectPromise;
  }

  // ينشئ العميل ويربط الأحداث ويبدأ initialize في الخلفية، دون انتظار اكتماله.
  // يُستخدم في الاتصال العادي وفي تدفق رمز الإقران معاً.
  async _createClient() {
    await this._teardownClient();
    this._closing = false;

    const authDir = this._authDir();
    const store = createWWebJSStore({
      sessions: this.sessions,
      instanceId: this.instanceId,
      logger: this.logger,
      dataPath: authDir,
    });

    const appRoot = fileURLToPath(new URL("../../", import.meta.url));
    const executablePath = resolveChromium({ appRoot });
    const puppeteer = {
      headless: true,
      executablePath: executablePath || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    };
    if (executablePath) {
      this.logger.info("whatsapp", "using bundled chromium", { executablePath });
    } else {
      this.logger.warn("whatsapp", "no bundled chromium found — falling back to puppeteer default");
    }

    const client = new Client({
      authStrategy: new RemoteAuth({
        clientId: this.instanceId,
        store,
        dataPath: authDir,
        backupSyncIntervalMs: 120000,
      }),
      puppeteer,
      takeoverOnConflict: true,
      // قيم كبيرة كي لا يتوقف تدفق QR بعد انتهاء صلاحية الرمز الأول
      // (qrMaxRetries=0 كان يجعل الرمز يختفي فجأة ويفشل الاتصال).
      qrMaxRetries: 60,
      authTimeoutMs: 0,
      deviceName: this.settings.get("whatsapp.instanceName") || "Sticker Bot",
      webVersionCache: { type: "local", strict: false },
    });
    this.client = client;

    this._bindEvents(client);
    // الحالة قبل initialize حتى تظهر الواجهة "جارٍ الاتصال" فوراً.
    this._setStatus("CONNECTING");

    this._init = client.initialize().catch((err) => {
      // نُخزّن الخطأ ولا نرميه هنا حتى لا يتسرب كـ unhandledRejection؛
      // connect() يقرأه لاحقاً.
      this._initError = err;
      throw err;
    });
    this._init.catch(() => {});
    return client;
  }

  async _doConnect() {
    await this._createClient();
    await this._init;
    if (this._initError) {
      const e = this._initError;
      this._initError = null;
      throw e;
    }
  }

  _bindEvents(client) {
    client.on("qr", (qr) => {
      this.qr = qr;
      this._setStatus("AUTHENTICATING");
      this.emit("qr", qr);
    });

    client.on("code", (code) => {
      this.pairingCode = code;
      this.emit("pairing", { code: code.replace(/(.{4})(?=.)/g, "$1-"), phone: null });
    });

    client.on("loading_screen", (percent) => {
      this._setStatus("CONNECTING", { loading: percent || 0 });
    });

    client.on("authenticated", () => {
      this._setStatus("AUTHENTICATING", { connecting: true });
    });

    client.on("ready", () => {
      this._reconnectAttempts = 0;
      this.qr = null;
      this.pairingCode = null;
      const wid = this.client?.info?.wid?._serialized;
      const lid = this.client?.info?.lid?._serialized || this.client?.info?.lid || null;
      this.wid = wid || null;
      this.lid = lid || null;
      this.pushname = this.client?.info?.pushname || this.client?.info?.name || null;
      if (wid) this.phone = wid.replace(/(\d+)@/g, "$1");
      this._attachPageDiagnostics();
      this.logger.info("whatsapp", "connected", { phone: this.phone, wid: this.wid, lid: this.lid, pushname: this.pushname });
      this.emit("qr", null);
      this._setStatus("CONNECTED", { phone: this.phone, wid: this.wid, lid: this.lid, pushname: this.pushname });

      // علامة قراءة رغبات الرقيب: ربط الحدث في time — نخلف لـ BotManager.
      this._emitEvent("ready", null);
      this.emit("ready", null);
    });

    client.on("auth_failure", (msg) => {
      this.logger.warn("whatsapp", "auth failure", { msg: String(msg) });
      this._markLoggedOut();
    });

    client.on("change_state", (state) => {
      this.logger.info("whatsapp", "state", { state });
    });

    client.on("disconnected", (reason) => {
      const r = String(reason);
      this.logger.warn("whatsapp", "disconnected", { reason: r });
      if (r === "LOGGED_OUT") {
        this._markLoggedOut();
        return;
      }
      this._setStatus("DISCONNECTED", { code: r });
      this._scheduleReconnect();
    });

    client.on("message", (msg) => this._onMessage(msg));
    client.on("message_revoke_everyone", (msg) => {
      const nm = this._normalize(msg);
      if (nm) this.emit("event", { name: "revoked", payload: nm });
    });

    // أحداث المجموعات: دخول أعضاء/مغادرتهم — نمررها للـ BotManager ليتعرف
    // على دخول البوت نفسه ويرسل رسالة التعريف ويتحقق من الصلاحيات.
    client.on("group_join", (notification) => {
      const p = this._normalizeGroupEvent(notification, "join");
      if (p) {
        this._emitEvent("group_join", p);
        this.emit("group-join", p);
      }
    });
    client.on("group_leave", (notification) => {
      const p = this._normalizeGroupEvent(notification, "leave");
      if (p) {
        this._emitEvent("group_leave", p);
        this.emit("group-leave", p);
      }
    });
  }

  _normalizeGroupEvent(notif, kind) {
    if (!notif) return null;
    const chatId = notif.chatId || notif.from || "";
    if (!String(chatId).endsWith("@g.us")) return null;
    const author = notif.author || null;
    const recipientIds = Array.isArray(notif.recipientIds) ? notif.recipientIds : [];
    return { kind, chatId, author, recipientIds, timestamp: notif.timestamp || Date.now() };
  }

  // يلتقط سجل صفحة واتساب ويب الحية (console / pageerror) لتشخيص الأخطاء
  // المضغوطة مثل "t"/"r" التي لا تكشف عن السبب الحقيقي (تقنية #201828).
  _attachPageDiagnostics() {
    const page = this.client?.pupPage;
    if (!page || page.__wsbDiag) return;
    page.__wsbDiag = true;
    const started = Date.now();
    page.on("console", (msg) => {
      const type = msg.type();
      if (type !== "error" && type !== "warning" && type !== "log") return;
      const text = String(msg.text() || "").slice(0, 500);
      if (!text.trim()) return;
      this._notePage(type, text);
      this.logger.info("wa-page", `[console:${type}] ${text}`);
    });
    page.on("pageerror", (err) => {
      const m = String(err?.message || err).slice(0, 500);
      const s = String(err?.stack || "").slice(0, 800);
      this._notePage("pageerror", m);
      this.logger.error("wa-page", `[pageerror] ${m}`, { stack: s });
    });
    page.on("requestfailed", (req) => {
      if (Date.now() - started > 30 * 1000) return; // فقط أول 30 ثانية وتجاهل ضوضائها
      const u = String(req.url() || "").split("?")[0].replace(/\d+/g, "N");
      this.logger.warn("wa-page", `[requestfailed] ${u} ${req.failure()?.errorText || ""}`);
    });
  }

  async _markLoggedOut() {
    this.logger.warn("whatsapp", "logged out (from phone or invalid session)");
    await this._teardownClient();
    try { this.sessions.delete(`wwebjs:${this.instanceId}`); } catch { /* ignore */ }
    this.qr = null;
    this.pairingCode = null;
    this.phone = null;
    this.wid = null;
    this.lid = null;
    this.emit("qr", null);
    this._setStatus("LOGOUT");
  }

  _scheduleReconnect() {
    if (this._closing || this._reconnectTimer) return;
    if (!this.settings.getBool("whatsapp.autoReconnect", true)) return;
    const delay = Math.min(5000 * Math.pow(2, this._reconnectAttempts), 120000);
    this._reconnectAttempts += 1;
    this.logger.info("whatsapp", `reconnect in ${delay}ms`);
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      try {
        await this.connect();
      } catch {
        this._scheduleReconnect();
      }
    }, delay);
  }

  // ===== الرسائل =====
  async _onMessage(msg) {
    try {
      const nm = await this._normalize(msg);
      if (nm) {
        this._holdRaw(nm, msg);
        this.emit("message", nm);
      }
    } catch (err) {
      this.logger.error("whatsapp", "message parse error", { err: err.message });
    }
  }

  // يحفظ مرجع الرسالة الخام لفترة قصيرة حتى يتم التنزيل من قبل العمال.
  _holdRaw(nm, raw) {
    if (!nm?.id || !raw) return;
    const now = Date.now();
    // تنظيف الانتهاء الصلاحية (تلك الأكبر من 15 دقيقة)
    for (const [k, v] of this._heldMedia) {
      if (now - v.at > 15 * 60 * 1000) this._heldMedia.delete(k);
    }
    this._heldMedia.set(nm.id, { raw, at: now });
  }

  async _normalize(msg) {
    if (!msg || msg.fromMe) return null;
    const chatId = msg.from || "";
    if (!chatId) return null;

    // واتساب ويب أعاد تسمية id._serialized إلى id.$1 (تغيير يوليو 2026) —
    // نعيد بناء _serialized حتى تعمل downloadMedia وجميع الاستدعاءات الداخلية.
    backfillSerialized(msg);

    const isGroup = chatId.endsWith("@g.us");
    const participantId = isGroup ? msg.author || msg.from : null;
    const type = msg.type || "chat";

    const media = this._extractMedia(msg);
    const body =
      msg.body ||
      (msg.rawData?.imageMessage?.caption) ||
      (msg.rawData?.videoMessage?.caption) ||
      "";

    let pushName = null;
    try {
      const contact = await msg.getContact?.();
      pushName = contact?.pushname || contact?.name || null;
    } catch { /* خامل */ }

    return {
      id: msg.id?._serialized || msg.id?.$1 || msg.id?.id || String(msg.id),
      chatId,
      isGroup,
      participantId,
      fromMe: false,
      body,
      mentions: this._extractMentions(msg),
      pushName,
      timestamp: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : new Date().toISOString(),
      media,
      rawType: type,
      _raw: msg,
    };
  }

  // يستخرج معرّفات الإشارة (mentioned JIDs) بأكبر قدر من المتانة: واتساب ويب
  // لا يملأ «mentionedIds» دائماً لرسائل الوسائط (صورة/فيديو بحمل إشارة)،
  // لذا نعتمد أيضاً على بروتوكول الرسالة الخام (contextInfo.mentionedJid).
  _extractMentions(msg) {
    const out = new Set();
    const addAll = (arr) => {
      if (!Array.isArray(arr)) return;
      for (const j of arr) if (j) out.add(String(j));
    };
    // المصدر المعتاد في wwebjs
    addAll(msg.mentionedIds || msg.mentionedJid || []);
    // المصدر الخام من بروتوكول واتساب (يعمل حتى لو لم يملأ wwebjs mentionedIds)
    const t = msg.type;
    const msgNode =
      msg.rawData?.[`${t}Message`] ||
      msg.rawData?.extendedTextMessage ||
      (msg.rawData && Object.values(msg.rawData).find(
        (v) => v && typeof v === "object" && v.contextInfo?.mentionedJid
      )) ||
      null;
    addAll(msgNode?.contextInfo?.mentionedJid || []);
    return [...out];
  }

  _extractMedia(msg) {
    if (!msg.hasMedia) return null;
    const t = msg.type;
    const mime = msg.rawData?.[`${t}Message`]?.mimetype || "";
    if (t === "image") return { type: "image", mimeType: mime, hasMedia: true, seconds: null };
    if (t === "video") return { type: "video", mimeType: mime, hasMedia: true, seconds: Number(msg.duration) || null };
    if (t === "sticker") return { type: "sticker", mimeType: mime, hasMedia: true, seconds: null };
    if (t === "document") {
      if (IMAGE_RE.test(mime)) return { type: "image", mimeType: mime, hasMedia: true, seconds: null };
      if (VIDEO_RE.test(mime)) return { type: "video", mimeType: mime, hasMedia: true, seconds: null };
      return { type: "document", mimeType: mime, hasMedia: true, seconds: null };
    }
    if (t === "ptt") return { type: "audio", mimeType: mime, hasMedia: true, seconds: null };
    return null;
  }

  async downloadMedia(message, targetPath) {
    const id = message?.id || message?.messageId;
    const held = id ? this._heldMedia.get(id) : null;
    const raw = message?._raw || held?.raw;
    if (!raw?.downloadMedia) throw new Error("media message expired or not found");
    const media = await raw.downloadMedia();
    if (!media?.data) throw new Error("download produced no data");
    const buf = Buffer.from(media.data, "base64");
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, buf);
    if (held) this._heldMedia.delete(id);
    return targetPath;
  }

  // ===== الإرسال =====
  async sendText(jid, text) {
    if (!this.client || this.status !== "CONNECTED") throw new Error("not connected");
    const sent = await this.client.sendMessage(toSendableJid(jid), String(text), { waitUntilMsgSent: true });
    if (!sent) throw new Error("sendMessage resolved without a message (فشل الإرسال بصمت)");
    return sent;
  }

  async sendSticker(jid, stickerPath, { pack, author } = {}) {
    if (!this.client || this.status !== "CONNECTED") throw new Error("not connected");
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(stickerPath);
    const media = new MessageMedia("image/webp", buf.toString("base64"));
    try {
      const sent = await this.client.sendMessage(toSendableJid(jid), media, {
        sendMediaAsSticker: true,
        stickerName: pack || "Sticker Bot",
        stickerAuthor: author || "Sticker Bot",
        waitUntilMsgSent: true,
      });
      if (!sent) throw new Error("sendMessage resolved without a message (فشل إرسال الملصق بصمت)");
      return sent;
    } catch (err) {
      throw this._annotateSendError(err);
    }
  }

  async sendMedia(jid, filePath, { kind = "image", caption, mime } = {}) {
    if (!this.client || this.status !== "CONNECTED") throw new Error("not connected");
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(filePath);
    const mimeType = mime || (kind === "video" ? "video/mp4" : "image/jpeg");
    const media = new MessageMedia(mimeType, buf.toString("base64"), filePath.split("/").pop());
    const sent = await this.client.sendMessage(toSendableJid(jid), media, { caption: caption || "", waitUntilMsgSent: true });
    if (!sent) throw new Error("sendMessage resolved without a message (فشل إرسال الوسيط بصمت)");
    return sent;
  }

  // حذف رسالة صادرة "للجميع" (revoke) بأمر داخلي في صفحة واتساب، بنفس منطق
  // Message.delete(true) في المكتبة مع نتائج منظمة للفرونت. المقنع في "t"-المنزلي.
  async revokeMessage(msgKey, timeoutMs = 20000) {
    if (!this.client || this.status !== "CONNECTED") {
      const e = new Error("WhatsApp غير متصل — تعذّر حذف الرسالة عند المستخدم");
      e.code = "NOT_CONNECTED";
      throw e;
    }
    const id = msgKey?._serialized || msgKey?.$1 || msgKey?.id || String(msgKey || "").trim();
    if (!id) {
      const e = new Error("لا يتوفر معرّف رسالة واتساب لهذه الرسالة");
      e.code = "NO_MSG_KEY";
      throw e;
    }
    const page = this.client.pupPage;
    if (!page) {
      const e = new Error("صفحة واتساب غير متاحة");
      e.code = "PAGE_UNAVAILABLE";
      throw e;
    }
    const result = await Promise.race([
      page.evaluate(async (msgId) => {
        try {
          const first = (v) => (v?.messages && v.messages[0]) || v;
          const W = (name) => window.require(name);
          let msg = W("WAWebCollections").Msg.get(msgId);
          if (!msg) msg = first(await W("WAWebCollections").Msg.getMessagesById([msgId]));
          if (!msg) return { ok: false, code: "MSG_NOT_FOUND", message: "الرسالة لم تعد موجودة في واتساب (حُلبت أو انتهت)" };
          const cap = W("WAWebMsgActionCapability");
          const canSender = (() => { try { return !!cap.canSenderRevokeMsg(msg); } catch { return false; } })();
          const canAdmin = (() => { try { return !!cap.canAdminRevokeMsg(msg); } catch { return false; } })();
          if (!canSender && !canAdmin) {
            return { ok: false, code: "TOO_OLD", message: "انتهت مهلة \"الحذف للجميع\" عند واتساب (تُتيحها فترة محدودة فقط)" };
          }
          const chat = W("WAWebCollections").Chat.get(msg.id.remote) || (await W("WAWebCollections").Chat.find(msg.id.remote));
          if (!chat) return { ok: false, code: "CHAT_NOT_FOUND", message: "لم يُعثر على المحادثة المرتبطة بالرسالة" };
          const { Cmd } = W("WAWebCmd");
          let newStyle = true;
          try {
            // نفس فحص المكتبة: window.WWebJS.compareWwebVersions (متعيّن عام، لا عبر require).
            newStyle = window.WWebJS?.compareWwebVersions?.(window.Debug?.VERSION, ">=", "2.3000.0") ?? true;
          } catch { /* افتراضي */ }
          if (newStyle) await Cmd.sendRevokeMsgs(chat, { list: [msg], type: "message" }, { clearMedia: false });
          else await Cmd.sendRevokeMsgs(chat, [msg], { clearMedia: false, type: msg.id.fromMe ? "Sender" : "Admin" });
          return { ok: true };
        } catch (err) {
          return { ok: false, code: "WA_ERROR", message: String(err?.message || err).slice(0, 240) };
        }
      }, id),
      new Promise((_, rej) =>
        setTimeout(() => rej(Object.assign(new Error("انتهت مدة انتظار الحذف"), { code: "TIMEOUT" })), timeoutMs)
      ),
    ]);
    if (!result || !result.ok) {
      const e = new Error((result && result.message) || "فشل حذف الرسالة من واتساب");
      e.code = (result && result.code) || "REVOKE_FAILED";
      throw e;
    }
    return true;
  }

  // ===== المجموعات =====
  // يجلب محادثات واتساب الحية ويُعيد المجموعات (@g.us) فقط بمعلوماتها.
  async listChatGroups() {
    if (!this.client || this.status !== "CONNECTED") return [];
    try {
      const chats = await Promise.race([
        this.client.getChats(),
        new Promise((r) => setTimeout(() => r([]), 30000)),
      ]);
      const out = [];
      for (const c of chats || []) {
        try {
          const serial = c?.id?._serialized || c?.id?.user || null;
          if (!serial) continue;
          const jid = serial.endsWith("@g.us")
            ? serial
            : (c?.id?.server === "g.us" && c.id.user ? `${c.id.user}@g.us` : null);
          if (!jid) continue;
          out.push({
            id: jid,
            name: c.name || c.subject || null,
            memberCount: Array.isArray(c.participants) ? c.participants.length : null,
          });
        } catch { /* تخطي محادثة */ }
      }
      return out;
    } catch (err) {
      this.logger.warn("whatsapp", "listChatGroups failed", { err: err.message });
      return [];
    }
  }

  // ===== معلومات المجموعة الحية (الاسم، عدد الأعضاء، صلاحية البوت كمسؤول) =====
  async getGroupInfo(jid) {
    if (!this.client || this.status !== "CONNECTED") throw new Error("not connected");
    const chat = await this.client.getChatById(toSendableJid(jid));
    const name = chat?.name || chat?.subject || null;
    const participants = Array.isArray(chat?.participants) ? chat.participants : [];
    let isBotAdmin = false;
    for (const p of participants) {
      const pid = p?.id?._serialized || p?.id?.$1 || p?.id?.user || p?.id || null;
      if (this._isMe(pid)) {
        isBotAdmin = !!(p?.isSuperAdmin || p?.isAdmin);
        break;
      }
    }
    return { jid, name, memberCount: participants.length, participants, isBotAdmin };
  }

  // هل المعرّف يخص هذا البوت؟ نقارن الأرقام لتغطية صيغ @lid و@s.whatsapp.net و@c.us.
  _isMe(jid) {
    if (!jid) return false;
    const me = [this.wid, this.lid, this.phone];
    for (const m of me) {
      if (!m) continue;
      const a = String(jid).replace(/\D/g, "");
      const b = String(m).replace(/\D/g, "");
      if (a && a === b) return true;
    }
    return false;
  }

  // ===== Pairing Code =====
  async requestPairingCode(phone) {
    const digits = String(phone).replace(/\D/g, "");
    if (digits.length < 10) throw new Error("phone must be E.164 digits with country code");
    if (!this.client) {
      // نبدأ تدفق الإقران دون انتظار اكتمال الاتصال — initialize يعمل في الخلفية.
      await this._createClient();
    }
    if (this.status === "CONNECTED") {
      throw new Error("الجهاز متصل بالفعل — لا حاجة لرمز إقران");
    }
    const code = await this.client.requestPairingCode(digits);
    this.pairingCode = code;
    this.emit("pairing", { code: code.replace(/(.{4})(?=.)/g, "$1-"), phone: digits });
    return code;
  }

  // ===== إيقاف =====
  async _teardownClient() {
    const c = this.client;
    this.client = null;
    if (!c) return;
    try {
      c.removeAllListeners();
      await c.destroy();
    } catch { /* ignore */ }
  }

  async logout() {
    this._closing = true;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    try {
      await this._teardownClient();
    } catch { /* ignore */ }
    try { this.sessions.delete(`wwebjs:${this.instanceId}`); } catch { /* ignore */ }
    this.emit("qr", null);
    this._setStatus("LOGOUT");
  }

  async disconnect() {
    this._closing = true;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    try {
      await this._teardownClient();
    } catch { /* ignore */ }
    this.emit("qr", null);
    this._setStatus("DISCONNECTED");
  }

  getStatus() {
    return { status: this.status, phone: this.phone, wid: this.wid, lid: this.lid, pushname: this.pushname, qr: this.qr, pairingCode: this.pairingCode };
  }

  async destroy() {
    await this.disconnect();
  }
}