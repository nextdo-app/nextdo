/**
 * `computeReconcile` — the pure reconcile decision (task 09-30 design §3,
 * implement.md B2). The adapter layer is a thin wrapper and is covered by
 * manual acceptance; this suite is the unit-test subject.
 *
 * Cases (B2 checklist):
 *   - 补排 (native): a future, titled, not-yet-pending row is scheduled;
 *   - orphan cancel (native): a title-null row with a pending
 *     notification is cancelled (the row itself is never touched);
 *   - pending-orphan cancel (native): a pending id with no matching
 *     scheduled row is cancelled;
 *   - past rows (native): never scheduled and never cancelled while
 *     pending — no late catch-up (R7);
 *   - title-null skip: a future orphan without a pending notification is
 *     neither scheduled nor cancelled;
 *   - tauri grace window: within GRACE → fire now; beyond GRACE → skipped;
 *   - firedIds dedupe (tauri): a row delivered earlier this session is
 *     not fired again;
 *   - idempotency (AC7): a second pass after the operations were applied
 *     (pending ids now include the scheduled rows) yields nothing.
 */
import { computeReconcile, TAURI_FIRE_GRACE_MS, type ReconcileInput } from './reminder-scheduler';
import type { ScheduledReminderRow } from '@nextdo/db';

/** A fixed reconcile moment — the tests build fires_at relative to it. */
const NOW = new Date('2026-09-30T12:00:00.000Z');
const MIN = 60 * 1000;

/** Build a scheduled reminder row relative to NOW. */
function row(overrides: Partial<ScheduledReminderRow> & { id: string }): ScheduledReminderRow {
  // `Partial` lets a caller pass `note: undefined`; the column is nullable
  // but never undefined, so pull it out and normalize it explicitly. Same for
  // `estMinutes`.
  const { note, estMinutes, ...rest } = overrides;
  return {
    kind: 'next',
    actionId: `act-${overrides.id}`,
    firesAt: new Date(NOW.getTime() + 30 * MIN).toISOString(),
    intensity: 'normal',
    title: '默认标题',
    note: note ?? null,
    estMinutes: estMinutes ?? null,
    ...rest,
  };
}

function input(overrides: Partial<ReconcileInput> & { rows: ScheduledReminderRow[] }): ReconcileInput {
  return {
    mode: 'native',
    // The in-app master switch defaults ON — only the #24 cases below turn it
    // off, so every pre-existing case keeps asserting its original behavior.
    enabled: true,
    now: NOW,
    pendingIds: new Set<string>(),
    ...overrides,
  };
}

describe('computeReconcile — native mode', () => {
  it('schedules a future titled row that is not pending (补排)', () => {
    const r = row({ id: 'r1' });
    const out = computeReconcile(input({ rows: [r] }));
    expect(out.toSchedule).toEqual([{ row: r, title: '默认标题' }]);
    expect(out.toCancel).toEqual([]);
    expect(out.toFireNow).toEqual([]);
  });

  it('does not schedule a row that is already pending (no duplicates)', () => {
    const r = row({ id: 'r1' });
    const out = computeReconcile(input({ rows: [r], pendingIds: new Set(['r1']) }));
    expect(out.toSchedule).toEqual([]);
    expect(out.toCancel).toEqual([]);
  });

  it('cancels an orphan row (title null) that still has a pending notification', () => {
    const orphan = row({ id: 'r1', title: null });
    const out = computeReconcile(input({ rows: [orphan], pendingIds: new Set(['r1']) }));
    expect(out.toCancel).toEqual(['r1']);
    expect(out.toSchedule).toEqual([]);
  });

  it('cancels pending ids that have no matching scheduled row (business-canceled)', () => {
    const live = row({ id: 'r1' });
    const out = computeReconcile(input({ rows: [live], pendingIds: new Set(['r1', 'stale-1', 'stale-2']) }));
    expect(out.toCancel).toEqual(['stale-1', 'stale-2']);
    expect(out.toSchedule).toEqual([]);
  });

  it('never schedules a past row (R7 — no late catch-up delivery)', () => {
    const past = row({ id: 'r1', firesAt: new Date(NOW.getTime() - MIN).toISOString() });
    const out = computeReconcile(input({ rows: [past] }));
    expect(out.toSchedule).toEqual([]);
    expect(out.toCancel).toEqual([]);
  });

  it('leaves a pending past-row notification to fire naturally (no cancel)', () => {
    const past = row({ id: 'r1', firesAt: new Date(NOW.getTime() - MIN).toISOString() });
    const out = computeReconcile(input({ rows: [past], pendingIds: new Set(['r1']) }));
    expect(out.toSchedule).toEqual([]);
    expect(out.toCancel).toEqual([]);
  });

  it('skips a future orphan without a pending notification (nothing to do)', () => {
    const orphan = row({ id: 'r1', title: null });
    const out = computeReconcile(input({ rows: [orphan] }));
    expect(out).toEqual({ toSchedule: [], toCancel: [], toFireNow: [] });
  });

  it('skips a row with a corrupt fires_at (defensive)', () => {
    const bad = row({ id: 'r1', firesAt: 'not-a-date' });
    const out = computeReconcile(input({ rows: [bad], pendingIds: new Set(['r1']) }));
    expect(out.toSchedule).toEqual([]);
    // The row still matches the pending id by row id — but title is set,
    // so only the business-cancel rule could apply: the row IS live, so
    // no cancel either.
    expect(out.toCancel).toEqual([]);
  });

  it('is idempotent: a second pass after the schedule applied yields nothing (AC7)', () => {
    const r1 = row({ id: 'r1' });
    const r2 = row({ id: 'r2', firesAt: new Date(NOW.getTime() + 90 * MIN).toISOString() });
    const first = computeReconcile(input({ rows: [r1, r2] }));
    expect(first.toSchedule.map((item) => item.row.id)).toEqual(['r1', 'r2']);
    // The adapter scheduled both — they are now pending:
    const second = computeReconcile(input({ rows: [r1, r2], pendingIds: new Set(['r1', 'r2']) }));
    expect(second).toEqual({ toSchedule: [], toCancel: [], toFireNow: [] });
  });
});

describe('computeReconcile — tauri mode', () => {
  it('fires a row that crossed fires_at within the grace window', () => {
    const r = row({ id: 'r1', firesAt: new Date(NOW.getTime() - 2 * MIN).toISOString() });
    const out = computeReconcile(input({ mode: 'tauri', rows: [r] }));
    expect(out.toFireNow).toEqual([{ row: r, title: '默认标题' }]);
    expect(out.toSchedule).toEqual([]);
    expect(out.toCancel).toEqual([]);
  });

  it('never fires a row past by more than the grace window (missed while closed)', () => {
    const late = row({ id: 'r1', firesAt: new Date(NOW.getTime() - (TAURI_FIRE_GRACE_MS / MIN) * MIN - MIN).toISOString() });
    const out = computeReconcile(input({ mode: 'tauri', rows: [late] }));
    expect(out.toFireNow).toEqual([]);
  });

  it('does not fire future rows (they wait for the crossing tick)', () => {
    const future = row({ id: 'r1', firesAt: new Date(NOW.getTime() + MIN).toISOString() });
    const out = computeReconcile(input({ mode: 'tauri', rows: [future] }));
    expect(out.toFireNow).toEqual([]);
  });

  it('never fires an orphan (title null) even within the grace window', () => {
    const orphan = row({ id: 'r1', title: null, firesAt: new Date(NOW.getTime() - MIN).toISOString() });
    const out = computeReconcile(input({ mode: 'tauri', rows: [orphan] }));
    expect(out.toFireNow).toEqual([]);
  });

  it('dedupes against firedIds: a row delivered this session is not fired again', () => {
    const r = row({ id: 'r1', firesAt: new Date(NOW.getTime() - MIN).toISOString() });
    const out = computeReconcile(input({ mode: 'tauri', rows: [r], firedIds: new Set(['r1']) }));
    expect(out.toFireNow).toEqual([]);
  });

  it('never produces cancels (desktop has no OS-side pending state)', () => {
    const r = row({ id: 'r1', firesAt: new Date(NOW.getTime() - MIN).toISOString() });
    const out = computeReconcile(input({ mode: 'tauri', rows: [r], pendingIds: new Set(['stale']) }));
    expect(out.toCancel).toEqual([]);
    expect(out.toFireNow).toHaveLength(1);
  });
});

describe('computeReconcile — the in-app master switch (issue #24 R2)', () => {
  it('withdraws every armed notification and schedules nothing when off (native)', () => {
    const r1 = row({ id: 'r1' });
    const r2 = row({ id: 'r2', firesAt: new Date(NOW.getTime() + 90 * MIN).toISOString() });
    const out = computeReconcile(
      input({ rows: [r1, r2], pendingIds: new Set(['r1', 'r2']), enabled: false }),
    );
    expect(out.toSchedule).toEqual([]);
    expect(out.toCancel).toEqual(['r1', 'r2']);
    expect(out.toFireNow).toEqual([]);
  });

  it('withdraws even when the business row is already gone (id is all it needs)', () => {
    const out = computeReconcile(
      input({ rows: [], pendingIds: new Set(['ghost']), enabled: false }),
    );
    expect(out).toEqual({ toSchedule: [], toCancel: ['ghost'], toFireNow: [] });
  });

  it('never fires a due row on desktop while off (tauri has no OS-side state)', () => {
    const due = row({ id: 'r1', firesAt: new Date(NOW.getTime() - MIN).toISOString() });
    const out = computeReconcile(input({ mode: 'tauri', rows: [due], enabled: false }));
    expect(out).toEqual({ toSchedule: [], toCancel: [], toFireNow: [] });
  });

  it('is idempotent while off: a second pass after the cancels applied yields nothing', () => {
    const r1 = row({ id: 'r1' });
    const first = computeReconcile(
      input({ rows: [r1], pendingIds: new Set(['r1']), enabled: false }),
    );
    expect(first.toCancel).toEqual(['r1']);
    const second = computeReconcile(
      input({ rows: [r1], pendingIds: new Set(), enabled: false }),
    );
    expect(second).toEqual({ toSchedule: [], toCancel: [], toFireNow: [] });
  });
});
