/**
 * Component tests — the Review tab (PRD R7, design.md §4.5): the two entry
 * cards (今日回顾 / 本周回顾) + the append-only history (kind tag + date +
 * one-line digest). The daily/weekly flows themselves are covered by
 * review-daily.test.tsx / review-weekly.test.tsx.
 */
const NOW = '2026-09-23T10:00:00.000Z';

const recordsRef = {
  records: [
    {
      id: 'r-1', createdAt: NOW, updatedAt: NOW, deletedAt: null,
      at: '2026-09-22T15:00:00.000Z',
      kind: 'daily',
      snapshot: {
        inboxCount: 0,
        completedToday: ['c-1'],
        stillOpen: [],
        projectsMissingActions: [],
        waitingFollowUps: [],
        calendarToday: [],
        calendarTomorrow: [],
        repeatedSkips: [],
      },
      answers: { completedActionIds: ['c-1'], rescheduled: [], skippedNoted: [], tomorrowMustDo: [] },
    },
    {
      id: 'r-2', createdAt: NOW, updatedAt: NOW, deletedAt: null,
      at: '2026-09-20T15:00:00.000Z',
      kind: 'weekly',
      snapshot: {
        inboxCount: 0,
        projects: [],
        waitingFollowUps: [],
        somedayCount: 0,
        stalledProjects: [],
        calendarNext7: [],
      },
      answers: {
        inboxCleared: true,
        followUpsRaised: [],
        calendarReasonable: true,
        somedayDecisions: [],
        projectDecisions: [],
      },
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
    isReactNativeRuntime: () => false,
    getReviewDetails: jest.fn(async (_db: unknown, id: string) => {
      const record = recordsRef.records.find((entry) => entry.id === id);
      return record === undefined ? null : { record, currentTitles: { 'c-1': '当前行动名' } };
    }),
    reviewRecordsWatchQuery: () => ({
      compile: () => ({ sql: 'SELECT 1', parameters: [] }),
      execute: async () => [],
    }),
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
    useQuery: () => ({
      data: recordsRef.records,
      isLoading: false,
      isFetching: false,
      error: undefined,
      refresh: async () => undefined,
    }),
    useStatus: () => ({ status: 'synced', isSynced: true }),
  };
});

// The root layout mounts the delivery engine (task 09-30) — jest runs as
// Platform 'ios', so the real native adapter drives expo-notifications
// (mocked: idle OS state — nothing pending, permission undetermined).
jest.mock('expo-notifications', () => mockExpoNotifications);

import { mockExpoNotifications } from './mocks/expo-notifications';

import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { getReviewDetails } from '@nextdo/db';
const mockedDetails = getReviewDetails as jest.Mock;

beforeEach(() => { jest.clearAllMocks(); });

describe('Review tab', () => {
  it('shows the two entry cards and the history trail (kind + date + digest)', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/review' });

    await waitFor(() => expect(screen.getByText('今日回顾')).toBeTruthy());
    expect(screen.getByText('本周回顾')).toBeTruthy();
    expect(screen.getByText('历史记录')).toBeTruthy();

    // Both records: kind tags + digests.
    expect(screen.getByText('日常')).toBeTruthy();
    expect(screen.getByText('每周')).toBeTruthy();
    expect(screen.getByText('完成 1 · 排期 0 · 安排明日 0 · 暂不处理 0')).toBeTruthy();
    expect(screen.getByText('项目 0 · 待跟进 0 · Someday 0')).toBeTruthy();
  });
});


describe('Review details', () => {
  it('opens a history card and labels old current-title fallbacks honestly', async () => {
    const view = renderRouter('app', { initialUrl: '/review' });
    await waitFor(() => expect(screen.getByText('历史记录')).toBeTruthy());
    fireEvent.press(screen.getByRole('button', { name: /查看日常回顾/ }));
    await waitFor(() => expect(view.getPathname()).toBe('/review/r-1'));
    await waitFor(() => expect(screen.getByText('本次标记完成')).toBeTruthy());
    expect(screen.getAllByText('当前行动名（当前标题）')).toHaveLength(2);
    expect(screen.getByText('回顾时未完成')).toBeTruthy();
    expect(screen.getByText('本次排期')).toBeTruthy();
  });

  it('prefers captured titles and displays recorded dates and missing references', async () => {
    const old = recordsRef.records[0]!;
    mockedDetails.mockResolvedValueOnce({
      record: { ...old, snapshot: { ...old.snapshot, titles: { 'c-1': '保存的原名' } }, answers: {
        completedActionIds: ['c-1'], rescheduled: [{ actionId: 'missing', toDate: '2026-09-25T08:00:00.000Z' }],
        skippedNoted: ['missing'], tomorrowMustDo: ['c-1'],
      } }, currentTitles: { 'c-1': '改名后的标题' },
    });
    renderRouter('app', { initialUrl: '/review/r-1' });
    await waitFor(() => expect(screen.getByText('本次排期')).toBeTruthy());
    expect(screen.getAllByText('保存的原名')).toHaveLength(2);
    expect(screen.queryByText(/改名后的标题/)).toBeNull();
    expect(screen.getByText('标题不可用（missing）')).toBeTruthy();
    expect(screen.getByText(/标题不可用（missing） →/)).toBeTruthy();
    expect(screen.getByText('安排到次日（按当前时区重算）')).toBeTruthy();
  });

  it('renders all legacy weekly checklist sections', async () => {
    renderRouter('app', { initialUrl: '/review/r-2' });
    await waitFor(() => expect(screen.getByText('项目状态决定')).toBeTruthy());
    expect(screen.getByText('Someday 决定')).toBeTruthy();
    expect(screen.getByText('本次跟进（仅记录）')).toBeTruthy();
    expect(screen.getByText('收件箱已清空：是')).toBeTruthy();
    expect(screen.getByText('日程安排合理：是')).toBeTruthy();
  });

  it('distinguishes loading from missing and offers a back path', async () => {
    let resolve: (value: null) => void = () => undefined;
    mockedDetails.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    renderRouter('app', { initialUrl: '/review/missing' });
    await waitFor(() => expect(screen.getByText('加载中…')).toBeTruthy());
    expect(screen.queryByText('找不到这条回顾记录。')).toBeNull();
    await act(async () => resolve(null));
    expect(screen.getByText('找不到这条回顾记录。')).toBeTruthy();
    expect(screen.getByText('← 回顾')).toBeTruthy();
  });

  it('shows a failed detail read and can retry', async () => {
    mockedDetails.mockRejectedValueOnce(new Error('read failed'));
    renderRouter('app', { initialUrl: '/review/r-2' });
    await waitFor(() => expect(screen.getByText('加载回顾详情失败：read failed')).toBeTruthy());
    fireEvent.press(screen.getByText('重试加载'));
    await waitFor(() => expect(screen.getByText('项目状态决定')).toBeTruthy());
  });
});
