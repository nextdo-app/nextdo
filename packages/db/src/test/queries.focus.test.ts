/**
 * Query tests — FocusSessions (spec: domain/domain-model.md "FocusSession" —
 * the live session persists as an `active` row; **timer end ≠ task
 * complete**).
 */
import {
  toIso,
  ulid,
  type FocusSession,
  type ReminderActionKind,
} from '@nextdo/core';
import {
  abandonFocusSession,
  addFocusSession,
  completeFocusSession,
  listFocusHistory,
  listFocusSessions,
  recordPause,
  startFocusSession,
} from '../queries/focus';
import { listNextActions } from '../queries/actions';
import { focusHistoryWatchQuery } from '../queries/watch-queries';
import { openTestDb, type TestDb } from './query-helpers';
import { FIXTURE_IDS, FIXTURE_NOW } from './fixtures';

const F = FIXTURE_IDS.focus;
const A = FIXTURE_IDS.actions;

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

function makeSession(overrides: Partial<FocusSession> = {}): FocusSession {
  return {
    id: ulid(FIXTURE_NOW),
    createdAt: toIso(FIXTURE_NOW),
    updatedAt: toIso(FIXTURE_NOW),
    deletedAt: null,
    actionId: '01TST0000000000000000000100',
    actionKind: 'next',
    mode: 'preset',
    plannedMinutes: 25,
    startedAt: toIso(FIXTURE_NOW),
    pausedSec: 0,
    status: 'active',
    ...overrides,
  };
}

describe('listFocusSessions', () => {
  it('returns [] on an empty database', async () => {
    const { db, close } = await open();
    try {
      expect(await listFocusSessions(db)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('lists the three seeded sessions; filters by actionId', async () => {
    const { db, close } = await open(true);
    try {
      expect(await listFocusSessions(db)).toHaveLength(3);
      const forA = await listFocusSessions(db, { actionId: A.a });
      expect(forA.map((session) => session.id)).toEqual([F.active]);
    } finally {
      await close();
    }
  });
});

describe('addFocusSession / startFocusSession', () => {
  it('add: inserts a valid session; rejects an out-of-range plannedMinutes', async () => {
    const { db, close } = await open();
    try {
      const session = makeSession();
      await addFocusSession(db, session);
      expect(await listFocusSessions(db)).toHaveLength(1);
      await addFocusSession(db, makeSession({ plannedMinutes: 30 }));
      await expect(
        addFocusSession(db, makeSession({ plannedMinutes: 181 })),
      ).rejects.toMatchObject({ code: 'validation.focusSession.plannedMinutes' });
      await expect(
        addFocusSession(db, makeSession({ plannedMinutes: 0 })),
      ).rejects.toMatchObject({ code: 'validation.focusSession.plannedMinutes' });
      await expect(
        addFocusSession(db, makeSession({ mode: 'free', plannedMinutes: 25 })),
      ).rejects.toMatchObject({ code: 'validation.focusSession.plannedMinutes' });
    } finally {
      await close();
    }
  });

  it('start: creates the live active row from this moment', async () => {
    const { db, close } = await open();
    try {
      const session = await startFocusSession(db, {
        actionId: '01TST0000000000000000000100',
        actionKind: 'next' as ReminderActionKind,
        mode: 'free',
        plannedMinutes: null,
        now: FIXTURE_NOW,
      });
      expect(session.status).toBe('active');
      expect(session.startedAt).toBe(toIso(FIXTURE_NOW));
      expect(session.pausedSec).toBe(0);
      expect(await listFocusSessions(db)).toHaveLength(1);
    } finally {
      await close();
    }
  });
});

describe('recordPause', () => {
  it('accumulates pausedSec on an active session', async () => {
    const { db, close } = await open(true);
    try {
      const updated = await recordPause(db, { sessionId: F.active, pausedSec: 45, now: FIXTURE_NOW });
      expect(updated.pausedSec).toBe(45);
      expect(updated.status).toBe('active');
      const reloaded = (await listFocusSessions(db)).find((session) => session.id === F.active);
      expect(reloaded?.pausedSec).toBe(45);
    } finally {
      await close();
    }
  });

  it('refuses a terminal session (its elapsed time is frozen)', async () => {
    const { db, close } = await open(true);
    try {
      await expect(
        recordPause(db, { sessionId: F.completed, pausedSec: 1, now: FIXTURE_NOW }),
      ).rejects.toMatchObject({ code: 'focusSession.not-active' });
    } finally {
      await close();
    }
  });

  it('refuses a negative total', async () => {
    const { db, close } = await open(true);
    try {
      await expect(
        recordPause(db, { sessionId: F.active, pausedSec: -5, now: FIXTURE_NOW }),
      ).rejects.toMatchObject({ code: 'validation.focusSession.pausedSec' });
    } finally {
      await close();
    }
  });
});

describe('completeFocusSession / abandonFocusSession', () => {
  it('complete: sets the terminal status + endedAt — and does NOT complete the action', async () => {
    const { db, close } = await open(true);
    try {
      const updated = await completeFocusSession(db, { sessionId: F.active, now: FIXTURE_NOW });
      expect(updated.status).toBe('completed');
      expect(updated.endedAt).toBe(toIso(FIXTURE_NOW));
      // The linked action (A.a) is a separate, explicit user confirmation.
      const action = (await listNextActions(db)).find((item) => item.id === A.a);
      expect(action?.status).toBe('open');
    } finally {
      await close();
    }
  });

  it('abandon: sets the terminal status + endedAt', async () => {
    const { db, close } = await open(true);
    try {
      const updated = await abandonFocusSession(db, { sessionId: F.active, now: FIXTURE_NOW });
      expect(updated.status).toBe('abandoned');
      expect(updated.endedAt).toBe(toIso(FIXTURE_NOW));
    } finally {
      await close();
    }
  });

  it('terminal sessions reject further transitions', async () => {
    const { db, close } = await open(true);
    try {
      await expect(
        completeFocusSession(db, { sessionId: F.completed, now: FIXTURE_NOW }),
      ).rejects.toMatchObject({ code: 'invalid-transition:completed:completed' });
      await expect(
        abandonFocusSession(db, { sessionId: F.completed, now: FIXTURE_NOW }),
      ).rejects.toMatchObject({ code: 'invalid-transition:completed:abandoned' });
    } finally {
      await close();
    }
  });

  it('throws not-found for a missing session', async () => {
    const { db, close } = await open(true);
    try {
      await expect(
        completeFocusSession(db, { sessionId: '01TST0000000000000000000099', now: FIXTURE_NOW }),
      ).rejects.toMatchObject({ code: 'focusSession.not-found' });
    } finally {
      await close();
    }
  });
});

describe('listFocusHistory (issue #96)', () => {
  it('lists terminal sessions newest first with the current action titles; excludes active', async () => {
    const { db, close } = await open(true);
    try {
      const rows = await listFocusHistory(db);
      expect(rows.map((row) => row.id)).toEqual([F.completed, F.abandoned]);
      expect(rows.map((row) => row.status)).toEqual(['completed', 'abandoned']);
      expect(rows.map((row) => row.title)).toEqual([
        '运行论文 baseline A',
        '工作日联系客服报修打印机',
      ]);
    } finally {
      await close();
    }
  });

  it('keeps the session facts the screen needs (mode, planned, paused)', async () => {
    const { db, close } = await open(true);
    try {
      const [completed, abandoned] = await listFocusHistory(db);
      expect(completed).toMatchObject({
        actionKind: 'next',
        actionId: A.b,
        mode: 'preset',
        plannedMinutes: 25,
        pausedSec: 120,
        status: 'completed',
      });
      expect(abandoned).toMatchObject({
        actionKind: 'next',
        actionId: A.window,
        mode: 'free',
        plannedMinutes: null,
        pausedSec: 60,
        status: 'abandoned',
      });
    } finally {
      await close();
    }
  });

  it('excludes a soft-deleted session but keeps an orphan whose action was trashed', async () => {
    const { db, close } = await open(true);
    try {
      await db
        .updateTable('focus_sessions')
        .set({ deleted_at: toIso(FIXTURE_NOW) })
        .where('id', '=', F.completed)
        .execute();
      let rows = await listFocusHistory(db);
      expect(rows.map((row) => row.id)).toEqual([F.abandoned]);

      // The time actually spent stays on the record; only the title is gone.
      await db
        .updateTable('next_actions')
        .set({ deleted_at: toIso(FIXTURE_NOW) })
        .where('id', '=', A.window)
        .execute();
      rows = await listFocusHistory(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.title).toBeNull();
    } finally {
      await close();
    }
  });

  it('focusHistoryWatchQuery compiles and returns the same rows (watch adapter)', async () => {
    const { db, close } = await open(true);
    try {
      const query = focusHistoryWatchQuery(db);
      const compiled = query.compile();
      expect(compiled.sql).toMatch(/focus_sessions/);
      expect(compiled.sql).toMatch(/status" in \(/);
      const rows = await query.execute();
      expect(rows.map((row) => row.id)).toEqual([F.completed, F.abandoned]);
      expect(rows[0]!.title).toBe('运行论文 baseline A');
    } finally {
      await close();
    }
  });
});
