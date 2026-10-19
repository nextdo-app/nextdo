/**
 * Component tests — the Focus timer screen (PRD R5, design.md §4.6).
 *
 * The db layer is mocked at the packages/db boundary with REAL session-row
 * state (a mutable array the mock functions read/write), covering the four
 * row states the screen must handle: no session (pick step), an active
 * session (live timer), a time-up session (banner), the post-session step
 * (issue 27 — 专注结束 ≠ 行动完成), and terminal-only rows (back to the pick
 * step). The timer math itself is unit-tested in lib/focus-timer.test.ts.
 */
type Session = {
  id: string;
  actionId: string;
  actionKind: string;
  mode: 'preset' | 'free';
  plannedMinutes: number | null;
  startedAt: string;
  pausedSec: number;
  status: 'active' | 'completed' | 'abandoned';
  endedAt?: string;
};

// `mock`-prefixed names are the only top-level bindings the jest.mock
// factory may reference (babel hoisting whitelist).
const mockState: { sessions: Session[] } = { sessions: [] };
const mockDb = {
  startFocusSession: jest.fn(),
  recordPause: jest.fn(),
  completeFocusSession: jest.fn(),
  abandonFocusSession: jest.fn(),
  completeAction: jest.fn(),
  addInboxItem: jest.fn(),
};

jest.mock('@nextdo/db', () => {
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    disconnect: async () => undefined,
    close: async () => undefined,
  };
  return {
    createPowerSyncDatabase: () => powersync,
    // R6 startup token check (background, non-blocking): a valid stored
    // token — the screen renders regardless (there is no gate in R6).
    getOwnerToken: async () => 'test-owner-token',
    getStoredBackendConfig: async () => null,
    fetchCredentialsOnce: async () => ({ ok: true, token: 'ps-service-jwt' }),
    setOwnerToken: async () => undefined,
    clearOwnerToken: async () => undefined,
    subscribeToOwnerTokenChange: () => () => undefined,
    createPowerSyncConnector: () => ({
      fetchCredentials: async () => null,
      uploadData: async () => undefined,
    }),
    subscribeAppStream: async () => undefined,
    wrapDb: () => ({}),
    // The delivery hook's source query (task 09-30 — the root layout
    // mounts useReminderDelivery in every renderRouter test).
    listScheduledReminders: async () => [],
    seedDefaultContexts: async () => 0,
    isReactNativeRuntime: () => false,
    listFocusSessions: async (_db: unknown, options?: { actionId?: string }) =>
      mockState.sessions.filter((s) => options?.actionId === undefined || s.actionId === options.actionId),
    // `mockDb` is declared after this factory but only touched when the
    // module is required — which now happens during import hoisting (the
    // focus-settings import pulls `@nextdo/db` in), so these go through
    // lazy wrappers instead of reading the binding at factory time.
    startFocusSession: (...args: unknown[]) => mockDb.startFocusSession(...args),
    recordPause: (...args: unknown[]) => mockDb.recordPause(...args),
    completeFocusSession: (...args: unknown[]) => mockDb.completeFocusSession(...args),
    abandonFocusSession: (...args: unknown[]) => mockDb.abandonFocusSession(...args),
    completeAction: (...args: unknown[]) => mockDb.completeAction(...args),
    // The focus page's quick capture (issue #58) — resolves to the item.
    addInboxItem: (...args: unknown[]) => mockDb.addInboxItem(...args),
    listNextActions: async () => [
      {
        id: 'f-1',
        createdAt: '2026-09-20T01:00:00.000Z',
        updatedAt: '2026-09-20T01:00:00.000Z',
        deletedAt: null,
        title: '写季度总结',
        projectId: null,
        contextIds: [],
        estMinutes: 30,
        value: 3,
        consecutiveSkips: 0,
        status: 'open',
      },
    ],
    listCalendarActions: async () => [],
    listHabitDays: async () => [],
    listHabits: async () => [],
    // The /now fallback target (goBack on 完成/放弃 in a deep-loaded stack)
    // mounts the Now screen — its pool / context / project hooks resolve
    // empty here so the screen renders its empty state.
    poolTriggerWatchQuery: () => ({}),
    queryEnginePool: async () => ({ actions: [], calendar: [], projects: [] }),
    listContexts: async () => [],
    listProjects: async () => [],
  };
});

jest.mock('@powersync/react', () => {
  const React = jest.requireActual('react');
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    close: async () => undefined,
    // The delivery hook subscribes to local changes (task 09-30) — a
    // no-op subscription in tests (the mocked queries never fire it).
    onChange: () => () => undefined,
  };
  return {
    PowerSyncContext: React.createContext(powersync),
    usePowerSync: () => powersync,
    useQuery: () => ({ data: [], error: undefined }),
    useStatus: () => ({ status: 'synced', isSynced: true }),
  };
});

// The root layout mounts the delivery engine (task 09-30) — jest runs as
// Platform 'ios', so the real native adapter drives expo-notifications
// (mocked: idle OS state — nothing pending, permission undetermined).
jest.mock('expo-notifications', () => mockExpoNotifications);

import { mockExpoNotifications } from './mocks/expo-notifications';

import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { FOCUS_SETTINGS_KEY, __setFocusSettingsStoreForTests } from '@/lib/focus-settings';

/** Device-local preference fixture (the module otherwise uses localStorage). */
const focusStore = (() => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (key: string) => map.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      map.set(key, value);
    },
  };
})();

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function seedActiveSession(overrides: Partial<Session> = {}): Session {
  const session: Session = {
    id: 's-1',
    actionId: 'f-1',
    actionKind: 'next',
    mode: 'preset',
    plannedMinutes: 25,
    startedAt: minutesAgo(1),
    pausedSec: 0,
    status: 'active',
    ...overrides,
  };
  mockState.sessions = [session];
  return session;
}

beforeEach(() => {
  mockState.sessions = [];
  jest.clearAllMocks();
  focusStore.map.clear();
  __setFocusSettingsStoreForTests(focusStore);
  mockDb.addInboxItem.mockImplementation(async (_db: unknown, item: unknown) => item);
  mockDb.startFocusSession.mockImplementation(async (_db: unknown, args: { now: Date; plannedMinutes: number | null; mode: string }) => {
    const session: Session = {
      id: 's-new',
      actionId: 'f-1',
      actionKind: 'next',
      mode: args.mode as 'preset' | 'free',
      plannedMinutes: args.plannedMinutes,
      startedAt: args.now.toISOString(),
      pausedSec: 0,
      status: 'active',
    };
    mockState.sessions = [...mockState.sessions, session];
    return session;
  });
  mockDb.recordPause.mockImplementation(
    async (_db: unknown, args: { sessionId: string; pausedSec: number }) => {
      const session = mockState.sessions.find((s) => s.id === args.sessionId);
      if (session !== undefined) session.pausedSec = args.pausedSec;
      return session;
    },
  );
  mockDb.completeFocusSession.mockImplementation(async (_db: unknown, args: { sessionId: string }) => {
    const session = mockState.sessions.find((s) => s.id === args.sessionId);
    if (session !== undefined) {
      session.status = 'completed';
      session.endedAt = new Date().toISOString();
    }
    return session;
  });
  mockDb.abandonFocusSession.mockImplementation(async (_db: unknown, args: { sessionId: string }) => {
    const session = mockState.sessions.find((s) => s.id === args.sessionId);
    if (session !== undefined) {
      session.status = 'abandoned';
      session.endedAt = new Date().toISOString();
    }
    return session;
  });
  mockDb.completeAction.mockResolvedValue(undefined);
});

describe('Focus screen', () => {
  it('with no active session: the pick step offers 15/25/45/60/free', async () => {
    renderRouter('app', { initialUrl: '/focus/f-1?kind=next' });
    await waitFor(() => expect(screen.getByText('选择本次专注时长')).toBeTruthy());
    expect(screen.getByText('15 分钟')).toBeTruthy();
    expect(screen.getByText('25 分钟')).toBeTruthy();
    expect(screen.getByText('45 分钟')).toBeTruthy();
    expect(screen.getByText('60 分钟')).toBeTruthy();
    expect(screen.getByText('自由计时')).toBeTruthy();
  });

  it('picking a preset starts the session and runs the countdown', async () => {
    renderRouter('app', { initialUrl: '/focus/f-1?kind=next' });
    await waitFor(() => expect(screen.getByText('25 分钟')).toBeTruthy());
    fireEvent.press(screen.getByText('25 分钟'));

    await waitFor(() => expect(mockDb.startFocusSession).toHaveBeenCalledTimes(1));
    const call = mockDb.startFocusSession.mock.calls[0][1];
    expect(call.plannedMinutes).toBe(25);
    expect(call.mode).toBe('preset');
    expect(call.actionId).toBe('f-1');
    // The countdown renders 25:00 (± the sub-second tick) with the controls.
    await waitFor(() => expect(screen.getByText(/24:5\d|25:00/)).toBeTruthy());
    expect(screen.getByText('暂停')).toBeTruthy();
  });

  it('pause freezes the clock; resume writes the accumulated total', async () => {
    seedActiveSession({ startedAt: minutesAgo(2) });
    renderRouter('app', { initialUrl: '/focus/f-1?kind=next' });

    // The live timer (no pick step on re-entry).
    await waitFor(() => expect(screen.getByText('暂停')).toBeTruthy());

    fireEvent.press(screen.getByText('暂停'));
    expect(screen.getByText('已暂停')).toBeTruthy();
    expect(screen.getByText('继续')).toBeTruthy();

    fireEvent.press(screen.getByText('继续'));
    await waitFor(() => expect(mockDb.recordPause).toHaveBeenCalledTimes(1));
    const call = mockDb.recordPause.mock.calls[0][1];
    expect(call.sessionId).toBe('s-1');
    expect(typeof call.pausedSec).toBe('number');
    expect(call.pausedSec).toBeGreaterThanOrEqual(0);
  });

  it('a time-up session shows the notice; 继续专注 dismisses it (session stays active)', async () => {
    // 26 minutes elapsed on a 25-minute preset.
    seedActiveSession({ startedAt: minutesAgo(26) });
    renderRouter('app', { initialUrl: '/focus/f-1?kind=next' });

    await waitFor(() => expect(screen.getByText('时间到')).toBeTruthy());
    // Issue 56: the notice is an alert INSIDE the focus card (no nested
    // Card), and the dimmed clock names the actual focus duration.
    expect(screen.getByLabelText('专注时间到')).toBeTruthy();
    expect(screen.getByText('本次专注满 25 分钟。结束专注，或继续再专注一会儿。')).toBeTruthy();
    expect(screen.getByText('本次专注 26 分钟')).toBeTruthy();
    // The notice offers 结束专注 / 继续专注 (the controls row is replaced).
    expect(screen.queryByText('暂停')).toBeNull();
    fireEvent.press(screen.getByText('继续专注'));
    expect(screen.queryByText('时间到')).toBeNull();
    expect(screen.getByText('暂停')).toBeTruthy();
    expect(mockState.sessions[0]?.status).toBe('active');
  });

  it('结束专注 closes the session WITHOUT completing the action (issue 27)', async () => {
    seedActiveSession();
    const view = renderRouter('app', { initialUrl: '/focus/f-1?kind=next' });
    await waitFor(() => expect(screen.getByText('结束专注')).toBeTruthy());
    fireEvent.press(screen.getByText('结束专注'));

    await waitFor(() => expect(mockDb.completeFocusSession).toHaveBeenCalledTimes(1));
    expect(mockState.sessions[0]?.status).toBe('completed');
    // The action is untouched — the follow-up step asks, it does not assume.
    expect(mockDb.completeAction).not.toHaveBeenCalled();
    // The screen stays put on the separate question instead of navigating.
    await waitFor(() => expect(screen.getByText('专注已完成')).toBeTruthy());
    expect(view.getPathname()).toBe('/focus/f-1');
  });

  it('the follow-up step completes the action only when 完成行动 is pressed', async () => {
    seedActiveSession();
    const view = renderRouter('app', { initialUrl: '/focus/f-1?kind=next' });
    await waitFor(() => expect(screen.getByText('结束专注')).toBeTruthy());
    fireEvent.press(screen.getByText('结束专注'));
    await waitFor(() => expect(screen.getByText('完成行动')).toBeTruthy());

    fireEvent.press(screen.getByText('完成行动'));
    await waitFor(() => expect(mockDb.completeAction).toHaveBeenCalledTimes(1));
    expect(mockDb.completeAction.mock.calls[0][1]).toMatchObject({ actionKind: 'next', actionId: 'f-1' });
    // Deep-loaded stack has no parent → goBack replaces to the Now tab.
    await waitFor(() => expect(view.getPathname()).toBe('/now'));
  });

  it('先不完成 banks the focus and leaves the action open in the pool', async () => {
    seedActiveSession();
    const view = renderRouter('app', { initialUrl: '/focus/f-1?kind=next' });
    await waitFor(() => expect(screen.getByText('结束专注')).toBeTruthy());
    fireEvent.press(screen.getByText('结束专注'));
    await waitFor(() => expect(screen.getByText('先不完成')).toBeTruthy());

    fireEvent.press(screen.getByText('先不完成'));
    await waitFor(() => expect(view.getPathname()).toBe('/now'));
    expect(mockDb.completeAction).not.toHaveBeenCalled();
    expect(mockState.sessions[0]?.status).toBe('completed');
  });

  it('放弃 closes the session as abandoned and leaves the action untouched', async () => {
    seedActiveSession();
    renderRouter('app', { initialUrl: '/focus/f-1?kind=next' });
    await waitFor(() => expect(screen.getByText('放弃')).toBeTruthy());
    fireEvent.press(screen.getByText('放弃'));

    await waitFor(() => expect(mockDb.abandonFocusSession).toHaveBeenCalledTimes(1));
    expect(mockDb.completeAction).not.toHaveBeenCalled();
    expect(mockState.sessions[0]?.status).toBe('abandoned');
  });

  it('terminal-only rows fall back to the pick step', async () => {
    seedActiveSession({ id: 's-old', status: 'completed', startedAt: minutesAgo(300), endedAt: minutesAgo(275) });
    renderRouter('app', { initialUrl: '/focus/f-1?kind=next' });
    await waitFor(() => expect(screen.getByText('选择本次专注时长')).toBeTruthy());
    expect(screen.queryByText('时间到')).toBeNull();
  });

  it('an active session recovered on re-entry shows the remaining time', async () => {
    // 10 minutes into a 25-minute session → ~15:00 left.
    seedActiveSession({ startedAt: minutesAgo(10) });
    renderRouter('app', { initialUrl: '/focus/f-1?kind=next' });
    await waitFor(() => expect(screen.getByText(/1[45]:\d{2}/)).toBeTruthy());
    // The action title (from the db) renders in the card header.
    expect(screen.getByText('写季度总结')).toBeTruthy();
  });

  it('starts a custom duration (issue #59) and remembers it for next time', async () => {
    renderRouter('app', { initialUrl: '/focus/f-1?kind=next' });
    await waitFor(() => expect(screen.getByText('选择本次专注时长')).toBeTruthy());

    fireEvent.changeText(screen.getByLabelText('自定义专注时长（分钟）'), '30');
    fireEvent.press(screen.getByText('开始'));

    await waitFor(() => expect(mockDb.startFocusSession).toHaveBeenCalledTimes(1));
    const call = mockDb.startFocusSession.mock.calls[0][1];
    expect(call.plannedMinutes).toBe(30);
    expect(call.mode).toBe('preset');
    await waitFor(() =>
      expect(focusStore.map.get(FOCUS_SETTINGS_KEY)).toBe(JSON.stringify({ lastMinutes: 30 })),
    );
  });

  it('rejects a custom duration outside 1–180 with a hint (issue #59)', async () => {
    renderRouter('app', { initialUrl: '/focus/f-1?kind=next' });
    await waitFor(() => expect(screen.getByText('选择本次专注时长')).toBeTruthy());

    fireEvent.changeText(screen.getByLabelText('自定义专注时长（分钟）'), '300');
    fireEvent.press(screen.getByText('开始'));

    expect(screen.getByText('请输入 1–180 之间的整数分钟')).toBeTruthy();
    expect(mockDb.startFocusSession).not.toHaveBeenCalled();
  });

  it('offers the remembered duration first as the default (issue #59)', async () => {
    focusStore.map.set(FOCUS_SETTINGS_KEY, JSON.stringify({ lastMinutes: 30 }));
    renderRouter('app', { initialUrl: '/focus/f-1?kind=next' });

    await waitFor(() => expect(screen.getByText('30 分钟')).toBeTruthy());
    fireEvent.press(screen.getByText('30 分钟'));

    await waitFor(() => expect(mockDb.startFocusSession).toHaveBeenCalledTimes(1));
    expect(mockDb.startFocusSession.mock.calls[0][1].plannedMinutes).toBe(30);
  });

  it('速记 captures an inbox item without leaving the running session (issue #58)', async () => {
    seedActiveSession();
    const view = renderRouter('app', { initialUrl: '/focus/f-1?kind=next' });
    await waitFor(() => expect(screen.getByText('暂停')).toBeTruthy());

    fireEvent.press(screen.getByText('速记一笔'));
    fireEvent.changeText(screen.getByPlaceholderText(/记下任何事/), '先记个想法');
    fireEvent.press(screen.getByText('记录'));

    await waitFor(() => expect(mockDb.addInboxItem).toHaveBeenCalledTimes(1));
    expect(mockDb.addInboxItem.mock.calls[0][1]).toMatchObject({ title: '先记个想法' });
    // Saving confirms in place (issue #58) instead of silently closing.
    await waitFor(() => expect(screen.getByText(/已记入收集箱/)).toBeTruthy());
    // The timer keeps running — capture never navigates away.
    expect(view.getPathname()).toBe('/focus/f-1');
    expect(screen.getByText('暂停')).toBeTruthy();
  });

  it('auto-starts a 2-minute focus session when preset=2 and autoStart=1 are provided (Issue 51)', async () => {
    mockState.sessions = [];
    mockDb.startFocusSession.mockImplementationOnce(async (_db, args) => {
      const s = {
        id: 's-auto',
        actionId: args.actionId,
        actionKind: args.actionKind,
        mode: args.mode,
        plannedMinutes: args.plannedMinutes,
        startedAt: new Date().toISOString(),
        pausedSec: 0,
        status: 'active' as const,
      };
      mockState.sessions.push(s);
      return s;
    });

    renderRouter('app', { initialUrl: '/focus/f-1?kind=next&preset=2&autoStart=1' });
    await waitFor(() =>
      expect(mockDb.startFocusSession).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actionId: 'f-1', actionKind: 'next', mode: 'preset', plannedMinutes: 2 }),
      ),
    );
    await waitFor(() => expect(screen.getByText('结束专注')).toBeTruthy());
  });
});
