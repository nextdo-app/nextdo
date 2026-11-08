/**
 * Query tests — ReviewRecords (spec: domain/domain-model.md "ReviewRecord" —
 * append-only audit trail: there are deliberately NO update or soft-delete
 * functions in the query layer).
 */
import {
  RECLARIFY_THRESHOLD,
  toIso,
  ulid,
  type DailyReviewRecord,
  type WeeklyReviewRecord,
} from '@nextdo/core';
import { sql } from 'kysely';
import { snoozeAction } from '../queries/actions';
import type { NextdoDb } from '../types';
import {
  buildDailyReviewSnapshot,
  submitReview,
  getReviewDetails,
  buildWeeklyReviewSnapshot,
  listCompletionRecords,
  listReviewCompletions,
} from '../queries/reviews';
import { addReviewRecord, listReviewRecords } from '../queries/reviews';
import { openTestDb, type TestDb } from './query-helpers';
import { FIXTURE_IDS, FIXTURE_NOW } from './fixtures';

let env: TestDb | null = null;
afterEach(async () => {
  if (env !== null) {
    await env.close();
    env = null;
  }
});
async function open(seed = false, now: Date = FIXTURE_NOW): Promise<TestDb> {
  env = await openTestDb(seed, now);
  return env;
}

function makeDaily(overrides: Partial<DailyReviewRecord> = {}): DailyReviewRecord {
  return {
    id: ulid(FIXTURE_NOW),
    createdAt: toIso(FIXTURE_NOW),
    updatedAt: toIso(FIXTURE_NOW),
    deletedAt: null,
    kind: 'daily',
    at: toIso(FIXTURE_NOW),
    snapshot: {
      inboxCount: 0,
      completedToday: [],
      stillOpen: [],
      projectsMissingActions: [],
      waitingFollowUps: [],
      calendarToday: [],
      calendarTomorrow: [],
      repeatedSkips: [],
    },
    answers: {
      completedActionIds: [],
      rescheduled: [],
      skippedNoted: [],
      tomorrowMustDo: [],
    },
    ...overrides,
  };
}

function makeWeekly(overrides: Partial<WeeklyReviewRecord> = {}): WeeklyReviewRecord {
  return {
    id: ulid(FIXTURE_NOW),
    createdAt: toIso(FIXTURE_NOW),
    updatedAt: toIso(FIXTURE_NOW),
    deletedAt: null,
    kind: 'weekly',
    at: toIso(FIXTURE_NOW),
    snapshot: {
      inboxCount: 0,
      projects: [],
      waitingFollowUps: [],
      somedayCount: 0,
      stalledProjects: [],
      calendarNext7: [],
    },
    answers: {
      inboxCleared: true,
      followUpsRaised: [],
      calendarReasonable: true,
      somedayDecisions: [],
      projectDecisions: [],
    },
    ...overrides,
  };
}

describe('listReviewRecords', () => {
  it('returns [] on an empty database', async () => {
    const { db, close } = await open();
    try {
      expect(await listReviewRecords(db)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('lists the seeded daily + weekly records ordered by at', async () => {
    const { db, close } = await open(true);
    try {
      const list = await listReviewRecords(db);
      expect(list).toHaveLength(2);
      expect(list.map((record) => record.id).sort()).toEqual(
        [FIXTURE_IDS.reviews.daily, FIXTURE_IDS.reviews.weekly].sort(),
      );
      expect(list.map((record) => record.kind).sort()).toEqual(['daily', 'weekly']);
    } finally {
      await close();
    }
  });
});

describe('addReviewRecord', () => {
  it('appends a valid daily record', async () => {
    const { db, close } = await open();
    try {
      const record = makeDaily();
      await addReviewRecord(db, record);
      expect(await listReviewRecords(db)).toEqual([record]);
    } finally {
      await close();
    }
  });

  it('appends a valid weekly record', async () => {
    const { db, close } = await open();
    try {
      const record = makeWeekly();
      await addReviewRecord(db, record);
      expect((await listReviewRecords(db)).map((item) => item.kind)).toEqual(['weekly']);
    } finally {
      await close();
    }
  });

  it('rejects a malformed snapshot (typed validation error)', async () => {
    const { db, close } = await open();
    try {
      const bad = makeDaily({ snapshot: { ...makeDaily().snapshot, inboxCount: -1 } });
      await expect(addReviewRecord(db, bad)).rejects.toMatchObject({
        code: 'validation.dailyReview.inboxCount',
      });
      expect(await listReviewRecords(db)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('rejects an unknown kind', async () => {
    const { db, close } = await open();
    try {
      const bad = makeDaily({ kind: 'monthly' } as unknown as Partial<DailyReviewRecord>);
      await expect(addReviewRecord(db, bad)).rejects.toMatchObject({
        code: 'validation.reviewRecord.kind',
      });
    } finally {
      await close();
    }
  });
});

// ---------------------------------------------------------------------------
// listCompletionRecords + buildDaily/WeeklyReviewSnapshot (task 09-22-app-ui-screens)
//
// TZ is pinned to UTC by the test script, so "device-local" == UTC in these
// tests — the local-day boundary cases below are exact.
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const at = (days: number, hours = 0): string =>
  toIso(new Date(FIXTURE_NOW.getTime() + days * DAY_MS + hours * HOUR_MS));

async function insertNextAction(
  db: NextdoDb,
  args: { id: string; createdAt: string; status?: string; consecutiveSkips?: number; projectId?: string },
): Promise<void> {
  await db
    .insertInto('next_actions')
    .values({
      id: args.id,
      created_at: args.createdAt,
      updated_at: args.createdAt,
      deleted_at: null,
      title: `na-${args.id}`,
      status: args.status ?? 'open',
      consecutive_skips: args.consecutiveSkips ?? 0,
      est_minutes: 10,
      value: 3,
      context_ids: '[]',
      project_id: args.projectId ?? null,
    })
    .execute();
}

async function insertCompletion(
  db: NextdoDb,
  args: { id: string; actionId: string; completedAt: string },
): Promise<void> {
  await db
    .insertInto('completion_records')
    .values({
      id: args.id,
      created_at: args.completedAt,
      updated_at: args.completedAt,
      deleted_at: null,
      action_kind: 'next',
      action_id: args.actionId,
      completed_at: args.completedAt,
      est_minutes: 10,
    })
    .execute();
}

async function insertWaiting(db: NextdoDb, args: { id: string; expectedBy: string | null }): Promise<void> {
  await db
    .insertInto('waiting_for_items')
    .values({
      id: args.id,
      created_at: toIso(FIXTURE_NOW),
      updated_at: toIso(FIXTURE_NOW),
      deleted_at: null,
      title: `wait-${args.id}`,
      waiting_on: 'test',
      expected_by: args.expectedBy,
    })
    .execute();
}

async function insertCalendar(db: NextdoDb, args: { id: string; startsAt: string }): Promise<void> {
  await db
    .insertInto('calendar_actions')
    .values({
      id: args.id,
      created_at: toIso(FIXTURE_NOW),
      updated_at: toIso(FIXTURE_NOW),
      deleted_at: null,
      title: `cal-${args.id}`,
      starts_at: args.startsAt,
      context_ids: '[]',
      est_minutes: 10,
      value: 3,
      status: 'open',
    })
    .execute();
}

async function insertProject(
  db: NextdoDb,
  args: { id: string; createdAt: string; status?: string },
): Promise<void> {
  await db
    .insertInto('projects')
    .values({
      id: args.id,
      created_at: args.createdAt,
      updated_at: args.createdAt,
      deleted_at: null,
      title: `proj-${args.id}`,
      outcome: 'done',
      value: 3,
      status: args.status ?? 'active',
    })
    .execute();
}

describe('listCompletionRecords', () => {
  it('returns [] on an empty database', async () => {
    const { db, close } = await open();
    try {
      expect(await listCompletionRecords(db)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('lists the seeded completions ordered by completedAt', async () => {
    const { db, close } = await open(true);
    try {
      const records = await listCompletionRecords(db);
      expect(records.map((record) => record.id).sort()).toEqual(
        [
          FIXTURE_IDS.completions.naDone,
          FIXTURE_IDS.completions.doNow,
          FIXTURE_IDS.completions.caDone,
        ].sort(),
      );
      // completedAt ascending: naDone(-2d) < doNow(-2d+1h) < caDone(-19.25h)
      expect(records[0]?.actionId).toBe(FIXTURE_IDS.actions.done);
      expect(records[2]?.actionId).toBe(FIXTURE_IDS.calendar.done);
    } finally {
      await close();
    }
  });

  it('filters by actionIds (empty list = no rows)', async () => {
    const { db, close } = await open(true);
    try {
      const records = await listCompletionRecords(db, {
        actionIds: [FIXTURE_IDS.calendar.done],
      });
      expect(records).toHaveLength(1);
      expect(records[0]?.actionId).toBe(FIXTURE_IDS.calendar.done);
      expect(await listCompletionRecords(db, { actionIds: [] })).toEqual([]);
    } finally {
      await close();
    }
  });

  it('filters by since (inclusive boundary)', async () => {
    const { db, close } = await open();
    try {
      const boundary = at(0, -10);
      await insertCompletion(db, { id: ulid(FIXTURE_NOW), actionId: 'a-old', completedAt: at(-1) });
      await insertCompletion(db, { id: ulid(FIXTURE_NOW), actionId: 'a-boundary', completedAt: boundary });
      await insertCompletion(db, { id: ulid(FIXTURE_NOW), actionId: 'a-new', completedAt: at(0, -1) });
      const records = await listCompletionRecords(db, { since: new Date(boundary) });
      expect(records.map((record) => record.actionId).sort()).toEqual(['a-boundary', 'a-new']);
    } finally {
      await close();
    }
  });
});

describe('buildDailyReviewSnapshot', () => {
  it('returns an empty snapshot on an empty database', async () => {
    const { db, close } = await open();
    try {
      await expect(buildDailyReviewSnapshot(db, FIXTURE_NOW)).resolves.toEqual({
        inboxCount: 0,
        completedToday: [],
        stillOpen: [],
        projectsMissingActions: [],
        waitingFollowUps: [],
        calendarToday: [],
        calendarTomorrow: [],
        repeatedSkips: [],
      });
    } finally {
      await close();
    }
  });

  it('derives every field from the seeded fixtures', async () => {
    const { db, close } = await open(true);
    try {
      const snapshot = await buildDailyReviewSnapshot(db, FIXTURE_NOW);
      // 2 live inbox items (the soft-deleted one is excluded).
      expect(snapshot.inboxCount).toBe(2);
      // Every fixture completion sits on a PAST local day (09-19 / 09-20).
      expect(snapshot.completedToday).toEqual([]);
      // All 8 open, non-deleted NextActions — first = oldest (skipped, -6d),
      // last = newest (b, today -2h); the four 09-20T10:00 ties are asserted
      // as a set (created_at ordering only).
      expect(snapshot.stillOpen).toHaveLength(8);
      expect(snapshot.stillOpen[0]).toBe(FIXTURE_IDS.actions.skipped);
      expect(snapshot.stillOpen[7]).toBe(FIXTURE_IDS.actions.b);
      expect(new Set(snapshot.stillOpen)).toEqual(
        new Set([
          FIXTURE_IDS.actions.skipped,
          FIXTURE_IDS.actions.depDone,
          FIXTURE_IDS.actions.window,
          FIXTURE_IDS.actions.a,
          FIXTURE_IDS.actions.blocked,
          FIXTURE_IDS.actions.baseline,
          FIXTURE_IDS.actions.snoozed,
          FIXTURE_IDS.actions.b,
        ]),
      );
      // Only the active, uncovered project (held is on-hold; paper is covered).
      expect(snapshot.projectsMissingActions).toEqual([FIXTURE_IDS.projects.empty]);
      // No fixture waiting item has a PASSED expectedBy (due=+2d, later=unset).
      expect(snapshot.waitingFollowUps).toEqual([]);
      expect(snapshot.calendarToday).toEqual([FIXTURE_IDS.calendar.soon]);
      expect(snapshot.calendarTomorrow).toEqual([FIXTURE_IDS.calendar.tomorrow]);
      // The 3-skip fixture action (RECLARIFY_THRESHOLD = 3).
      expect(snapshot.repeatedSkips).toEqual([FIXTURE_IDS.actions.skipped]);
    } finally {
      await close();
    }
  });

  it('counts completions on the local-day boundary (midnight in, 23:59:59 out)', async () => {
    const { db, close } = await open();
    try {
      // Local midnight of today (TZ pinned to UTC) → today; the instant
      // before → yesterday.
      await insertCompletion(db, { id: ulid(FIXTURE_NOW), actionId: 'a-midnight', completedAt: '2026-09-21T00:00:00.000Z' });
      await insertCompletion(db, { id: ulid(FIXTURE_NOW), actionId: 'a-just-before', completedAt: '2026-09-20T23:59:59.000Z' });
      const snapshot = await buildDailyReviewSnapshot(db, FIXTURE_NOW);
      expect(snapshot.completedToday).toEqual(['a-midnight']);
    } finally {
      await close();
    }
  });

  it('flags repeated skips at exactly 3 consecutive skips, not at 2', async () => {
    const { db, close } = await open();
    try {
      expect(RECLARIFY_THRESHOLD).toBe(3);
      await insertNextAction(db, { id: 'a-two', createdAt: toIso(FIXTURE_NOW), consecutiveSkips: 2 });
      await insertNextAction(db, { id: 'a-three', createdAt: toIso(FIXTURE_NOW), consecutiveSkips: 3 });
      const snapshot = await buildDailyReviewSnapshot(db, FIXTURE_NOW);
      expect(snapshot.repeatedSkips).toEqual(['a-three']);
    } finally {
      await close();
    }
  });

  it('lists waiting items whose expectedBy is today or in the past (not tomorrow)', async () => {
    const { db, close } = await open();
    try {
      await insertWaiting(db, { id: 'w-yesterday', expectedBy: at(-1) });
      await insertWaiting(db, { id: 'w-today', expectedBy: toIso(FIXTURE_NOW) });
      await insertWaiting(db, { id: 'w-tomorrow', expectedBy: at(1) });
      await insertWaiting(db, { id: 'w-unset', expectedBy: null });
      const snapshot = await buildDailyReviewSnapshot(db, FIXTURE_NOW);
      expect(snapshot.waitingFollowUps.sort()).toEqual(['w-today', 'w-yesterday']);
    } finally {
      await close();
    }
  });

  it('buckets calendar actions by local day (today / tomorrow / later)', async () => {
    const { db, close } = await open();
    try {
      await insertCalendar(db, { id: 'c-today', startsAt: at(0, 1) });
      await insertCalendar(db, { id: 'c-tomorrow', startsAt: at(1, 1) });
      await insertCalendar(db, { id: 'c-later', startsAt: at(2, 1) });
      const snapshot = await buildDailyReviewSnapshot(db, FIXTURE_NOW);
      expect(snapshot.calendarToday).toEqual(['c-today']);
      expect(snapshot.calendarTomorrow).toEqual(['c-tomorrow']);
    } finally {
      await close();
    }
  });
});

describe('buildWeeklyReviewSnapshot', () => {
  it('returns an empty snapshot on an empty database', async () => {
    const { db, close } = await open();
    try {
      await expect(buildWeeklyReviewSnapshot(db, FIXTURE_NOW)).resolves.toEqual({
        inboxCount: 0,
        projects: [],
        waitingFollowUps: [],
        somedayCount: 0,
        stalledProjects: [],
        calendarNext7: [],
      });
    } finally {
      await close();
    }
  });

  it('derives every field from the seeded fixtures', async () => {
    const { db, close } = await open(true);
    try {
      const snapshot = await buildWeeklyReviewSnapshot(db, FIXTURE_NOW);
      expect(snapshot.inboxCount).toBe(2);
      // Every non-deleted project, created-ascending (held -20d, paper -14d, empty -10d).
      expect(snapshot.projects.map((project) => project.id)).toEqual([
        FIXTURE_IDS.projects.held,
        FIXTURE_IDS.projects.paper,
        FIXTURE_IDS.projects.empty,
      ]);
      const paper = snapshot.projects.find((project) => project.id === FIXTURE_IDS.projects.paper);
      // Paper's only completion: the done action (naDone, -2d).
      expect(paper).toEqual({
        id: FIXTURE_IDS.projects.paper,
        title: '毕业论文实验',
        hasOpenAction: true,
        lastProgressAt: at(-2),
      });
      const empty = snapshot.projects.find((project) => project.id === FIXTURE_IDS.projects.empty);
      expect(empty?.hasOpenAction).toBe(false);
      expect(empty?.lastProgressAt).toBeNull();
      expect(snapshot.waitingFollowUps).toEqual([]);
      expect(snapshot.somedayCount).toBe(1);
      // paper progressed 2d ago (< 14d); empty was created 10d ago (< 14d);
      // held is on-hold → none stalled.
      expect(snapshot.stalledProjects).toEqual([]);
      expect(snapshot.calendarNext7.sort()).toEqual(
        [FIXTURE_IDS.calendar.soon, FIXTURE_IDS.calendar.tomorrow].sort(),
      );
    } finally {
      await close();
    }
  });

  it('applies the 14-day stall boundary (>= 14d stalled, < 14d not)', async () => {
    const { db, close } = await open();
    try {
      const nowMs = FIXTURE_NOW.getTime();
      const exactly14dAgo = toIso(new Date(nowMs - 14 * DAY_MS));
      const justUnder14dAgo = toIso(new Date(nowMs - 14 * DAY_MS + 60_000));
      const createdAt15dAgo = toIso(new Date(nowMs - 15 * DAY_MS));
      const createdAt13dAgo = toIso(new Date(nowMs - 13 * DAY_MS));

      // Progressed exactly 14 days ago → stalled (inclusive boundary).
      await insertProject(db, { id: 'p-progress-14d', createdAt: toIso(FIXTURE_NOW) });
      await insertNextAction(db, { id: 'a-p1', createdAt: toIso(FIXTURE_NOW), projectId: 'p-progress-14d' });
      await insertCompletion(db, { id: ulid(FIXTURE_NOW), actionId: 'a-p1', completedAt: exactly14dAgo });
      // Progressed 14 days minus a minute ago → not stalled.
      await insertProject(db, { id: 'p-progress-under', createdAt: toIso(FIXTURE_NOW) });
      await insertNextAction(db, { id: 'a-p2', createdAt: toIso(FIXTURE_NOW), projectId: 'p-progress-under' });
      await insertCompletion(db, { id: ulid(FIXTURE_NOW), actionId: 'a-p2', completedAt: justUnder14dAgo });
      // Never completed, created 15 days ago → stalled.
      await insertProject(db, { id: 'p-never-15d', createdAt: createdAt15dAgo });
      // Never completed, created 13 days ago → not stalled.
      await insertProject(db, { id: 'p-never-13d', createdAt: createdAt13dAgo });
      // Old but on-hold → never stalled (active projects only).
      await insertProject(db, { id: 'p-held-old', createdAt: createdAt15dAgo, status: 'on-hold' });

      const snapshot = await buildWeeklyReviewSnapshot(db, FIXTURE_NOW);
      expect(snapshot.stalledProjects.sort()).toEqual(['p-never-15d', 'p-progress-14d']);
    } finally {
      await close();
    }
  });

  it('collects calendar actions starting within the next 7 local days (window-inclusive/exclusive)', async () => {
    const { db, close } = await open();
    try {
      // Window: [today 00:00 local, today+7d 00:00 local) — TZ pinned to UTC.
      const today0000 = '2026-09-21T00:00:00.000Z';
      const plus7d0000 = '2026-09-28T00:00:00.000Z';
      await insertCalendar(db, { id: 'c-at-window-start', startsAt: today0000 });
      await insertCalendar(db, { id: 'c-inside', startsAt: at(6, 12) });
      await insertCalendar(db, { id: 'c-at-window-end', startsAt: plus7d0000 });
      await insertCalendar(db, { id: 'c-before', startsAt: '2026-09-20T23:00:00.000Z' });
      const snapshot = await buildWeeklyReviewSnapshot(db, FIXTURE_NOW);
      expect(snapshot.calendarNext7).toEqual(['c-at-window-start', 'c-inside']);
    } finally {
      await close();
    }
  });
});

describe('submitReview atomic decisions and history', () => {
  it.each(['reminders', 'review_records'] as const)('rolls back after earlier completion when %s INSERT fails, then retries once', async (table) => {
    const { db } = await open();
    await insertNextAction(db, { id: 'a-complete', createdAt: at(0) });
    await insertNextAction(db, { id: 'a-tomorrow', createdAt: at(0) });
    await snoozeAction(db, { actionKind: 'next', actionId: 'a-complete', snoozedUntil: new Date(at(1)), now: FIXTURE_NOW });
    const beforeReminders = await db.selectFrom('reminders').selectAll().execute();
    const record = makeDaily();
    record.snapshot.stillOpen = ['a-complete', 'a-tomorrow'];
    record.answers.completedActionIds = ['a-complete'];
    record.answers.tomorrowMustDo = ['a-tomorrow'];
    await sql.raw(`CREATE TRIGGER fail_review_write INSTEAD OF INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'injected review failure'); END`).execute(db);
    await expect(submitReview(db, { record, now: FIXTURE_NOW })).rejects.toThrow('injected review failure');
    expect((await db.selectFrom('next_actions').selectAll().execute()).every((row) => row.status === 'open')).toBe(true);
    expect((await db.selectFrom('next_actions').selectAll().where('id', '=', 'a-tomorrow').executeTakeFirst())?.snoozed_until).toBeNull();
    expect(await listCompletionRecords(db)).toEqual([]);
    expect(await listReviewRecords(db)).toEqual([]);
    expect(await db.selectFrom('reminders').selectAll().execute()).toEqual(beforeReminders);
    await sql.raw('DROP TRIGGER fail_review_write').execute(db);
    const saved = await submitReview(db, { record, now: FIXTURE_NOW });
    expect(saved.answers).toEqual(record.answers);
    expect(await listReviewRecords(db)).toHaveLength(1);
    expect(await listCompletionRecords(db)).toHaveLength(1);
    expect(await db.selectFrom('reminders').selectAll().where('state', '=', 'scheduled').execute()).toEqual([
      expect.objectContaining({ action_id: 'a-tomorrow', fires_at: '2026-09-22T08:00:00.000Z' }),
    ]);
    await expect(submitReview(db, { record, now: FIXTURE_NOW })).rejects.toMatchObject({ code: 'review.already-submitted' });
    expect(await listCompletionRecords(db)).toHaveLength(1);
  });

  it('rolls back weekly status and trash at final INSERT; retry preserves live unrelated project edits and titles', async () => {
    const { db } = await open(true);
    const record = makeWeekly({ snapshot: await buildWeeklyReviewSnapshot(db, FIXTURE_NOW) });
    const someday = await db.selectFrom('someday_maybe_items').selectAll().where('deleted_at', 'is', null).executeTakeFirstOrThrow();
    record.answers.projectDecisions = [{ id: FIXTURE_IDS.projects.paper, to: 'done' }];
    record.answers.somedayDecisions = [{ id: someday.id, to: 'trash' }];
    await db.updateTable('projects').set({ outcome: 'concurrently edited outcome', title: 'renamed title' }).where('id', '=', FIXTURE_IDS.projects.paper).execute();
    await sql.raw("CREATE TRIGGER fail_review_write INSTEAD OF INSERT ON review_records BEGIN SELECT RAISE(ABORT, 'injected review failure'); END").execute(db);
    await expect(submitReview(db, { record, now: FIXTURE_NOW })).rejects.toThrow('injected review failure');
    expect((await db.selectFrom('projects').select('status').where('id', '=', FIXTURE_IDS.projects.paper).executeTakeFirst())?.status).toBe('active');
    expect((await db.selectFrom('someday_maybe_items').select('deleted_at').where('id', '=', someday.id).executeTakeFirst())?.deleted_at).toBeNull();
    expect(await listReviewRecords(db)).toHaveLength(2);
    await sql.raw('DROP TRIGGER fail_review_write').execute(db);
    await submitReview(db, { record, now: FIXTURE_NOW });
    const project = await db.selectFrom('projects').selectAll().where('id', '=', FIXTURE_IDS.projects.paper).executeTakeFirst();
    expect(project).toMatchObject({ status: 'done', outcome: 'concurrently edited outcome', title: 'renamed title' });
    expect((await getReviewDetails(db, record.id))?.record.snapshot.titles?.[someday.id]).toBe(someday.title);
    expect(await listReviewRecords(db)).toHaveLength(3);
  });

  it('rejects overlapping, foreign, stale, and past-date daily choices without writes', async () => {
    const { db } = await open();
    await insertNextAction(db, { id: 'a', createdAt: at(0) });
    const record = makeDaily();
    record.snapshot.stillOpen = ['a'];
    record.answers.completedActionIds = ['a'];
    record.answers.skippedNoted = ['a'];
    await expect(submitReview(db, { record, now: FIXTURE_NOW })).rejects.toMatchObject({ code: 'review.invalid-decision' });
    record.answers.skippedNoted = [];
    record.answers.completedActionIds = ['foreign'];
    await expect(submitReview(db, { record, now: FIXTURE_NOW })).rejects.toMatchObject({ code: 'review.invalid-decision' });
    record.answers.completedActionIds = [];
    record.answers.rescheduled = [{ actionId: 'a', toDate: '2026-09-21T08:00:00.000Z' }];
    await expect(submitReview(db, { record, now: FIXTURE_NOW })).rejects.toMatchObject({ code: 'review.invalid-date' });
    record.answers.rescheduled = [];
    record.answers.tomorrowMustDo = ['a'];
    await db.updateTable('next_actions').set({ status: 'done' }).where('id', '=', 'a').execute();
    await expect(submitReview(db, { record, now: FIXTURE_NOW })).rejects.toMatchObject({ code: 'review.stale-action' });
    expect(await listReviewRecords(db)).toEqual([]);
    expect(await db.selectFrom('reminders').selectAll().execute()).toEqual([]);
  });

  it('rolls back an earlier project status change when a later terminal project rejects transition', async () => {
    const { db } = await open();
    await insertProject(db, { id: 'p-active', createdAt: at(0) });
    await insertProject(db, { id: 'p-done', status: 'done', createdAt: at(0) });
    const record = makeWeekly({ snapshot: await buildWeeklyReviewSnapshot(db, FIXTURE_NOW) });
    record.answers.projectDecisions = [{ id: 'p-active', to: 'on-hold' }, { id: 'p-done', to: 'active' }];
    await expect(submitReview(db, { record, now: FIXTURE_NOW })).rejects.toMatchObject({ code: 'invalid-transition:done:active' });
    expect((await db.selectFrom('projects').select('status').where('id', '=', 'p-active').executeTakeFirst())?.status).toBe('active');
    expect(await listReviewRecords(db)).toEqual([]);
  });

  it('retains captured titles after rename/delete, reads old records without rewriting, validates optional metadata', async () => {
    const { db } = await open();
    await insertNextAction(db, { id: 'a', createdAt: at(0) });
    const record = makeDaily();
    record.snapshot.stillOpen = ['a'];
    const saved = await submitReview(db, { record, now: FIXTURE_NOW });
    await db.updateTable('next_actions').set({ title: 'new title', deleted_at: at(1) }).where('id', '=', 'a').execute();
    const details = await getReviewDetails(db, record.id);
    expect(details?.record.snapshot.titles).toEqual({ a: 'na-a' });
    expect(details?.currentTitles).toEqual({ a: 'new title' });
    const legacy = makeDaily();
    legacy.snapshot.stillOpen = ['a', 'missing'];
    await addReviewRecord(db, legacy);
    expect((await getReviewDetails(db, legacy.id))?.record).toEqual(legacy);
    expect(await getReviewDetails(db, 'missing')).toBeNull();
    expect((await listReviewRecords(db)).find((entry) => entry.id === saved.id)).toEqual(saved);
    for (const titles of [null, [], { a: 3 }, { a: '' }]) {
      const bad = makeDaily({ snapshot: { ...record.snapshot, titles } } as unknown as Partial<DailyReviewRecord>);
      await expect(addReviewRecord(db, bad)).rejects.toMatchObject({ code: 'validation.reviewRecord.titles' });
    }
  });
});


describe('listReviewCompletions', () => {
  it('resolves mixed completion kinds, soft-deleted labels, and a missing legacy label on the local day', async () => {
    const { db } = await open(true);
    const day = await db.selectFrom('habit_days').select(['id', 'habit_id']).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
    const examples = [
      { id: FIXTURE_IDS.actions.trashed, kind: 'next' },
      { id: FIXTURE_IDS.calendar.done, kind: 'calendar' },
      { id: day.id, kind: 'habit' },
      { id: FIXTURE_IDS.inbox.trashed, kind: 'do_now' },
      { id: 'missing-legacy', kind: 'do_now' },
    ];
    for (const example of examples) {
      await db.insertInto('completion_records').values({ id: ulid(FIXTURE_NOW), created_at: at(0), updated_at: at(0),
        deleted_at: null, completed_at: at(0), action_kind: example.kind, action_id: example.id, est_minutes: 10 }).execute();
    }
    const rows = await listReviewCompletions(db, FIXTURE_NOW);
    expect(rows).toHaveLength(5);
    for (const example of examples) expect(rows).toContainEqual(expect.objectContaining(example));
    for (const row of rows.filter((entry) => entry.id !== 'missing-legacy')) expect(row.title).not.toContain('标题不可用');
    expect(rows.find((row) => row.id === 'missing-legacy')?.title).toBe('标题不可用（missing-legacy）');
    expect(await listReviewCompletions(db, new Date('2026-09-22T00:00:00.000Z'))).toEqual([]);
  });
});
