/**
 * Query tests — Projects + action-coverage derivation
 * (spec: domain/domain-model.md "Project" — "Coverage is always derived,
 * never stored").
 */
import { toIso, ulid, type NextAction, type Project, type Value } from '@nextdo/core';
import { addNextAction, completeAction } from '../queries/actions';
import {
  addProject,
  getProjectCoverage,
  listProjects,
  projectActionCoverage,
  trashProject,
  updateProject,
} from '../queries/projects';
import { STALL_DAYS, isStalled } from '../queries/reviews';
import { projectCardsWatchQuery } from '../queries/watch-queries';
import { openTestDb, type TestDb } from './query-helpers';
import { FIXTURE_IDS, FIXTURE_NOW } from './fixtures';

const P = FIXTURE_IDS.projects;
const DAY_MS = 86_400_000;

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

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: ulid(FIXTURE_NOW),
    createdAt: toIso(FIXTURE_NOW),
    updatedAt: toIso(FIXTURE_NOW),
    deletedAt: null,
    title: '新项目',
    outcome: '完成它',
    value: 3 as Value,
    status: 'active',
    ...overrides,
  };
}

describe('CRUD', () => {
  it('lists [] on an empty database', async () => {
    const { db, close } = await open();
    try {
      expect(await listProjects(db)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('lists live projects ordered by created_at', async () => {
    const { db, close } = await open(true);
    try {
      const list = await listProjects(db);
      expect(list).toHaveLength(3);
      expect(list.map((project) => project.id)).toEqual([P.held, P.paper, P.empty]);
    } finally {
      await close();
    }
  });

  it('add: inserts a valid project; rejects a missing outcome', async () => {
    const { db, close } = await open();
    try {
      const project = makeProject();
      await addProject(db, project);
      expect(await listProjects(db)).toEqual([project]);
      await expect(addProject(db, makeProject({ outcome: '  ' }))).rejects.toMatchObject({
        code: 'project.needs-outcome',
      });
    } finally {
      await close();
    }
  });

  it('update: active → on-hold is a legal transition', async () => {
    const { db, close } = await open(true);
    try {
      const held = (await listProjects(db)).find((project) => project.id === P.paper);
      await updateProject(db, { ...(held as Project), status: 'on-hold', updatedAt: toIso(FIXTURE_NOW) });
      const reloaded = (await listProjects(db)).find((project) => project.id === P.paper);
      expect(reloaded?.status).toBe('on-hold');
    } finally {
      await close();
    }
  });

  it('update: done is terminal (done → active is illegal)', async () => {
    const { db, close } = await open();
    try {
      const project = makeProject();
      await addProject(db, project);
      await updateProject(db, { ...project, status: 'done', updatedAt: toIso(FIXTURE_NOW) });
      await expect(
        updateProject(db, { ...project, status: 'active', updatedAt: toIso(FIXTURE_NOW) }),
      ).rejects.toMatchObject({ code: 'invalid-transition:done:active' });
    } finally {
      await close();
    }
  });

  it('update: throws not-found for a missing project', async () => {
    const { db, close } = await open(true);
    try {
      await expect(updateProject(db, makeProject())).rejects.toMatchObject({ code: 'project.not-found' });
    } finally {
      await close();
    }
  });

  it('trash: soft-deletes; a second trash throws not-found', async () => {
    const { db, close } = await open();
    try {
      const project = makeProject();
      await addProject(db, project);
      await trashProject(db, { id: project.id, now: FIXTURE_NOW });
      expect(await listProjects(db)).toEqual([]);
      await expect(trashProject(db, { id: project.id, now: FIXTURE_NOW })).rejects.toMatchObject({
        code: 'project.not-found',
      });
    } finally {
      await close();
    }
  });
});

describe('coverage (derived, never stored)', () => {
  it('getProjectCoverage: true with an open action, false without', async () => {
    const { db, close } = await open(true);
    try {
      expect(await getProjectCoverage(db, P.paper)).toBe(true);
      expect(await getProjectCoverage(db, P.empty)).toBe(false);
    } finally {
      await close();
    }
  });

  it('getProjectCoverage: throws not-found for a missing project', async () => {
    const { db, close } = await open(true);
    try {
      await expect(getProjectCoverage(db, '01TST0000000000000000000099')).rejects.toMatchObject({
        code: 'project.not-found',
      });
    } finally {
      await close();
    }
  });

  it('projectActionCoverage: the active projects lacking an open action', async () => {
    const { db, close } = await open(true);
    try {
      // paper is covered; held is on-hold (not reported); empty is the only
      // active uncovered project.
      expect((await projectActionCoverage(db)).map((project) => project.id)).toEqual([P.empty]);
    } finally {
      await close();
    }
  });

  it('coverage re-derives after the last action completes (no stored counter)', async () => {
    const { db, close } = await open(true);
    try {
      // paper has exactly two open actions (A.b, A.depDone) — complete both
      // via the canonical transaction and the project becomes uncovered.
      await completeAction(db, { actionKind: 'next', actionId: FIXTURE_IDS.actions.b, now: FIXTURE_NOW });
      await completeAction(db, {
        actionKind: 'next',
        actionId: FIXTURE_IDS.actions.depDone,
        now: FIXTURE_NOW,
      });
      expect(await getProjectCoverage(db, P.paper)).toBe(false);
      expect((await projectActionCoverage(db)).map((project) => project.id).sort()).toEqual(
        [P.paper, P.empty].sort(),
      );
    } finally {
      await close();
    }
  });
});

describe('projectCardsWatchQuery (design §4.1)', () => {
  function makeAction(overrides: Partial<NextAction> = {}): NextAction {
    return {
      id: ulid(FIXTURE_NOW),
      createdAt: toIso(FIXTURE_NOW),
      updatedAt: toIso(FIXTURE_NOW),
      deletedAt: null,
      title: '行动',
      contextIds: [],
      estMinutes: 30,
      value: 3,
      consecutiveSkips: 0,
      status: 'open',
      ...overrides,
    };
  }

  it('empty project: zero counts, null deadlines/progress/next-action', async () => {
    const { db, close } = await open();
    try {
      const project = makeProject();
      await addProject(db, project);
      const [card] = await projectCardsWatchQuery(db).execute();
      expect(card).toEqual({
        ...project,
        openCount: 0,
        completedCount: 0,
        earliestOpenDeadline: null,
        lastProgressAt: null,
        nextAction: null,
      });
    } finally {
      await close();
    }
  });

  it('progress 1/4: 1 completed + 3 open; earliest deadline is the min over OPEN actions only', async () => {
    const { db, close } = await open();
    try {
      const project = makeProject();
      await addProject(db, project);
      const doneDeadline = toIso(new Date(FIXTURE_NOW.getTime() + DAY_MS));
      const d1 = toIso(new Date(FIXTURE_NOW.getTime() + 5 * DAY_MS));
      const d2 = toIso(new Date(FIXTURE_NOW.getTime() + 2 * DAY_MS));
      const completed = makeAction({ projectId: project.id, title: '已完成', deadline: doneDeadline });
      await addNextAction(db, completed);
      await addNextAction(db, makeAction({ projectId: project.id, title: '晚截止', deadline: d1 }));
      await addNextAction(db, makeAction({ projectId: project.id, title: '早截止', deadline: d2 }));
      await addNextAction(db, makeAction({ projectId: project.id, title: '无截止' }));
      await completeAction(db, { actionKind: 'next', actionId: completed.id, now: FIXTURE_NOW });

      const [card] = await projectCardsWatchQuery(db).execute();
      expect(card?.openCount).toBe(3);
      expect(card?.completedCount).toBe(1);
      // the completed action holds an EARLIER deadline — it must not count.
      expect(card?.earliestOpenDeadline).toBe(d2);
    } finally {
      await close();
    }
  });

  it('next-action ordering: deadline-null last, then deadline, then created_at', async () => {
    const { db, close } = await open();
    try {
      const project = makeProject();
      await addProject(db, project);
      const deadline = toIso(new Date(FIXTURE_NOW.getTime() + 3 * DAY_MS));
      const x = makeAction({
        projectId: project.id,
        title: 'X 无截止（最早创建）',
        createdAt: toIso(new Date(FIXTURE_NOW.getTime() - 3 * DAY_MS)),
      });
      const y = makeAction({
        projectId: project.id,
        title: 'Y 有截止',
        deadline,
        estMinutes: 45,
        contextIds: [FIXTURE_IDS.contexts.computer],
        createdAt: toIso(new Date(FIXTURE_NOW.getTime() - 2 * DAY_MS)),
      });
      const z = makeAction({
        projectId: project.id,
        title: 'Z 同截止（更晚创建）',
        deadline,
        createdAt: toIso(new Date(FIXTURE_NOW.getTime() - DAY_MS)),
      });
      await addNextAction(db, x);
      await addNextAction(db, y);
      await addNextAction(db, z);

      const [card] = await projectCardsWatchQuery(db).execute();
      expect(card?.nextAction).toEqual({
        id: y.id,
        title: 'Y 有截止',
        contextIds: [FIXTURE_IDS.contexts.computer],
        deadline,
        estMinutes: 45,
      });
    } finally {
      await close();
    }
  });

  it('no open actions → openCount 0 + nextAction null (all done)', async () => {
    const { db, close } = await open();
    try {
      const project = makeProject();
      await addProject(db, project);
      const action = makeAction({ projectId: project.id });
      await addNextAction(db, action);
      await completeAction(db, { actionKind: 'next', actionId: action.id, now: FIXTURE_NOW });

      const [card] = await projectCardsWatchQuery(db).execute();
      expect(card?.openCount).toBe(0);
      expect(card?.completedCount).toBe(1);
      expect(card?.earliestOpenDeadline).toBeNull();
      expect(card?.nextAction).toBeNull();
      expect(card?.lastProgressAt).toBe(toIso(FIXTURE_NOW));
    } finally {
      await close();
    }
  });

  it('lastProgressAt is the MAX completion over the project actions (null when never done)', async () => {
    const { db, close } = await open();
    try {
      const project = makeProject();
      await addProject(db, project);
      const a = makeAction({ projectId: project.id, title: '甲' });
      const b = makeAction({ projectId: project.id, title: '乙' });
      const other = makeAction({ title: '丙（不属于该项目）' });
      await addNextAction(db, a);
      await addNextAction(db, b);
      await addNextAction(db, other);
      // A different project's later completion must not leak in.
      const otherProject = makeProject();
      await addProject(db, otherProject);
      const otherAction = makeAction({ projectId: otherProject.id, title: '丁' });
      await addNextAction(db, otherAction);

      const later = new Date(FIXTURE_NOW.getTime() + 2 * DAY_MS);
      await completeAction(db, { actionKind: 'next', actionId: a.id, now: FIXTURE_NOW });
      await completeAction(db, { actionKind: 'next', actionId: b.id, now: later });
      await completeAction(db, { actionKind: 'next', actionId: otherAction.id, now: later });

      const cards = await projectCardsWatchQuery(db).execute();
      const card = cards.find((entry) => entry.id === project.id);
      expect(card?.lastProgressAt).toBe(toIso(later));
      expect(card?.completedCount).toBe(2);
    } finally {
      await close();
    }
  });

  it('isStalled: the 14-day boundary (13 天不卡 / 14 天卡；从未完成按 createdAt 起算)', () => {
    const ago = (days: number): string => toIso(new Date(FIXTURE_NOW.getTime() - days * DAY_MS));
    expect(STALL_DAYS).toBe(14);
    expect(isStalled(ago(13), null, FIXTURE_NOW)).toBe(false);
    expect(isStalled(ago(14), null, FIXTURE_NOW)).toBe(true);
    expect(isStalled(null, ago(13), FIXTURE_NOW)).toBe(false);
    expect(isStalled(null, ago(14), FIXTURE_NOW)).toBe(true);
    expect(isStalled(null, null, FIXTURE_NOW)).toBe(false);
    // corrupt timestamps never stall.
    expect(isStalled('not-a-date', null, FIXTURE_NOW)).toBe(false);
    expect(isStalled(null, 'not-a-date', FIXTURE_NOW)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Project deadline (issue #16)
// ---------------------------------------------------------------------------

describe('project deadline', () => {
  it('round-trips: set → read back → change → clear', async () => {
    const { db, close } = await open();
    try {
      const project = makeProject();
      await addProject(db, project);
      // No deadline is the default, and it reads back as absent (undefined),
      // not as an empty string — the UI branches on exactly that.
      expect((await listProjects(db))[0]?.deadline).toBeUndefined();

      const due = toIso(new Date(FIXTURE_NOW.getTime() + 3 * DAY_MS));
      await updateProject(db, { ...project, deadline: due });
      expect((await listProjects(db))[0]?.deadline).toBe(due);

      const later = toIso(new Date(FIXTURE_NOW.getTime() + 9 * DAY_MS));
      await updateProject(db, { ...project, deadline: later });
      expect((await listProjects(db))[0]?.deadline).toBe(later);

      await updateProject(db, { ...project, deadline: undefined });
      expect((await listProjects(db))[0]?.deadline).toBeUndefined();
    } finally {
      await close();
    }
  });

  it('leaves pre-existing rows (NULL column) readable as "no deadline"', async () => {
    // The column was added to a table that already had rows; those rows must
    // keep working without a backfill migration.
    const { db, close } = await open(true);
    try {
      const list = await listProjects(db);
      expect(list).toHaveLength(3);
      expect(list.every((project) => project.deadline === undefined)).toBe(true);
    } finally {
      await close();
    }
  });

  it('survives a status transition with the deadline intact', async () => {
    const { db, close } = await open();
    try {
      const project = makeProject();
      const due = toIso(new Date(FIXTURE_NOW.getTime() + DAY_MS));
      await addProject(db, { ...project, deadline: due });
      await updateProject(db, {
        ...project,
        deadline: due,
        status: 'on-hold',
        updatedAt: toIso(FIXTURE_NOW),
      });
      const reloaded = (await listProjects(db))[0];
      expect(reloaded?.status).toBe('on-hold');
      expect(reloaded?.deadline).toBe(due);
    } finally {
      await close();
    }
  });
});
