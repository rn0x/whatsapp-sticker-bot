// BackupManager — إنشاء/استعادة/تصدير. الجلسة تُضمّن فقط مشفرة.
import archiver from "archiver";
import { createReadStream, createWriteStream, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, copyFileSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";
import { Database } from "../core/database.mjs";
import { nowIso } from "../utils/time.mjs";

const FORMAT_VERSION = 1;

export class BackupManager {
  constructor({ db, settings, logger, paths, backupsRepo, sessionsRepo, services }) {
    this.db = db;
    this.settings = settings;
    this.logger = logger;
    this.paths = paths;
    this.backups = backupsRepo;
    this.sessions = sessionsRepo;
    this.services = services;
  }

  async createBackup({ includeSession = false, passphrase = null } = {}) {
    if (includeSession && !passphrase) {
      throw new Error("الجلسة لا تُضمّن إلا مع كلمة مرور للتشفير");
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `backup-${stamp}.zip`;
    const zipPath = join(this.paths.get("backups"), filename);

    const dbSnapshot = join(this.paths.get("temp"), `snapshot-${Date.now()}.db`);
    try {
      this.db.backupTo(dbSnapshot);

      const settingsExport = JSON.stringify(this.settings.getAll(), null, 2);
      const writeSettings = join(this.paths.get("temp"), "settings.json");
      writeFileSync(writeSettings, settingsExport);

      const sessionBlob = includeSession
        ? this._exportSession(passphrase)
        : null;

      const manifest = {
        formatVersion: FORMAT_VERSION,
        appVersion: process.env.npm_package_version || "0.1.0",
        createdAt: nowIso(),
        encrypted: includeSession,
        dbSize: statSync(dbSnapshot).size,
        sessionIncluded: includeSession,
      };

      const output = createWriteStream(zipPath);
      const arc = archiver("zip", { zlib: { level: 9 } });
      arc.pipe(output);
      arc.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
      arc.append(readFileSync(dbSnapshot), { name: "database.db" });
      arc.append(readFileSync(writeSettings), { name: "settings.json" });
      if (includeSession) arc.append(JSON.stringify(sessionBlob), { name: "session.json" });

      await new Promise((resolve, reject) => {
        output.on("close", resolve);
        arc.on("error", reject);
        arc.finalize();
      });

      const record = this.backups.create({
        filename,
        path: zipPath,
        size: statSync(zipPath).size,
        encrypted: includeSession,
        note: includeSession ? "with encrypted session" : "no session",
      });
      this.logger.info("backup", `backup created: ${filename}`, { size: record.size });
      return record;
    } finally {
      try { unlinkSync(dbSnapshot); } catch { /* ignore */ }
    }
  }

  _exportSession(passphrase) {
    const list = this.sessions.list();
    const out = {};
    for (const s of list) {
      const full = this.sessions.get(s.instance_id);
      out[s.instance_id] = {
        provider: full.provider,
        encrypted: encryptJson(full.payload, passphrase),
      };
    }
    return out;
  }

  async restoreBackup({ zipPath, passphrase = null }) {
    this.logger.info("backup", `restore requested: ${basename(zipPath)}`);
    if (!existsSync(zipPath)) throw new Error("backup file not found");

    // 1) استخراج وتحقق إلى مجلد مؤقت
    const tmp = join(this.paths.get("temp"), `restore-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    await extractZip(zipPath, tmp);

    const manifestPath = join(tmp, "manifest.json");
    if (!existsSync(manifestPath)) throw new Error("invalid backup: missing manifest");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.formatVersion !== FORMAT_VERSION) {
      throw new Error(`unsupported backup format: ${manifest.formatVersion}`);
    }

    // 2) backup تلقائي للحالة الحالية (احتياط أمان + rollback)
    const safety = await this.createBackup({ includeSession: false });
    this.logger.info("backup", "safety backup taken before restore", { file: safety.filename });

    // 3) إيقاف النظام
    await this.services.shutdown();

    try {
      // 4) التحقق من قاعدة البيانات المستعادة
      const restoredDbFile = join(tmp, "database.db");
      if (!existsSync(restoredDbFile)) throw new Error("invalid backup: missing database");
      const checkDb = new Database(restoredDbFile);
      const integrity = checkDb.integrityCheck();
      await checkDb.migrate();
      const before = checkDb.integrityCheck();
      checkDb.close();
      if (!integrity.ok || !before.ok) throw new Error("restored database failed integrity check");

      // 5) استبدال الملفات
      copyFileSync(restoredDbFile, this.paths.dbPath());
      removeWalFiles(this.paths.dbPath());

      // 6) الجلسة (إن وُجدت، فك تشفيرها والتحقق من كلمة المرور)
      const sessionFile = join(tmp, "session.json");
      if (existsSync(sessionFile)) {
        if (!passphrase) throw new Error("backup contains encrypted session — passphrase required");
        const blob = JSON.parse(readFileSync(sessionFile, "utf8"));
        for (const [instanceId, entry] of Object.entries(blob)) {
          const payload = decryptJson(entry.encrypted, passphrase);
          this.sessions.set(instanceId, entry.provider, payload);
        }
      }

      // 7) إعادة تشغيل النظام (يعيد فتح DB + workers + whatsapp)
      await this.services.init();
      this.logger.info("backup", "restore completed successfully");
      return { ok: true, safetyBackup: safety.filename };
    } catch (err) {
      // التراجع التلقائي للحالة السابقة
      this.logger.error("backup", `restore failed, rolling back to ${safety.filename}`, { err: err.message });
      const safetyZip = join(this.paths.get("backups"), safety.filename);
      const rollbackTmp = join(this.paths.get("temp"), `rollback-${Date.now()}`);
      mkdirSync(rollbackTmp, { recursive: true });
      await extractZip(safetyZip, rollbackTmp);
      copyFileSync(join(rollbackTmp, "database.db"), this.paths.dbPath());
      removeWalFiles(this.paths.dbPath());
      await this.services.init();
      throw new Error(`restore failed (rolled back to ${safety.filename}): ${err.message}`);
    }
  }

  // التصدير — بدون جلسة وأسرار
  exportUsersCSV() {
    const rows = this.services.users.search({ limit: 100000 }).rows;
    const header = ["id", "whatsapp_id", "phone", "name", "role", "status", "first_seen_at", "last_seen_at", "total_jobs"];
    const lines = [header.join(",")];
    for (const r of rows) {
      const st = this.services.users.getUserStats(r.id);
      const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
      lines.push([r.id, esc(r.whatsappId), esc(r.phone), esc(r.name), r.role, r.status, r.firstSeenAt, r.lastSeenAt, st.totalJobs].join(","));
    }
    const out = join(this.paths.get("exports"), `users-${Date.now()}.csv`);
    writeFileSync(out, lines.join("\n"), "utf8");
    return out;
  }

  exportUsersJSON() {
    const rows = this.services.users.search({ limit: 100000 }).rows;
    const data = rows.map((r) => {
      const st = this.services.users.getUserStats(r.id);
      return { ...r, stats: st };
    });
    const out = join(this.paths.get("exports"), `users-${Date.now()}.json`);
    writeFileSync(out, JSON.stringify(data, null, 2), "utf8");
    return out;
  }
}

function removeWalFiles(dbPath) {
  for (const suffix of ["-wal", "-shm"]) {
    const p = dbPath + suffix;
    try { unlinkSync(p); } catch { /* ignore */ }
  }
}

async function extractZip(zipPath, outDir) {
  const yauzl = await import("yauzl");
  await new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry();
        } else {
          zipfile.openReadStream(entry, (err2, stream) => {
            if (err2) return reject(err2);
            const target = join(outDir, basename(entry.fileName));
            const out = createWriteStream(target);
            stream.pipe(out);
            out.on("close", () => zipfile.readEntry());
          });
        }
      });
      zipfile.on("end", resolve);
      zipfile.on("error", reject);
    });
  });
}

function deriveKey(passphrase) {
  return scryptSync(String(passphrase), "whatsapp-sticker-bot-backup", 32);
}

function encryptJson(value, passphrase) {
  const key = deriveKey(passphrase);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plain = Buffer.from(JSON.stringify(value), "utf8");
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString("hex"), tag: tag.toString("hex"), data: enc.toString("hex") };
}

function decryptJson(enc, passphrase) {
  const key = deriveKey(passphrase);
  const iv = Buffer.from(enc.iv, "hex");
  const tag = Buffer.from(enc.tag, "hex");
  const data = Buffer.from(enc.data, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(plain.toString("utf8"));
}