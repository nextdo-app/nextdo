/**
 * Component tests — the focus history & statistics screen (issue #96):
 * summary totals, heatmap/trend accessibility cells, the completed/abandoned
 * list, and the empty/loading/error states.
 */
import type { FocusHistoryRow } from '@nextdo/db';

const mockNow = new Date(2026, 8, 21, 10, 0, 0, 0); // local Monday 2026-09-21

function localIso(monthIndex: number, day: number, hour: number, minute: number): string {
  return new Date(2026, monthIndex, day, hour, minute, 0, 0).toISOString();
}

const defaultRows: FocusHistoryRow[] = [
  {
    id: 'f-1',
    actionKind: 'next',
    actionId: 'a-1',
    title: '写周报',
    startedAt: localIso(8, 21, 10, 0),
    endedAt: localIso(8, 21, 10, 25),
    status: 'completed',
    mode: 'preset',
    plannedMinutes: 25,
    pausedSec: 0,
  },
  {
    id: 'f-2',
    actionKind: 'calendar',
    actionId: 'a-2',
    title: null,
    startedAt: localIso(8, 20, 9, 0),
    endedAt: localIso(8, 20, 9, 20),
    status: 'abandoned',
    mode: 'free',
    plannedMinutes: null,
    pausedSec: 0,
  },
];

const mockHistoryState: {
  rows: FocusHistoryRow[];
  error: Error | null;
  loading: boolean;
} = { rows: defaultRows, error: null, loading: false };
/** Counts mounted watches — a retry must create a new one (the real SDK's
 *  watch result has no `refresh`; see use-focus-history.ts). */
const mockWatch = { starts: 0 };

jest.mock('@/hooks/use-app-clock', () => ({
  useAppClock: () => mockNow,
}));

jest.mock('@nextdo/db', () => {
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    disconnect: async () => undefined,
    close: async () => undefined,
  };
  const compilable = () => ({
    compile: () => ({ sql: 'SELECT 1', parameters: [] }),
    execute: async () => [],
  });
  return {
    createPowerSyncDatabase: () => powersync,
    getOwnerToken: async () => null,
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
    listScheduledReminders: async () => [],
    seedDefaultContexts: async () => 0,
    isReactNativeRuntime: () => false,
    focusHistoryWatchQuery: compilable,
    reviewRecordsWatchQuery: compilable,
  };
});

jest.mock('@powersync/react', () => {
  const React = jest.requireActual('react');
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    close: async () => undefined,
    onChange: () => () => undefined,
  };
  return {
    PowerSyncContext: React.createContext(powersync),
    usePowerSync: () => powersync,
    useQuery: () => {
      // One snapshot per mounted watch: a retry remounts the screen, which
      // creates a fresh watch and reads the CURRENT mock state. The real
      // `useQuery` in watch mode returns no `refresh` — neither does this.
      const [snapshot] = React.useState(() => {
        mockWatch.starts += 1;
        return { ...mockHistoryState };
      });
      return {
        data: snapshot.rows,
        isLoading: snapshot.loading,
        isFetching: false,
        error: snapshot.error,
      };
    },
    useStatus: () => ({ status: 'synced', isSynced: true }),
  };
});

jest.mock('expo-notifications', () => mockExpoNotifications);

import { mockExpoNotifications } from './mocks/expo-notifications';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

beforeEach(() => {
  jest.clearAllMocks();
  mockWatch.starts = 0;
  mockHistoryState.rows = defaultRows;
  mockHistoryState.error = null;
  mockHistoryState.loading = false;
});

describe('Focus history screen', () => {
  it('renders totals, heatmap/trend cells and both terminal statuses', async () => {
    renderRouter('app', { initialUrl: '/focus-history' });

    await waitFor(() => expect(screen.getByText('专注历史')).toBeTruthy());
    expect(screen.getByLabelText('今日专注 25 分钟')).toBeTruthy();
    // Sunday 9/20 belongs to the previous Monday-start week.
    expect(screen.getByLabelText('本周专注 25 分钟')).toBeTruthy();
    expect(screen.getByLabelText('总计专注 45 分钟')).toBeTruthy();
    expect(screen.getByText('完成 1 · 放弃 1')).toBeTruthy();

    // The heatmap cell and the day-trend bar carry the same accessible label.
    expect(screen.getAllByLabelText('9月21日 专注 25 分钟')).toHaveLength(2);
    expect(screen.getAllByLabelText('9月20日 专注 20 分钟')).toHaveLength(2);

    expect(screen.getByText('写周报')).toBeTruthy();
    expect(screen.getByText('行动已删除')).toBeTruthy();
    expect(screen.getByText('完成')).toBeTruthy();
    expect(screen.getByText('放弃')).toBeTruthy();
    expect(screen.getByText('9月21日 10:00–10:25 · 25 分钟')).toBeTruthy();
    expect(screen.getByText('9月20日 09:00–09:20 · 20 分钟')).toBeTruthy();
  });

  it('switches the trend between days and Monday-start weeks', async () => {
    renderRouter('app', { initialUrl: '/focus-history' });
    await waitFor(() => expect(screen.getByText('近 7 天')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: '按周查看趋势' }));
    expect(screen.getByText('近 8 周')).toBeTruthy();
    expect(screen.getByText('每周从周一开始；把每次专注算在开始的那周。')).toBeTruthy();
    // The previous Monday-start week aggregates the Sunday session.
    expect(screen.getByLabelText('9月14日 专注 20 分钟')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: '按日查看趋势' }));
    expect(screen.getByText('按设备本地日期，把每次专注算在开始的那天。')).toBeTruthy();
  });

  it('shows the empty state when there are no terminal sessions', async () => {
    mockHistoryState.rows = [];
    renderRouter('app', { initialUrl: '/focus-history' });
    await waitFor(() => expect(screen.getByText('还没有专注记录')).toBeTruthy());
    expect(
      screen.getByText('在行动上开始一次专注，完成或放弃后都会记录在这里。'),
    ).toBeTruthy();
  });

  it('shows the loading state while the watch resolves', async () => {
    mockHistoryState.loading = true;
    renderRouter('app', { initialUrl: '/focus-history' });
    await waitFor(() => expect(screen.getByText('加载中…')).toBeTruthy());
  });

  it('shows the read error; retrying creates a new watch and clears it', async () => {
    mockHistoryState.rows = [];
    mockHistoryState.error = new Error('读取专注记录失败');
    renderRouter('app', { initialUrl: '/focus-history' });
    await waitFor(() => expect(screen.getByText('读取专注记录失败')).toBeTruthy());
    expect(mockWatch.starts).toBe(1);

    // The next read succeeds. The retry must actually re-subscribe (a new
    // mounted watch), not just clear a local error flag.
    mockHistoryState.rows = defaultRows;
    mockHistoryState.error = null;

    fireEvent.press(screen.getByRole('button', { name: '重试加载' }));
    await waitFor(() => expect(screen.getByText('写周报')).toBeTruthy());
    expect(screen.queryByText('读取专注记录失败')).toBeNull();
    expect(mockWatch.starts).toBe(2);
  });
});
