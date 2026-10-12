-- The server-side tables the upload endpoint (server/app) applies ps_crud
-- batches to. Column sets mirror packages/db/src/schema.ts EXACTLY — `id`
-- is the ULID primary key the client mints (the PowerSync SDK provides it
-- to the client, so the client never re-declares it). A schema change is
-- one change unit: packages/db/src/schema.ts + this file +
-- server/powersync/sync-config.yaml (spec: app/database-guidelines.md
-- "Schema changes").
--
-- Runs on first `docker compose up` (after 01-create-storage-db.sql),
-- against the POSTGRES_DB database (nextdo).
--
-- Types follow the client schema: column.text → TEXT, column.integer →
-- INTEGER. All data columns are nullable — a partial row (e.g. a PATCH
-- that arrives first) must stay representable; the client's own queries
-- filter deleted_at IS NULL, and the stream does the same.

CREATE TABLE inbox_items (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  title TEXT,
  captured_at TEXT
);
CREATE INDEX inbox_items_captured_at_idx ON inbox_items (captured_at);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  title TEXT,
  outcome TEXT,
  value INTEGER,
  status TEXT,
  deadline TEXT
);

CREATE TABLE next_actions (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  title TEXT,
  project_id TEXT,
  context_ids TEXT,
  est_minutes INTEGER,
  value INTEGER,
  category TEXT,
  due_date TEXT,
  deadline TEXT,
  depends_on_id TEXT,
  window_start TEXT,
  window_end TEXT,
  window_days TEXT,
  snoozed_until TEXT,
  last_snoozed_at TEXT,
  consecutive_skips INTEGER,
  last_skipped_at TEXT,
  status TEXT,
  source_inbox_id TEXT,
  replaces_action_id TEXT
);
CREATE INDEX next_actions_status_idx ON next_actions (status);
CREATE INDEX next_actions_project_id_idx ON next_actions (project_id);

CREATE TABLE waiting_for_items (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  title TEXT,
  waiting_on TEXT,
  expected_by TEXT,
  follow_up_at TEXT
);

CREATE TABLE calendar_actions (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  title TEXT,
  starts_at TEXT,
  context_ids TEXT,
  est_minutes INTEGER,
  value INTEGER,
  category TEXT,
  deadline TEXT,
  snoozed_until TEXT,
  last_snoozed_at TEXT,
  consecutive_skips INTEGER,
  last_skipped_at TEXT,
  status TEXT,
  source_inbox_id TEXT,
  replaces_action_id TEXT
);
CREATE INDEX calendar_actions_starts_at_idx ON calendar_actions (starts_at);

CREATE TABLE someday_maybe_items (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  title TEXT,
  note TEXT
);

CREATE TABLE reference_items (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  title TEXT,
  url TEXT,
  note TEXT
);

CREATE TABLE contexts (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  name TEXT
);

CREATE TABLE habits (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  title TEXT,
  action_title TEXT,
  est_minutes INTEGER,
  value INTEGER,
  category TEXT,
  project_id TEXT,
  window_start TEXT,
  window_end TEXT,
  window_days TEXT,
  cycle_days INTEGER,
  started_at TEXT,
  status TEXT
);

CREATE TABLE habit_days (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  habit_id TEXT,
  local_date TEXT,
  status TEXT,
  snoozed_until TEXT,
  last_snoozed_at TEXT,
  consecutive_skips INTEGER,
  last_skipped_at TEXT
);
CREATE INDEX habit_days_local_date_idx ON habit_days (local_date);

CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  action_kind TEXT,
  action_id TEXT,
  fires_at TEXT,
  intensity TEXT,
  state TEXT
);

CREATE TABLE focus_sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  action_id TEXT,
  action_kind TEXT,
  mode TEXT,
  planned_minutes INTEGER,
  started_at TEXT,
  paused_sec INTEGER,
  ended_at TEXT,
  status TEXT
);

-- Append-only audit trails: the upload endpoint rejects PATCH/DELETE for
-- these (spec: app/database-guidelines.md "Upload conflict policy v1").
CREATE TABLE review_records (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  kind TEXT,
  at TEXT,
  snapshot TEXT,
  answers TEXT
);
CREATE INDEX review_records_at_idx ON review_records (at);

CREATE TABLE completion_records (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  action_kind TEXT,
  action_id TEXT,
  completed_at TEXT,
  est_minutes INTEGER
);

-- PowerSync logical replication: the service's replicator streams the WAL
-- through a publication named `powersync` in the SOURCE database. Without
-- it every replication attempt fails PSYNC_S1141 ("Publication 'powersync'
-- does not exist"). FOR ALL TABLES covers the 14 tables above and any
-- additive v1 schema change (the official self-host-demo creates it in its
-- init script the same way).
CREATE PUBLICATION powersync FOR ALL TABLES;
