export const version = 1;
export const name = "initial_schema";

export function up(db) {
  db.exec(`
CREATE TABLE users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  whatsapp_id    TEXT NOT NULL UNIQUE,          -- JID مثل 9725...@c.us
  phone          TEXT,
  name           TEXT,
  push_name      TEXT,
  first_seen_at  TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,
  welcome_sent   INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'ACTIVE',-- ACTIVE | BLOCKED
  role           TEXT NOT NULL DEFAULT 'USER',  -- USER | PREMIUM | ADMIN
  quota_limit    INTEGER,                        -- NULL = الإعداد العام
  quota_mode     TEXT NOT NULL DEFAULT 'default',-- default|rolling_24h|daily_fixed|unlimited|custom
  priority       INTEGER NOT NULL DEFAULT 0,     -- أعلى = أسرع خدمة (من الخادم فقط)
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_name  ON users(name COLLATE NOCASE);
CREATE INDEX idx_users_status_role ON users(status, role);

CREATE TABLE groups (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id     TEXT NOT NULL UNIQUE,            -- JID مثل 1234@g.us
  name         TEXT,
  added_at     TEXT NOT NULL,
  member_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE group_settings (
  group_id      TEXT PRIMARY KEY REFERENCES groups(group_id) ON DELETE CASCADE,
  enabled       INTEGER NOT NULL DEFAULT 1,
  mode          TEXT NOT NULL DEFAULT 'MENTION_ONLY', -- OFF|MENTION_ONLY|COMMAND_ONLY|AUTO
  daily_limit   INTEGER,                        -- NULL = بلا حد إضافي
  allowed_roles TEXT,                           -- JSON array أو NULL
  updated_at    TEXT NOT NULL
);

CREATE TABLE group_members (
  group_id  TEXT REFERENCES groups(group_id) ON DELETE CASCADE,
  user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX idx_group_members_user ON group_members(user_id);

CREATE TABLE jobs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id         TEXT REFERENCES groups(group_id) ON DELETE SET NULL,
  message_id       TEXT NOT NULL UNIQUE,        -- idempotency key
  type             TEXT NOT NULL CHECK (type IN ('IMAGE','VIDEO')),
  status           TEXT NOT NULL DEFAULT 'QUEUED'
                     CHECK (status IN ('QUEUED','PROCESSING','SENDING','COMPLETED','FAILED','CANCELLED')),
  priority         INTEGER NOT NULL DEFAULT 0,
  input_path       TEXT,                        -- NULL حتى اكتمال التنزيل
  input_hash       TEXT,
  output_path      TEXT,
  output_exists    INTEGER NOT NULL DEFAULT 0,
  attempts         INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 5,
  retry_at         TEXT,
  worker_id        TEXT,
  locked_at        TEXT,
  heartbeat_at     TEXT,
  reserved_amount  INTEGER NOT NULL DEFAULT 1,
  sticker_sent_at  TEXT,                        -- Outbox marker
  error            TEXT,
  created_at       TEXT NOT NULL,
  started_at       TEXT,
  completed_at     TEXT,
  failed_at        TEXT
);
CREATE INDEX idx_jobs_status_priority_created ON jobs(status, priority, created_at);
CREATE INDEX idx_jobs_status_created        ON jobs(status, created_at);
CREATE INDEX idx_jobs_status_user_created   ON jobs(status, user_id, created_at);
CREATE INDEX idx_jobs_hash_created          ON jobs(input_hash, created_at);
CREATE INDEX idx_jobs_retry_at              ON jobs(retry_at);

CREATE TABLE job_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt     INTEGER NOT NULL,
  status      TEXT NOT NULL,
  error       TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX idx_job_attempts_job ON job_attempts(job_id);

CREATE TABLE quota_usage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id      INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL DEFAULT 1,
  consumed_at TEXT NOT NULL
);
CREATE INDEX idx_quota_usage_user_time ON quota_usage(user_id, consumed_at);

CREATE TABLE quota_reservations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id      INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL DEFAULT 1,
  reserved_at TEXT NOT NULL
);
CREATE INDEX idx_quota_res_user_time ON quota_reservations(user_id, reserved_at);

CREATE TABLE file_cache (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  hash       TEXT NOT NULL UNIQUE,
  path       TEXT NOT NULL,
  kind       TEXT NOT NULL,                     -- image|animated
  size       INTEGER,
  job_id     INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_file_cache_expires ON file_cache(expires_at);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  level      TEXT NOT NULL CHECK (level IN ('INFO','WARN','ERROR')),
  scope      TEXT,
  message    TEXT NOT NULL,
  meta_json  TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_logs_level_time ON logs(level, created_at);
CREATE INDEX idx_logs_time       ON logs(created_at);

CREATE TABLE backups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filename    TEXT NOT NULL,
  path        TEXT NOT NULL,
  size        INTEGER,
  created_at  TEXT NOT NULL,
  encrypted   INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'ok',
  note        TEXT
);

CREATE TABLE sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id  TEXT NOT NULL UNIQUE,
  provider     TEXT NOT NULL,                   -- baileys
  payload_blob TEXT NOT NULL,                   -- JSON (قد يكون مفبركاً سابقاً مشفراً)
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_sessions_instance ON sessions(instance_id);
`);
}