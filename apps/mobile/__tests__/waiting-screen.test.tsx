/**
 * Component tests — the waiting screen (Waiting For 事项管理).
 *
 * Runs for real against a mocked `@nextdo/db` and `@powersync/react` boundary.
 */

/** The mutable local "database" of waiting items. */
const mockWaitingRef: { current: unknown[] } = { current: [] };

/** Tracking calls to addWaitingForItem and trashWaitingForItem. */
const calls = {
  add: [] as unknown[],
  trash: [] as unknown[],
};

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
    somedayItemsWatchQuery: compilable,
    skipAction: async () => undefined,
    completeAction: async () => undefined,
    snoozeAction: async () => undefined,
    trashAction: async () => undefined,
    listProjects: async () => [],
    listHabits: async () => [],
    listHabitDays: async () => [],
    listContexts: async () => [],
    // --- the waiting surface under test ---
    listWaitingForItems: async () => mockWaitingRef.current,
    addWaitingForItem: async (_db: unknown, item: unknown) => {
      calls.add.push(item);
      mockWaitingRef.current = [item, ...mockWaitingRef.current];
      return item;
    },
    trashWaitingForItem: async (_db: unknown, args: { id: string }) => {
      calls.trash.push(args);
      mockWaitingRef.current = mockWaitingRef.current.filter(
        (row) => (row as { id: string }).id !== args.id,
      );
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
      data: mockWaitingRef.current,
      isLoading: false,
      isFetching: false,
      error: undefined,
      refresh: async () => undefined,
    }),
    useStatus: () => ({ status: 'synced', isSynced: true }),
  };
});

jest.mock('expo-notifications', () => mockExpoNotifications);

import { act, fireEvent, renderRouter, screen, testRouter, waitFor } from 'expo-router/testing-library';
import { mockExpoNotifications } from './mocks/expo-notifications';
import { toIso } from '@nextdo/core';

function waitingItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = toIso(new Date());
  return {
    id: 'w-1',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    title: '等导师审阅论文',
    waitingOn: '导师',
    expectedBy: undefined,
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

async function openWaiting(): Promise<void> {
  renderRouter('app', { initialUrl: '/(tabs)/inbox' });
  await flush();
  testRouter.navigate('/waiting');
  await flush();
}

beforeEach(() => {
  mockWaitingRef.current = [
    waitingItem(),
    waitingItem({ id: 'w-2', title: '等发票开具', waitingOn: '财务部' }),
  ];
  calls.add = [];
  calls.trash = [];
  mockExpoNotifications.getPermissionsAsync.mockResolvedValue({
    status: 'undetermined',
    granted: false,
  } as never);
});

describe('Waiting screen', () => {
  it('lists existing waiting items with title and waitingOn badge', async () => {
    await openWaiting();

    await waitFor(() => expect(screen.getByText('等待事项')).toBeTruthy());
    expect(screen.getByText('等导师审阅论文')).toBeTruthy();
    expect(screen.getByText('等待: 导师')).toBeTruthy();
    expect(screen.getByText('等发票开具')).toBeTruthy();
    expect(screen.getByText('等待: 财务部')).toBeTruthy();
  });

  it('pressing 已得到结果 triggers trash', async () => {
    await openWaiting();
    await waitFor(() => expect(screen.getByText('等导师审阅论文')).toBeTruthy());

    const finishButtons = screen.getAllByRole('button', { name: '已得到结果' });
    expect(finishButtons.length).toBeGreaterThanOrEqual(1);
    fireEvent.press(finishButtons[0]!);
    await flush();

    expect(calls.trash).toHaveLength(1);
    expect((calls.trash[0] as { id: string }).id).toBe('w-1');
  });

  it('validates empty inputs on add form', async () => {
    await openWaiting();
    await waitFor(() => expect(screen.getByText('等待事项')).toBeTruthy());

    const addButton = screen.getByRole('button', { name: '添加等待' });
    expect(addButton.props.accessibilityState?.disabled).toBe(true);

    fireEvent.changeText(screen.getByLabelText('等待事项名称'), '等快递送达');
    expect(addButton.props.accessibilityState?.disabled).toBe(true);

    fireEvent.changeText(screen.getByLabelText('等待对象'), '顺丰速运');
    expect(addButton.props.accessibilityState?.disabled).toBe(false);

    fireEvent.press(addButton);
    await flush();

    expect(calls.add).toHaveLength(1);
    expect(calls.add[0]).toMatchObject({
      title: '等快递送达',
      waitingOn: '顺丰速运',
    });
  });

  it('shows empty state when no waiting items exist', async () => {
    mockWaitingRef.current = [];
    await openWaiting();

    await waitFor(() => expect(screen.getByText('暂无等待事项')).toBeTruthy());
  });
});
