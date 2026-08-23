// groups-flow.test.mjs — اختبارات بوابات معالجة الجروبات:
// التقاط الإشارة (LID/هاتف) ووضع الأمر والتلقائي والتسجيل عند الرفض.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { Database } from "../../src/core/database.mjs";
import { AppPaths } from "../../src/main/config.mjs";
import { Logger } from "../../src/main/logger.mjs";
import { SettingsRepo } from "../../src/core/repositories/settings.repo.mjs";
import { UsersRepo } from "../../src/core/repositories/users.repo.mjs";
import { GroupsRepo } from "../../src/core/repositories/groups.repo.mjs";
import { BotManager } from "../../src/bot/bot-manager.mjs";

const GID = "120363000000000000@g.us";

class MockAdapter extends EventEmitter {
  constructor() {
    super();
    this.sentTexts = [];
    this.status = "CONNECTED";
    this.phone = "966569697241";
    this.wid = "96880000000@lid";
  }
  async sendText(jid, text) { this.sentTexts.push({ jid, text }); }
  getStatus() { return { status: this.status, phone: this.phone, wid: this.wid }; }
  async getGroupInfo(jid) { return { jid, name: "Test Group", memberCount: 10, isBotAdmin: true }; }
  async disconnect() {}
}

let dir, db, settings, users, groups, adapter, bot, member;
let enqueued, drops;

function makeMsg({ mentions = [], body = "", media = null, chatId = GID }) {
  return {
    id: "msg-" + Math.random().toString(36).slice(2),
    chatId,
    isGroup: true,
    participantId: member && member.whatsappId,
    mentions,
    body,
    media,
  };
}

function makeBot() {
  adapter = new MockAdapter();
  const verbose = { info: (s, m, data) => drops.push({ level: "info", m, data }), warn: (s, m, data) => drops.push({ level: "warn", m, data }) };
  enqueued = [];
  drops = [];
  bot = new BotManager({
    adapter,
    settings,
    users,
    groups,
    logger: verbose,
    queue: { enqueue: (o) => { enqueued.push(o); return { ok: true, job: { id: 1 } }; } },
    rateLimiter: { hit: () => ({ allowed: true }) },
    quota: { usageFor: () => ({ remaining: 99 }) },
    humanizer: null,
  });
  bot.start();
  return bot;
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "sb-groups-"));
  const paths = new AppPaths(dir);
  db = new Database(paths.dbPath());
  await db.migrate();
  settings = new SettingsRepo(db);
  users = new UsersRepo(db);
  groups = new GroupsRepo(db);
  groups.upsertGroup(GID, { name: "Test Group" });
  // مستخدم حقيقي لأنه يُضاف إلى group_members (FK صارم).
  member = users.upsertOrGet({ whatsappId: "972511111111@s.whatsapp.net", phone: "972511111111", name: "T", pushName: "T" });
});

after(() => { db.close(); });

test("mention matches phone digits and LID digits alike (2026)", () => {
  const b = makeBot();
  const msg = makeMsg({ mentions: ["96880000000@lid"], body: "اصنع هذا ملصق", media: { type: "image", hasMedia: true } });
  assert.equal(b.isMentioned(msg), true);

  const phoneForm = makeMsg({ mentions: ["966569697241@s.whatsapp.net"], body: "x" });
  assert.equal(b.isMentioned(phoneForm), true);

  const stranger = makeMsg({ mentions: ["99999999999@s.whatsapp.net"], body: "x" });
  assert.equal(b.isMentioned(stranger), false);
});

test("@mention arriving as Wid object ({_serialized}) is detected (واتساب ويب 2026)", () => {
  const b = makeBot();
  // الواجهة قد تُمرر الإشارات ككائنات وليس نصوصاً — كما في getMentions() الأصلي.
  const objForm = makeMsg({
    mentions: [{ _serialized: "96880000000@lid" }],
    body: "",
    media: { type: "image", hasMedia: true },
  });
  assert.equal(b.isMentioned(objForm), true, "Wid object mention must be detected");

  const objLidUnknown = makeMsg({
    mentions: [{ user: "96880000000", server: "lid", $1: "96880000000@lid" }],
    body: "",
    media: { type: "video", hasMedia: true },
  });
  assert.equal(b.isMentioned(objLidUnknown), true, "$1/id fallback resolves like _serialized");
});

test("bot learns its regular LID from a caption that names it (2026)", async () => {
  const b = makeBot();
  groups.updateSettings(GID, { mode: "MENTION_ONLY", enabled: true });

  // البوت @mentioned لكن LID المنتظم مختلف تماماً عن أي رقم نعرفه — يحتوي النص على
  // «Sticker Bot» فيتعلَّم البوت الهوية ثم يقبل لاحقاً حتى بدون نص.
  const unknownLid = makeMsg({
    mentions: [{ _serialized: "77700001111@lid" }],
    body: "Sticker Bot حول هالصورة",
    media: { type: "image", hasMedia: true },
  });
  await b.handleGroupMessage(unknownLid, member);
  assert.equal(enqueued.length, 1, "named caption + unknown LID passes via self-learning");

  // الآن حتى رسالة صورة بلا نص وبذات الـ LID تُقبل (هو معروف للبوت).
  const bare = makeMsg({
    mentions: ["77700001111@lid"],
    body: "",
    media: { type: "image", hasMedia: true },
  });
  await b.handleGroupMessage(bare, member);
  assert.equal(enqueued.length, 2, "learned LID works on later bare mentions");
});

test("COMMAND_ONLY responds to command word, drops chatty messages", async () => {
  const b = makeBot();
  groups.updateSettings(GID, { mode: "COMMAND_ONLY", enabled: true });

  const withCmd = makeMsg({ body: "اصنع ملصق من هذه الصورة", media: { type: "image", hasMedia: true } });
  await b.handleGroupMessage(withCmd, member);
  assert.equal(enqueued.length, 1, "command message should pass the gate");

  const noCmd = makeMsg({ body: "شوف هالصورة", media: { type: "image", hasMedia: true } });
  await b.handleGroupMessage(noCmd, member);
  assert.equal(enqueued.length, 1, "plain message must NOT pass COMMAND_ONLY");
  assert.ok(drops.some((d) => d.m === "group drop: no-command"), "expected a no-command drop log");
});

test("MENTION_ONLY requires a mention", async () => {
    const b = makeBot();
    groups.updateSettings(GID, { mode: "MENTION_ONLY", enabled: true });

    const noMention = makeMsg({ body: "اصنع", media: { type: "image", hasMedia: true } });
    await b.handleGroupMessage(noMention, member);
    assert.equal(enqueued.length, 0, "no mention → dropped");
    assert.ok(drops.some((d) => d.m === "group drop: no-mention"), "expected a no-mention drop log");

    const withMention = makeMsg({ mentions: ["96880000000@lid"], body: "اصنع", media: { type: "image", hasMedia: true } });
    await b.handleGroupMessage(withMention, member);
    assert.equal(enqueued.length, 1, "mention → accepted");
  });

test("MENTION_ONLY accepts a real mention even when its identity is unknown (2026 fallback)", async () => {
  const b = makeBot();
  groups.updateSettings(GID, { mode: "MENTION_ONLY", enabled: true });

  // إشارة فعلية برقم غريب (LID منتظم لم يتعلمه البوت بعد) → تُقبل بأمان بدل الإسقاط.
  const foreign = makeMsg({ mentions: [{ _serialized: "77001122334@lid" }], body: "", media: { type: "image", hasMedia: true } });
  await b.handleGroupMessage(foreign, member);
  assert.equal(enqueued.length, 1, "any real mention passes MENTION_ONLY via fallback");
  assert.ok(drops.some((d) => d.m === "mention accepted via any-mention fallback"), "fallback path is logged");
});

test("AUTO accepts any image/video", async () => {
  const b = makeBot();
  groups.updateSettings(GID, { mode: "AUTO", enabled: true });

  await b.handleGroupMessage(makeMsg({ body: "", media: { type: "image", hasMedia: true } }), member);
  assert.equal(enqueued.length, 1);
});

test("disabled group cancels everything even in AUTO", async () => {
    const b = makeBot();
    groups.updateSettings(GID, { mode: "AUTO", enabled: false });

    await b.handleGroupMessage(makeMsg({ media: { type: "image", hasMedia: true } }), member);
    assert.equal(enqueued.length, 0, "disabled group must drop");
    assert.ok(drops.some((d) => d.m === "group drop: disabled"), "expected a disabled drop log");
  });

test("sticker sent directly is dropped (not converted) — logged as not-media", async () => {
    const b = makeBot();
    groups.updateSettings(GID, { mode: "AUTO", enabled: true });

    await b.handleGroupMessage(makeMsg({ body: "", media: { type: "sticker", hasMedia: true } }), member);
    assert.equal(enqueued.length, 0, "bug: stickers are never converted to stickers");
    assert.ok(drops.some((d) => d.m === "group drop: not-media"), "expected a not-media drop log");
  });

test("parseCommand recognizes slash + arabic commands", () => {
  const b = makeBot();
  assert.equal(b.parseCommand("/help").cmd, "help");
  assert.equal(b.parseCommand("حصتي").cmd, "usage");
  assert.equal(b.parseCommand("@Sticker Bot /اضبط").cmd, "settings");
  assert.equal(b.parseCommand("بوت /video").cmd, "video");
  assert.equal(b.parseCommand("سلام عليكم"), null);
});

test("mention also caught by bare bot name or the word «بوت» (دون @)", () => {
  const b = makeBot();
  // اسم البوت «Sticker Bot» في منتصف النص بدون إشارة @.
  const nameInText = makeMsg({ body: "او Sticker Bot حول هالصورة", mentions: [], media: { type: "image", hasMedia: true } });
  assert.equal(b.isMentioned(nameInText), true, "bare bot name should count as mention");

  // كلمة «بوت» المنفردة وحسب المراجعة.
  const wordBot = makeMsg({ body: "بوت حول هالصورة", mentions: [], media: { type: "image", hasMedia: true } });
  assert.equal(b.isMentioned(wordBot), true, "the word بوت should count as mention");

  // «البوت» ككلمة لاحقة للـ بتعريف لا تُعد إشارة (كلام عابر).
  const casual = makeMsg({ body: "هالصورة حلوه البوت تحولها", mentions: [], media: { type: "image", hasMedia: true } });
  assert.equal(b.isMentioned(casual), false, "مقال حديث عام لا يُعد إشارة");
});

test("/اسم و/مؤلف يضبطان باك الملصقات والمؤلف للمستخدم ثم يُرجعان الافتراضي", async () => {
  const b = makeBot();
  const dm = (body) => makeMsg({ chatId: "972511111111@c.us", isGroup: false, body });

  // بدون قيمة → يعرض الحالي
  await b.handleTextCommand(dm("/اسم"), member);
  assert.ok(adapter.sentTexts[adapter.sentTexts.length - 1].text.includes("اسم مجموعة ملصقاتك"), "shows current pack");

  await b.handleTextCommand(dm("/اسم باك أحمد"), member);
  assert.equal(users.getPrefs(member.id).packName, "باك أحمد", "/اسم sets pack name");
  await b.handleTextCommand(dm("/مؤلف محمد الدوسري"), member);
  assert.equal(users.getPrefs(member.id).packAuthor, "محمد الدوسري", "/مؤلف sets author");

  // «من؟» لا يُفرغه؛ «افتراضي» يقفل إلى null → يقع الافتراضي العام.
  await b.handleTextCommand(dm("/اسم افتراضي"), member);
  assert.equal(users.getPrefs(member.id).packName, null, "اسم افتراضي resets pack to default");
  await b.handleTextCommand(dm("/مؤلف مسح"), member);
  assert.equal(users.getPrefs(member.id).packAuthor, null, "مؤلف مسح resets author to default");
});

test("MENTION_ONLY accepts a hand-typed textual mention (@اسم_البوت)", async () => {
  const b = makeBot();
  groups.updateSettings(GID, { mode: "MENTION_ONLY", enabled: true });

  // دون mentions صريحة، فقط نص كتبه المستخدم ظناً أنه إشارة
  const typed = makeMsg({ body: "@Sticker Bot حول هذه الصورة", media: { type: "image", hasMedia: true } });
  await b.handleGroupMessage(typed, member);
  assert.equal(enqueued.length, 1, "textual @mention should pass MENTION_ONLY");
});

test("/help works inside the group in any mode", async () => {
  const b = makeBot();
  groups.updateSettings(GID, { mode: "MENTION_ONLY", enabled: true });
  const before = enqueued.length;
  await b.handleGroupMessage(makeMsg({ body: "/help" }), member);
  assert.equal(enqueued.length, before, "help must not enqueue media");
  assert.ok(adapter.sentTexts.length > 0, "bot should reply with help");
  assert.ok(adapter.sentTexts[adapter.sentTexts.length - 1].text.includes("أنا بوت"), "help text expected");
});

test("user can toggle auto-convert off and back on via commands", async () => {
  const b = makeBot();
  groups.updateSettings(GID, { mode: "AUTO", enabled: true });

  // إيقاف التحويل التلقائي لأحد الأعضاء
  await b.handleTextCommand(makeMsg({ chatId: "972511111111@c.us", isGroup: false, body: "/off" }), member);
  let prefs = users.getPrefs(member.id);
  assert.equal(prefs.autoConvert, false, "/off should disable auto-convert");

  // وسيط يصل منه → لا يُحوَّل ويرد عليه بتذكير
  const dropped = makeMsg({ body: "", media: { type: "image", hasMedia: true } });
  const before = enqueued.length;
  await b.handleGroupMessage(dropped, member);
  assert.equal(enqueued.length, before, "disabled user media must not be enqueued");
  assert.ok(adapter.sentTexts[adapter.sentTexts.length - 1].text.includes("/on"), "should hint /on");

  // إعادة التفعيل
  await b.handleTextCommand(makeMsg({ chatId: "972511111111@c.us", isGroup: false, body: "/on" }), member);
  prefs = users.getPrefs(member.id);
  assert.equal(prefs.autoConvert, true, "/on should enable auto-convert");
});

test("/video off blocks only video, images still convert", async () => {
  const b = makeBot();
  groups.updateSettings(GID, { mode: "AUTO", enabled: true });
  // الافتراضي مفعل → «/فيديو» بدون اتجاه يبدّل إلى معطّل
  await b.handleTextCommand(makeMsg({ chatId: "972511111111@c.us", isGroup: false, body: "/فيديو" }), member);
  assert.equal(users.getPrefs(member.id).allowVideo, false, "toggle from default on turns it off");
  await b.handleTextCommand(makeMsg({ chatId: "972511111111@c.us", isGroup: false, body: "/video off" }), member);
  assert.equal(users.getPrefs(member.id).allowVideo, false, "/video off keeps it off");

  const before = enqueued.length;
  await b.handleGroupMessage(makeMsg({ body: "", media: { type: "video", hasMedia: true } }), member);
  assert.equal(enqueued.length, before, "video must be blocked");

  await b.handleGroupMessage(makeMsg({ body: "", media: { type: "image", hasMedia: true } }), member);
  assert.equal(enqueued.length, before + 1, "image still converts");
});

test("bot joining a group registers it, checks admin, and welcomes once", async () => {
  const b = makeBot();
  const addedOnlyBot = { chatId: GID, kind: "join", author: "972511111111@s.whatsapp.net", recipientIds: ["96880000000@lid"] };
  await b.handleGroupJoin(addedOnlyBot);
  assert.ok(groups.isBotWelcomed(GID), "group should be marked welcomed");
  assert.ok(adapter.sentTexts.some((s) => s.jid === GID), "bot sends intro to the group");
  const intros = adapter.sentTexts.filter((s) => s.jid === GID).length;
  assert.equal(intros, 1, "intro sent once");

  const anotherMember = { chatId: GID, kind: "join", author: "972511111111@s.whatsapp.net", recipientIds: ["97200000000@c.us"] };
  await b.handleGroupJoin(anotherMember);
  const introsAfter = adapter.sentTexts.filter((s) => s.jid === GID).length;
  assert.equal(introsAfter, intros, "plain member join must not trigger welcome again");
});