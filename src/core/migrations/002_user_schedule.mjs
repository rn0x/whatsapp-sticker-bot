export const version = 2;
export const name = "user_schedule_fair_scheduling";

export function up(db) {
  db.exec(`
CREATE TABLE user_schedule (
  user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_served_at  TEXT,          -- آخر مرة خدم فيها Worker هذا المستخدم
  weight          INTEGER NOT NULL DEFAULT 1  -- من الدور/الأولوية
);
`);
}