// واجهة WhatsAppAdapter — العقد الذي يعتمد عليه النظام.
// أي مكتبة مستقبلية (whatsapp-web.js...إلخ) يجب أن تنفذ هذه الواجهة.
//
// الأحداث: 'status' {status}, 'qr' (string), 'pairing' {code, phone},
//          'message' (عادة رسالة موحّدة), 'event' (أي حدث خام)

/**
 * المصطلح: رسالة موحّدة
 * {
 *   id, chatId, isGroup, participantId, fromMe, body,
 *   mentions: [], pushName, timestamp, quoted,
 *   media: { type: 'image'|'video'|'document'|'sticker', mimeType, hasMedia, directPath, seconds }
 * }
 */

export const WHATSAPP_ADAPTER_CONTRACT = `
interface WhatsAppAdapter {
  async connect(): Promise<void>
  async disconnect(): Promise<void>
  async destroy(): Promise<void>
  async logout(): Promise<void>
  async requestPairingCode(phoneE164: string): Promise<string>
  async downloadMedia(message: NormalizedMessage, targetPath: string): Promise<string>
  async sendText(jid: string, text: string): Promise<unknown>
  async sendSticker(jid: string, stickerPath: string, {pack?, author?}): Promise<unknown>
  async sendMedia(jid, filePath, {kind?, caption?, mime?}): Promise<unknown>
  // يحذف رسالة صادرة "للجميع" (revoke)؛ يرمي بخصائص code عند الفشل
  // (NOT_CONNECTED|NO_MSG_KEY|MSG_NOT_FOUND|TOO_OLD|CHAT_NOT_FOUND|TIMEOUT).
  async revokeMessage(msgKey: string): Promise<boolean>
  getStatus(): { status, phone, qr, pairingCode }
  on(event: string, cb: Function): this
}
`;

export async function createAdapter(config) {
  const provider = config.settings.get("whatsapp.provider") || "wwebjs";
  if (provider === "wwebjs") {
    const { WWebJSAdapter } = await import("./wwebjs-adapter.mjs");
    return new WWebJSAdapter(config);
  }
  throw new Error(`unsupported whatsapp provider: ${provider}`);
}