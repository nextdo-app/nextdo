/**
 * Component tests — the habits screen (task 10-02 — 习惯创建表单与
 * 21 天挑战启动).
 *
 * The screen runs for real against a mocked `@nextdo/db` boundary:
 *  - `startHabit` / `trashHabit` are jest.fn spies, so the assertions
 *    pin the ARGUMENTS the screen hands the db layer (the fixed
 *    `cycleDays: 21` / `status: 'active'`, the actionTitle inheritance,
 *    the optional window) rather than a re-implementation of the
 *    transaction;
 *  - `habitCycleDay` is the REAL implementation (requireActual), so the
 *    「第 N/21 天」 readout is not asserted against a second copy of the
 *    cycle rule (design.md §2).
 *
 * Mounted the way the app reaches it — `/(tabs)/settings` first, then
 * `testRouter.navigate('/habits')` — so `back()` has a parent to land
 * on (testing-guidelines: an unhandled GO_BACK wedges the fake-timer
 * waitFor loop).
 */

/** The mutable local "database" the mocked reads return. */
const mockHabitsRef: { current: unknown[] } = { current: [] };
const mockDaysRef: { current: unknown[] } = { current: [] };

/** The habit row handed to `startHabit` by the last submit. */
const mockStartArgsRef: { current: unknown } = { current: null };

jest.mock('@nextdo/db', () => {
  const compilable = () => ({
    compile: () => ({ sql: 'SELECT 1', parameters: [] }),
    execute: async () => [],
  });
  // The REAL cycle-day rule — re-implementing it in the mock would make
  // these tests assert a second copy of the rule instead of the exported
  // one the screen actually calls.
  const actual = jest.requireActual('@nextdo/db') as {
    habitCycleDay: (startedAt: string, cycleDays: number, localDate: string) => number | null;
  };
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    disconnect: async () => undefined,
    close: async () => undefined,
  };
  return {
    ...actual,
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
    // The delivery hook's source query (the root layout mounts
    // useReminderDelivery in every renderRouter test).
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
    listProjects: async () => [],
    listContexts: async () => [],
    addContext: async () => undefined,
    // --- the habits surface under test ---
    listHabits: async () => mockHabitsRef.current,
    listHabitDays: async () => mockDaysRef.current,
    startHabit: async (db: unknown, habit: { id: string; startedAt: string }, now: unknown) => {
      mockStartArgsRef.current = { db, habit, now };
      mockHabitsRef.current = [...mockHabitsRef.current, habit];
      // Mirror the real transaction: a challenge booked to start ahead has
      // no day for today yet, and that null is not a failure.
      const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
      const dayKeyOf = (d: Date): string =>
        `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
      const startsToday = dayKeyOf(new Date(habit.startedAt)) === dayKeyOf(now as Date);
      return {
        habit,
        today: startsToday ? { id: 'hd-seeded', habitId: habit.id, localDate: '20260101' } : null,
      };
    },
    trashHabit: async (_db: unknown, args: { id: string }) => {
      mockHabitsRef.current = mockHabitsRef.current.filter(
        (row) => (row as { id: string }).id !== args.id,
      );
    },
    updateHabit: async (_db: unknown, habit: { id: string }) => {
      mockHabitsRef.current = mockHabitsRef.current.map((row) =>
        (row as { id: string }).id === habit.id ? { ...(row as Record<string, unknown>), ...habit } : row,
      );
      return habit;
    },
  };
});

jest.mock('@powersync/react', () => {
  const React = jest.requireActual('react');
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    close: async () => undefined,
    // The delivery hook subscribes to local changes — a no-op here.
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

jest.mock('expo-notifications', () => mockExpoNotifications);

import { act, fireEvent, renderRouter, screen, testRouter, waitFor } from 'expo-router/testing-library';
import { mockExpoNotifications } from './mocks/expo-notifications';
import { habitDayId, localDateKey, toIso } from '@nextdo/core';
import { localDateKey as pickerDateKey } from '../lib/review-dates';

/** A live Habit row as `listHabits` returns it (started today → day 1). */
function habit(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const startedAt = toIso(new Date());
  return {
    id: 'h-1',
    createdAt: startedAt,
    updatedAt: startedAt,
    deletedAt: null,
    title: '阅读',
    actionTitle: '阅读 30 min',
    estMinutes: 30,
    value: 4,
    windowStart: '19:00',
    windowEnd: '23:00',
    cycleDays: 21,
    startedAt,
    status: 'active',
    ...overrides,
  };
}

/** Today's done HabitDay for `habitId` (counts toward 本期已完成). */
function doneToday(habitId: string) {
  const localDate = localDateKey(new Date());
  return {
    id: habitDayId(habitId, localDate),
    createdAt: toIso(new Date()),
    updatedAt: toIso(new Date()),
    deletedAt: null,
    habitId,
    localDate,
    status: 'done',
    consecutiveSkips: 0,
  };
}

/** Mount the screen the way the app reaches it (parent route first). */
async function openHabits(): Promise<void> {
  renderRouter('app', { initialUrl: '/(tabs)/settings' });
  await flush();
  testRouter.navigate('/habits');
  await flush();
}

/** Flush several microtask rounds (the read/insert chains are promise-hop
 *  deep and the router navigation settles across several of them). */
async function flush(rounds = 10): Promise<void> {
  let p: Promise<unknown> = Promise.resolve();
  for (let i = 0; i < rounds; i++) {
    p = p.then(() => act(async () => {}));
  }
  await p;
}

/** The submit button's disabled state (Button mirrors it into a11y state). */
function submitDisabled(): boolean {
  return screen.getByRole('button', { name: '开始 21 天挑战' }).props.accessibilityState?.disabled === true;
}

async function fillRequiredFields(): Promise<void> {
  fireEvent.changeText(screen.getByLabelText('习惯名'), '阅读');
  fireEvent.changeText(screen.getByLabelText('预计分钟'), '30');
  await flush();
}

/**
 * Open one window half's picker, choose `hhmm`, confirm.
 *
 * The half is a read-only field (issue #13), so there is nothing to
 * `changeText` — the value arrives through the picker modal.
 */
async function pickWindowHalf(label: string, hhmm: string): Promise<void> {
  fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${label}`) }));
  await flush();
  const [hour, minute] = hhmm.split(':');
  fireEvent.press(screen.getByLabelText(`小时 ${hour}`));
  fireEvent.press(screen.getByLabelText(`分钟 ${minute}`));
  fireEvent.press(screen.getByRole('button', { name: '确定' }));
  await flush();
}

/** Turn the window switch on and pick both halves. */
async function fillWindow(start: string, end: string): Promise<void> {
  fireEvent.press(screen.getByRole('button', { name: '开启时间窗口' }));
  await flush();
  await pickWindowHalf('时间窗口开始', start);
  await pickWindowHalf('时间窗口结束', end);
}

/** Open the start-date picker and confirm a `YYYY-MM-DD` pick. */
async function pickStartDate(dateKey: string): Promise<void> {
  fireEvent.press(screen.getByRole('button', { name: /^起始日期/ }));
  await flush();
  const [year, month, day] = dateKey.split('-');
  fireEvent.press(screen.getByLabelText(`年 ${year}`));
  fireEvent.press(screen.getByLabelText(`月 ${Number(month)}`));
  fireEvent.press(screen.getByLabelText(`日 ${Number(day)}`));
  fireEvent.press(screen.getByRole('button', { name: '确定' }));
  await flush();
}

/** `YYYY-MM-DD` for a day relative to today. */
function dayKey(offset: number): string {
  const day = new Date();
  day.setDate(day.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

beforeEach(() => {
  mockHabitsRef.current = [];
  mockDaysRef.current = [];
  mockStartArgsRef.current = null;
  mockExpoNotifications.getPermissionsAsync.mockResolvedValue({
    status: 'undetermined',
    granted: false,
    canAskAgain: true,
    expires: 'never',
  });
});

describe('habits screen', () => {
  it('starts a 21-day challenge: cycleDays 21, status active, and the action title inherits the habit name', async () => {
    await openHabits();

    await fillRequiredFields();
    fireEvent.press(screen.getByRole('button', { name: '价值 4' }));
    await fillWindow('19:00', '23:00');
    await flush();

    expect(submitDisabled()).toBe(false);
    fireEvent.press(screen.getByRole('button', { name: '开始 21 天挑战' }));
    await flush();

    const args = mockStartArgsRef.current as { habit: Record<string, unknown> } | null;
    expect(args).not.toBeNull();
    const created = args!.habit;
    expect(created['title']).toBe('阅读');
    // An empty 每日行动 inherits the habit name (the generated day's title).
    expect(created['actionTitle']).toBe('阅读');
    expect(created['estMinutes']).toBe(30);
    expect(created['value']).toBe(4);
    expect(created['cycleDays']).toBe(21);
    expect(created['status']).toBe('active');
    expect(created['windowStart']).toBe('19:00');
    expect(created['windowEnd']).toBe('23:00');
    // The weekday mask is out of scope — never written.
    expect(created['windowDays']).toBeUndefined();
  });

  it('keeps the value default at 3 and an explicit 每日行动 when the user types one', async () => {
    await openHabits();

    await fillRequiredFields();
    fireEvent.changeText(screen.getByLabelText('每日行动标题（选填）'), '读 30 分钟');
    await flush();
    fireEvent.press(screen.getByRole('button', { name: '开始 21 天挑战' }));
    await flush();

    const args = mockStartArgsRef.current as { habit: Record<string, unknown> } | null;
    expect(args!.habit['actionTitle']).toBe('读 30 分钟');
    expect(args!.habit['value']).toBe(3);
  });

  it('writes NO window when the switch is off (an all-day habit)', async () => {
    await openHabits();

    await fillRequiredFields();
    fireEvent.press(screen.getByRole('button', { name: '开始 21 天挑战' }));
    await flush();

    const args = mockStartArgsRef.current as { habit: Record<string, unknown> } | null;
    expect(args!.habit['windowStart']).toBeUndefined();
    expect(args!.habit['windowEnd']).toBeUndefined();
  });

  it('defaults the start date to today and writes it as local midnight', async () => {
    await openHabits();

    await fillRequiredFields();
    expect(screen.getByText('今天 · 挑战第 1 天')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: '开始 21 天挑战' }));
    await flush();

    const args = mockStartArgsRef.current as { habit: Record<string, unknown> } | null;
    const startedAt = new Date(String(args!.habit['startedAt']));
    expect(startedAt.getHours()).toBe(0);
    expect(startedAt.getMinutes()).toBe(0);
    expect(pickerDateKey(startedAt)).toBe(dayKey(0));
  });

  it('a future start date is written verbatim, not as the creation instant', async () => {
    await openHabits();

    await fillRequiredFields();
    await pickStartDate(dayKey(3));
    // Booked ahead: the challenge has no cycle day yet, so the readout is a
    // countdown rather than 「挑战第 N 天」.
    expect(screen.getByText(/3 天后开始/)).toBeTruthy();
    expect(submitDisabled()).toBe(false);

    fireEvent.press(screen.getByRole('button', { name: '开始 21 天挑战' }));
    await flush();

    const args = mockStartArgsRef.current as { habit: Record<string, unknown> } | null;
    const startedAt = new Date(String(args!.habit['startedAt']));
    expect(pickerDateKey(startedAt)).toBe(dayKey(3));
    expect(startedAt.getHours()).toBe(0);
    // Creating a habit that is not live yet is a SUCCESS, not an error: the
    // form resets and the row lands in the list carrying the countdown.
    expect(screen.getByText('阅读')).toBeTruthy();
    expect(screen.getByText('3 天后开始')).toBeTruthy();
    expect(screen.queryByText(/今天的挑战日没有生成/)).toBeNull();
  });

  it('a past start date keeps the submit disabled and explains why', async () => {
    await openHabits();

    await fillRequiredFields();
    await pickStartDate(dayKey(-1));
    expect(submitDisabled()).toBe(true);
    expect(screen.getByText(/起始日期不能早于今天/)).toBeTruthy();
    expect(mockStartArgsRef.current).toBeNull();
  });

  it('there is no backfill window — a long-past start date is rejected the same way', async () => {
    await openHabits();

    await fillRequiredFields();
    await pickStartDate(dayKey(-21));
    expect(submitDisabled()).toBe(true);
    expect(screen.getByText(/起始日期不能早于今天/)).toBeTruthy();
    expect(mockStartArgsRef.current).toBeNull();
  });

  it('a half-filled window keeps the submit disabled', async () => {
    await openHabits();

    await fillRequiredFields();
    // Only the start half picked — a window must have BOTH ends.
    fireEvent.press(screen.getByRole('button', { name: '开启时间窗口' }));
    await flush();
    await pickWindowHalf('时间窗口开始', '19:00');
    expect(submitDisabled()).toBe(true);
    expect(mockStartArgsRef.current).toBeNull();

    // Completing the pair enables it.
    await pickWindowHalf('时间窗口结束', '23:00');
    expect(submitDisabled()).toBe(false);
  });

  it('start >= end keeps the submit disabled', async () => {
    await openHabits();

    await fillRequiredFields();
    await fillWindow('23:00', '19:00');
    expect(submitDisabled()).toBe(true);
    expect(mockStartArgsRef.current).toBeNull();

    // start === end is equally invalid (the window is half-open).
    await pickWindowHalf('时间窗口开始', '20:00');
    await pickWindowHalf('时间窗口结束', '20:00');
    expect(submitDisabled()).toBe(true);
  });

  it('the window halves are read-only fields, never typed inputs', async () => {
    await openHabits();

    await fillRequiredFields();
    fireEvent.press(screen.getByRole('button', { name: '开启时间窗口' }));
    await flush();

    // A malformed HH:mm used to be typeable; the picker makes it unreachable.
    expect(screen.queryByLabelText('时间窗口开始')).toBeNull();
    expect(screen.getByRole('button', { name: /^时间窗口开始/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^时间窗口结束/ })).toBeTruthy();
  });

  it('a non-positive or fractional 预计分钟 keeps the submit disabled', async () => {
    await openHabits();

    fireEvent.changeText(screen.getByLabelText('习惯名'), '阅读');
    fireEvent.changeText(screen.getByLabelText('预计分钟'), '0');
    await flush();
    expect(submitDisabled()).toBe(true);

    fireEvent.changeText(screen.getByLabelText('预计分钟'), '1.5');
    await flush();
    expect(submitDisabled()).toBe(true);

    fireEvent.changeText(screen.getByLabelText('预计分钟'), '30');
    await flush();
    expect(submitDisabled()).toBe(false);
  });

  it('shows the challenge day, the window and the done count; deleting removes the row', async () => {
    mockHabitsRef.current = [habit()];
    mockDaysRef.current = [doneToday('h-1')];
    await openHabits();

    // 第 1/21 天 — the habit started today, so the cycle day is 1.
    await waitFor(() => expect(screen.getByText('第 1/21 天')).toBeTruthy());
    expect(screen.getByText('每日行动：阅读 30 min')).toBeTruthy();
    expect(screen.getByText('19:00–23:00')).toBeTruthy();
    expect(screen.getByText('30 分钟')).toBeTruthy();
    expect(screen.getByText('价值 4')).toBeTruthy();
    expect(screen.getByText('本期已完成 1 天')).toBeTruthy();

    // 删除 → the row disappears (soft delete + reload).
    fireEvent.press(screen.getAllByRole('button', { name: '删除' })[0]!);
    await flush();
    await waitFor(() => expect(screen.queryByText('阅读')).toBeNull());
    expect(mockHabitsRef.current).toHaveLength(0);
  });

  it('an all-day habit (no window) reads 全天 instead of a time range', async () => {
    mockHabitsRef.current = [
      habit({
        id: 'h-2',
        title: '喝水',
        actionTitle: '喝水',
        windowStart: undefined,
        windowEnd: undefined,
      }),
    ];
    await openHabits();

    await waitFor(() => expect(screen.getByText('喝水')).toBeTruthy());
    expect(screen.getByText('全天')).toBeTruthy();
    // No HH:mm pair is rendered for this row (the window tag is 全天).
    expect(screen.queryByText(/^\d{2}:\d{2}–\d{2}:\d{2}$/)).toBeNull();
  });

  it('settings page has no habit entry, and Now tab entry reaches habits screen with zero-habit empty state', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/settings' });
    await flush();

    // The Settings tab no longer hosts the habits card
    expect(screen.queryByRole('button', { name: '管理习惯' })).toBeNull();

    // Navigate to /habits and verify the zero-habit empty state
    testRouter.navigate('/habits');
    await flush();

    await waitFor(() => expect(screen.getByText('还没有习惯')).toBeTruthy());
    // The cycle copy states the challenge semantics AND explicitly denies
    // the promise (the domain model forbids 「21 天保证养成习惯」).
    expect(screen.getByText(/21 天是一个挑战周期/)).toBeTruthy();
    expect(screen.getByText(/不是「一定能养成」的保证/)).toBeTruthy();
    // The form is visible even with no habits (one tap to create the first).
    expect(screen.getByLabelText('习惯名')).toBeTruthy();
  });

  it('edits an existing habit and updates its fields', async () => {
    mockHabitsRef.current = [habit({ id: 'h-edit', title: '旧习惯', actionTitle: '旧行动', estMinutes: 20 })];
    await openHabits();

    await waitFor(() => expect(screen.getByText('旧习惯')).toBeTruthy());

    // Tap 编辑
    fireEvent.press(screen.getByRole('button', { name: '编辑' }));
    await flush();

    // The inline form shows prefilled values
    expect(screen.getByText('编辑习惯')).toBeTruthy();
    expect(screen.getByLabelText('编辑习惯名').props.value).toBe('旧习惯');

    // Modify title and estMinutes
    fireEvent.changeText(screen.getByLabelText('编辑习惯名'), '深度阅读');
    fireEvent.changeText(screen.getByLabelText('编辑预计分钟'), '45');
    await flush();

    // Tap 保存
    fireEvent.press(screen.getByRole('button', { name: '保存' }));
    await flush();

    // Verify row displays updated title and estMinutes
    await waitFor(() => expect(screen.getByText('深度阅读')).toBeTruthy());
    expect(screen.getByText('45 分钟')).toBeTruthy();
  });
});