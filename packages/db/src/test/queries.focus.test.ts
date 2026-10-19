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
  listFocusSessions,
  recordPause,
  startFocusSession,
} from '../queries/focus';
import { listNextActions } from '../queries/actions';
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
