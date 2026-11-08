/** Daily UI tests exercise one atomic DB boundary; rollback is covered by real DB tests. */
const NOW = '2026-09-23T10:00:00.000Z';

const dataRef = {
  snapshot: {
    inboxCount: 2,
    completedToday: ['c-1'],
    stillOpen: ['a-1', 'a-2', 'a-3', 'a-4'],
    projectsMissingActions: ['p-1'],
    waitingFollowUps: ['w-1'],
    calendarToday: ['cal-1'],
    calendarTomorrow: ['cal-2'],
    repeatedSkips: ['a-5', 'hd-1', 'cal-3'],
  },
  actions: [
    {
      id: 'a-1', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '写周报',
      projectId: null, contextIds: [], estMinutes: 30, value: 3, deadline: null,
      consecutiveSkips: 0, status: 'open',
    },
    {
      id: 'a-2', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '整理实验数据',
      projectId: null, contextIds: [], estMinutes: 60, value: 3, deadline: null,
      consecutiveSkips: 0, status: 'open',
    },
    {
      id: 'a-3', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '回复邮件',
      projectId: null, contextIds: [], estMinutes: 10, value: 3, deadline: null,
      consecutiveSkips: 0, status: 'open',
    },
    {
      id: 'a-4', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '跑回归测试',
      projectId: null, contextIds: [], estMinutes: 20, value: 3, deadline: null,
      consecutiveSkips: 0, status: 'open',
    },
    {
      id: 'a-5', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '反复跳过的行动',
      projectId: null, contextIds: [], estMinutes: 15, value: 3, deadline: null,
      consecutiveSkips: 3, status: 'open',
    },
  ],
  calendar: [
    {
      id: 'cal-1', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '团队站会',
      startsAt: '2026-09-23T01:30:00.000Z', contextIds: [], estMinutes: 15, value: 3,
      consecutiveSkips: 0, status: 'open',
    },
    {
      id: 'cal-2', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '评审会',
      startsAt: '2026-09-24T02:00:00.000Z', contextIds: [], estMinutes: 60, value: 4,
      consecutiveSkips: 0, status: 'open',
    },
    {
      id: 'cal-3', createdAt: NOW, updatedAt: NOW, deletedAt: null, title: '反复跳过的日程',
      startsAt: '2026-09-25T03:00:00.000Z', contextIds: [], estMinutes: 30, value: 3,
      consecutiveSkips: 3, status: 'open',
    },
  ],
  waiting: [
    {
      id: 'w-1', createdAt: NOW, updatedAt: NOW, deletedAt: null,
      title: '等供应商报价', waitingOn: '供应商', expectedBy: '2026-09-20',
    },
  ],
  habitDays: [
    {
      id: 'hd-1', createdAt: NOW, updatedAt: NOW, deletedAt: null,
      habitId: 'h-1', localDate: '20260923', status: 'open', consecutiveSkips: 3,
    },
  ],
  habits: [
    {
      id: 'h-1', createdAt: NOW, updatedAt: NOW, deletedAt: null,
      title: '晨间拉伸', actionTitle: '做 10 分钟拉伸', estMinutes: 10, value: 2,
      cycleDays: 21, startedAt: '2026-09-01T00:00:00.000Z', status: 'active',
    },
  ],
  projects: [
    {
      id: 'p-1', createdAt: NOW, updatedAt: NOW, deletedAt: null,
      title: '论文实验', outcome: '跑出 baseline', value: 4, status: 'active',
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
    buildDailyReviewSnapshot: jest.fn(async () => dataRef.snapshot),
    listNextActions: jest.fn(async () => dataRef.actions),
    listCalendarActions: jest.fn(async () => dataRef.calendar),
    listWaitingForItems: jest.fn(async () => dataRef.waiting),
    listHabitDays: jest.fn(async () => dataRef.habitDays),
    listHabits: jest.fn(async () => dataRef.habits),
    listProjects: jest.fn(async () => dataRef.projects),
    listReviewCompletions: jest.fn(async () => [
      { id: 'c-1', title: '完成的行动', kind: 'next' },
      { id: 'c-2', title: '完成的会议', kind: 'calendar' },
      { id: 'c-3', title: '完成的晨跑', kind: 'habit' },
      { id: 'c-4', title: '标题不可用（legacy）', kind: 'do_now' },
    ]),
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
import { buildDailyReviewSnapshot, submitReview } from '@nextdo/db';

const mockedSubmit = submitReview as jest.Mock;
const mockedSnapshot = buildDailyReviewSnapshot as jest.Mock;

jest.mock('@/components/datetime-picker', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return { DateTimePicker: ({ onConfirm }: { onConfirm: (date: string) => void }) => (
    <><Pressable onPress={() => onConfirm('2099-09-25')}><Text>选择未来日期</Text></Pressable>
      <Pressable onPress={() => onConfirm('2026-02-30')}><Text>选择无效日期</Text></Pressable></>
  ) };
});

/**
 * Render the daily review the way the app actually reaches it — pushed from
 * the Review tab — so the submit's final `router.back()` has a parent route
 * to pop to. With `initialUrl: '/review/daily'` alone the GO_BACK action is
 * unhandled; expo-router then THROWS in test mode, and the throw wedges
 * RNTL's fake-timer `waitFor` loop (the test dies on jest's 5s timeout even
 * though every assertion would pass).
 */
async function renderDaily() {
  const view = renderRouter('app', { initialUrl: '/review' });
  // The root auth gate (prod-deploy R3) renders asynchronously — flush it so
  // /review actually loads before we push /review/daily onto it (otherwise
  // the submit's router.back() has no parent to pop to). The navigate itself
  // is NOT act-wrapped: expo-router's test router asserts the pathname
  // synchronously, and act() would batch the update past that assertion.
  await act(async () => {});
  testRouter.navigate('/review/daily');
  await act(async () => {});
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('daily review — rendering', () => {
  it('renders the snapshot sections + the decision rows + the repeated skips', async () => {
    renderRouter('app', { initialUrl: '/review/daily' });

    await waitFor(() => expect(screen.getByText('今日回顾')).toBeTruthy());

    // Snapshot (read-only).
    expect(screen.getByText('收件箱 2 条')).toBeTruthy();
    expect(screen.getByText('今日完成 1 项')).toBeTruthy();
    expect(screen.getByText('缺少行动的项目')).toBeTruthy();
    expect(screen.getByText('打开项目：论文实验')).toBeTruthy();
    expect(screen.getByText('完成的行动 · 下一步行动')).toBeTruthy();
    expect(screen.getByText('完成的会议 · 日程')).toBeTruthy();
    expect(screen.getByText('完成的晨跑 · 习惯')).toBeTruthy();
    expect(screen.getByText('标题不可用（legacy） · 即时完成')).toBeTruthy();
    expect(screen.getByText('待跟进（已过期）')).toBeTruthy();
    expect(screen.getByText('等供应商报价 — 等供应商')).toBeTruthy();
    expect(screen.getByText('今日日程')).toBeTruthy();
    // Calendar rows render as one Text: `title（<local date time>）` — match
    // on the title, the formatted time is locale-dependent.
    expect(screen.getByText(/团队站会/)).toBeTruthy();
    expect(screen.getByText('明日日程')).toBeTruthy();
    expect(screen.getByText(/评审会/)).toBeTruthy();

    // Decision rows (stillOpen, in snapshot order).
    expect(screen.getByText('未完成的行动（4）')).toBeTruthy();
    expect(screen.getByText('写周报')).toBeTruthy();
    expect(screen.getByText('整理实验数据')).toBeTruthy();
    expect(screen.getByText('回复邮件')).toBeTruthy();
    expect(screen.getByText('跑回归测试')).toBeTruthy();

    // Repeated skips — all three kinds resolved to titles.
    expect(screen.getByText('反复跳过的行动')).toBeTruthy();
    expect(screen.getByText('晨间拉伸')).toBeTruthy();
    expect(screen.getByText('反复跳过的日程')).toBeTruthy();
    // Reclarify entries only for the non-habit kinds.
    expect(screen.getAllByText('重新明晰')).toHaveLength(2);
  });
});

describe('daily review — submit', () => {
  it('submits one atomic request with all choices and local 08:00 dates', async () => {
    const view = await renderDaily();
    await waitFor(() => expect(screen.getByText('未完成的行动（4）')).toBeTruthy());
    fireEvent.press(screen.getAllByText('已完成')[0]!);
    fireEvent.press(screen.getAllByText('安排到明日')[1]!);
    fireEvent.press(screen.getAllByText('选择排期日期')[2]!);
    fireEvent.press(screen.getByText('选择未来日期'));
    expect(screen.getByText('排期到 2099-09-25 08:00')).toBeTruthy();
    fireEvent.press(screen.getAllByText('暂不处理')[3]!);
    fireEvent.press(screen.getByText('提交回顾'));
    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledTimes(1));
    expect(mockedSubmit.mock.calls[0][1].record).toMatchObject({
      kind: 'daily', snapshot: dataRef.snapshot,
      answers: {
        completedActionIds: ['a-1'], tomorrowMustDo: ['a-2'], skippedNoted: ['a-4'],
        rescheduled: [{ actionId: 'a-3', toDate: new Date(2099, 8, 25, 8).toISOString() }],
      },
    });
    await waitFor(() => expect(view.getPathname()).toBe('/review'));
  });

  it('rejects an impossible picked date without adding a decision', async () => {
    await renderDaily();
    fireEvent.press(screen.getAllByText('选择排期日期')[0]!);
    fireEvent.press(screen.getByText('选择无效日期'));
    expect(screen.getByText('请选择尚未到达的日期（当地 08:00）')).toBeTruthy();
    fireEvent.press(screen.getByText('提交回顾'));
    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledTimes(1));
    expect(mockedSubmit.mock.calls[0][1].record.answers.rescheduled).toEqual([]);
  });

  it('preserves choices and attempt identity on failure, then retries successfully', async () => {
    mockedSubmit.mockRejectedValueOnce(new Error('boom'));
    const view = await renderDaily();
    fireEvent.press(screen.getAllByText('已完成')[0]!);
    fireEvent.press(screen.getByText('提交回顾'));
    await waitFor(() => expect(screen.getByText(/本次变更均未保存.*boom/)).toBeTruthy());
    expect(view.getPathname()).toBe('/review/daily');
    expect(screen.getByText('已选：完成行动')).toBeTruthy();
    fireEvent.press(screen.getByText('提交回顾'));
    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledTimes(2));
    const first = mockedSubmit.mock.calls[0][1].record;
    const second = mockedSubmit.mock.calls[1][1].record;
    expect(second.id).toBe(first.id);
    expect(second.answers).toEqual(first.answers);
    await waitFor(() => expect(view.getPathname()).toBe('/review'));
  });

  it('refreshes snapshot without clearing a valid explicit choice', async () => {
    await renderDaily();
    fireEvent.press(screen.getAllByText('已完成')[0]!);
    mockedSnapshot.mockResolvedValueOnce({ ...dataRef.snapshot, projectsMissingActions: [] });
    fireEvent.press(screen.getByText('刷新回顾数据'));
    await waitFor(() => expect(screen.queryByText('缺少行动的项目')).toBeNull());
    expect(screen.getByText('已选：完成行动')).toBeTruthy();
    fireEvent.press(screen.getByText('提交回顾'));
    await waitFor(() => expect(mockedSubmit).toHaveBeenCalledTimes(1));
    expect(mockedSubmit.mock.calls[0][1].record.answers.completedActionIds).toEqual(['a-1']);
  });

  it('shows load errors and permits a successful retry', async () => {
    mockedSnapshot.mockRejectedValue(new Error('read failed'));
    await renderDaily();
    await waitFor(() => expect(screen.getByText(/加载回顾数据失败/)).toBeTruthy());
    mockedSnapshot.mockImplementation(async () => dataRef.snapshot);
    fireEvent.press(screen.getByText('重试加载'));
    await waitFor(() => expect(screen.getByText('未完成的行动（4）')).toBeTruthy());
  });
});


it('guards a second submit while the first transaction is still pending', async () => {
  let finish: () => void = () => undefined;
  mockedSubmit.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  await renderDaily();
  const submitButton = screen.getByText('提交回顾');
  fireEvent.press(submitButton);
  fireEvent.press(submitButton);
  expect(mockedSubmit).toHaveBeenCalledTimes(1);
  await act(async () => finish());
});
