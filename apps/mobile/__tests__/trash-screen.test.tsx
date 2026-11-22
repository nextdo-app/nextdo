/**
 * Component tests — the recycle bin (issue #89).
 *
 * The screen lists every soft-deleted row with its kind/detail/delete time,
 * and its per-row 恢复 runs the restore with that row's own kind + id. A
 * failed restore must surface the error and leave the row in place.
 */

/** The mutable local "database" of trashed rows. */
const mockTrashRef: { current: unknown[] } = { current: [] };
const mockTrashListeners = new Set<() => void>();

/** Tracking calls to restoreTrashedItem, with a failure switch. */
const restoreCalls: { args: unknown[]; failure: Error | null } = { args: [], failure: null };

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
    // --- the trash surface under test ---
    trashedItemsWatchQuery: compilable,
    restoreTrashedItem: async (_db: unknown, args: { kind: string; id: string }) => {
      restoreCalls.args.push(args);
      if (restoreCalls.failure !== null) throw restoreCalls.failure;
      mockTrashRef.current = mockTrashRef.current.filter(
        (row) => (row as { kind: string; id: string }).id !== args.id,
      );
      mockTrashListeners.forEach((listener) => listener());
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
    useQuery: () => {
      const data = React.useSyncExternalStore(
        (listener: () => void) => {
          mockTrashListeners.add(listener);
          return () => mockTrashListeners.delete(listener);
        },
        () => mockTrashRef.current,
      );
      return {
        data,
        isLoading: false,
        isFetching: false,
        error: undefined,
        refresh: async () => undefined,
      };
    },
    useStatus: () => ({ status: 'synced', isSynced: true }),
  };
});

jest.mock('expo-notifications', () => mockExpoNotifications);

// The account-settings bridge mounts beside the screen under test; keep this
// suite on its own mocked DB surface.
jest.mock('@/hooks/use-synced-settings', () => ({
  useSyncedSettings: () => undefined,
}));


import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { StorageNextdoError } from '@nextdo/core';
import { mockExpoNotifications } from './mocks/expo-notifications';

function trashed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'next-action',
    id: 'a-1',
    title: '买打印机墨盒',
    detail: '毕业论文实验',
    deletedAt: '2026-10-13T09:00:00.000Z',
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
  mockTrashRef.current = [
    trashed(),
    trashed({
      kind: 'waiting',
      id: 'w-1',
      title: '等导师确认开题材料',
      detail: '导师',
      deletedAt: '2026-10-12T09:00:00.000Z',
    }),
  ];
  restoreCalls.args = [];
  restoreCalls.failure = null;
  mockExpoNotifications.getPermissionsAsync.mockResolvedValue({
    status: 'undetermined',
    granted: false,
  } as never);
});

describe('回收站 (issue #89)', () => {
  it('lists each trashed row with its kind, detail and delete time', async () => {
    renderRouter('app', { initialUrl: '/trash' });
    await flush();

    await waitFor(() => expect(screen.getByText('回收站')).toBeTruthy());
    expect(screen.getByText('买打印机墨盒')).toBeTruthy();
    expect(screen.getByText('下一步行动')).toBeTruthy();
    expect(screen.getByText('毕业论文实验')).toBeTruthy();
    expect(screen.getByText('等导师确认开题材料')).toBeTruthy();
    expect(screen.getByText('等待事项')).toBeTruthy();
    expect(screen.getByText('已删除 (2)')).toBeTruthy();
    expect(screen.getAllByText(/删除于 /).length).toBe(2);
  });

  it('恢复 runs the restore for THAT row (kind + id) and drops it from the list', async () => {
    renderRouter('app', { initialUrl: '/trash' });
    await flush();
    await waitFor(() => expect(screen.getByText('买打印机墨盒')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: '恢复下一步行动：买打印机墨盒' }));
    await flush();

    expect(restoreCalls.args).toHaveLength(1);
    expect(restoreCalls.args[0]).toMatchObject({ kind: 'next-action', id: 'a-1' });
    expect(restoreCalls.args[0]).toHaveProperty('now');
    expect(screen.queryByText('买打印机墨盒')).toBeNull();
    expect(screen.getByText('已删除 (1)')).toBeTruthy();
  });

  it('a failed restore surfaces the typed Chinese copy and keeps the row', async () => {
    restoreCalls.failure = new StorageNextdoError(
      'trash.parent-project-deleted',
      'Project is still deleted',
    );
    renderRouter('app', { initialUrl: '/trash' });
    await flush();
    await waitFor(() => expect(screen.getByText('买打印机墨盒')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: '恢复下一步行动：买打印机墨盒' }));
    await flush();

    await waitFor(() =>
      expect(screen.getByText('所属项目已删除或不存在，请先恢复项目后再试')).toBeTruthy(),
    );
    // The raw English message must not leak, and the row is still there.
    expect(screen.queryByText('Project is still deleted')).toBeNull();
    expect(screen.getByText('买打印机墨盒')).toBeTruthy();
    expect(screen.getByText('已删除 (2)')).toBeTruthy();
  });

  it('an already-restored row maps trash.not-found to Chinese copy and keeps the list', async () => {
    restoreCalls.failure = new StorageNextdoError(
      'trash.not-found',
      'No trashed next-action row with id a-1',
    );
    renderRouter('app', { initialUrl: '/trash' });
    await flush();
    await waitFor(() => expect(screen.getByText('买打印机墨盒')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: '恢复下一步行动：买打印机墨盒' }));
    await flush();

    await waitFor(() =>
      expect(screen.getByText('这条记录已不在回收站（可能已被恢复）')).toBeTruthy(),
    );
    expect(screen.queryByText(/No trashed next-action row/)).toBeNull();
    expect(screen.getByText('买打印机墨盒')).toBeTruthy();
  });

  it('the empty state explains where deleted rows come from', async () => {
    mockTrashRef.current = [];
    renderRouter('app', { initialUrl: '/trash' });
    await flush();

    await waitFor(() => expect(screen.getByText('回收站是空的')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /^恢复/ })).toBeNull();
  });

  it('the list stays live while trashed rows change', async () => {
    renderRouter('app', { initialUrl: '/trash' });
    await flush();

    act(() => {
      mockTrashRef.current = [trashed({ id: 'a-2', title: '取快递' })];
      mockTrashListeners.forEach((listener) => listener());
    });

    expect(screen.queryByText('买打印机墨盒')).toBeNull();
    expect(screen.getByText('取快递')).toBeTruthy();
    expect(screen.getByText('已删除 (1)')).toBeTruthy();
  });
});
