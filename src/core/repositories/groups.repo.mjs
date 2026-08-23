import { nowIso } from "../../utils/time.mjs";
import { rowToCamel, rowsToCamel } from "../../utils/keys.mjs";

const GROUP_COLS = "id, group_id, name, added_at, member_count";
const SETTINGS_COLS = "group_id, enabled, mode, daily_limit, allowed_roles, updated_at";

export class GroupsRepo {
  constructor(db) {
    this.db = db;
  }

  upsertGroup(groupId, { name, memberCount } = {}) {
    const now = nowIso();
    const r = this.db.prepare(`
      INSERT INTO groups (group_id, name, added_at, member_count) VALUES (?, ?, ?, ?)
      ON CONFLICT(group_id) DO UPDATE SET
        name=COALESCE(excluded.name, groups.name),
        member_count=COALESCE(excluded.member_count, groups.member_count)
      RETURNING ${GROUP_COLS}
    `).get(groupId, name || null, now, memberCount || 0);
    return rowToCamel(r);
  }

  getGroup(groupId) {
    const r = this.db.prepare(`SELECT ${GROUP_COLS} FROM groups WHERE group_id=?`).get(groupId);
    return rowToCamel(r);
  }

  getSettings(groupId) {
    const r = this.db.prepare(`SELECT ${SETTINGS_COLS} FROM group_settings WHERE group_id=?`).get(groupId);
    if (!r) return null;
    const out = rowToCamel(r);
    if (out.allowedRoles) {
      try {
        out.allowedRoles = JSON.parse(out.allowedRoles);
      } catch {
        out.allowedRoles = null;
      }
    }
    return out;
  }

  ensureSettings(groupId, defaults = {}) {
    this.upsertGroup(groupId, { name: defaults.name || null, memberCount: defaults.memberCount || null });
    const now = nowIso();
    const mode = (defaults.mode || "MENTION_ONLY").toUpperCase();
    const allowed = ["OFF", "MENTION_ONLY", "COMMAND_ONLY", "AUTO"];
    const safeMode = allowed.includes(mode) ? mode : "MENTION_ONLY";
    const r = this.db.prepare(`
      INSERT INTO group_settings (group_id, enabled, mode, daily_limit, allowed_roles, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(group_id) DO UPDATE SET group_id=excluded.group_id
      RETURNING ${SETTINGS_COLS}
    `).get(groupId, defaults.enabled !== undefined ? (defaults.enabled ? 1 : 0) : 1,
      safeMode, defaults.dailyLimit ?? null, defaults.allowedRoles ? JSON.stringify(defaults.allowedRoles) : null,
      now);
    return rowToCamel(r);
  }

  updateSettings(groupId, fields) {
    // لا صف إعدادات بعد؟ ننشئه أولاً (سلوك upsert آمن) وإلا كان التحديث لا-أثر.
    if (!this.getSettings(groupId)) {
      this.ensureSettings(groupId, {
        mode: fields.mode,
        enabled: fields.enabled,
        dailyLimit: fields.daily_limit,
        allowedRoles: fields.allowed_roles,
      });
    }
    const allowed = ["enabled", "mode", "daily_limit", "allowed_roles"];
    const sets = [];
    const vals = [];
    for (const k of allowed) {
      if (fields[k] !== undefined) {
        sets.push(`${k}=?`);
        let v;
        if (k === "enabled") v = fields[k] ? 1 : 0;
        else if (k === "allowed_roles") v = fields[k] ? JSON.stringify(fields[k]) : null;
        else if (k === "mode") v = String(fields[k]).toUpperCase();
        else v = fields[k];
        vals.push(v);
      }
    }
    if (sets.length) {
      sets.push("updated_at=?");
      vals.push(nowIso(), groupId);
      this.db.prepare(`UPDATE group_settings SET ${sets.join(", ")} WHERE group_id=?`).run(...vals);
    }
    return this.getSettings(groupId);
  }

  addMember(groupId, userId) {
    this.db.prepare(
      "INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)"
    ).run(groupId, userId, nowIso());
  }

  memberCounts(groupId) {
    return this.db.prepare("SELECT COUNT(*) AS c FROM group_members WHERE group_id=?").get(groupId).c;
  }

  list({ query, limit = 100, offset = 0 } = {}) {
    const where = [];
    const vals = [];
    if (query) {
      where.push("g.name LIKE ? OR g.group_id LIKE ?");
      const like = `%${query}%`;
      vals.push(like, like);
    }
    const sql = `
      SELECT g.*, s.enabled AS si, s.mode AS sm
      FROM groups g
      LEFT JOIN group_settings s ON s.group_id = g.group_id
      ${where.length ? "WHERE " + where.join(" OR ") : ""}
      ORDER BY g.id DESC LIMIT ? OFFSET ?`;
    const rows = this.db.prepare(sql).all(...vals, limit, offset);
    const count = this.db.prepare(
      `SELECT COUNT(*) AS c FROM groups g ${where.length ? "WHERE " + where.join(" OR ") : ""}`
    ).get(...vals);
    return { rows: rowsToCamel(rows), total: count.c };
  }

  outstandingJobsInGroup(groupId) {
    return this.db.prepare(
      `SELECT COUNT(*) AS c FROM jobs WHERE group_id=? AND status IN ('QUEUED','PROCESSING','SENDING')`
    ).get(groupId).c;
  }

  // ترحيب البوت في المجموعة — يُرسل مرة واحدة فقط لتجنّب إزعاج القروب عند كل دخول.
  isBotWelcomed(groupId) {
    const r = this.db.prepare("SELECT bot_welcomed FROM groups WHERE group_id=?").get(groupId);
    return !!(r && r.bot_welcomed);
  }

  markBotWelcomed(groupId) {
    const r = this.db.prepare("SELECT bot_welcomed FROM groups WHERE group_id=?").get(groupId);
    if (r) {
      this.db.prepare("UPDATE groups SET bot_welcomed=1 WHERE group_id=?").run(groupId);
    } else {
      this.upsertGroup(groupId, {});
      this.db.prepare("UPDATE groups SET bot_welcomed=1 WHERE group_id=?").run(groupId);
    }
  }
}