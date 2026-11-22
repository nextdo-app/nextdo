/**
 * Component tests — the reference library (issue #90).
 *
 * The screen is the first UI for ReferenceItems written by Clarify: a live
 * list with client-side search, inline title/url/note editing, link opening,
 * and a two-step soft delete. Failed writes must surface Chinese copy and
 * keep the row (and the edit form) in place.
 */

/** The mutable local "database" of live reference items. */
const mockRefsRef: { current: unknown[] } = { current: [] };
const mockRefsListeners = new Set<() => void>();
const mockUpdateCalls: unknown[] = [];
const mockTrashCalls: unknown[] = [];
const mockOpenCalls: string[] = [];
const mockFailures: { update: Error | null; trash: Error | null } = {
  update: null,
  trash: null,
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
  const notify = () => mockRefsListeners.forEach((listener) => listener());
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
    // --- the reference-library surface under test ---
    referenceItemsWatchQuery: compilable,
    updateReferenceItem: async (_db: unknown, item: Record<string, unknown>) => {
      mockUpdateCalls.push(item);
      if (mockFailures.update !== null) throw mockFailures.update;
      mockRefsRef.current = mockRefsRef.current.map((row) =>
        (row as { id: string }).id === item.id ? item : row,
      );
      notify();
      return item;
    },
    trashReferenceItem: async (_db: unknown, args: { id: string }) => {
      mockTrashCalls.push(args);
      if (mockFailures.trash !== null) throw mockFailures.trash;
      mockRefsRef.current = mockRefsRef.current.filter(
        (row) => (row as { id: string }).id !== args.id,
      );
      notify();
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
          mockRefsListeners.add(listener);
          return () => mockRefsListeners.delete(listener);
        },
        () => mockRefsRef.current,
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

jest.mock('@/lib/app-update', () => ({
  // The root layout renders AutoUpdateDialog, which reads currentAppVersion /
  // detectUpdatePlatform from this module. Keep the real implementations and
  // override only the external-link call the screen under test makes.
  ...jest.requireActual('@/lib/app-update'),
  openExternalUrl: async (url: string) => {
    mockOpenCalls.push(url);
  },
}));

jest.mock('expo-notifications', () => mockExpoNotifications);

// The account-settings bridge mounts beside this screen but is unrelated to
// the reference library; keep this suite on its own mocked DB surface.
jest.mock('@/hooks/use-synced-settings', () => ({
  useSyncedSettings: () => undefined,
}));


import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { StorageNextdoError } from '@nextdo/core';
import { mockExpoNotifications } from './mocks/expo-notifications';

function reference(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'r-1',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    deletedAt: null,
    title: '论文模板 LaTeX 配置说明',
    url: 'https://example.com/thesis-template',
    note: '第 5 章最重要',
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
  mockRefsRef.current = [
    reference(),
    reference({
      id: 'r-2',
      title: 'GTD 原文',
      url: 'https://gtd.example/book',
      note: '第 5 章',
    }),
  ];
  mockUpdateCalls.length = 0;
  mockTrashCalls.length = 0;
  mockOpenCalls.length = 0;
  mockFailures.update = null;
  mockFailures.trash = null;
  mockExpoNotifications.getPermissionsAsync.mockResolvedValue({
    status: 'undetermined',
    granted: false,
  } as never);
});

describe('资料库 (issue #90)', () => {
  it('lists each reference with its domain, note and link action', async () => {
    renderRouter('app', { initialUrl: '/references' });
    await flush();

    await waitFor(() => expect(screen.getByText('资料库')).toBeTruthy());
    expect(screen.getByText('论文模板 LaTeX 配置说明')).toBeTruthy();
    expect(screen.getByText('example.com')).toBeTruthy();
    expect(screen.getByText('第 5 章最重要')).toBeTruthy();
    expect(screen.getByText('资料 (2)')).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开链接：论文模板 LaTeX 配置说明' })).toBeTruthy();
  });

  it('searches title, note and URL client-side', async () => {
    renderRouter('app', { initialUrl: '/references' });
    await flush();
    await waitFor(() => expect(screen.getByText('论文模板 LaTeX 配置说明')).toBeTruthy());

    fireEvent.changeText(screen.getByLabelText('搜索资料'), 'gtd.example');
    await flush();
    expect(screen.queryByText('论文模板 LaTeX 配置说明')).toBeNull();
    expect(screen.getByText('GTD 原文')).toBeTruthy();
    expect(screen.getByText('找到 1 条')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('搜索资料'), '不存在的关键词');
    await flush();
    expect(screen.getByText('没有匹配的资料')).toBeTruthy();
  });

  it('edits title, URL and note through updateReferenceItem', async () => {
    renderRouter('app', { initialUrl: '/references' });
    await flush();
    await waitFor(() => expect(screen.getByText('论文模板 LaTeX 配置说明')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: '编辑资料：论文模板 LaTeX 配置说明' }));
    fireEvent.changeText(screen.getByLabelText('资料标题'), '论文模板（新版）');
    fireEvent.changeText(screen.getByLabelText('资料链接'), 'https://example.org/template');
    fireEvent.changeText(screen.getByLabelText('资料备注'), '先读 §4');
    fireEvent.press(screen.getByRole('button', { name: '保存' }));
    await flush();

    expect(mockUpdateCalls).toHaveLength(1);
    expect(mockUpdateCalls[0]).toMatchObject({
      id: 'r-1',
      title: '论文模板（新版）',
      url: 'https://example.org/template',
      note: '先读 §4',
    });
    await waitFor(() => expect(screen.getByText('论文模板（新版）')).toBeTruthy());
    expect(screen.getByText('example.org')).toBeTruthy();
  });

  it('rejects an invalid URL without writing and keeps the form recoverable', async () => {
    renderRouter('app', { initialUrl: '/references' });
    await flush();
    await waitFor(() => expect(screen.getByText('论文模板 LaTeX 配置说明')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: '编辑资料：论文模板 LaTeX 配置说明' }));
    fireEvent.changeText(screen.getByLabelText('资料链接'), 'ftp://example.com/file');
    fireEvent.press(screen.getByRole('button', { name: '保存' }));
    await flush();

    expect(
      screen.getByText('链接格式不正确（需要有效的 http:// 或 https:// 地址）'),
    ).toBeTruthy();
    expect(mockUpdateCalls).toHaveLength(0);
    // Still editing: the save button is available for a corrected value.
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy();
  });

  it('rejects an invalid port without writing', async () => {
    renderRouter('app', { initialUrl: '/references' });
    await flush();
    await waitFor(() => expect(screen.getByText('论文模板 LaTeX 配置说明')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: '编辑资料：论文模板 LaTeX 配置说明' }));
    fireEvent.changeText(
      screen.getByLabelText('资料链接'),
      'https://example.com:invalid-port/path',
    );
    fireEvent.press(screen.getByRole('button', { name: '保存' }));
    await flush();

    expect(
      screen.getByText('链接格式不正确（需要有效的 http:// 或 https:// 地址）'),
    ).toBeTruthy();
    expect(mockUpdateCalls).toHaveLength(0);
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy();
  });

  it('accepts an IDN host and shows its normalized domain', async () => {
    renderRouter('app', { initialUrl: '/references' });
    await flush();
    await waitFor(() => expect(screen.getByText('论文模板 LaTeX 配置说明')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: '编辑资料：论文模板 LaTeX 配置说明' }));
    fireEvent.changeText(screen.getByLabelText('资料链接'), 'https://例子.测试/文档');
    fireEvent.press(screen.getByRole('button', { name: '保存' }));
    await flush();

    expect(mockUpdateCalls).toHaveLength(1);
    expect(mockUpdateCalls[0]).toMatchObject({
      url: 'https://例子.测试/文档',
    });
    // Browsers show punycode; React Native's URL polyfill keeps the Unicode
    // host. Both mean the IDN was accepted.
    await waitFor(() => {
      const domain = screen.queryByText('xn--fsqu00a.xn--0zwm56d') ?? screen.getByText('例子.测试');
      expect(domain).toBeTruthy();
    });
  });

  it('rejects an empty title without writing', async () => {
    renderRouter('app', { initialUrl: '/references' });
    await flush();
    await waitFor(() => expect(screen.getByText('论文模板 LaTeX 配置说明')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: '编辑资料：论文模板 LaTeX 配置说明' }));
    fireEvent.changeText(screen.getByLabelText('资料标题'), '   ');
    fireEvent.press(screen.getByRole('button', { name: '保存' }));
    await flush();

    expect(screen.getByText('请填写资料标题')).toBeTruthy();
    expect(mockUpdateCalls).toHaveLength(0);
  });

  it('opens the stored link through the external-link helper', async () => {
    renderRouter('app', { initialUrl: '/references' });
    await flush();
    await waitFor(() => expect(screen.getByText('论文模板 LaTeX 配置说明')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: '打开链接：论文模板 LaTeX 配置说明' }));
    await flush();
    expect(mockOpenCalls).toEqual(['https://example.com/thesis-template']);
  });

  it('a reference without a URL shows 无链接 and no open button', async () => {
    mockRefsRef.current = [reference({ url: undefined })];
    renderRouter('app', { initialUrl: '/references' });
    await flush();

    await waitFor(() => expect(screen.getByText('无链接')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /^打开链接/ })).toBeNull();
  });

  it('a stored non-HTTP(S) link is explained and never passed to the opener', async () => {
    mockRefsRef.current = [reference({ url: 'file:///tmp/reference.txt' })];
    renderRouter('app', { initialUrl: '/references' });
    await flush();

    await waitFor(() => expect(screen.getByText('链接格式异常')).toBeTruthy());
    expect(
      screen.getByText('链接格式不受支持，无法打开。请编辑为 http:// 或 https:// 地址。'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^打开链接/ })).toBeNull();
    expect(mockOpenCalls).toEqual([]);
  });

  it('deletes in two steps and drops the row from the list', async () => {
    renderRouter('app', { initialUrl: '/references' });
    await flush();
    await waitFor(() => expect(screen.getByText('论文模板 LaTeX 配置说明')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: '删除资料：论文模板 LaTeX 配置说明' }));
    expect(mockTrashCalls).toHaveLength(0);
    fireEvent.press(screen.getByRole('button', { name: '确认删除资料：论文模板 LaTeX 配置说明' }));
    await flush();

    expect(mockTrashCalls).toHaveLength(1);
    expect(mockTrashCalls[0]).toMatchObject({ id: 'r-1' });
    expect(screen.queryByText('论文模板 LaTeX 配置说明')).toBeNull();
    expect(screen.getByText('资料 (1)')).toBeTruthy();
  });

  it('a failed edit surfaces the typed Chinese copy and keeps the form', async () => {
    mockFailures.update = new StorageNextdoError(
      'referenceItem.not-found',
      'No live ReferenceItem with id r-1',
    );
    renderRouter('app', { initialUrl: '/references' });
    await flush();
    await waitFor(() => expect(screen.getByText('论文模板 LaTeX 配置说明')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: '编辑资料：论文模板 LaTeX 配置说明' }));
    fireEvent.changeText(screen.getByLabelText('资料标题'), '改个标题');
    fireEvent.press(screen.getByRole('button', { name: '保存' }));
    await flush();

    await waitFor(() => expect(screen.getByText('这条资料不存在了（可能已被删除）')).toBeTruthy());
    expect(screen.queryByText('No live ReferenceItem with id r-1')).toBeNull();
    // The form stays open so the user can retry after a refresh.
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy();
  });

  it('a failed delete keeps the row and shows the error', async () => {
    mockFailures.trash = new StorageNextdoError(
      'referenceItem.not-found',
      'No live ReferenceItem with id r-1',
    );
    renderRouter('app', { initialUrl: '/references' });
    await flush();
    await waitFor(() => expect(screen.getByText('论文模板 LaTeX 配置说明')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: '删除资料：论文模板 LaTeX 配置说明' }));
    fireEvent.press(screen.getByRole('button', { name: '确认删除资料：论文模板 LaTeX 配置说明' }));
    await flush();

    await waitFor(() => expect(screen.getByText('这条资料不存在了（可能已被删除）')).toBeTruthy());
    expect(screen.getByText('论文模板 LaTeX 配置说明')).toBeTruthy();
    expect(screen.getByText('资料 (2)')).toBeTruthy();
  });

  it('the empty state explains where references come from', async () => {
    mockRefsRef.current = [];
    renderRouter('app', { initialUrl: '/references' });
    await flush();

    await waitFor(() => expect(screen.getByText('资料库是空的')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /^打开链接/ })).toBeNull();
  });
});
