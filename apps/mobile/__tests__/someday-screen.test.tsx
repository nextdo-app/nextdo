/**
 * Component tests — the Someday/Maybe screen.
 *
 * The screen is the always-available list behind 「有空再说」: entries come
 * from the Clarify wizard and from the Now action menu's
 * 「转为 Someday/Maybe」. Runs for real against a mocked `@nextdo/db` and
 * `@powersync/react` boundary (same shell mocks as waiting-screen.test.tsx).
 */
const mockSomedayRef: { current: unknown[] } = { current: [] };

const calls = {
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
    settingsWatchQuery: () => ({
      compile: () => ({ sql: 'SELECT 1', parameters: [] }),
      execute: async () => [],
    }),
    setAppSetting: async () => undefined,
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
    listWaitingForItems: async () => [],
    // --- the someday surface under test ---
    trashSomedayMaybeItem: async (_db: unknown, args: { id: string }) => {
      calls.trash.push(args);
      mockSomedayRef.current = mockSomedayRef.current.filter(
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
      data: mockSomedayRef.current,
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

function somedayItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = toIso(new Date());
  return {
    id: 's-1',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    title: '学做手冲咖啡',
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

async function openSomeday(): Promise<void> {
  renderRouter('app', { initialUrl: '/(tabs)/inbox' });
  await flush();
  testRouter.navigate('/someday');
  await flush();
}

beforeEach(() => {
  mockSomedayRef.current = [
    somedayItem({ note: '先看器材清单' }),
    somedayItem({ id: 's-2', title: '读完《搞定》' }),
  ];
  calls.trash = [];
  mockExpoNotifications.getPermissionsAsync.mockResolvedValue({
    status: 'undetermined',
    granted: false,
  } as never);
});

describe('Someday screen', () => {
  it('lists parked items with their note', async () => {
    await openSomeday();

    await waitFor(() => expect(screen.getByText('Someday / Maybe')).toBeTruthy());
    expect(screen.getByText('学做手冲咖啡')).toBeTruthy();
    expect(screen.getByText('先看器材清单')).toBeTruthy();
    expect(screen.getByText('读完《搞定》')).toBeTruthy();
  });

  it('删除 asks for confirmation before trashing the item', async () => {
    await openSomeday();
    await waitFor(() => expect(screen.getByText('学做手冲咖啡')).toBeTruthy());

    fireEvent.press(screen.getAllByRole('button', { name: '删除' })[0]!);
    expect(calls.trash).toHaveLength(0);

    fireEvent.press(screen.getByRole('button', { name: '确认删除？' }));
    await flush();

    expect(calls.trash).toHaveLength(1);
    expect((calls.trash[0] as { id: string }).id).toBe('s-1');
  });

  it('deletes with the app clock at press time, not the mount time', async () => {
    await openSomeday();
    await waitFor(() => expect(screen.getByText('学做手冲咖啡')).toBeTruthy());
    const mountedAt = Date.now();

    // One app-clock tick: the delete must carry the NEW now, not the value
    // captured when the screen mounted.
    await act(async () => {
      jest.advanceTimersByTime(61_000);
    });

    fireEvent.press(screen.getAllByRole('button', { name: '删除' })[0]!);
    fireEvent.press(screen.getByRole('button', { name: '确认删除？' }));
    await flush();

    expect(calls.trash).toHaveLength(1);
    const deletedAt = new Date((calls.trash[0] as { now: Date }).now).getTime();
    expect(deletedAt).toBeGreaterThanOrEqual(mountedAt + 60_000);
  });

  it('shows the empty state when nothing is parked', async () => {
    mockSomedayRef.current = [];
    await openSomeday();

    await waitFor(() => expect(screen.getByText('暂时没有搁置的事')).toBeTruthy());
  });
});
