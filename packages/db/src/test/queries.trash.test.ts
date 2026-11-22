/**
 * Query tests — the trash / recycle bin (issue #89).
 *
 * Covers the read side (all nine soft-deletable aggregates, newest delete
 * first, live rows excluded), the restore transaction per kind, the
 * not-found path, and the rule that restoring an action does NOT resurrect
 * its cancelled reminders.
 */
import { toIso } from '@nextdo/core';
import { listNextActions, trashAction } from '../queries/actions';
import { listCalendarActions, trashCalendarAction } from '../queries/calendar';
import { listHabitDays, listHabits, trashHabit } from '../queries/habits';
import { listInboxItems, trashInboxItem } from '../queries/inbox';
import { listProjects, trashProject } from '../queries/projects';
import { listReferenceItems, trashReferenceItem } from '../queries/references';
import { listScheduledRemindersFor } from '../queries/reminders';
import { listSomedayMaybeItems, trashSomedayMaybeItem } from '../queries/someday';
import { listWaitingForItems, trashWaitingForItem } from '../queries/waiting';
import { listTrashedItems, restoreTrashedItem } from '../queries/trash';
import { trashedItemsWatchQuery } from '../queries/watch-queries';
import { openTestDb, type TestDb } from './query-helpers';
import { FIXTURE_IDS, FIXTURE_NOW, fixtureHabitDayId } from './fixtures';

const I = FIXTURE_IDS.inbox;
const A = FIXTURE_IDS.actions;
const P = FIXTURE_IDS.projects;
const H = FIXTURE_IDS.habits;
const W = FIXTURE_IDS.waiting;
const C = FIXTURE_IDS.calendar;
const S = FIXTURE_IDS.someday;
const R = FIXTURE_IDS.reference;

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

describe('trash list', () => {
  it('lists [] on an empty database', async () => {
    const { db } = await open();
    expect(await listTrashedItems(db)).toEqual([]);
  });

  it('lists the seeded trashed rows, newest delete first, with kind/title/detail', async () => {
    const { db } = await open(true);
    const items = await listTrashedItems(db);

    expect(items.map((item) => item.kind)).toEqual(['next-action', 'inbox', 'someday']);
    expect(items.map((item) => item.id)).toEqual([A.trashed, I.trashed, S.trashed]);
    expect(items[0]).toMatchObject({
      kind: 'next-action',
      title: '买打印机墨盒（已删）',
      detail: null,
      deletedAt: toIso(new Date('2026-09-20T10:00:00.000Z')),
    });
    expect(items[1]).toMatchObject({ title: '倒垃圾（当场做了）', detail: null });
    expect(items[2]).toMatchObject({ title: '换手机壳', detail: null });
  });

  it('includes every other kind once it is trashed, with its useful detail line', async () => {
    const { db } = await open(true);
    const habitDay = fixtureHabitDayId(H.mid, 0);

    await trashProject(db, { id: P.paper, now: FIXTURE_NOW });
    await trashHabit(db, { id: H.today, now: FIXTURE_NOW });
    await trashAction(db, { actionKind: 'habit', actionId: habitDay, now: FIXTURE_NOW });
    await trashWaitingForItem(db, { id: W.due, now: FIXTURE_NOW });
    await trashReferenceItem(db, { id: R.link, now: FIXTURE_NOW });
    await trashCalendarAction(db, { id: C.tomorrow, now: FIXTURE_NOW });

    const items = await listTrashedItems(db);
    const byKind = new Map(items.map((item) => [item.kind, item]));

    expect(byKind.get('project')).toMatchObject({
      id: P.paper,
      title: '毕业论文实验',
      detail: 'baseline A/B 跑完并写入论文 §4',
    });
    expect(byKind.get('habit')).toMatchObject({ id: H.today, title: '21 天晨读挑战' });
    expect(byKind.get('habit-day')).toMatchObject({
      id: habitDay,
      title: '21 天力量训练',
      detail: '2026-09-21',
    });
    expect(byKind.get('waiting')).toMatchObject({
      id: W.due,
      title: '等导师确认开题材料',
      detail: '导师（李老师说“有空再看”）',
    });
    expect(byKind.get('reference')).toMatchObject({
      id: R.link,
      title: '论文模板 LaTeX 配置说明',
      detail: 'https://example.com/thesis-template',
    });
    expect(byKind.get('calendar-action')).toMatchObject({ id: C.tomorrow, title: '牙医复诊' });
    expect(items).toHaveLength(9);
  });

  it('the watched query returns the same rows as the one-shot read', async () => {
    const { db } = await open(true);
    expect(await trashedItemsWatchQuery(db).execute()).toEqual(await listTrashedItems(db));
  });
});

describe('restore', () => {
  it('restores every kind: deleted_at cleared, the live list sees it again', async () => {
    const { db } = await open(true);
    const habitDay = fixtureHabitDayId(H.mid, 0);

    await trashProject(db, { id: P.paper, now: FIXTURE_NOW });
    await trashHabit(db, { id: H.today, now: FIXTURE_NOW });
    await trashAction(db, { actionKind: 'habit', actionId: habitDay, now: FIXTURE_NOW });
    await trashWaitingForItem(db, { id: W.due, now: FIXTURE_NOW });
    await trashReferenceItem(db, { id: R.link, now: FIXTURE_NOW });
    await trashCalendarAction(db, { id: C.tomorrow, now: FIXTURE_NOW });
    expect(await listTrashedItems(db)).toHaveLength(9);

    const cases: Array<{
      kind: Parameters<typeof restoreTrashedItem>[1]['kind'];
      id: string;
      isLive: () => Promise<boolean>;
    }> = [
      { kind: 'inbox', id: I.trashed, isLive: async () => (await listInboxItems(db)).some((row) => row.id === I.trashed) },
      { kind: 'next-action', id: A.trashed, isLive: async () => (await listNextActions(db)).some((row) => row.id === A.trashed) },
      { kind: 'calendar-action', id: C.tomorrow, isLive: async () => (await listCalendarActions(db)).some((row) => row.id === C.tomorrow) },
      { kind: 'habit-day', id: habitDay, isLive: async () => (await listHabitDays(db, { habitId: H.mid })).some((row) => row.id === habitDay) },
      { kind: 'project', id: P.paper, isLive: async () => (await listProjects(db)).some((row) => row.id === P.paper) },
      { kind: 'habit', id: H.today, isLive: async () => (await listHabits(db)).some((row) => row.id === H.today) },
      { kind: 'someday', id: S.trashed, isLive: async () => (await listSomedayMaybeItems(db)).some((row) => row.id === S.trashed) },
      { kind: 'waiting', id: W.due, isLive: async () => (await listWaitingForItems(db)).some((row) => row.id === W.due) },
      { kind: 'reference', id: R.link, isLive: async () => (await listReferenceItems(db)).some((row) => row.id === R.link) },
    ];

    for (const testCase of cases) {
      expect(await testCase.isLive()).toBe(false);
      await restoreTrashedItem(db, { kind: testCase.kind, id: testCase.id, now: FIXTURE_NOW });
      expect(await testCase.isLive()).toBe(true);
    }

    expect(await listTrashedItems(db)).toEqual([]);
  });

  it('does not resurrect the action reminders that trashing cancelled', async () => {
    const { db } = await open(true);
    expect(await listScheduledRemindersFor(db, 'next', A.snoozed)).toHaveLength(1);

    await trashAction(db, { actionKind: 'next', actionId: A.snoozed, now: FIXTURE_NOW });
    expect(await listScheduledRemindersFor(db, 'next', A.snoozed)).toEqual([]);

    await restoreTrashedItem(db, { kind: 'next-action', id: A.snoozed, now: FIXTURE_NOW });
    expect((await listNextActions(db)).some((row) => row.id === A.snoozed)).toBe(true);
    // `cancelled` is terminal — the user arms a new reminder explicitly.
    expect(await listScheduledRemindersFor(db, 'next', A.snoozed)).toEqual([]);
  });

  it('rejects a live row and a missing id with trash.not-found', async () => {
    const { db } = await open(true);
    await expect(
      restoreTrashedItem(db, { kind: 'inbox', id: I.plain, now: FIXTURE_NOW }),
    ).rejects.toMatchObject({ code: 'trash.not-found' });
    await expect(
      restoreTrashedItem(db, { kind: 'inbox', id: 'missing', now: FIXTURE_NOW }),
    ).rejects.toMatchObject({ code: 'trash.not-found' });
  });

  it('refuses to restore an action while its project is still deleted, and keeps it in the bin', async () => {
    const { db } = await open(true);
    await trashAction(db, { actionKind: 'next', actionId: A.b, now: FIXTURE_NOW });
    await trashProject(db, { id: P.paper, now: FIXTURE_NOW });

    await expect(
      restoreTrashedItem(db, { kind: 'next-action', id: A.b, now: FIXTURE_NOW }),
    ).rejects.toMatchObject({ code: 'trash.parent-project-deleted' });

    // Not silently restored: it stays in the bin and out of the live list.
    expect((await listTrashedItems(db)).some((item) => item.id === A.b)).toBe(true);
    expect((await listNextActions(db)).some((row) => row.id === A.b)).toBe(false);

    // Parent first, then the child.
    await restoreTrashedItem(db, { kind: 'project', id: P.paper, now: FIXTURE_NOW });
    await restoreTrashedItem(db, { kind: 'next-action', id: A.b, now: FIXTURE_NOW });
    expect((await listNextActions(db)).some((row) => row.id === A.b)).toBe(true);
    expect((await listTrashedItems(db)).some((item) => item.id === A.b)).toBe(false);
  });

  it('refuses to restore a habit day while its habit is still deleted', async () => {
    const { db } = await open(true);
    const habitDay = fixtureHabitDayId(H.mid, 0);
    await trashAction(db, { actionKind: 'habit', actionId: habitDay, now: FIXTURE_NOW });
    await trashHabit(db, { id: H.mid, now: FIXTURE_NOW });

    await expect(
      restoreTrashedItem(db, { kind: 'habit-day', id: habitDay, now: FIXTURE_NOW }),
    ).rejects.toMatchObject({ code: 'trash.parent-habit-deleted' });

    expect((await listTrashedItems(db)).some((item) => item.id === habitDay)).toBe(true);
    expect((await listHabitDays(db, { habitId: H.mid })).some((row) => row.id === habitDay)).toBe(false);

    await restoreTrashedItem(db, { kind: 'habit', id: H.mid, now: FIXTURE_NOW });
    await restoreTrashedItem(db, { kind: 'habit-day', id: habitDay, now: FIXTURE_NOW });
    expect((await listHabitDays(db, { habitId: H.mid })).some((row) => row.id === habitDay)).toBe(true);
  });

  it('two concurrent restores of the same row: exactly one wins, the other gets trash.not-found', async () => {
    const { db } = await open(true);
    const results = await Promise.allSettled([
      restoreTrashedItem(db, { kind: 'inbox', id: I.trashed, now: FIXTURE_NOW }),
      restoreTrashedItem(db, { kind: 'inbox', id: I.trashed, now: FIXTURE_NOW }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: 'trash.not-found' });
    expect((await listInboxItems(db)).filter((row) => row.id === I.trashed)).toHaveLength(1);
    expect((await listTrashedItems(db)).some((item) => item.id === I.trashed)).toBe(false);
  });

  it('trashing an inbox item through the public mutation makes it restorable', async () => {
    const { db } = await open(true);
    await trashInboxItem(db, { id: I.plain, now: FIXTURE_NOW });
    expect((await listTrashedItems(db)).some((item) => item.id === I.plain)).toBe(true);

    await restoreTrashedItem(db, { kind: 'inbox', id: I.plain, now: FIXTURE_NOW });
    expect((await listInboxItems(db)).some((row) => row.id === I.plain)).toBe(true);
  });

  it('trashing a someday item through the public mutation makes it restorable', async () => {
    const { db } = await open(true);
    await trashSomedayMaybeItem(db, { id: S.keep, now: FIXTURE_NOW });
    expect((await listTrashedItems(db)).some((item) => item.id === S.keep)).toBe(true);

    await restoreTrashedItem(db, { kind: 'someday', id: S.keep, now: FIXTURE_NOW });
    expect((await listSomedayMaybeItems(db)).some((row) => row.id === S.keep)).toBe(true);
  });
});
