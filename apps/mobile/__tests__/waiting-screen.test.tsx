/**
 * Component tests — the waiting screen (Waiting For 事项管理).
 *
 * Runs for real against a mocked `@nextdo/db` and `@powersync/react` boundary.
 */

/** The mutable local "database" of waiting items. */
const mockWaitingRef: { current: unknown[] } = { current: [] };

/** Tracking calls to addWaitingForItem / updateWaitingForItem / trashWaitingForItem. */
const calls = {
  add: [] as unknown[],
  update: [] as unknown[],
  trash: [] as unknown[],
};

/** Flip to simulate a failed write (the form must keep its values). */
const mockFailures = { update: false };

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
    // --- the waiting surface under test ---
    listWaitingForItems: async () => mockWaitingRef.current,
    addWaitingForItem: async (_db: unknown, item: unknown) => {
      calls.add.push(item);
      mockWaitingRef.current = [item, ...mockWaitingRef.current];
      return item;
    },
    updateWaitingForItem: async (_db: unknown, item: unknown) => {
      if (mockFailures.update) throw new Error('write failed');
      calls.update.push(item);
      const id = (item as { id: string }).id;
      mockWaitingRef.current = mockWaitingRef.current.map((row) =>
        (row as { id: string }).id === id ? item : row,
      );
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

// The real picker is a calendar/time modal; the screen only needs to prove
// that a picked value flows into the stored ISO, so confirm deterministically.
jest.mock('@/components/datetime-picker', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    DateTimePicker: ({
      mode,
      value,
      onConfirm,
    }: {
      mode: 'date' | 'datetime';
      value: string;
      onConfirm: (value: string) => void;
    }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`mock-picker-${mode}`}
        onPress={() => onConfirm(mode === 'date' ? '2026-12-01' : '2026-12-02T09:30')}
      >
        <Text>{`picker-value:${value}`}</Text>
        <Text>mock confirm</Text>
      </Pressable>
    ),
  };
});

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

/** A device-local moment as the stored ISO string. */
function localIso(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): string {
  return new Date(year, month - 1, day, hour, minute, second).toISOString();
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
  calls.update = [];
  calls.trash = [];
  mockFailures.update = false;
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

  it('adds expectedBy and followUpAt picked from the calendar/time modal', async () => {
    await openWaiting();
    await waitFor(() => expect(screen.getByText('等待事项')).toBeTruthy());

    fireEvent.changeText(screen.getByLabelText('等待事项名称'), '等客户签合同');
    fireEvent.changeText(screen.getByLabelText('等待对象'), '客户');
    fireEvent.press(screen.getByLabelText('选择预期日期'));
    fireEvent.press(screen.getByLabelText('mock-picker-date'));
    fireEvent.press(screen.getByLabelText('选择跟进时间'));
    fireEvent.press(screen.getByLabelText('mock-picker-datetime'));
    fireEvent.press(screen.getByRole('button', { name: '添加等待' }));
    await flush();

    expect(calls.add).toHaveLength(1);
    const added = calls.add[0] as { expectedBy: string; followUpAt: string };
    const expected = new Date(added.expectedBy);
    expect([
      expected.getFullYear(),
      expected.getMonth() + 1,
      expected.getDate(),
      expected.getHours(),
      expected.getMinutes(),
    ]).toEqual([2026, 12, 1, 23, 59]);
    const followUp = new Date(added.followUpAt);
    expect([
      followUp.getFullYear(),
      followUp.getMonth() + 1,
      followUp.getDate(),
      followUp.getHours(),
      followUp.getMinutes(),
    ]).toEqual([2026, 12, 2, 9, 30]);
  });

  it('edits a row in place and preserves the dates it did not touch', async () => {
    // Date-only values are stored at end of day (the Clarify convention).
    const expectedBy = localIso(2026, 12, 1, 23, 59, 59);
    const followUpAt = localIso(2026, 12, 2, 9, 30);
    mockWaitingRef.current = [
      waitingItem({ id: 'w-edit', title: '等合同盖章', expectedBy, followUpAt }),
    ];
    await openWaiting();
    await waitFor(() => expect(screen.getByText('等合同盖章')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: '编辑' }));
    await flush();
    // The create form is still mounted above the row editor.
    fireEvent.changeText(screen.getAllByLabelText('等待事项名称')[1]!, '等合同盖章完成');
    fireEvent.press(screen.getByRole('button', { name: '保存修改' }));
    await flush();

    expect(calls.update).toHaveLength(1);
    expect(calls.update[0]).toMatchObject({
      id: 'w-edit',
      title: '等合同盖章完成',
      waitingOn: '导师',
      expectedBy,
      followUpAt,
    });
  });

  it('seeds the follow-up picker with the stored date-only day (issue #94 R1)', async () => {
    // A date-only follow-up is stored at 23:59:59 of that day and prefills as
    // 'YYYY-MM-DD'. Reopening the picker must start on that day, not today.
    mockWaitingRef.current = [
      waitingItem({ id: 'w-seed', title: '等样机', followUpAt: localIso(2026, 12, 3, 23, 59, 59) }),
    ];
    await openWaiting();
    await waitFor(() => expect(screen.getByText('等样机')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: '编辑' }));
    await flush();
    // The create form is still mounted above the row editor — the editor's
    // follow-up trigger is the last one.
    const followUpTriggers = screen.getAllByLabelText('选择跟进时间');
    fireEvent.press(followUpTriggers[followUpTriggers.length - 1]!);
    await flush();

    expect(screen.getByText('picker-value:2026-12-03')).toBeTruthy();
  });

  it('keeps untouched stored dates byte-for-byte when only the title changes (issue #94 R2)', async () => {
    // Values written on another device: re-encoding them from a local date
    // key would shift the instant (and truncate followUpAt to the minute).
    const storedExpectedBy = '2026-12-01T04:00:00.000Z';
    const storedFollowUpAt = '2026-12-02T01:30:45.000Z';
    mockWaitingRef.current = [
      waitingItem({
        id: 'w-tz',
        title: '等签证',
        expectedBy: storedExpectedBy,
        followUpAt: storedFollowUpAt,
      }),
    ];
    await openWaiting();
    await waitFor(() => expect(screen.getByText('等签证')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: '编辑' }));
    await flush();
    fireEvent.changeText(screen.getAllByLabelText('等待事项名称')[1]!, '等签证结果');
    fireEvent.press(screen.getByRole('button', { name: '保存修改' }));
    await flush();

    expect(calls.update).toHaveLength(1);
    expect(calls.update[0]).toMatchObject({
      id: 'w-tz',
      title: '等签证结果',
      expectedBy: storedExpectedBy,
      followUpAt: storedFollowUpAt,
    });
  });

  it('clears a date when the edit form clear action is used', async () => {
    mockWaitingRef.current = [
      waitingItem({ id: 'w-clear', expectedBy: localIso(2026, 12, 1, 23, 59) }),
    ];
    await openWaiting();
    await waitFor(() => expect(screen.getByText('等导师审阅论文')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: '编辑' }));
    await flush();
    fireEvent.press(screen.getByLabelText('清除预期日期'));
    fireEvent.press(screen.getByRole('button', { name: '保存修改' }));
    await flush();

    expect(calls.update).toHaveLength(1);
    expect((calls.update[0] as { expectedBy?: string }).expectedBy).toBeUndefined();
  });

  it('keeps the edited values and shows the error when the write fails', async () => {
    mockWaitingRef.current = [waitingItem({ id: 'w-fail', title: '等回执' })];
    mockFailures.update = true;
    await openWaiting();
    await waitFor(() => expect(screen.getByText('等回执')).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: '编辑' }));
    await flush();
    fireEvent.changeText(screen.getAllByLabelText('等待事项名称')[1]!, '等回执确认');
    fireEvent.press(screen.getByRole('button', { name: '保存修改' }));
    await flush();

    expect(calls.update).toHaveLength(0);
    expect(screen.getAllByLabelText('等待事项名称')[1]!.props.value).toBe('等回执确认');
    expect(screen.getByText('write failed')).toBeTruthy();
  });
});
