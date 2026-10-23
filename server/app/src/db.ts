/**
 * Postgres access — ALL server-side SQL lives here (spec:
 * app/database-guidelines.md "Source of Truth & Layers";
 * project/directory-structure.md: "Server-side Postgres SQL (upload apply
 * logic, JWT minting) — server/app/src only").
 *
 * @nextdo/server is ISOLATED (Rule 1: no monorepo imports) — the table
 * catalog below re-declares the client schema from
 * packages/db/src/schema.ts. Keep the two in lockstep: a schema change is
 * one change unit (schema.ts + server/powersync/sync-config.yaml stream +
 * the DDL in server/powersync/init — database-guidelines.md "Schema
 * changes").
 *
 * SQL-safety model: table and column names are interpolated ONLY from the
 * static catalogs below (never from request data); every VALUE is a
 * bind parameter.
 *
 * Upload conflict policy v1 (single user — database-guidelines.md):
 *   - mutable tables: PUT/PATCH upsert (last-uploaded wins per row);
 *     DELETE soft-deletes via `deleted_at` (every table has it; the client
 *     itself trashes via a deleted_at UPDATE — a raw DELETE op still must
 *     not hard-delete server-side data).
 *   - append-only tables (review_records, completion_records): PUT
 *     inserts (a duplicate PUT is a no-op — the audit trail keeps its
 *     first write); PATCH/DELETE are rejected at the endpoint (upload.ts).
 */
import pg from 'pg';
import { logger } from './logger.js';

/** Mutable tables → declared columns (id excluded — it is the ULID PK the
 *  client mints; matches packages/db/src/schema.ts exactly). */
export const MUTABLE_TABLES: Readonly<Record<string, readonly string[]>> = {
  inbox_items: ['created_at', 'updated_at', 'deleted_at', 'title', 'captured_at'],
  projects: [
    'created_at',
    'updated_at',
    'deleted_at',
    'title',
    'outcome',
    'value',
    'status',
    'deadline',
  ],
  next_actions: [
    'created_at',
    'updated_at',
    'deleted_at',
    'title',
    'project_id',
    'context_ids',
    'est_minutes',
    'value',
    'category',
    'due_date',
    'deadline',
    'depends_on_id',
    'window_start',
    'window_end',
    'window_days',
    'snoozed_until',
    'last_snoozed_at',
    'consecutive_skips',
    'last_skipped_at',
    'status',
    'source_inbox_id',
    'replaces_action_id',
    'note',
  ],
  waiting_for_items: [
    'created_at',
    'updated_at',
    'deleted_at',
    'title',
    'waiting_on',
    'expected_by',
    'follow_up_at',
  ],
  calendar_actions: [
    'created_at',
    'updated_at',
    'deleted_at',
    'title',
    'starts_at',
    'context_ids',
    'est_minutes',
    'value',
    'category',
    'deadline',
    'snoozed_until',
    'last_snoozed_at',
    'consecutive_skips',
    'last_skipped_at',
    'status',
    'source_inbox_id',
    'replaces_action_id',
    'note',
  ],
  someday_maybe_items: ['created_at', 'updated_at', 'deleted_at', 'title', 'note'],
  reference_items: ['created_at', 'updated_at', 'deleted_at', 'title', 'url', 'note'],
  contexts: ['created_at', 'updated_at', 'deleted_at', 'name'],
  habits: [
    'created_at',
    'updated_at',
    'deleted_at',
    'title',
    'action_title',
    'est_minutes',
    'value',
    'category',
    'project_id',
    'window_start',
    'window_end',
    'window_days',
    'cycle_days',
    'started_at',
    'status',
  ],
  habit_days: [
    'created_at',
    'updated_at',
    'deleted_at',
    'habit_id',
    'local_date',
    'status',
    'snoozed_until',
    'last_snoozed_at',
    'consecutive_skips',
    'last_skipped_at',
  ],
  reminders: [
    'created_at',
    'updated_at',
    'deleted_at',
    'action_kind',
    'action_id',
    'fires_at',
    'intensity',
    'state',
  ],
  focus_sessions: [
    'created_at',
    'updated_at',
    'deleted_at',
    'action_id',
    'action_kind',
    'mode',
    'planned_minutes',
    'started_at',
    'paused_sec',
    'ended_at',
    'status',
  ],
};

/** Append-only audit trails → declared columns (same source). */
export const APPEND_ONLY_TABLES: Readonly<Record<string, readonly string[]>> = {
  review_records: ['created_at', 'updated_at', 'deleted_at', 'kind', 'at', 'snapshot', 'answers'],
  completion_records: [
    'created_at',
    'updated_at',
    'deleted_at',
    'action_kind',
    'action_id',
    'completed_at',
    'est_minutes',
  ],
};

/** The pool surface the server uses (a pg.Pool satisfies it structurally;
 *  tests inject an in-memory mock of the same shape). */
export interface DbQueryResult {
  rows: unknown[];
}

export interface DbClient {
  query(text: string, values?: readonly unknown[]): Promise<DbQueryResult>;
  release(): void;
}

export interface DbPool {
  connect(): Promise<DbClient>;
  query(text: string, values?: readonly unknown[]): Promise<DbQueryResult>;
  end(): Promise<void>;
}

/** pg pool with explicit sizing (versions-node.md: configure max/idle). */
export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

/** Run `fn` in one Postgres transaction (BEGIN/COMMIT/ROLLBACK). A failure
 *  rolls back and rethrows — the caller (the /upload handler) maps it to a
 *  5xx, which the client treats as transient (block + retry). */
export async function withTransaction<T>(pool: DbPool, fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // The original failure is the one to surface; the rollback problem
      // is logged (no silent catch).
      logger.error('db.rollback-failed', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Build the statement applying one PUT/PATCH to a mutable table. `data` is
 * filtered to the table's declared columns (unknown keys are dropped — the
 * client schema is the source of truth; anything else is protocol drift).
 * Returns null when no declared column is present (the op is a no-op).
 */
export function buildUpsert(
  table: string,
  columns: readonly string[],
  id: string,
  data: Record<string, unknown>,
): { text: string; values: unknown[] } | null {
  const cols = columns.filter((c) => Object.prototype.hasOwnProperty.call(data, c));
  if (cols.length === 0) {
    return null;
  }
  const names = ['id', ...cols];
  const placeholders = names.map((_, i) => `$${i + 1}`).join(', ');
  const updates = cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  const values: unknown[] = [id, ...cols.map((c) => data[c])];
  const text =
    `INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders}) ` +
    `ON CONFLICT (id) DO UPDATE SET ${updates}`;
  return { text, values };
}

/**
 * Build the statement for a PUT on an append-only table: insert, and a
 * NO-OP on conflict — the audit trail never gets overwritten (a retry
 * re-PUT is idempotent). Returns null when nothing is insertable.
 */
export function buildInsertOnly(
  table: string,
  columns: readonly string[],
  id: string,
  data: Record<string, unknown>,
): { text: string; values: unknown[] } | null {
  const cols = columns.filter((c) => Object.prototype.hasOwnProperty.call(data, c));
  if (cols.length === 0) {
    return null;
  }
  const names = ['id', ...cols];
  const placeholders = names.map((_, i) => `$${i + 1}`).join(', ');
  const values: unknown[] = [id, ...cols.map((c) => data[c])];
  const text =
    `INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders}) ` +
    `ON CONFLICT (id) DO NOTHING`;
  return { text, values };
}

/**
 * Build the soft-delete for a DELETE op on a mutable table (Trash =
 * deleted_at set — domain-model.md; never a hard DELETE FROM). `nowIso` is
 * the app clock as ISO-8601 UTC, passed as a value (testable).
 */
export function buildSoftDelete(table: string, id: string, nowIso: string): {
  text: string;
  values: unknown[];
} {
  return {
    text: `UPDATE ${table} SET deleted_at = $2 WHERE id = $1`,
    values: [id, nowIso],
  };
}
