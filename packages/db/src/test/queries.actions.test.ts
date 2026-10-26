/**
 * Query tests — NextAction CRUD + the canonical transactions
 * (spec: domain/domain-model.md "The Complete Transaction",
 * next-action-engine.md "Skip & Re-clarify").
 *
 * Covers every exported function: happy path + empty database +
 * invariant-violation cases (typed error codes).
 */
import { toIso, ulid, type NextAction, type Value } from '@nextdo/core';
import {
  addNextAction,
  completeAction,
  listCompletedActions,
  listNextActions,
  reopenAction,
  skipAction,
  snoozeAction,
  trashAction,
  updateNextAction,
} from '../queries/actions';
import { listFocusSessions } from '../queries/focus';
import { listCompletionRecords } from '../queries/reviews';
import { listScheduledRemindersFor } from '../queries/reminders';
import { queryEnginePool } from '../queries/pool';
import { openTestDb, type TestDb } from './query-helpers';
import { FIXTURE_IDS, FIXTURE_NOW, fixtureHabitDayId } from './fixtures';

const A = FIXTURE_IDS.actions;
const C = FIXTURE_IDS.calendar;
const H = FIXTURE_IDS.habits;
const R = FIXTURE_IDS.reminders;

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

function makeAction(overrides: Partial<NextAction> = {}): NextAction {
  const now = FIXTURE_NOW;
  return {
    id: ulid(now),
    createdAt: toIso(now),
    updatedAt: toIso(now),
    deletedAt: null,
    title: '测试动作',
    contextIds: [],
    estMinutes: 25,
    value: 3 as Value,
    status: 'open',
    consecutiveSkips: 0,
    ...overrides,
  };
}

describe('listNextActions', () => {
  it('returns [] on an empty database', async () => {
    const { db, close } = await open();
    try {
      expect(await listNextActions(db)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('lists live next actions (soft-deleted excluded by default)', async () => {
    const { db, close } = await open(true);
    try {
      const list = await listNextActions(db);
      const ids = new Set(list.map((action) => action.id));
      expect(list).toHaveLength(9);
      for (const id of [A.b, A.a, A.blocked, A.baseline, A.depDone, A.done, A.window, A.snoozed, A.skipped]) {
        expect(ids.has(id)).toBe(true);
      }
      expect(ids.has(A.trashed)).toBe(false);
      // ordered by created_at
      const createdAt = list.map((action) => action.createdAt);
      expect([...createdAt].sort()).toEqual(createdAt);
    } finally {
      await close();
    }
  });

  it('includeDeleted returns the trashed row too', async () => {
    const { db, close } = await open(true);
    try {
      const list = await listNextActions(db, { includeDeleted: true });
      expect(list).toHaveLength(10);
      expect(list.map((action) => action.id)).toContain(A.trashed);
    } finally {
      await close();
    }
  });
});

describe('addNextAction', () => {
  it('inserts a valid action and it is readable back', async () => {
    const { db, close } = await open();
    try {
      const action = makeAction({ title: '新动作' });
      await addNextAction(db, action);
      const list = await listNextActions(db);
      expect(list).toHaveLength(1);
      expect(list[0]).toEqual(action);
    } finally {
      await close();
    }
  });

  it('rejects an empty title with a typed validation error', async () => {
    const { db, close } = await open();
    try {
      await expect(addNextAction(db, makeAction({ title: '  ' }))).rejects.toMatchObject({
        name: 'ValidationNextdoError',
        code: 'validation.nextAction.title',
      });
      expect(await listNextActions(db)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('rejects a non-positive estimate', async () => {
    const { db, close } = await open();
    try {
      await expect(addNextAction(db, makeAction({ estMinutes: 0 }))).rejects.toMatchObject({
        code: 'validation.nextAction.estMinutes',
      });
    } finally {
      await close();
    }
  });

  it('arms the deadline reminder in the same transaction (task 10-17)', async () => {
    const { db, close } = await open();
    try {
      const action = makeAction();
      const firesAt = new Date(FIXTURE_NOW.getTime() + 3_600_000);
      await addNextAction(db, action, { reminderAt: [toIso(firesAt)], now: FIXTURE_NOW });
      const armed = (await db.selectFrom('reminders').selectAll().execute()).filter(
        (row) => row.action_id === action.id,
      );
      expect(armed).toHaveLength(1);
      expect(armed[0]?.action_kind).toBe('next');
      expect(armed[0]?.state).toBe('scheduled');
      expect(armed[0]?.fires_at).toBe(toIso(firesAt));
    } finally {
      await close();
    }
  });

  it('arms nothing for a moment that already passed (AC-5)', async () => {
    const { db, close } = await open();
    try {
      const action = makeAction();
      await addNextAction(db, action, {
        reminderAt: [toIso(new Date(FIXTURE_NOW.getTime() - 60_000))],
        now: FIXTURE_NOW,
      });
      expect(await listScheduledRemindersFor(db, 'next', action.id)).toEqual([]);
      expect(await db.selectFrom('reminders').selectAll().execute()).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it('without a reminder input no reminder row is written', async () => {
    const { db, close } = await open();
    try {
      await addNextAction(db, makeAction());
      expect(await db.selectFrom('reminders').selectAll().execute()).toHaveLength(0);
    } finally {
      await close();
    }
  });
});

describe('updateNextAction', () => {
  // Issue #63: the note column is additive and optional — a row without a
  // note must stay note-less, never carry an empty string that then reads
  // back as a blank line on the Now card.
  it('stores an emptied or blank note as NULL', async () => {
    const { db, close } = await open();
    try {
      const action = makeAction({ note: '等对方回电话' });
      await addNextAction(db, action);
      const readNote = async () =>
        (
          await db
            .selectFrom('next_actions')
            .select('note')
            .where('id', '=', action.id)
            .executeTakeFirstOrThrow()
        ).note;
      expect(await readNote()).toBe('等对方回电话');

      await updateNextAction(db, { ...action, note: '', updatedAt: toIso(FIXTURE_NOW) });
      expect(await readNote()).toBeNull();
      const [reloaded] = await listNextActions(db);
      expect(reloaded?.note).toBeUndefined();

      await updateNextAction(db, { ...action, note: '   ', updatedAt: toIso(FIXTURE_NOW) });
      expect(await readNote()).toBeNull();
    } finally {
      await close();
    }
  });

  it('redefining (title change) resets consecutiveSkips and lastSkippedAt', async () => {
    const { db, close } = await open(true);
    try {
      const skipped = (await listNextActions(db)).find((action) => action.id === A.skipped);
      expect(skipped).toBeDefined();
      const updated = await updateNextAction(db, {
        ...(skipped as NextAction),
        title: '重新定义的标题',
        updatedAt: toIso(FIXTURE_NOW),
      });
      expect(updated.consecutiveSkips).toBe(0);
      expect(updated.lastSkippedAt).toBeUndefined();
      const reloaded = (await listNextActions(db)).find((action) => action.id === A.skipped);
      expect(reloaded?.consecutiveSkips).toBe(0);
      expect(reloaded?.lastSkippedAt).toBeUndefined();
    } finally {
      await close();
    }
  });

  it('a non-redefining update keeps the skip streak', async () => {
    const { db, close } = await open(true);
    try {
      const skipped = (await listNextActions(db)).find((action) => action.id === A.skipped);
      const updated = await updateNextAction(db, {
        ...(skipped as NextAction),
        value: 4 as Value,
        updatedAt: toIso(FIXTURE_NOW),
      });
      expect(updated.consecutiveSkips).toBe(3);
    } finally {
      await close();
    }
  });

  it('redefining (estimate change) resets consecutiveSkips and lastSkippedAt', async () => {
    const { db, close } = await open(true);
    try {
      const skipped = (await listNextActions(db)).find((action) => action.id === A.skipped);
      expect(skipped).toBeDefined();
      const updated = await updateNextAction(db, {
        ...(skipped as NextAction),
        estMinutes: 45,
        updatedAt: toIso(FIXTURE_NOW),
      });
      expect(updated.consecutiveSkips).toBe(0);
      expect(updated.lastSkippedAt).toBeUndefined();
      const reloaded = (await listNextActions(db)).find((action) => action.id === A.skipped);
      expect(reloaded?.consecutiveSkips).toBe(0);
      expect(reloaded?.lastSkippedAt).toBeUndefined();
    } finally {
      await close();
    }
  });

  it('arms the reminder and replaces the previously armed one (AC-2)', async () => {
    const { db, close } = await open(true);
    try {
      const action = (await listNextActions(db)).find((item) => item.id === A.a) as NextAction;
      const first = new Date(FIXTURE_NOW.getTime() + 3_600_000);
      const second = new Date(FIXTURE_NOW.getTime() + 7_200_000);
      await updateNextAction(db, action, { reminderAt: [toIso(first)], now: FIXTURE_NOW });
      expect(await listScheduledRemindersFor(db, 'next', A.a)).toEqual([toIso(first)]);
      await updateNextAction(db, action, { reminderAt: [toIso(second)], now: FIXTURE_NOW });
      expect(await listScheduledRemindersFor(db, 'next', A.a)).toEqual([toIso(second)]);
      // Exactly one row stays pending — the old fires_at was cancelled in the
      // same transaction instead of staying armed alongside the new one.
      const scheduled = (await db.selectFrom('reminders').selectAll().execute()).filter(
        (row) => row.action_id === A.a && row.state === 'scheduled',
      );
      expect(scheduled).toHaveLength(1);
      expect(scheduled[0]?.fires_at).toBe(toIso(second));
    } finally {
      await close();
    }
  });

  it('keeps several pending reminders for one action (task 10-26)', async () => {
    const { db, close } = await open(true);
    try {
      const action = (await listNextActions(db)).find((item) => item.id === A.a) as NextAction;
      const first = new Date(FIXTURE_NOW.getTime() + 3_600_000);
      const second = new Date(FIXTURE_NOW.getTime() + 7_200_000);
      const third = new Date(FIXTURE_NOW.getTime() + 10_800_000);
      await updateNextAction(db, action, {
        reminderAt: [toIso(second), toIso(first)],
        now: FIXTURE_NOW,
      });
      // Ordered by fires_at, regardless of the order the form sent them in.
      expect(await listScheduledRemindersFor(db, 'next', A.a)).toEqual([toIso(first), toIso(second)]);

      // A moment that stays wanted keeps its row id: the delivery layer and
      // the calendar mappings join on it, so re-creating it would cancel and
      // re-create every notification on an unrelated edit.
      const before = (await db.selectFrom('reminders').selectAll().execute()).filter(
        (row) => row.action_id === A.a && row.state === 'scheduled',
      );
      const keptId = before.find((row) => row.fires_at === toIso(first))?.id;

      await updateNextAction(db, action, {
        reminderAt: [toIso(first), toIso(third)],
        now: FIXTURE_NOW,
      });
      expect(await listScheduledRemindersFor(db, 'next', A.a)).toEqual([toIso(first), toIso(third)]);
      const after = (await db.selectFrom('reminders').selectAll().execute()).filter(
        (row) => row.action_id === A.a && row.state === 'scheduled',
      );
      expect(after.find((row) => row.fires_at === toIso(first))?.id).toBe(keptId);
      expect(after.some((row) => row.fires_at === toIso(second))).toBe(false);
    } finally {
      await close();
    }
  });

  it('clears the reminder when the form sends null', async () => {
    const { db, close } = await open(true);
    try {
      const action = (await listNextActions(db)).find((item) => item.id === A.a) as NextAction;
      await updateNextAction(db, action, {
        reminderAt: [toIso(new Date(FIXTURE_NOW.getTime() + 3_600_000))],
        now: FIXTURE_NOW,
      });
      await updateNextAction(db, action, { reminderAt: [], now: FIXTURE_NOW });
      expect(await listScheduledRemindersFor(db, 'next', A.a)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('leaves an existing reminder alone when no reminder input is given', async () => {
    const { db, close } = await open(true);
    try {
      const action = (await listNextActions(db)).find((item) => item.id === A.a) as NextAction;
      const target = new Date(FIXTURE_NOW.getTime() + 3_600_000);
      await snoozeAction(db, { actionKind: 'next', actionId: A.a, snoozedUntil: target, now: FIXTURE_NOW });
      // A rename must not disarm the reminder the snooze just armed.
      await updateNextAction(db, { ...action, title: '改个名字', updatedAt: toIso(FIXTURE_NOW) });
      expect(await listScheduledRemindersFor(db, 'next', A.a)).toEqual([toIso(target)]);
    } finally {
      await close();
    }
  });

  it('the Complete Transaction cancels the deadline reminder (AC-4)', async () => {
    const { db, close } = await open(true);
    try {
      const action = (await listNextActions(db)).find((item) => item.id === A.a) as NextAction;
      await updateNextAction(db, action, {
        reminderAt: [toIso(new Date(FIXTURE_NOW.getTime() + 3_600_000))],
        now: FIXTURE_NOW,
      });
      await completeAction(db, { actionKind: 'next', actionId: A.a, now: FIXTURE_NOW });
      expect(await listScheduledRemindersFor(db, 'next', A.a)).toEqual([]);
      const mine = (await db.selectFrom('reminders').selectAll().execute()).filter(
        (row) => row.action_id === A.a,
      );
      expect(mine.every((row) => row.state === 'cancelled')).toBe(true);
    } finally {
      await close();
    }
  });

  it('throws not-found for a missing action', async () => {
    const { db, close } = await open(true);
    try {
      const action = makeAction();
      await expect(updateNextAction(db, action)).rejects.toMatchObject({ code: 'action.not-found' });
    } finally {
      await close();
    }
  });
});

describe('completeAction (The Complete Transaction)', () => {
  it('next: status done + CompletionRecord with the copied estimate', async () => {
    const { db, close } = await open(true);
    try {
      await completeAction(db, { actionKind: 'next', actionId: A.a, now: FIXTURE_NOW });
      const list = await listNextActions(db);
      const done = list.find((action) => action.id === A.a);
      expect(done?.status).toBe('done');
      const records = await db
        .selectFrom('completion_records')
        .selectAll()
        .where('action_id', '=', A.a)
        .execute();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ action_kind: 'next', est_minutes: 10 });
    } finally {
      await close();
    }
  });

  it('next (snoozed): clears snoozedUntil and cancels the scheduled Reminder', async () => {
    const { db, close } = await open(true);
    try {
      await completeAction(db, { actionKind: 'next', actionId: A.snoozed, now: FIXTURE_NOW });
      const action = (await listNextActions(db)).find((item) => item.id === A.snoozed);
      expect(action?.status).toBe('done');
      expect(action?.snoozedUntil).toBeUndefined();
      const reminder = await db
        .selectFrom('reminders')
        .selectAll()
        .where('id', '=', FIXTURE_IDS.reminders.snooze)
        .executeTakeFirst();
      expect(reminder?.state).toBe('cancelled');
    } finally {
      await close();
    }
  });

  it('habit: completing the LAST cycle day marks the habit completed', async () => {
    const { db, close } = await open(true);
    try {
      const dayId = (await db
        .selectFrom('habit_days')
        .select('id')
        .where('habit_id', '=', H.last)
        .execute())[0]?.id;
      expect(dayId).toBeDefined();
      await completeAction(db, { actionKind: 'habit', actionId: dayId as string, now: FIXTURE_NOW });
      const habit = await db
        .selectFrom('habits')
        .select('status')
        .where('id', '=', H.last)
        .executeTakeFirst();
      expect(habit?.status).toBe('completed');
      const records = await db
        .selectFrom('completion_records')
        .selectAll()
        .where('action_kind', '=', 'habit')
        .execute();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ action_id: dayId, est_minutes: 10 });
    } finally {
      await close();
    }
  });

  it('habit: a mid-cycle day does NOT complete the habit', async () => {
    const { db, close } = await open(true);
    try {
      const dayId = (await db
        .selectFrom('habit_days')
        .select('id')
        .where('habit_id', '=', H.mid)
        .where('status', '=', 'open')
        .execute())[0]?.id;
      expect(dayId).toBeDefined();
      await completeAction(db, { actionKind: 'habit', actionId: dayId as string, now: FIXTURE_NOW });
      const habit = await db
        .selectFrom('habits')
        .select('status')
        .where('id', '=', H.mid)
        .executeTakeFirst();
      expect(habit?.status).toBe('active');
    } finally {
      await close();
    }
  });

  it('refuses a second completion (illegal transition done → done)', async () => {
    const { db, close } = await open(true);
    try {
      await expect(
        completeAction(db, { actionKind: 'next', actionId: A.done, now: FIXTURE_NOW }),
      ).rejects.toMatchObject({ code: 'invalid-transition:done:done' });
    } finally {
      await close();
    }
  });

  it('refuses a soft-deleted action (not-found)', async () => {
    const { db, close } = await open(true);
    try {
      await expect(
        completeAction(db, { actionKind: 'next', actionId: A.trashed, now: FIXTURE_NOW }),
      ).rejects.toMatchObject({ code: 'action.not-found' });
    } finally {
      await close();
    }
  });
});

describe('skipAction', () => {
  it('increments consecutiveSkips and sets lastSkippedAt', async () => {
    const { db, close } = await open(true);
    try {
      await skipAction(db, { actionKind: 'next', actionId: A.skipped, now: FIXTURE_NOW });
      const action = (await listNextActions(db)).find((item) => item.id === A.skipped);
      expect(action?.consecutiveSkips).toBe(4);
      expect(action?.lastSkippedAt).toBe(toIso(FIXTURE_NOW));
    } finally {
      await close();
    }
  });

  it('never creates a Reminder (skips are DB-only)', async () => {
    const { db, close } = await open(true);
    try {
      const before = (await db.selectFrom('reminders').selectAll().execute()).length;
      await skipAction(db, { actionKind: 'next', actionId: A.a, now: FIXTURE_NOW });
      const after = (await db.selectFrom('reminders').selectAll().execute()).length;
      expect(after).toBe(before);
    } finally {
      await close();
    }
  });
});

describe('snoozeAction', () => {
  it('sets snoozedUntil, resets skips, and creates the matching Reminder', async () => {
    const { db, close } = await open(true);
    try {
      const target = new Date(FIXTURE_NOW.getTime() + 3600_000);
      const before = (await db.selectFrom('reminders').selectAll().execute()).length;
      await snoozeAction(db, { actionKind: 'next', actionId: A.skipped, snoozedUntil: target, now: FIXTURE_NOW });
      const action = (await listNextActions(db)).find((item) => item.id === A.skipped);
      expect(action?.snoozedUntil).toBe(toIso(target));
      expect(action?.consecutiveSkips).toBe(0);
      const reminders = await db.selectFrom('reminders').selectAll().execute();
      expect(reminders).toHaveLength(before + 1);
      const created = reminders.find((reminder) => reminder.action_id === A.skipped);
      expect(created).toBeDefined();
      expect(created?.state).toBe('scheduled');
      expect(created?.fires_at).toBe(toIso(target));
    } finally {
      await close();
    }
  });

  it('throws not-found for a missing action', async () => {
    const { db, close } = await open(true);
    try {
      const target = new Date(FIXTURE_NOW.getTime() + 3600_000);
      await expect(
        snoozeAction(db, { actionKind: 'next', actionId: '01TST0000000000000000000099', snoozedUntil: target, now: FIXTURE_NOW }),
      ).rejects.toMatchObject({ code: 'action.not-found' });
    } finally {
      await close();
    }
  });

  it('a re-snooze cancels the previous scheduled Reminder in the same transaction', async () => {
    const { db, close } = await open(true);
    try {
      // A.snoozed carries the fixture scheduled reminder R.snooze.
      const first = new Date(FIXTURE_NOW.getTime() + 3600_000);
      const second = new Date(FIXTURE_NOW.getTime() + 2 * 3600_000);
      await snoozeAction(db, { actionKind: 'next', actionId: A.snoozed, snoozedUntil: first, now: FIXTURE_NOW });
      await snoozeAction(db, { actionKind: 'next', actionId: A.snoozed, snoozedUntil: second, now: FIXTURE_NOW });
      const reminders = await db
        .selectFrom('reminders')
        .selectAll()
        .where('action_id', '=', A.snoozed)
        .orderBy('created_at')
        .execute();
      // Exactly one scheduled row survives (the newest target time).
      const scheduled = reminders.filter((reminder) => reminder.state === 'scheduled');
      expect(scheduled).toHaveLength(1);
      expect(scheduled[0]?.fires_at).toBe(toIso(second));
      // The fixture row is no longer armed. It is not cancelled-and-reinserted
      // when its moment is still the target (`reconcileReminder` reuses the
      // row so its id — the delivery join key — stays stable), so the only
      // cancelled row is the fixture one, dropped once the target moved past it.
      expect(reminders.filter((reminder) => reminder.state === 'cancelled').map((r) => r.id)).toContain(
        R.snooze,
      );
    } finally {
      await close();
    }
  });
});

describe('trashAction', () => {
  it('soft-deletes (deleted_at set; the row is kept)', async () => {
    const { db, close } = await open(true);
    try {
      await trashAction(db, { actionKind: 'next', actionId: A.a, now: FIXTURE_NOW });
      const list = await listNextActions(db);
      expect(list.map((action) => action.id)).not.toContain(A.a);
      const row = await db.selectFrom('next_actions').selectAll().where('id', '=', A.a).executeTakeFirst();
      expect(row?.deleted_at).toBe(toIso(FIXTURE_NOW));
    } finally {
      await close();
    }
  });

  it('trashing twice throws not-found (the row is no longer live)', async () => {
    const { db, close } = await open(true);
    try {
      await trashAction(db, { actionKind: 'next', actionId: A.a, now: FIXTURE_NOW });
      await expect(trashAction(db, { actionKind: 'next', actionId: A.a, now: FIXTURE_NOW })).rejects.toMatchObject({
        code: 'action.not-found',
      });
    } finally {
      await close();
    }
  });

  it('cancels the action scheduled Reminders in the same transaction (R8)', async () => {
    const { db, close } = await open(true);
    try {
      // R.snooze is the fixture scheduled reminder pointing at A.snoozed.
      await trashAction(db, { actionKind: 'next', actionId: A.snoozed, now: FIXTURE_NOW });
      const reminder = await db
        .selectFrom('reminders')
        .selectAll()
        .where('id', '=', R.snooze)
        .executeTakeFirst();
      expect(reminder?.state).toBe('cancelled');
      expect(reminder?.updated_at).toBe(toIso(FIXTURE_NOW));
      // The action row is soft-deleted in the same transaction.
      const row = await db.selectFrom('next_actions').selectAll().where('id', '=', A.snoozed).executeTakeFirst();
      expect(row?.deleted_at).toBe(toIso(FIXTURE_NOW));
    } finally {
      await close();
    }
  });

  it('a reminder created by a snooze is cancelled when the action is later trashed', async () => {
    const { db, close } = await open(true);
    try {
      const target = new Date(FIXTURE_NOW.getTime() + 3600_000);
      await snoozeAction(db, { actionKind: 'next', actionId: A.a, snoozedUntil: target, now: FIXTURE_NOW });
      await trashAction(db, { actionKind: 'next', actionId: A.a, now: FIXTURE_NOW });
      const reminders = await db
        .selectFrom('reminders')
        .selectAll()
        .where('action_id', '=', A.a)
        .execute();
      expect(reminders).toHaveLength(1);
      expect(reminders[0]?.state).toBe('cancelled');
    } finally {
      await close();
    }
  });
});

describe('reopenAction — the restore transaction (issue 27)', () => {
  it('puts a done action back to open, clearing snooze state and skips', async () => {
    const { db, close } = await open(true);
    try {
      const target = new Date(FIXTURE_NOW.getTime() + 3600_000);
      await snoozeAction(db, { actionKind: 'next', actionId: A.done, now: FIXTURE_NOW, snoozedUntil: target });
      await db
        .updateTable('next_actions')
        .set({ consecutive_skips: 3 })
        .where('id', '=', A.done)
        .execute();

      await reopenAction(db, { actionKind: 'next', actionId: A.done, now: FIXTURE_NOW });

      const row = await db.selectFrom('next_actions').selectAll().where('id', '=', A.done).executeTakeFirst();
      expect(row?.status).toBe('open');
      expect(row?.snoozed_until).toBeNull();
      expect(row?.consecutive_skips).toBe(0);
      expect(row?.updated_at).toBe(toIso(FIXTURE_NOW));
    } finally {
      await close();
    }
  });

  it('soft-deletes the CompletionRecords so the review snapshots stop counting it', async () => {
    const { db, close } = await open(true);
    try {
      await reopenAction(db, { actionKind: 'next', actionId: A.done, now: FIXTURE_NOW });

      expect(await listCompletionRecords(db, { actionIds: [A.done] })).toEqual([]);
      // The row survives (soft delete — history is not destroyed).
      const row = await db
        .selectFrom('completion_records')
        .selectAll()
        .where('action_id', '=', A.done)
        .executeTakeFirst();
      expect(row?.deleted_at).toBe(toIso(FIXTURE_NOW));
    } finally {
      await close();
    }
  });

  it('leaves the action FocusSessions untouched (the point of issue 27)', async () => {
    const { db, close } = await open(true);
    try {
      const before = await listFocusSessions(db, { actionId: A.a });
      await completeAction(db, { actionKind: 'next', actionId: A.a, now: FIXTURE_NOW });
      await reopenAction(db, { actionKind: 'next', actionId: A.a, now: FIXTURE_NOW });

      expect(await listFocusSessions(db, { actionId: A.a })).toEqual(before);
    } finally {
      await close();
    }
  });

  it('the restored action is back in the engine pool', async () => {
    const { db, close } = await open(true);
    try {
      await reopenAction(db, { actionKind: 'next', actionId: A.done, now: FIXTURE_NOW });
      const pool = await queryEnginePool(db, FIXTURE_NOW);
      expect(pool.actions.map((candidate) => candidate.id)).toContain(A.done);
    } finally {
      await close();
    }
  });

  it('refuses an action that is not done (illegal transition open → open)', async () => {
    const { db, close } = await open(true);
    try {
      await expect(
        reopenAction(db, { actionKind: 'next', actionId: A.a, now: FIXTURE_NOW }),
      ).rejects.toMatchObject({ code: 'invalid-transition:open:open' });
    } finally {
      await close();
    }
  });

  it('refuses a soft-deleted action (not-found)', async () => {
    const { db, close } = await open(true);
    try {
      await expect(
        reopenAction(db, { actionKind: 'next', actionId: A.trashed, now: FIXTURE_NOW }),
      ).rejects.toMatchObject({ code: 'action.not-found' });
    } finally {
      await close();
    }
  });

  it('restores a habit 打卡 (the day row carries the title, the Habit the rest)', async () => {
    const { db, close } = await open(true);
    try {
      const dayId = fixtureHabitDayId(H.mid, -1);
      await reopenAction(db, { actionKind: 'habit', actionId: dayId, now: FIXTURE_NOW });

      const day = await db.selectFrom('habit_days').selectAll().where('id', '=', dayId).executeTakeFirst();
      expect(day?.status).toBe('open');
      // The habit itself is untouched — only a `completed` one is reopened.
      const habit = await db.selectFrom('habits').selectAll().where('id', '=', H.mid).executeTakeFirst();
      expect(habit?.status).toBe('active');
    } finally {
      await close();
    }
  });

  it('reopens a finished challenge when its last day is restored', async () => {
    const { db, close } = await open(true);
    try {
      // H.last is on its final cycle day: completing it finishes the habit.
      const lastDay = fixtureHabitDayId(H.last, 0);
      await completeAction(db, { actionKind: 'habit', actionId: lastDay, now: FIXTURE_NOW });
      const finished = await db.selectFrom('habits').selectAll().where('id', '=', H.last).executeTakeFirst();
      expect(finished?.status).toBe('completed');

      await reopenAction(db, { actionKind: 'habit', actionId: lastDay, now: FIXTURE_NOW });

      const habit = await db.selectFrom('habits').selectAll().where('id', '=', H.last).executeTakeFirst();
      expect(habit?.status).toBe('active');
      const day = await db.selectFrom('habit_days').selectAll().where('id', '=', lastDay).executeTakeFirst();
      expect(day?.status).toBe('open');
    } finally {
      await close();
    }
  });
});

describe('listCompletedActions — the 已完成行动 window read (issue 27)', () => {
  it('returns the done next, calendar and habit actions, newest completion first', async () => {
    const { db, close } = await open(true);
    try {
      const rows = await listCompletedActions(db);
      const ids = rows.map((row) => row.id);
      expect(ids).toContain(A.done);
      expect(ids).toContain(C.done);
      // A 打卡 is a pool row with its own 完成 button — it belongs here too.
      expect(ids).toContain(fixtureHabitDayId(H.mid, -1));

      const next = rows.find((row) => row.id === A.done);
      expect(next).toMatchObject({ kind: 'next', estMinutes: 30 });
      expect(next?.completedAt).not.toBeNull();
      const calendar = rows.find((row) => row.id === C.done);
      expect(calendar?.kind).toBe('calendar');
      expect(calendar?.projectId).toBeNull();
    } finally {
      await close();
    }
  });

  it('a habit row shows the parent Habit title, estimate and project', async () => {
    const { db, close } = await open(true);
    try {
      const row = (await listCompletedActions(db)).find(
        (entry) => entry.id === fixtureHabitDayId(H.mid, -1),
      );
      // The day row has none of these — the window must not show blanks.
      expect(row).toMatchObject({
        kind: 'habit',
        title: '21 天力量训练',
        estMinutes: 45,
        projectId: FIXTURE_IDS.projects.empty,
      });
    } finally {
      await close();
    }
  });

  it('a 打卡 completed from the pool lands in the window with its instant', async () => {
    const { db, close } = await open(true);
    try {
      const today = fixtureHabitDayId(H.today, 0);
      expect((await listCompletedActions(db)).map((entry) => entry.id)).not.toContain(today);

      await completeAction(db, { actionKind: 'habit', actionId: today, now: FIXTURE_NOW });

      const row = (await listCompletedActions(db)).find((entry) => entry.id === today);
      expect(row).toMatchObject({ kind: 'habit', title: '21 天晨读挑战' });
      expect(row?.completedAt).toBe(toIso(FIXTURE_NOW));
    } finally {
      await close();
    }
  });

  it('omits open and soft-deleted actions', async () => {
    const { db, close } = await open(true);
    try {
      const ids = (await listCompletedActions(db)).map((row) => row.id);
      expect(ids).not.toContain(A.a);
      expect(ids).not.toContain(A.trashed);
    } finally {
      await close();
    }
  });

  it('a restored action leaves the list', async () => {
    const { db, close } = await open(true);
    try {
      expect((await listCompletedActions(db)).map((row) => row.id)).toContain(A.done);
      await reopenAction(db, { actionKind: 'next', actionId: A.done, now: FIXTURE_NOW });
      expect((await listCompletedActions(db)).map((row) => row.id)).not.toContain(A.done);
    } finally {
      await close();
    }
  });
});
