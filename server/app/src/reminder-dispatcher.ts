/**
 * Due-reminder dispatcher for the external channels (design.md "调度用例").
 *
 * Runs on every cron tick:
 *   1. read the reminders that are due (`state='scheduled'`, `fires_at <= now`),
 *      joined to their action's title;
 *   2. for each reminder × each configured channel, CLAIM a row in
 *      `reminder_deliveries` before sending, then send and record the outcome.
 *
 * Why claim first: the client writes no `fired` marker (PRD R7), so the
 * server is the only place that can guarantee one delivery per
 * (reminder, channel). The claim is an `INSERT … ON CONFLICT DO NOTHING
 * RETURNING id` against the unique index — a concurrent tick, or a repeat
 * of the same tick, gets no row back and skips.
 *
 * Trade-off (v1, deliberate): at-most-once. A crash between the claim and
 * the send loses that one delivery rather than risking a duplicate; a
 * failed send is recorded on the row and logged, never silently dropped.
 *
 * @nextdo/server imports nothing from the monorepo (spec:
 * project/directory-structure.md Rule 1), so the due-reminder join is
 * spelled out here in raw SQL; it mirrors
 * packages/db/src/queries/reminders.ts.
 */
import type { DbPool } from './db.js';
import type { DueReminder, ReminderChannel } from './channels.js';

export interface DispatchLogger {
  info(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface DispatchDeps {
  pool: DbPool;
  channels: readonly ReminderChannel[];
  now: Date;
  logger: DispatchLogger;
  /** Injectable transport — tests never touch the network. */
  fetchFn?: typeof fetch;
  maxAttempts?: number;
  limit?: number;
}

export interface DispatchSummary {
  due: number;
  sent: number;
  failed: number;
  skipped: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_LIMIT = 50;

interface DueReminderRow {
  id: string;
  action_kind: string | null;
  action_id: string | null;
  fires_at: string | null;
  intensity: string | null;
  title: string | null;
}

/**
 * Reminders that are due and still point at a live action.
 *
 * Mirrors packages/db/src/queries/reminders.ts (three LEFT JOINs, one per
 * `action_kind`) but filters on time and keeps only rows that still have a
 * title — an orphan reminder has nothing to say and is skipped rather than
 * sent as an empty message.
 *
 * @returns due reminders, oldest fire time first.
 */
export async function listDueReminders(
  pool: DbPool,
  now: Date,
  limit: number,
): Promise<DueReminder[]> {
  const result = await pool.query(
    `SELECT r.id,
            r.action_kind,
            r.action_id,
            r.fires_at,
            r.intensity,
            COALESCE(na.title, ca.title, h.title) AS title
       FROM reminders r
       LEFT JOIN next_actions na
              ON na.id = r.action_id
             AND r.action_kind = 'next'
             AND na.deleted_at IS NULL
       LEFT JOIN calendar_actions ca
              ON ca.id = r.action_id
             AND r.action_kind = 'calendar'
             AND ca.deleted_at IS NULL
       LEFT JOIN habit_days hd
              ON hd.id = r.action_id
             AND r.action_kind = 'habit'
             AND hd.deleted_at IS NULL
       LEFT JOIN habits h
              ON h.id = hd.habit_id
             AND h.deleted_at IS NULL
      WHERE r.state = 'scheduled'
        AND r.deleted_at IS NULL
        AND r.fires_at IS NOT NULL
        AND r.fires_at <= $1
      ORDER BY r.fires_at ASC
      LIMIT $2`,
    [now.toISOString(), limit],
  );

  return (result.rows as DueReminderRow[])
    .filter(
      (row) =>
        typeof row.id === 'string' &&
        typeof row.title === 'string' &&
        row.title.trim() !== '',
    )
    .map((row) => ({
      id: row.id,
      actionKind: row.action_kind ?? '',
      actionId: row.action_id ?? '',
      firesAt: row.fires_at ?? '',
      intensity: row.intensity ?? '',
      title: row.title as string,
    }));
}

/**
 * Claim the (reminder, channel) slot before sending.
 *
 * @returns true when this caller won the claim (the row was newly
 * inserted), false when another tick or an earlier attempt already
 * handled it.
 */
async function claimDelivery(
  pool: DbPool,
  reminderId: string,
  channel: string,
  nowIso: string,
): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO reminder_deliveries (id, reminder_id, channel, status, attempts, delivered_at)
     VALUES ($1, $2, $3, 'pending', 0, $4)
     ON CONFLICT (reminder_id, channel) DO NOTHING
     RETURNING id`,
    [crypto.randomUUID(), reminderId, channel, nowIso],
  );
  return result.rows.length > 0;
}

async function recordOutcome(
  pool: DbPool,
  reminderId: string,
  channel: string,
  status: 'sent' | 'failed',
  attempts: number,
  nowIso: string,
  lastError: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE reminder_deliveries
        SET status = $3, attempts = $4, delivered_at = $5, last_error = $6
      WHERE reminder_id = $1 AND channel = $2`,
    [reminderId, channel, status, attempts, nowIso, lastError],
  );
}

/** Deliver every due reminder to every configured channel. */
export async function dispatchDueReminders(deps: DispatchDeps): Promise<DispatchSummary> {
  const fetchFn = deps.fetchFn ?? fetch;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const limit = deps.limit ?? DEFAULT_LIMIT;
  const nowIso = deps.now.toISOString();
  const summary: DispatchSummary = { due: 0, sent: 0, failed: 0, skipped: 0 };

  const due = await listDueReminders(deps.pool, deps.now, limit);
  summary.due = due.length;

  for (const reminder of due) {
    for (const channel of deps.channels) {
      const claimed = await claimDelivery(deps.pool, reminder.id, channel.kind, nowIso);
      if (!claimed) {
        summary.skipped += 1;
        continue;
      }

      let lastError: string | null = null;
      let attempt = 0;
      for (; attempt < maxAttempts; attempt += 1) {
        try {
          const request = await channel.buildRequest(reminder, deps.now);
          const response = await fetchFn(request.url, request.init);
          if (!response.ok) {
            throw new Error(`${channel.kind} responded ${response.status}`);
          }
          lastError = null;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      const ok = lastError === null;
      await recordOutcome(
        deps.pool,
        reminder.id,
        channel.kind,
        ok ? 'sent' : 'failed',
        ok ? attempt + 1 : attempt,
        nowIso,
        lastError,
      );

      if (ok) {
        summary.sent += 1;
        // Log the channel and outcome only — never the reminder's text.
        deps.logger.info(`reminder delivered (${channel.kind})`);
      } else {
        summary.failed += 1;
        deps.logger.error(`reminder delivery failed (${channel.kind})`, lastError);
      }
    }
  }

  return summary;
}
