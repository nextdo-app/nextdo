import { toIso } from '@nextdo/core';
import { wrapPowerSyncWithKysely } from '@powersync/kysely-driver';
import { AppSchema, type Database } from '../schema';
import { getActionDetails, listNextActions } from '../queries/actions';
import { listHabitDays, listHabits } from '../queries/habits';
import { FIXTURE_IDS, FIXTURE_NOW, fixtureHabitDayId, seedFixtures } from './fixtures';
import { createNodeTestDatabase, type NodeTestDatabase } from './powersync-node';

let env: NodeTestDatabase<Database>;
beforeEach(async () => {
  env = await createNodeTestDatabase<Database>(AppSchema);
  await seedFixtures(env.kysely);
});
afterEach(async () => {
  await env.close();
});

it('loads the title and re-clarify metadata for all three action kinds', async () => {
  expect(await getActionDetails(env.kysely, 'next', FIXTURE_IDS.actions.b)).toEqual({
    title: '运行论文 baseline A',
    projectId: FIXTURE_IDS.projects.paper,
    contextIds: [FIXTURE_IDS.contexts.computer],
  });
  expect(await getActionDetails(env.kysely, 'calendar', FIXTURE_IDS.calendar.soon)).toEqual({
    title: '组会汇报',
    projectId: null,
    contextIds: [FIXTURE_IDS.contexts.office],
  });
  expect(
    await getActionDetails(env.kysely, 'habit', fixtureHabitDayId(FIXTURE_IDS.habits.mid, 0)),
  ).toEqual({ title: '21 天力量训练', projectId: null, contextIds: [] });
});

it.each(['next', 'calendar', 'habit'] as const)(
  'returns null for a missing %s action',
  async (kind) => {
    expect(await getActionDetails(env.kysely, kind, 'missing')).toBeNull();
  },
);

it('excludes deleted actions, deleted habit days and missing or deleted parent habits', async () => {
  const { kysely: db } = env;
  const dayId = fixtureHabitDayId(FIXTURE_IDS.habits.mid, 0);
  const deleted_at = toIso(FIXTURE_NOW);
  expect(await getActionDetails(db, 'next', FIXTURE_IDS.actions.trashed)).toBeNull();
  await db
    .updateTable('calendar_actions')
    .set({ deleted_at })
    .where('id', '=', FIXTURE_IDS.calendar.soon)
    .execute();
  expect(await getActionDetails(db, 'calendar', FIXTURE_IDS.calendar.soon)).toBeNull();
  await db.updateTable('habit_days').set({ deleted_at }).where('id', '=', dayId).execute();
  expect(await getActionDetails(db, 'habit', dayId)).toBeNull();
  await db.updateTable('habit_days').set({ deleted_at: null }).where('id', '=', dayId).execute();
  await db
    .updateTable('habits')
    .set({ deleted_at })
    .where('id', '=', FIXTURE_IDS.habits.mid)
    .execute();
  expect(await getActionDetails(db, 'habit', dayId)).toBeNull();
  await db.updateTable('habit_days').set({ habit_id: 'missing' }).where('id', '=', dayId).execute();
  expect(await getActionDetails(db, 'habit', dayId)).toBeNull();
});

it('returns one row instead of whole action and habit tables on a larger dataset', async () => {
  const { kysely: db } = env;
  const next = await db
    .selectFrom('next_actions')
    .selectAll()
    .where('id', '=', FIXTURE_IDS.actions.b)
    .executeTakeFirstOrThrow();
  const habit = await db
    .selectFrom('habits')
    .selectAll()
    .where('id', '=', FIXTURE_IDS.habits.today)
    .executeTakeFirstOrThrow();
  const day = await db
    .selectFrom('habit_days')
    .selectAll()
    .where('id', '=', fixtureHabitDayId(habit.id, 0))
    .executeTakeFirstOrThrow();
  await db.transaction().execute(async (tx) => {
    for (let batch = 0; batch < 10; batch++) {
      await tx
        .insertInto('next_actions')
        .values(
          Array.from({ length: 100 }, (_, i) => ({
            ...next,
            id: `benchmark-action-${batch * 100 + i}`,
          })),
        )
        .execute();
    }
    await tx
      .insertInto('habits')
      .values(
        Array.from({ length: 100 }, (_, i) => ({
          ...habit,
          id: `benchmark-habit-${i}`,
        })),
      )
      .execute();
    for (let batch = 0; batch < 21; batch++) {
      await tx
        .insertInto('habit_days')
        .values(
          Array.from({ length: 100 }, (_, i) => ({
            ...day,
            id: `benchmark-day-${batch}-${i}`,
            habit_id: `benchmark-habit-${i}`,
          })),
        )
        .execute();
    }
  });
  const returnedRows: number[] = [];
  const measured = wrapPowerSyncWithKysely<Database>(env.powersync, {
    plugins: [
      {
        transformQuery: ({ node }) => node,
        async transformResult({ result }) {
          returnedRows.push(result.rows.length);
          return result;
        },
      },
    ],
  });
  const previous = (await listNextActions(measured)).find((row) => row.id === next.id);
  expect(returnedRows.splice(0)).toEqual([1009]);
  expect(await getActionDetails(measured, 'next', next.id)).toEqual({
    title: previous!.title,
    projectId: previous!.projectId,
    contextIds: previous!.contextIds,
  });
  expect(returnedRows.splice(0)).toEqual([1]);
  const [days, habits] = await Promise.all([listHabitDays(measured), listHabits(measured)]);
  expect(returnedRows.splice(0).sort((a, b) => a - b)).toEqual([106, 2107]);
  const previousHabit = habits.find(
    (row) => row.id === days.find((row) => row.id === day.id)?.habitId,
  );
  expect(await getActionDetails(measured, 'habit', day.id)).toEqual({
    title: previousHabit!.title,
    projectId: null,
    contextIds: [],
  });
  expect(returnedRows).toEqual([1]);
});
