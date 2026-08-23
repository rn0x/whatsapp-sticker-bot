// WWebJS RemoteAuth Store — يحفظ الجلسة (zip مضغوط) داخل SQLite عبر SessionsRepo.
// يضمن: استمرار الجلسة عبر إعادة التشغيل + تضمينها مشفرة في النسخ الاحتياطي.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function createWWebJSStore({ sessions, instanceId, logger, dataPath }) {
  const sessionName = instanceId || "primary";
  const key = `wwebjs:${sessionName}`;
  const dir = dataPath || join(process.cwd(), ".wwebjs_auth");

  const getBlob = () => {
    const rec = sessions.get(key);
    const b64 = rec?.payload?.zipBase64;
    return b64 ? Buffer.from(b64, "base64") : null;
  };

  return {
    async sessionExists({ session }) {
      return !!getBlob();
    },
    async save({ session }) {
      // RemoteAuth يكتب <dataPath>/<sessionName>.zip ثم يستدعي store.save
      try {
        const buf = await readFile(join(dir, `${session}.zip`));
        sessions.set(key, "wwebjs", {
          session,
          zipBase64: buf.toString("base64"),
          savedAt: new Date().toISOString(),
        });
        logger?.info?.("whatsapp", `wwebjs session saved (${buf.length} bytes)`);
      } catch (err) {
        logger?.error?.("whatsapp", "wwebjs store.save failed (zip missing?)", { err: err.message });
      }
    },
    async extract({ session, path }) {
      const buf = getBlob();
      if (!buf) return;
      await writeFile(path ?? join(dir, `${session}.zip`), buf);
      logger?.info?.("whatsapp", `wwebjs session extracted (${buf.length} bytes)`);
    },
    async delete({ session }) {
      sessions.delete(key);
      logger?.info?.("whatsapp", "wwebjs session deleted");
    },
  };
}