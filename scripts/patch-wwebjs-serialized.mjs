// patch-wwebjs-serialized.mjs
// واتساب ويب (تحديث يوليو 2026) أعاد تسمية المعرّف الداخلي id._serialized إلى id.$1.
// wwebjs 1.34.x ما زال يقرأ _serialized في مواضع كثيرة (downloadMedia, getChats…)
// فيصبح غير معرف وتفشل التنزيلات بالخطأ المبهم "r: r".
// هذا السكربت يضيف backfill _serialized عند نقاط الدخول في نسخة node_modules،
// ويُعاد تشغيله بعد كل npm install عبر postinstall. (متكرّر بأمان بعلامة wsb:)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const SRC = dirname(require.resolve("whatsapp-web.js/package.json"));
const MARK = "// wsb:serialized-backfill";

const BLOCK = `
        // wsb:serialized-backfill
        if (this.id && this.id._serialized == null && this.id.$1 != null) {
            this.id._serialized = this.id.$1;
        }`;

let changed = 0;

// 1) البنيات التي تحتوي this.id = data.id (أو data.msgKey للـ Reaction)
const structureFiles = [
  "src/structures/Message.js",
  "src/structures/Chat.js",
  "src/structures/Contact.js",
  "src/structures/GroupNotification.js",
  "src/structures/Broadcast.js",
  "src/structures/Channel.js",
  "src/structures/Call.js",
  "src/structures/Payment.js",
  "src/structures/Product.js",
  "src/structures/ProductMetadata.js",
  "src/structures/Reaction.js",
];

for (const rel of structureFiles) {
  const file = join(SRC, rel);
  if (!existsSync(file)) continue;
  let text = readFileSync(file, "utf8");
  if (text.includes(MARK)) continue;
  const re = /this\.id = (data\.id|data\.msgKey);/;
  if (!re.test(text)) continue;
  text = text.replace(re, (full) => `${full}${BLOCK}`);
  writeFileSync(file, text);
  changed++;
  console.log(`[patch-wwebjs] patched ${rel}`);
}

// 2) قراءات _serialized داخل الصفحة (Injected/Utils.js) المتعلقة بمهامنا
const utilsFile = join(SRC, "src/util/Injected/Utils.js");
if (existsSync(utilsFile)) {
  let text = readFileSync(utilsFile, "utf8");
  const pairs = [
    [/(Msg\.get\(msg\.id\._serialized\))/g, "Msg.get(msg.id._serialized || msg.id.$$1)"],
    [/(createWid\(chat\.id\._serialized\))/g, "createWid(chat.id._serialized || chat.id.$$1)"],
    [/(Msg\.get\(newMsgKey\._serialized\))/g, "Msg.get(newMsgKey._serialized || newMsgKey.$$1)"],
    [/(Msg\.get\(chat\.lastReceivedKey\._serialized\))/g, "Msg.get(chat.lastReceivedKey._serialized || chat.lastReceivedKey.$$1)"],
    [/(chat\.lastReceivedKey\._serialized,)/g, "chat.lastReceivedKey._serialized || chat.lastReceivedKey.$$1,"],
    // WhatsApp Web 2026 يتطلب messageSecret على الرسائل الصادرة، وغيابه يجعل
    // addAndSendMsgToChat يسقط الإرسال بصمت (لا خطأ، لا رسالة تصل).
    [/(isNewMsg: true,\n(\s+)type: 'chat',)/, "isNewMsg: true,\n$2messageSecret: window.crypto.getRandomValues(new Uint8Array(32)),\n$2type: 'chat',"],
  ];
  let before = text;
  for (const [re, rep] of pairs) text = text.replace(re, rep);
  if (text !== before) {
    if (!text.includes(MARK)) text = `// ${MARK} (page-side $1 fallbacks)\n${text}`;
    writeFileSync(utilsFile, text);
    changed++;
    console.log("[patch-wwebjs] patched util/Injected/Utils.js");
  }
}

if (changed === 0) console.log("[patch-wwebjs] nothing to patch (already applied?)");
else console.log(`[patch-wwebjs] patched ${changed} file(s)`);