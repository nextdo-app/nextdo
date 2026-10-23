/**
 * Query tests — `listScheduledReminders` (the delivery layer's source of
 * truth, task 09-30 design §2.1): the JOIN resolves each reminder's
 * display title by kind (next / calendar / habit → parent habit), a
 * soft-deleted or missing action yields `title: null` (an orphan the
 * delivery layer cancels), and only `state='scheduled'` non-deleted rows
 * come back.
 */
import { toIso, ulid, type Reminder } from '@nextdo/core';
import { listScheduledReminders } from '../queries/reminders';
import { openTestDb, type TestDb } from './query-helpers';
import { FIXTURE_IDS, FIXTURE_NOW, fixtureHabitDayId } from './fixtures';
import { reminderToRow } from '../schema';

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

async function insertReminder(
  db: TestDb['db'],
  overrides: Partial<Reminder> & { id: string },
): Promise<void> {
  const nowIso = toIso(FIXTURE_NOW);
  const reminder: Reminder = {
    createdAt: nowIso,
    updatedAt: nowIso,
    deletedAt: null,
    actionKind: 'next',
    actionId: 'act-none',
    firesAt: toIso(new Date(FIXTURE_NOW.getTime() + 3600_000)),
    intensity: 'normal',
    state: 'scheduled',
    ...overrides,
  };
  await db.insertInto('reminders').values({ id: reminder.id, ...reminderToRow(reminder) }).execute();
}

describe('listScheduledReminders', () => {
  it('returns [] on an empty database', async () => {
    const { db, close } = await open();
    try {
      expect(await listScheduledReminders(db)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('lists the fixture scheduled rows with their kind-resolved titles, ordered by fires_at', async () => {
    const { db, close } = await open(true);
    try {
      const rows = await listScheduledReminders(db);
      // cancelled (R.cancelled) and fired (R.fired) are excluded.
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.id)).toEqual([R.soon, R.snooze]); // fires_at order
      expect(rows[0]).toEqual({
        id: R.soon,
        kind: 'calendar',
        actionId: C.soon,
        firesAt: toIso(new Date(FIXTURE_NOW.getTime() + 15 * 60_000)),
        intensity: 'important',
        title: '组会汇报', // the CalendarAction's title
        note: null,
        estMinutes: 30,
      });
      expect(rows[1]).toEqual({
        id: R.snooze,
        kind: 'next',
        actionId: A.snoozed,
        firesAt: toIso(new Date(FIXTURE_NOW.getTime() + 60 * 60_000)),
        intensity: 'normal',
        title: '取快递', // the NextAction's title
        note: null,
        estMinutes: 15,
      });
    } finally {
      await close();
    }
  });

  it('habit reminders resolve to the parent habit title (the day row has none)', async () => {
    const { db, close } = await open(true);
    try {
      const dayId = fixtureHabitDayId(H.today, 0); // the fixture's open day row
      await insertReminder(db, {
        id: ulid(FIXTURE_NOW),
        actionKind: 'habit',
        actionId: dayId,
        intensity: 'normal',
      });
      const rows = await listScheduledReminders(db);
      const habitRow = rows.find((row) => row.actionId === dayId);
      expect(habitRow).toBeDefined();
      expect(habitRow?.title).toBe('21 天晨读挑战'); // the Habit's title
      expect(habitRow?.kind).toBe('habit');
    } finally {
      await close();
    }
  });

  it('a soft-deleted action row is an orphan: the reminder stays listed with title null', async () => {
    const { db, close } = await open(true);
    try {
      // Simulate the cross-device / legacy state directly (the UI paths —
      // trash / reclarify — cancel the reminder in the same transaction,
      // see the trashAction tests; a raw soft delete leaves the orphan).
      await db
        .updateTable('next_actions')
        .set({ deleted_at: toIso(FIXTURE_NOW) })
        .where('id', '=', A.snoozed)
        .execute();
      const rows = await listScheduledReminders(db);
      const orphan = rows.find((row) => row.id === R.snooze);
      expect(orphan).toBeDefined();
      expect(orphan?.title).toBeNull();
    } finally {
      await close();
    }
  });

  it('a reminder whose habit day was soft-deleted is an orphan (title null)', async () => {
    const { db, close } = await open(true);
    try {
      const dayId = fixtureHabitDayId(H.today, 0);
      await insertReminder(db, {
        id: ulid(FIXTURE_NOW),
        actionKind: 'habit',
        actionId: dayId,
      });
      await db
        .updateTable('habit_days')
        .set({ deleted_at: toIso(FIXTURE_NOW) })
        .where('id', '=', dayId)
        .execute();
      const rows = await listScheduledReminders(db);
      const orphan = rows.find((row) => row.actionId === dayId);
      expect(orphan?.title).toBeNull();
    } finally {
      await close();
    }
  });

  it('a reminder pointing at a missing action row is an orphan (title null)', async () => {
    const { db, close } = await open();
    try {
      await insertReminder(db, { id: ulid(FIXTURE_NOW), actionId: 'act-missing' });
      const rows = await listScheduledReminders(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.title).toBeNull();
    } finally {
      await close();
    }
  });

  it('soft-deleted reminder rows are excluded', async () => {
    const { db, close } = await open(true);
    try {
      await db
        .updateTable('reminders')
        .set({ deleted_at: toIso(FIXTURE_NOW) })
        .where('id', '=', R.soon)
        .execute();
      const rows = await listScheduledReminders(db);
      expect(rows.map((row) => row.id)).toEqual([R.snooze]);
    } finally {
      await close();
    }
  });
});
