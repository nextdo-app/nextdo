/**
 * Query tests — the simple aggregates: WaitingFor, Calendar, SomedayMaybe,
 * Reference, Context (list / add / update / trash per entity).
 *
 * Each aggregate: happy path + empty database + one invariant-violation
 * case + not-found propagation.
 */
import {
  toIso,
  ulid,
  type CalendarAction,
  type Context,
  type ReferenceItem,
  type SomedayMaybeItem,
  type Value,
  type WaitingForItem,
} from '@nextdo/core';
import {
  addCalendarAction,
  listCalendarActions,
  trashCalendarAction,
  updateCalendarAction,
} from '../queries/calendar';
import { completeAction, snoozeAction } from '../queries/actions';
import { addContext, listContexts, seedDefaultContexts, trashContext, updateContext } from '../queries/contexts';
import {
  addReferenceItem,
  listReferenceItems,
  trashReferenceItem,
  updateReferenceItem,
} from '../queries/references';
import {
  addSomedayMaybeItem,
  listSomedayMaybeItems,
  trashSomedayMaybeItem,
  updateSomedayMaybeItem,
} from '../queries/someday';
import {
  addWaitingForItem,
  listWaitingForItems,
  trashWaitingForItem,
  updateWaitingForItem,
} from '../queries/waiting';
import { waitingForWatchQuery } from '../queries/watch-queries';
import { listScheduledReminders } from '../queries/reminders';
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

function base(overrides: Partial<{ id: string }> = {}) {
  return {
    id: overrides.id ?? ulid(FIXTURE_NOW),
    createdAt: toIso(FIXTURE_NOW),
    updatedAt: toIso(FIXTURE_NOW),
    deletedAt: null,
  };
}

/** The live scheduled reminders the calendar-action rule owns. */
function scheduledCalendarReminders(db: TestDb['db'], actionId: string) {
  return db
    .selectFrom('reminders')
    .select(['id', 'fires_at', 'intensity', 'state'])
    .where('action_kind', '=', 'calendar')
    .where('action_id', '=', actionId)
    .where('state', '=', 'scheduled')
    .where('deleted_at', 'is', null)
    .execute();
}

describe('WaitingFor', () => {
  it('lists [] when empty; the seeded due + later items otherwise', async () => {
    const fresh = await open();
    try {
      expect(await listWaitingForItems(fresh.db)).toEqual([]);
    } finally {
      await fresh.close();
    }
    const { db, close } = await open(true);
    try {
      const list = await listWaitingForItems(db);
      expect(list.map((item) => item.id)).toEqual([FIXTURE_IDS.waiting.later, FIXTURE_IDS.waiting.due]);
    } finally {
      await close();
    }
  });

  it('add: inserts; rejects an item without waitingOn (invariant 3)', async () => {
    const { db, close } = await open();
    try {
      const item: WaitingForItem = { ...base(), title: '等结果', waitingOn: '师兄' };
      await addWaitingForItem(db, item);
      expect(await listWaitingForItems(db)).toHaveLength(1);
      await expect(
        addWaitingForItem(db, { ...base(), title: '等结果', waitingOn: '' }),
      ).rejects.toMatchObject({ code: 'validation.waitingForItem.waitingOn' });
    } finally {
      await close();
    }
  });

  it('update/trash propagate not-found', async () => {
    const { db, close } = await open();
    try {
      const item: WaitingForItem = { ...base(), title: '等结果', waitingOn: '师兄' };
      await addWaitingForItem(db, item);
      await updateWaitingForItem(db, { ...item, waitingOn: '导师', updatedAt: toIso(FIXTURE_NOW) });
      await trashWaitingForItem(db, { id: item.id, now: FIXTURE_NOW });
      expect(await listWaitingForItems(db)).toEqual([]);
      await expect(
        updateWaitingForItem(db, { ...item, waitingOn: 'x', updatedAt: toIso(FIXTURE_NOW) }),
      ).rejects.toMatchObject({ code: 'waitingForItem.not-found' });
    } finally {
      await close();
    }
  });

  it('waitingForWatchQuery compiles and returns non-deleted items', async () => {
    const { db, close } = await open(true);
    try {
      const q = waitingForWatchQuery(db);
      const compiled = q.compile();
      expect(compiled.sql).toMatch(/waiting_for_items/);
      expect(compiled.sql).toMatch(/deleted_at/);
      // Run compiled query through execute()
      const mapped = await q.execute();
      expect(mapped).toHaveLength(2);
      expect(mapped[0]!.waitingOn).toBeDefined();
    } finally {
      await close();
    }
  });
});

describe('CalendarAction', () => {
  it('lists [] when empty; the seeded open + done actions otherwise', async () => {
    const fresh = await open();
    try {
      expect(await listCalendarActions(fresh.db)).toEqual([]);
    } finally {
      await fresh.close();
    }
    const { db, close } = await open(true);
    try {
      const list = await listCalendarActions(db);
      const ids = new Set(list.map((action) => action.id));
      expect(list).toHaveLength(3);
      expect(ids.has(FIXTURE_IDS.calendar.soon)).toBe(true);
      expect(ids.has(FIXTURE_IDS.calendar.done)).toBe(true);
    } finally {
      await close();
    }
  });

  it('add: inserts; rejects a missing startsAt', async () => {
    const { db, close } = await open();
    try {
      const action: CalendarAction = {
        ...base(),
        title: '周会',
        startsAt: toIso(new Date(FIXTURE_NOW.getTime() + 86_400_000)),
        contextIds: [],
        estMinutes: 60,
        value: 3 as Value,
        consecutiveSkips: 0,
        status: 'open',
      };
      await addCalendarAction(db, action, FIXTURE_NOW);
      expect(await listCalendarActions(db)).toHaveLength(1);
      await expect(
        addCalendarAction(db, { ...action, startsAt: '' }, FIXTURE_NOW),
      ).rejects.toMatchObject({ code: 'validation.calendarAction.startsAt' });
    } finally {
      await close();
    }
  });

  it('update: a changed startsAt moves the auto reminder with the 60-min rule', async () => {
    const { db, close } = await open();
    try {
      const startsAt = new Date(FIXTURE_NOW.getTime() + 30 * 60_000);
      const action: CalendarAction = {
        ...base(),
        title: '周会',
        startsAt: toIso(startsAt),
        contextIds: [],
        estMinutes: 30,
        value: 3 as Value,
        consecutiveSkips: 0,
        status: 'open',
      };
      await addCalendarAction(db, action, FIXTURE_NOW);
      const first = await scheduledCalendarReminders(db, action.id);
      expect(first).toHaveLength(1);
      expect(first[0]!.fires_at).toBe(toIso(new Date(startsAt.getTime() - 15 * 60_000)));
      expect(first[0]!.intensity).toBe('important');

      // 10:00 + 45 min is still inside the window → fires at 10:30.
      const nextStart = new Date(FIXTURE_NOW.getTime() + 45 * 60_000);
      await updateCalendarAction(db, { ...action, startsAt: toIso(nextStart) }, FIXTURE_NOW);

      const after = await scheduledCalendarReminders(db, action.id);
      expect(after).toHaveLength(1);
      expect(after[0]!.fires_at).toBe(toIso(new Date(nextStart.getTime() - 15 * 60_000)));
      const old = await db
        .selectFrom('reminders')
        .select(['state'])
        .where('id', '=', first[0]!.id)
        .executeTakeFirst();
      expect(old?.state).toBe('cancelled');
    } finally {
      await close();
    }
  });

  it('update: moving startsAt beyond 60 minutes cancels the auto reminder', async () => {
    const { db, close } = await open();
    try {
      const action: CalendarAction = {
        ...base(),
        title: '周会',
        startsAt: toIso(new Date(FIXTURE_NOW.getTime() + 30 * 60_000)),
        contextIds: [],
        estMinutes: 30,
        value: 3 as Value,
        consecutiveSkips: 0,
        status: 'open',
      };
      await addCalendarAction(db, action, FIXTURE_NOW);
      expect(await scheduledCalendarReminders(db, action.id)).toHaveLength(1);

      await updateCalendarAction(
        db,
        { ...action, startsAt: toIso(new Date(FIXTURE_NOW.getTime() + 2 * 3_600_000)) },
        FIXTURE_NOW,
      );
      expect(await scheduledCalendarReminders(db, action.id)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('update: a title-only edit re-arms the future reminder with the new title', async () => {
    const { db, close } = await open();
    try {
      const action: CalendarAction = {
        ...base(),
        title: '周会',
        startsAt: toIso(new Date(FIXTURE_NOW.getTime() + 30 * 60_000)),
        contextIds: [],
        estMinutes: 30,
        value: 3 as Value,
        consecutiveSkips: 0,
        status: 'open',
      };
      await addCalendarAction(db, action, FIXTURE_NOW);
      const first = await scheduledCalendarReminders(db, action.id);
      expect(first).toHaveLength(1);

      await updateCalendarAction(db, { ...action, title: '周会（改）' }, FIXTURE_NOW);

      const after = await scheduledCalendarReminders(db, action.id);
      expect(after).toHaveLength(1);
      // Same moment + intensity, fresh id: the native reconcile keys on the
      // id, so a kept id would keep the old notification body forever.
      expect(after[0]!.id).not.toBe(first[0]!.id);
      expect(after[0]!.fires_at).toBe(first[0]!.fires_at);
      expect(after[0]!.intensity).toBe('important');
      const old = await db
        .selectFrom('reminders')
        .select(['state'])
        .where('id', '=', first[0]!.id)
        .executeTakeFirst();
      expect(old?.state).toBe('cancelled');
      // What the delivery layer reads now: the new title at the same moment.
      const scheduled = await listScheduledReminders(db);
      const armed = scheduled.find((row) => row.id === after[0]!.id);
      expect(armed?.title).toBe('周会（改）');
      expect(armed?.firesAt).toBe(first[0]!.fires_at);
    } finally {
      await close();
    }
  });

  it('update: a title-only edit re-arms the snooze reminder at the user moment', async () => {
    const { db, close } = await open();
    try {
      const action: CalendarAction = {
        ...base(),
        title: '周会',
        startsAt: toIso(new Date(FIXTURE_NOW.getTime() + 30 * 60_000)),
        contextIds: [],
        estMinutes: 30,
        value: 3 as Value,
        consecutiveSkips: 0,
        status: 'open',
      };
      await addCalendarAction(db, action, FIXTURE_NOW);
      const snoozedUntil = new Date(FIXTURE_NOW.getTime() + 10 * 60_000);
      await snoozeAction(db, {
        actionKind: 'calendar',
        actionId: action.id,
        snoozedUntil,
        now: FIXTURE_NOW,
      });
      const before = await scheduledCalendarReminders(db, action.id);
      expect(before).toHaveLength(1);
      expect(before[0]!.intensity).toBe('normal');

      await updateCalendarAction(db, { ...action, title: '周会（改）' }, FIXTURE_NOW);

      const after = await scheduledCalendarReminders(db, action.id);
      expect(after).toHaveLength(1);
      expect(after[0]!.id).not.toBe(before[0]!.id);
      // The user's chosen snooze moment and intensity are preserved.
      expect(after[0]!.fires_at).toBe(toIso(snoozedUntil));
      expect(after[0]!.intensity).toBe('normal');
      const scheduled = await listScheduledReminders(db);
      expect(scheduled.find((row) => row.id === after[0]!.id)?.title).toBe('周会（改）');
    } finally {
      await close();
    }
  });

  it('update: a title-only edit leaves a past reminder alone (no late re-trigger)', async () => {
    const { db, close } = await open();
    try {
      // startsAt is 10 min away → the auto reminder fires 5 min in the past.
      const action: CalendarAction = {
        ...base(),
        title: '周会',
        startsAt: toIso(new Date(FIXTURE_NOW.getTime() + 10 * 60_000)),
        contextIds: [],
        estMinutes: 30,
        value: 3 as Value,
        consecutiveSkips: 0,
        status: 'open',
      };
      await addCalendarAction(db, action, FIXTURE_NOW);
      const first = await scheduledCalendarReminders(db, action.id);
      expect(first).toHaveLength(1);
      expect(new Date(first[0]!.fires_at as string).getTime()).toBeLessThan(
        FIXTURE_NOW.getTime(),
      );

      await updateCalendarAction(db, { ...action, title: '周会（改）' }, FIXTURE_NOW);

      const after = await scheduledCalendarReminders(db, action.id);
      expect(after).toHaveLength(1);
      expect(after[0]!.id).toBe(first[0]!.id);
    } finally {
      await close();
    }
  });

  it('update: a completion that landed while the form was open survives the write', async () => {
    const { db, close } = await open();
    try {
      const action: CalendarAction = {
        ...base(),
        title: '周会',
        startsAt: toIso(new Date(FIXTURE_NOW.getTime() + 30 * 60_000)),
        contextIds: [],
        estMinutes: 30,
        value: 3 as Value,
        consecutiveSkips: 0,
        status: 'open',
      };
      await addCalendarAction(db, action, FIXTURE_NOW);
      // The form was filled from this row; another device completes it before
      // the save reaches the local DB (the stale object still says 'open').
      await completeAction(db, { actionKind: 'calendar', actionId: action.id, now: FIXTURE_NOW });

      const merged = await updateCalendarAction(
        db,
        {
          ...action,
          title: '周会（改）',
          startsAt: toIso(new Date(FIXTURE_NOW.getTime() + 45 * 60_000)),
        },
        FIXTURE_NOW,
      );

      // The stale status is ignored; the edit lands on the live row.
      expect(merged.status).toBe('done');
      const row = await db
        .selectFrom('calendar_actions')
        .select(['title', 'status', 'starts_at'])
        .where('id', '=', action.id)
        .executeTakeFirst();
      expect(row?.title).toBe('周会（改）');
      expect(row?.status).toBe('done');
      // Completion cancelled the reminder; the edit must not arm a new one.
      expect(await scheduledCalendarReminders(db, action.id)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('update: a trash that landed while the form was open is not overwritten', async () => {
    const { db, close } = await open();
    try {
      const action: CalendarAction = {
        ...base(),
        title: '周会',
        startsAt: toIso(new Date(FIXTURE_NOW.getTime() + 30 * 60_000)),
        contextIds: [],
        estMinutes: 30,
        value: 3 as Value,
        consecutiveSkips: 0,
        status: 'open',
      };
      await addCalendarAction(db, action, FIXTURE_NOW);
      await trashCalendarAction(db, { id: action.id, now: FIXTURE_NOW });

      await expect(
        updateCalendarAction(db, { ...action, title: '周会（改）' }, FIXTURE_NOW),
      ).rejects.toMatchObject({ code: 'calendarAction.not-found' });

      const row = await db
        .selectFrom('calendar_actions')
        .select(['title', 'deleted_at'])
        .where('id', '=', action.id)
        .executeTakeFirst();
      expect(row?.title).toBe('周会');
      expect(row?.deleted_at).not.toBeNull();
    } finally {
      await close();
    }
  });

  it('update: a future snooze owns the reminder — editing startsAt arms nothing', async () => {
    const { db, close } = await open();
    try {
      const action: CalendarAction = {
        ...base(),
        title: '周会',
        startsAt: toIso(new Date(FIXTURE_NOW.getTime() + 30 * 60_000)),
        contextIds: [],
        estMinutes: 30,
        value: 3 as Value,
        consecutiveSkips: 0,
        status: 'open',
      };
      await addCalendarAction(db, action, FIXTURE_NOW);
      const snoozedUntil = new Date(FIXTURE_NOW.getTime() + 10 * 60_000);
      await snoozeAction(db, {
        actionKind: 'calendar',
        actionId: action.id,
        snoozedUntil,
        now: FIXTURE_NOW,
      });
      const before = await scheduledCalendarReminders(db, action.id);

      await updateCalendarAction(
        db,
        {
          ...action,
          startsAt: toIso(new Date(FIXTURE_NOW.getTime() + 45 * 60_000)),
          snoozedUntil: toIso(snoozedUntil),
        },
        FIXTURE_NOW,
      );

      const after = await scheduledCalendarReminders(db, action.id);
      expect(after).toHaveLength(1);
      // A start-time edit with an unchanged title keeps the snooze row as is.
      expect(after[0]!.id).toBe(before[0]!.id);
      expect(after[0]!.intensity).toBe('normal');
      expect(after[0]!.fires_at).toBe(toIso(snoozedUntil));
    } finally {
      await close();
    }
  });

  it('update/trash propagate not-found', async () => {
    const { db, close } = await open(true);
    try {
      await expect(
        updateCalendarAction(
          db,
          {
            ...base(),
            title: 'x',
            startsAt: toIso(FIXTURE_NOW),
            contextIds: [],
            estMinutes: 30,
            value: 3 as Value,
            consecutiveSkips: 0,
            status: 'open',
          },
          FIXTURE_NOW,
        ),
      ).rejects.toMatchObject({ code: 'calendarAction.not-found' });
      await trashCalendarAction(db, { id: FIXTURE_IDS.calendar.soon, now: FIXTURE_NOW });
      expect(await listCalendarActions(db)).toHaveLength(2);
      // The R8 pattern: the action's scheduled reminder (R.soon) is
      // cancelled in the same transaction — a deleted action never notifies.
      const reminder = await db
        .selectFrom('reminders')
        .selectAll()
        .where('id', '=', FIXTURE_IDS.reminders.soon)
        .executeTakeFirst();
      expect(reminder?.state).toBe('cancelled');
    } finally {
      await close();
    }
  });
});

describe('SomedayMaybe', () => {
  it('lists live items only (trashed excluded)', async () => {
    const { db, close } = await open(true);
    try {
      const list = await listSomedayMaybeItems(db);
      expect(list.map((item) => item.id)).toEqual([FIXTURE_IDS.someday.keep]);
      expect(await listSomedayMaybeItems(db, { includeDeleted: true })).toHaveLength(2);
    } finally {
      await close();
    }
  });

  it('add: inserts; rejects an empty title', async () => {
    const { db, close } = await open();
    try {
      const item: SomedayMaybeItem = { ...base(), title: '学钢琴', note: '明年春天' };
      await addSomedayMaybeItem(db, item);
      expect(await listSomedayMaybeItems(db)).toEqual([item]);
      await expect(addSomedayMaybeItem(db, { ...base(), title: '' })).rejects.toMatchObject({
        code: 'validation.somedayMaybeItem.title',
      });
    } finally {
      await close();
    }
  });

  it('update/trash propagate not-found', async () => {
    const { db, close } = await open();
    try {
      const item: SomedayMaybeItem = { ...base(), title: '学钢琴' };
      await addSomedayMaybeItem(db, item);
      await updateSomedayMaybeItem(db, { ...item, note: '改主意了', updatedAt: toIso(FIXTURE_NOW) });
      await trashSomedayMaybeItem(db, { id: item.id, now: FIXTURE_NOW });
      expect(await listSomedayMaybeItems(db)).toEqual([]);
    } finally {
      await close();
    }
  });
});

describe('ReferenceItem', () => {
  it('lists the seeded reference link', async () => {
    const { db, close } = await open(true);
    try {
      const list = await listReferenceItems(db);
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toBe(FIXTURE_IDS.reference.link);
      expect(list[0]?.url).not.toBeUndefined();
    } finally {
      await close();
    }
  });

  it('add: inserts; rejects an empty title', async () => {
    const { db, close } = await open();
    try {
      const item: ReferenceItem = { ...base(), title: 'GTD 原文', url: 'https://gtd.example' };
      await addReferenceItem(db, item);
      expect(await listReferenceItems(db)).toHaveLength(1);
      await expect(addReferenceItem(db, { ...base(), title: '' })).rejects.toMatchObject({
        code: 'validation.referenceItem.title',
      });
    } finally {
      await close();
    }
  });

  it('update/trash propagate not-found', async () => {
    const { db, close } = await open();
    try {
      const item: ReferenceItem = { ...base(), title: 'GTD 原文' };
      await addReferenceItem(db, item);
      await updateReferenceItem(db, { ...item, note: '第 5 章最重要', updatedAt: toIso(FIXTURE_NOW) });
      await trashReferenceItem(db, { id: item.id, now: FIXTURE_NOW });
      expect(await listReferenceItems(db)).toEqual([]);
      await expect(
        trashReferenceItem(db, { id: item.id, now: FIXTURE_NOW }),
      ).rejects.toMatchObject({ code: 'referenceItem.not-found' });
    } finally {
      await close();
    }
  });
});

describe('Context', () => {
  it('lists the five seeded contexts', async () => {
    const { db, close } = await open(true);
    try {
      const names = (await listContexts(db)).map((context) => context.name).sort();
      expect(names).toEqual(['computer', 'home', 'office', 'outside', 'phone']);
    } finally {
      await close();
    }
  });

  it('add: inserts; rejects an empty name', async () => {
    const { db, close } = await open();
    try {
      const context: Context = { ...base(), name: 'library' };
      await addContext(db, context);
      expect(await listContexts(db)).toHaveLength(1);
      await expect(addContext(db, { ...base(), name: ' ' })).rejects.toMatchObject({
        code: 'validation.context.name',
      });
    } finally {
      await close();
    }
  });

  it('update/trash propagate not-found', async () => {
    const { db, close } = await open(true);
    try {
      const context = (await listContexts(db)).find((item) => item.name === 'home');
      await updateContext(db, { ...(context as Context), name: 'home-v2', updatedAt: toIso(FIXTURE_NOW) });
      await trashContext(db, { id: FIXTURE_IDS.contexts.home, now: FIXTURE_NOW });
      await expect(
        trashContext(db, { id: FIXTURE_IDS.contexts.home, now: FIXTURE_NOW }),
      ).rejects.toMatchObject({ code: 'context.not-found' });
    } finally {
      await close();
    }
  });

  it('seed: a fresh database gets the five spec defaults (now timestamps, ULID ids)', async () => {
    const { db, close } = await open();
    try {
      expect(await seedDefaultContexts(db, FIXTURE_NOW)).toBe(5);
      const names = (await listContexts(db)).map((context) => context.name).sort();
      expect(names).toEqual(['computer', 'home', 'office', 'outside', 'phone']);
      for (const context of await listContexts(db)) {
        expect(context.createdAt).toBe(toIso(FIXTURE_NOW));
        expect(context.updatedAt).toBe(toIso(FIXTURE_NOW));
        expect(context.deletedAt).toBeNull();
        expect(context.id).toHaveLength(26);
      }
    } finally {
      await close();
    }
  });

  it('seed: a second call is a no-op (idempotent — still 5 rows)', async () => {
    const { db, close } = await open();
    try {
      expect(await seedDefaultContexts(db, FIXTURE_NOW)).toBe(5);
      expect(await seedDefaultContexts(db, FIXTURE_NOW)).toBe(0);
      expect(await listContexts(db)).toHaveLength(5);
    } finally {
      await close();
    }
  });

  it('seed: existing user contexts → no-op (row count unchanged)', async () => {
    const { db, close } = await open();
    try {
      await addContext(db, { ...base(), name: 'library' });
      expect(await seedDefaultContexts(db, FIXTURE_NOW)).toBe(0);
      expect(await listContexts(db)).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it('seed: a user who deleted ALL contexts is not re-seeded', async () => {
    const { db, close } = await open();
    try {
      expect(await seedDefaultContexts(db, FIXTURE_NOW)).toBe(5);
      for (const context of await listContexts(db)) {
        await trashContext(db, { id: context.id, now: FIXTURE_NOW });
      }
      expect(await listContexts(db)).toHaveLength(0);
      // Soft-deleted rows still count as "existing" — the user's intent
      // (an empty context set) is respected (design §6).
      expect(await seedDefaultContexts(db, FIXTURE_NOW)).toBe(0);
      expect(await listContexts(db)).toHaveLength(0);
    } finally {
      await close();
    }
  });
});
