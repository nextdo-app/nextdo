/**
 * Auto-initialization of PostgreSQL database schema.
 *
 * Runs on backend startup (both Node.js and Cloudflare Workers).
 * Ensures all application tables and indexes exist without requiring
 * users to manually run SQL scripts in database consoles.
 */
import type { DbPool } from './db.js';
import { logger } from './logger.js';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS inbox_items (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  title TEXT,
  captured_at TEXT
);
CREATE INDEX IF NOT EXISTS inbox_items_captured_at_idx ON inbox_items (captured_at);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  title TEXT,
  outcome TEXT,
  value INTEGER,
  status TEXT
);

CREATE TABLE IF NOT EXISTS next_actions (
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
  replaces_action_id TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS next_actions_status_idx ON next_actions (status);
CREATE INDEX IF NOT EXISTS next_actions_project_id_idx ON next_actions (project_id);

CREATE TABLE IF NOT EXISTS waiting_for_items (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  title TEXT,
  waiting_on TEXT,
  expected_by TEXT,
  follow_up_at TEXT
);

CREATE TABLE IF NOT EXISTS calendar_actions (
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
  replaces_action_id TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS calendar_actions_starts_at_idx ON calendar_actions (starts_at);

CREATE TABLE IF NOT EXISTS someday_maybe_items (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  title TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS reference_items (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  title TEXT,
  url TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS contexts (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  name TEXT
);

CREATE TABLE IF NOT EXISTS habits (
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

CREATE TABLE IF NOT EXISTS habit_days (
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
CREATE INDEX IF NOT EXISTS habit_days_local_date_idx ON habit_days (local_date);

CREATE TABLE IF NOT EXISTS reminders (
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

CREATE TABLE IF NOT EXISTS focus_sessions (
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

CREATE TABLE IF NOT EXISTS review_records (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  kind TEXT,
  at TEXT,
  snapshot TEXT,
  answers TEXT
);
CREATE INDEX IF NOT EXISTS review_records_at_idx ON review_records (at);

CREATE TABLE IF NOT EXISTS completion_records (
  id TEXT PRIMARY KEY,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  action_kind TEXT,
  action_id TEXT,
  completed_at TEXT,
  est_minutes INTEGER
);
`;

/** Ensure all tables, indexes, and PowerSync replication publication exist. */
export async function initDatabaseSchema(pool: DbPool): Promise<void> {
  await pool.query(SCHEMA_SQL);
  // `CREATE TABLE IF NOT EXISTS` above never touches a table that already
  // exists, so columns added after a database was first created need their
  // own idempotent ALTER. `note` (issue #63) is one: a client that starts
  // uploading it against an older database would otherwise fail the whole
  // upload batch with "column note does not exist".
  await pool.query(`
    ALTER TABLE next_actions ADD COLUMN IF NOT EXISTS note TEXT;
    ALTER TABLE calendar_actions ADD COLUMN IF NOT EXISTS note TEXT;
  `);

  // Try to create the PowerSync publication if it does not already exist
  try {
    await pool.query('CREATE PUBLICATION powersync FOR ALL TABLES;');
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    // 42710: duplicate_object (publication "powersync" already exists)
    if (err?.code !== '42710') {
      logger.info(
        `publication creation note: ${err?.message ?? 'already configured or insufficient privilege'}`,
      );
    }
  }
}
