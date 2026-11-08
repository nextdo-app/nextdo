/** Weekly UI decisions are submitted through one atomic DB operation. */
const NOW = '2026-09-23T10:00:00.000Z';

const dataRef = {
  snapshot: {
    inboxCount: 1,
    projects: [
      { id: 'p-1', title: '论文实验', hasOpenAction: true, lastProgressAt: '2026-09-20T01:00:00.000Z' },
      { id: 'p-2', title: '学 Rust', hasOpenAction: false, lastProgressAt: null },
    ],
    waitingFollowUps: ['w-1'],
    somedayCount: 2,
    stalledProjects: ['p-2'],
    calendarNext7: ['cal-1'],
  },
  waiting: [
    {
      id: 'w-1', createdAt: NOW, updatedAt: NOW, deletedAt: null,
      title: '等供应商报价', waitingOn: '供应商', expectedBy: '2026-09-20',
    },
  ],
  somedays: [
    { id: 's-1', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '学吉他' },
    { id: 's-2', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '旅行计划' },
  ],
  calendar: [
    {
      id: 'cal-1', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '评审会',
      startsAt: '2026-09-25T02:00:00.000Z', contextIds: [], estMinutes: 60, value: 4,
      consecutiveSkips: 0, status: 'open',
    },
  ],
  projects: [
    {
      id: 'p-1', createdAt: NOW, updatedAt: NOW, deletedAt: null,
      title: '论文实验', outcome: '跑出 baseline', value: 4, status: 'active',
    },
    {
      id: 'p-2', createdAt: NOW, updatedAt: NOW, deletedAt: null,
      title: '学 Rust', outcome: '写一个小 CLI', value: 2, status: 'active',
    },
  ],
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
    reviewRecordsWatchQuery: jest.fn(() => ({
      compile: () => ({ sql: 'select 1', parameters: [] }),
      execute: async () => [],
    })),
    isReactNativeRuntime: () => false,
    buildWeeklyReviewSnapshot: jest.fn(async () => dataRef.snapshot),
    listWaitingForItems: jest.fn(async () => dataRef.waiting),
    listSomedayMaybeItems: jest.fn(async () => dataRef.somedays),
    listCalendarActions: jest.fn(async () => dataRef.calendar),
    listProjects: jest.fn(async () => dataRef.projects),
    submitReview: jest.fn(async (db: unknown, input: unknown) => input),
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
  const queryResult = {
    data: [],
    isLoading: false,
    isFetching: false,
    error: undefined,
    refresh: async () => undefined,
  };
  return {
    PowerSyncContext: React.createContext(powersync),
    usePowerSync: () => powersync,
    useQuery: () => queryResult,
    useStatus: () => ({ status: 'synced', isSynced: true }),
  };
});

// The root layout mounts the delivery engine (task 09-30) — jest runs as
// Platform 'ios', so the real native adapter drives expo-notifications
// (mocked: idle OS state — nothing pending, permission undetermined).
jest.mock('expo-notifications', () => mockExpoNotifications);

import { mockExpoNotifications } from './mocks/expo-notifications';

import { act, fireEvent, renderRouter, screen, testRouter, waitFor } from 'expo-router/testing-library';
import { listProjects, buildWeeklyReviewSnapshot, submitReview } from '@nextdo/db';

const mockedSubmit = submitReview as jest.Mock;
const mockedProjects = listProjects as jest.Mock;
const mockedSnapshot = buildWeeklyReviewSnapshot as jest.Mock;

/**
 * Render the weekly review the way the app actually reaches it — pushed from
 * the Review tab — so the submit's final `router.back()` has a parent route
 * to pop to. With `initialUrl: '/review/weekly'` alone the GO_BACK action is
 * unhandled; expo-router then THROWS in test mode, which wedges RNTL's
 * fake-timer `waitFor` loop (the test would die on jest's 5s timeout).
 */
async function renderWeekly() {
  const view = renderRouter('app', { initialUrl: '/review' });
  // The root auth gate (prod-deploy R3) renders asynchronously — flush it so
  // /review actually loads before we push /review/weekly onto it (otherwise
  // the submit's router.back() has no parent to pop to). The navigate itself
  // is NOT act-wrapped: expo-router's test router asserts the pathname
  // synchronously, and act() would batch the update past that assertion.
  await act(async () => {});
  testRouter.navigate('/review/weekly');
  await act(async () => {});
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('weekly review — rendering', () => {
  it('renders the snapshot (project table + stall + someday + schedule) and defaults', async () => {
    renderRouter('app', { initialUrl: '/review/weekly' });

    await waitFor(() => expect(screen.getByText('本周回顾')).toBeTruthy());

    // Snapshot cards.
    expect(screen.getByText('收件箱 1 条')).toBeTruthy();
    expect(screen.getByText('Someday 2 条')).toBeTruthy();
    expect(screen.getByText('等供应商报价 — 等供应商')).toBeTruthy();
    expect(screen.getByText('未来 7 天日程')).toBeTruthy();
    // Schedule rows render as one Text: `title（<local date time>）` — match
    // on the title, the formatted time is locale-dependent.
    expect(screen.getByText(/评审会/)).toBeTruthy();

    // Project table: titles, coverage, stall tag (p-2 only), progress.
    expect(screen.getByText('论文实验')).toBeTruthy();
    expect(screen.getByText('学 Rust')).toBeTruthy();
    expect(screen.getByText('有进行中的行动')).toBeTruthy();
    expect(screen.getByText('缺少行动')).toBeTruthy();
    expect(screen.getByText('停滞 ≥ 14 天')).toBeTruthy();
    expect(screen.getAllByText(/最近进展：/)).toHaveLength(2);
    expect(screen.getByText('最近进展：暂无')).toBeTruthy();

    // Status chips default to the current status (both active → 2× 进行中).
    expect(screen.getAllByText('进行中')).toHaveLength(2);

    // Follow-up check-off + the someday keep/trash rows.
    expect(screen.getByText('跟进勾选')).toBeTruthy();
    expect(screen.getByText('已跟进')).toBeTruthy();
    expect(screen.getByText('学吉他')).toBeTruthy();
    expect(screen.getByText('旅行计划')).toBeTruthy();

    // Confirmation switches: inboxCleared derives from inboxCount (1 → 否),
    // calendarReasonable defaults 是.
    expect(screen.getByText('收件箱已清空')).toBeTruthy();
    expect(screen.getByText('日程安排合理')).toBeTruthy();
  });
});

describe('weekly review — submit', () => {
  it('submits project, Someday, follow-up, and confirmation decisions together', async () => {
    const view = await renderWeekly();
    fireEvent.press(screen.getAllByText('已完成')[0]!);
    fireEvent.press(screen.getAllByText('删除')[0]!);
    fireEvent.press(screen.getAllByText('否')[0]!);
    fireEvent.press(screen.getByText('已跟进'));
    fireEvent.press(screen.getByText('提交回顾'));
    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledTimes(1));
    expect(mockedSubmit.mock.calls[0][1].record).toMatchObject({
      kind: 'weekly', snapshot: dataRef.snapshot,
      answers: {
        inboxCleared: true, calendarReasonable: true, followUpsRaised: ['w-1'],
        somedayDecisions: [{ id: 's-1', to: 'trash' }, { id: 's-2', to: 'keep' }],
        projectDecisions: [{ id: 'p-1', to: 'done' }, { id: 'p-2', to: 'active' }],
      },
    });
    await waitFor(() => expect(view.getPathname()).toBe('/review'));
  });

  it('uses live status defaults and drops choices invalidated by a terminal state on refresh', async () => {
    await renderWeekly();
    fireEvent.press(screen.getByLabelText('项目 论文实验 状态：搁置'));
    fireEvent.press(screen.getByLabelText('项目 学 Rust 状态：搁置'));
    mockedProjects.mockResolvedValueOnce(dataRef.projects.map((project) => ({ ...project, status: project.id === 'p-1' ? 'done' : 'active' })));
    fireEvent.press(screen.getByText('刷新回顾数据'));
    await waitFor(() => expect(screen.getByText('已完成（状态不可更改）')).toBeTruthy());
    expect(screen.queryByLabelText('项目 论文实验 状态：进行中')).toBeNull();
    expect(screen.queryByLabelText('项目 论文实验 状态：搁置')).toBeNull();
    expect(screen.getByLabelText('项目 学 Rust 状态：搁置').props.accessibilityState.selected).toBe(true);
    fireEvent.press(screen.getByText('提交回顾'));
    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledTimes(1));
    expect(mockedSubmit.mock.calls[0][1].record.answers.projectDecisions).toEqual([
      { id: 'p-1', to: 'done' }, { id: 'p-2', to: 'on-hold' },
    ]);
  });

  it('uses refreshed untouched defaults and filters resolved waiting choices', async () => {
    await renderWeekly();
    fireEvent.press(screen.getByText('已跟进'));
    mockedProjects.mockResolvedValueOnce(dataRef.projects.map((project) => ({ ...project, status: 'on-hold' })));
    mockedSnapshot.mockResolvedValueOnce({ ...dataRef.snapshot, inboxCount: 0, waitingFollowUps: [] });
    fireEvent.press(screen.getByText('刷新回顾数据'));
    await waitFor(() => expect(screen.queryByText('跟进勾选')).toBeNull());
    fireEvent.press(screen.getByText('提交回顾'));
    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledTimes(1));
    expect(mockedSubmit.mock.calls[0][1].record.answers).toMatchObject({
      inboxCleared: true, followUpsRaised: [],
      projectDecisions: [{ id: 'p-1', to: 'on-hold' }, { id: 'p-2', to: 'on-hold' }],
    });
  });

  it('preserves weekly choices and retries after an atomic submit failure', async () => {
    mockedSubmit.mockRejectedValueOnce(new Error('boom'));
    const view = await renderWeekly();
    fireEvent.press(screen.getAllByText('已完成')[0]!);
    fireEvent.press(screen.getAllByText('删除')[0]!);
    fireEvent.press(screen.getByText('提交回顾'));
    await waitFor(() => expect(screen.getByText(/本次变更均未保存.*boom/)).toBeTruthy());
    expect(view.getPathname()).toBe('/review/weekly');
    fireEvent.press(screen.getByText('提交回顾'));
    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledTimes(2));
    expect(mockedSubmit.mock.calls[1][1].record.id).toBe(mockedSubmit.mock.calls[0][1].record.id);
    expect(mockedSubmit.mock.calls[1][1].record.answers).toEqual(mockedSubmit.mock.calls[0][1].record.answers);
    await waitFor(() => expect(view.getPathname()).toBe('/review'));
  });
});
