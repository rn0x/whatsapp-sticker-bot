// مصادقة لوحة التحكم — scrypt + جلسة برمز عشوائي منتهي الصلاحية.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 ساعة

export class AdminAuth {
  constructor(settings, sessions = null) {
    this.settings = settings;
    this.sessions = sessions || new Map(); // token -> {expires}
  }

  isConfigured() {
    return !!this.settings.get("admin.passwordHash");
  }

  setPassword(plain) {
    if (typeof plain !== "string" || plain.length < 4) {
      throw new Error("password too weak (min 4 chars)");
    }
    const salt = randomBytes(16).toString("hex");
    const hash = derive(plain, salt);
    this.settings.set("admin.passwordHash", hash);
    this.settings.set("admin.salt", salt);
    this.settings.set("admin.requireLogin", true);
  }

  verify(plain) {
    const hash = this.settings.get("admin.passwordHash");
    const salt = this.settings.get("admin.salt");
    if (!hash || !salt) return false;
    try {
      const expected = Buffer.from(hash, "hex");
      const actual = derive(plain, salt);
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }

  createSession() {
    const token = randomBytes(32).toString("hex");
    this.sessions.set(token, { expires: Date.now() + SESSION_TTL_MS });
    return token;
  }

  verifySession(token) {
    const s = this.sessions.get(token);
    if (!s) return false;
    if (Date.now() > s.expires) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  destroySession(token) {
    this.sessions.delete(token);
  }

  requireAuth(token) {
    return this.verifySession(token);
  }

  // لوحة التحكم مفتوحة دائماً بلا تسجيل دخول (متطلب المستخدم).
  loginRequired() {
    return false;
  }
}

function derive(plain, salt) {
  return scryptSync(String(plain), salt, 64);
}