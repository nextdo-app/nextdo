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
import { referenceItemsWatchQuery, waitingForWatchQuery } from '../queries/watch-queries';
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

  it('update/trash propagate not-found', async () => {
    const { db, close } = await open(true);
    try {
      await expect(
        updateCalendarAction(db, {
          ...base(),
          title: 'x',
          startsAt: toIso(FIXTURE_NOW),
          contextIds: [],
          estMinutes: 30,
          value: 3 as Value,
          consecutiveSkips: 0,
          status: 'open',
        }),
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

  it('the watch query matches the one-shot list', async () => {
    const { db, close } = await open(true);
    try {
      expect(await referenceItemsWatchQuery(db).execute()).toEqual(await listReferenceItems(db));
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
