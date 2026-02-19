/**
 * Memory Store — SQLite Schema DDL
 *
 * Applied once on first run via schema migration in SqliteMemoryStore.init()
 */
export const SCHEMA_DDL = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS runs (
  run_id    TEXT PRIMARY KEY,
  goal      TEXT NOT NULL,
  target    TEXT NOT NULL,
  persona   TEXT,
  timestamp TEXT NOT NULL,
  status    TEXT NOT NULL CHECK(status IN ('pending','running','success','failed','aborted')),
  meta      TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id    TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  type      TEXT NOT NULL,
  content   TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS errors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  signature   TEXT NOT NULL,
  category    TEXT NOT NULL,
  raw_message TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fix_recipes (
  signature      TEXT PRIMARY KEY,
  fix_steps_json TEXT NOT NULL,
  success_count  INTEGER NOT NULL DEFAULT 0,
  fail_count     INTEGER NOT NULL DEFAULT 0,
  last_updated   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policies (
  policy_id         TEXT PRIMARY KEY,
  trigger_signature TEXT NOT NULL,
  policy_json       TEXT NOT NULL,
  confidence        REAL NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_run_id    ON events(run_id);
CREATE INDEX IF NOT EXISTS idx_errors_run_id    ON errors(run_id);
CREATE INDEX IF NOT EXISTS idx_errors_signature ON errors(signature);
CREATE INDEX IF NOT EXISTS idx_policies_trigger ON policies(trigger_signature);
`
