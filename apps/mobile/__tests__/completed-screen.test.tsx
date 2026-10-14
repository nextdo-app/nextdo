/**
 * Component tests — the 「已完成行动」 window (issue 27).
 *
 * The screen has exactly two jobs, and both are pinned here: it lists what
 * the user completed (with WHEN), and its per-row 恢复 runs the restore
 * transaction with that row's own kind + id. A focus session ending must
 * never land here on its own — the focus-screen tests cover that half.
 */

/** The mutable local "database" of completed actions. */
const mockCompletedRef: { current: unknown[] } = { current: [] };

/** Tracking calls to reopenAction, with a failure switch. */
const reopenCalls: { args: unknown[]; shouldFail: boolean } = { args: [], shouldFail: false };

jest.mock('@nextdo/db', () => {
  const compilable = () => ({
    compile: () => ({ sql: 'SELECT 1', parameters: [] }),
    execute: async () => [],
  });
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    disconnect: async () => undefined,
    close: async () => undefined,
  };
  return {
    createPowerSyncDatabase: () => powersync,
    getOwnerToken: async () => null,
    getStoredBackendConfig: async () => null,
    fetchCredentialsOnce: async () => ({ ok: true, token: 'ps-jwt' }),
    setOwnerToken: async () => undefined,
    clearOwnerToken: async () => undefined,
    subscribeToOwnerTokenChange: () => () => undefined,
    createPowerSyncConnector: () => ({
      fetchCredentials: async () => null,
      uploadData: async () => undefined,
    }),
    subscribeAppStream: async () => undefined,
    wrapDb: () => ({}),
    listScheduledReminders: async () => [],
    seedDefaultContexts: async () => 0,
    isReactNativeRuntime: () => false,
    queryEnginePool: async () => ({ actions: [], calendar: [], projects: [] }),
    poolTriggerWatchQuery: compilable,
    inboxItemsWatchQuery: compilable,
    projectsWatchQuery: compilable,
    projectCardsWatchQuery: compilable,
    isStalled: () => false,
    reviewRecordsWatchQuery: compilable,
    waitingForWatchQuery: compilable,
    skipAction: async () => undefined,
    completeAction: async () => undefined,
    snoozeAction: async () => undefined,
    trashAction: async () => undefined,
    listProjects: async () => [{ id: 'p-1', title: '论文致谢', status: 'active', deadline: undefined }],
    listHabits: async () => [],
    listHabitDays: async () => [],
    listContexts: async () => [],
    // --- the completed surface under test ---
    completedActionsWatchQuery: compilable,
    reopenAction: async (_db: unknown, args: unknown) => {
      reopenCalls.args.push(args);
      if (reopenCalls.shouldFail) throw new Error('restore rejected');
    },
  };
});

jest.mock('@powersync/react', () => {
  const React = jest.requireActual('react');
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    close: () => Promise.resolve(undefined),
    onChange: () => () => undefined,
  };
  return {
    PowerSyncContext: React.createContext(powersync),
    usePowerSync: () => powersync,
    useQuery: () => ({
      data: mockCompletedRef.current,
      isLoading: false,
      isFetching: false,
      error: undefined,
      refresh: async () => undefined,
    }),
    useStatus: () => ({ status: 'synced', isSynced: true }),
  };
});

jest.mock('expo-notifications', () => mockExpoNotifications);

import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { mockExpoNotifications } from './mocks/expo-notifications';

function completed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a-1',
    kind: 'next',
    title: '跑 baseline A',
    estMinutes: 45,
    contextIds: [],
    projectId: 'p-1',
    completedAt: '2026-10-13T09:00:00.000Z',
    ...overrides,
  };
}

async function flush(rounds = 10): Promise<void> {
  let p: Promise<unknown> = Promise.resolve();
  for (let i = 0; i < rounds; i++) {
    p = p.then(() => act(async () => {}));
  }
  await p;
}

beforeEach(() => {
  mockCompletedRef.current = [
    completed(),
    completed({
      id: 'c-1',
      kind: 'calendar',
      title: '组会',
      estMinutes: 60,
      projectId: null,
      completedAt: '2026-10-14T02:00:00.000Z',
    }),
  ];
  reopenCalls.args = [];
  reopenCalls.shouldFail = false;
  mockExpoNotifications.getPermissionsAsync.mockResolvedValue({
    status: 'undetermined',
    granted: false,
  } as never);
});

describe('已完成行动 window (issue 27)', () => {
  it('lists each completed action with its kind, project and completion time', async () => {
    renderRouter('app', { initialUrl: '/completed' });
    await flush();

    await waitFor(() => expect(screen.getByText('已完成行动')).toBeTruthy());
    expect(screen.getByText('跑 baseline A')).toBeTruthy();
    expect(screen.getByText('下一步行动')).toBeTruthy();
    // The project name is resolved from the id the row carries.
    expect(screen.getByText('论文致谢')).toBeTruthy();
    expect(screen.getByText('组会')).toBeTruthy();
    expect(screen.getByText('日程')).toBeTruthy();
    expect(screen.getAllByText(/完成于 /).length).toBe(2);
  });

  it('恢复为未完成 runs the restore for THAT row (kind + id)', async () => {
    renderRouter('app', { initialUrl: '/completed' });
    await flush();
    await waitFor(() => expect(screen.getByText('组会')).toBeTruthy());

    const buttons = screen.getAllByRole('button', { name: '恢复为未完成' });
    expect(buttons.length).toBe(2);
    // The newest completion is first (组会, 2026-10-14) — the hook re-sorts
    // the UNION's arbitrary row order, so index 0 is the calendar action.
    fireEvent.press(buttons[0]!);
    await flush();

    expect(reopenCalls.args).toHaveLength(1);
    expect(reopenCalls.args[0]).toMatchObject({ actionKind: 'calendar', actionId: 'c-1' });
    expect(reopenCalls.args[0]).toHaveProperty('now');
  });

  it('lists a habit 打卡 and restores it with kind=habit', async () => {
    mockCompletedRef.current = [
      completed({
        id: 'hd-1',
        kind: 'habit',
        title: '21 天晨读挑战',
        estMinutes: 30,
        projectId: null,
      }),
    ];
    renderRouter('app', { initialUrl: '/completed' });
    await flush();

    await waitFor(() => expect(screen.getByText('21 天晨读挑战')).toBeTruthy());
    expect(screen.getByText('习惯')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: '恢复为未完成' }));
    await flush();

    expect(reopenCalls.args[0]).toMatchObject({ actionKind: 'habit', actionId: 'hd-1' });
  });

  it('a failed restore surfaces the error instead of silently doing nothing', async () => {
    reopenCalls.shouldFail = true;
    renderRouter('app', { initialUrl: '/completed' });
    await flush();
    await waitFor(() => expect(screen.getByText('跑 baseline A')).toBeTruthy());

    fireEvent.press(screen.getAllByRole('button', { name: '恢复为未完成' })[0]!);
    await flush();

    expect(reopenCalls.args).toHaveLength(1);
    await waitFor(() => expect(screen.getByText('restore rejected')).toBeTruthy());
  });

  it('the empty state explains where completions come from', async () => {
    mockCompletedRef.current = [];
    renderRouter('app', { initialUrl: '/completed' });
    await flush();

    await waitFor(() => expect(screen.getByText('还没有已完成的行动')).toBeTruthy());
    expect(screen.queryByRole('button', { name: '恢复为未完成' })).toBeNull();
  });
});