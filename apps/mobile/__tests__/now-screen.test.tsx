/**
 * Component tests — the Now tab (PRD D2 hero-first, design §5): the
 * engine-wired execution screen. The engine pool is mocked at the
 * packages/db boundary with real pool shapes; the REAL core `recommend()`
 * runs, so these tests pin the screen's rendering of each pool shape: a
 * recommendation, the empty pool, the all-filtered explainable empty
 * state, and the needsReclarify banner (consecutiveSkips ≥ 3).
 *
 * Rework assertions (design §5): the STATS ROW (可执行 n/总 · 预计耗时
 * Σ est · 认知负荷 三档), the CONTEXT FILTER chips (local UI state —
 * list area only, never the hero recommendation), and the always-expanded
 * eligible list (project chip + read-only context chips + due label).
 */
const poolRef: { current: unknown } = { current: null };
const ctxRef: { current: unknown[] } = { current: [] };
const projectsRef: { current: unknown[] } = { current: [] };
// Today's habit days (task 10-02 — the strip's data; mutable so the empty
// state and the populated strip are both reachable).
const habitDaysRef: { current: unknown[] } = { current: [] };
const habitListRef: { current: unknown[] } = { current: [] };
// Counts `completeAction` calls and lets a test flip it to a FAILURE, so
// the block's post-write re-read can be pinned both ways (re-read on
// success, NO re-read on failure).
const completeCalls: { count: number; shouldFail: boolean; args: unknown[] } = {
  count: 0,
  shouldFail: false,
  args: [],
};
const updateCalls: { count: number; actions: unknown[] } = {
  count: 0,
  actions: [],
};
// Counts the habit READS (`useHabits` re-reads on mount, on focus and on
// `reload()`). The success-path test can assert the rendered counters
// changed, but the FAILURE path renders identically whether or not a
// re-read happens — the source rows did not move — so "the screen looks
// the same" proves nothing. Counting the reads is the only way to observe
// that no re-read was fired (hook-guidelines Rule 8: delete the mechanism
// under test and this test must go red).
const habitReads = { habits: 0, days: 0 };

/**
 * Read counter for the scene list. Needed because the ONLY way to prove the
 * focus re-read fires is to count reads — under `renderRouter` the tab
 * REMOUNTS on a stack navigation, so the mount-time read picks the new rows
 * up and a "the chip disappeared" assertion passes even with `reload()`
 * deleted (verified by mutation). hook-guidelines Rule 8.
 */
const contextReads = { count: 0 };

jest.mock('@nextdo/db', () => {
  const compilable = () => ({
    compile: () => ({ sql: 'SELECT 1', parameters: [] }),
    execute: async () => [],
  });
  // The REAL cycle-day rule: these tests navigate to /habits, which mounts
  // HabitsScreen → useHabits → habitCycleDay. Re-implementing it in the mock
  // would assert a second copy of the rule (same reasoning as
  // habits-screen.test.tsx). testing-guidelines: the factory must provide
  // every @nextdo/db export the mounted tree touches.
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
    habitCycleDay: actual.habitCycleDay,
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
    queryEnginePool: async () => poolRef.current,
    poolTriggerWatchQuery: compilable,
    skipAction: async () => undefined,
    completeAction: async (_db: unknown, args: unknown) => {
      completeCalls.count += 1;
      completeCalls.args.push(args);
      if (completeCalls.shouldFail) throw new Error('complete rejected');
    },
    updateNextAction: async (_db: unknown, action: unknown) => {
      updateCalls.count += 1;
      updateCalls.actions.push(action);
      return action;
    },
    snoozeAction: async () => undefined,
    trashAction: async () => undefined,
    listProjects: async () => projectsRef.current,
    listContexts: async () => {
      contextReads.count += 1;
      return ctxRef.current;
    },
    addContext: async () => undefined,
    listHabits: async () => {
      habitReads.habits += 1;
      return habitListRef.current;
    },
    listHabitDays: async () => {
      habitReads.days += 1;
      return habitDaysRef.current;
    },
    // HabitsScreen mounts on the /habits route these tests navigate to.
    startHabit: async () => ({ habit: null, today: null }),
    trashHabit: async () => undefined,
    // ContextsScreen mounts on the /contexts route (the scene bar's
    // 「管理场景」 entry) — the mock must provide every export the tree
    // touches or the screen renders nothing (testing-guidelines).
    trashContext: async () => undefined,
    getRecentUploadRejections: async () => [],
    subscribeToUploadRejections: () => () => undefined,
    clearUploadRejections: async () => undefined,
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

import { act, fireEvent, renderRouter, screen, testRouter, waitFor } from 'expo-router/testing-library';
import { mockExpoNotifications } from './mocks/expo-notifications';
import type { NextCandidate } from '@nextdo/core';
import { localDateKey } from '@nextdo/core';
import { __setEngineContextStoreForTests } from '@/lib/engine-context';

/** A minimal eligible next-action candidate (the pool contract shape). */
function nextAction(overrides: Partial<NextCandidate> = {}): NextCandidate {
  return {
    id: `n-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'next',
    title: '写季度总结',
    contextIds: [],
    estMinutes: 25,
    value: 3,
    consecutiveSkips: 0,
    dependencyDone: true,
    createdAt: '2026-09-20T01:00:00.000Z',
    ...overrides,
  };
}

function setPool(actions: NextCandidate[]) {
  poolRef.current = { actions, calendar: [], projects: [] };
}

function context(id: string, name: string) {
  return { id, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', deletedAt: null, name };
}

/** A live `active` Habit row as `listHabits` returns it. */
function habitFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'h-1',
    createdAt: '2026-09-20T01:00:00.000Z',
    updatedAt: '2026-09-20T01:00:00.000Z',
    deletedAt: null,
    title: '阅读',
    actionTitle: '阅读 30 min',
    estMinutes: 30,
    value: 4,
    cycleDays: 21,
    startedAt: '2026-09-20T01:00:00.000Z',
    status: 'active',
    ...overrides,
  };
}

/** A HabitDay row as `listHabitDays` returns it (today, `h-1` by default). */
function habitDayFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'hd-1',
    createdAt: '2026-09-20T01:00:00.000Z',
    updatedAt: '2026-09-20T01:00:00.000Z',
    deletedAt: null,
    habitId: 'h-1',
    localDate: localDateKey(new Date()),
    status: 'open',
    consecutiveSkips: 0,
    ...overrides,
  };
}

/** Flush the microtask rounds a read + a router navigation settle across. */
async function flushRenders(rounds = 10): Promise<void> {
  let p: Promise<unknown> = Promise.resolve();
  for (let i = 0; i < rounds; i++) {
    p = p.then(() => {
      act(() => {});
    });
  }
  await p;
}

/**
 * Preset the persisted engine context (the scene bar's store). The engine
 * contract excludes a context-TAGGED action when the engine context
 * doesn't contain one of its ids (spec: context-mismatch), so tests with
 * tagged actions must select the matching scenes here — independent of the
 * screen's list-filter chips under test.
 */
function presetEngineContext(contextIds: string[], availableMinutes = 60) {
  __setEngineContextStoreForTests({
    getItem: async () => JSON.stringify({ contextIds, availableMinutes }),
    setItem: async () => undefined,
  });
}

beforeEach(() => {
  setPool([]);
  ctxRef.current = [];
  projectsRef.current = [];
  habitDaysRef.current = [];
  habitListRef.current = [];
  completeCalls.count = 0;
  completeCalls.shouldFail = false;
  completeCalls.args = [];
  updateCalls.count = 0;
  updateCalls.actions = [];
  habitReads.habits = 0;
  habitReads.days = 0;
  contextReads.count = 0;
  // Fresh in-memory engine-context store per test (module-level backend).
  __setEngineContextStoreForTests(null);
});

describe('Now screen', () => {
  it('shows the recommendation card, reasons, the stats row and the always-open list', async () => {
    // The deadline-near, high-value action wins over the plain one.
    setPool([
      nextAction({
        id: 'winner',
        title: '交周报',
        value: 5,
        estMinutes: 30,
        contextIds: [],
        // A deadline late TODAY (23:59 local): `+1h` crossed midnight after
        // 23:00 and flipped the due label to 明天 — the test went red every
        // evening. 23:59-today is always 今天 and always h ≤ 24 (urgency
        // 0.9 → the 截止时间快到了 reason), at any run time.
        deadline: (() => {
          const d = new Date();
          d.setHours(23, 59, 0, 0);
          return d.toISOString();
        })(),
      }),
      nextAction({ id: 'loser', title: '整理桌面', value: 1, estMinutes: 25 }),
    ]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    // The title renders twice — the hero AND the always-open list row.
    await waitFor(() => expect(screen.getAllByText('交周报')).toHaveLength(2));
    // The recommendation's subtitle + reasons render (Chinese labels).
    expect(screen.getByText('为什么是它？')).toBeTruthy();
    expect(screen.getByText(/截止时间快到了/)).toBeTruthy();
    // The three main buttons.
    expect(screen.getByText('开始')).toBeTruthy();
    expect(screen.getByText('换一个')).toBeTruthy();
    // …and the deadline chip on both the hero and its list row, which core
    // words by urgency rather than by calendar date (issue #16).
    expect(screen.getAllByText('今天截止')).toHaveLength(2);
    // Stats row: 2 eligible of 2 total · 30+25 = 55 分钟 · <60 → 轻.
    expect(screen.getByText('2/2 项')).toBeTruthy();
    expect(screen.getByText('55 分钟')).toBeTruthy();
    expect(screen.getByText('轻')).toBeTruthy();
    // The list is ALWAYS expanded: the second title is visible, and each
    // row carries its own 稍后 (hero button + 2 rows = 3).
    expect(screen.getByText('整理桌面')).toBeTruthy();
    expect(screen.getAllByText('稍后')).toHaveLength(3);
    // The context bar (scenes + time chips).
    expect(screen.getByText('当前场景')).toBeTruthy();
    expect(screen.getByText('任意')).toBeTruthy();
  });

  it('allows collapsing and expanding the eligible items list to reduce visual distraction', async () => {
    setPool([
      nextAction({ id: 'a', title: '主行动', value: 5, estMinutes: 20 }),
      nextAction({ id: 'b', title: '次要行动', value: 3, estMinutes: 20 }),
    ]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    await waitFor(() => expect(screen.getAllByText('主行动')).toHaveLength(2));
    expect(screen.getByText('次要行动')).toBeTruthy();
    expect(screen.getByText('收起清单')).toBeTruthy();

    // Click to collapse
    fireEvent.press(screen.getByText('收起清单'));
    await waitFor(() => expect(screen.getByText('展开清单')).toBeTruthy());
    expect(screen.getByText(/已折叠 2 项备选事项/)).toBeTruthy();
    // In collapsed mode, the list row for 次要行动 is hidden; hero stays intact.
    expect(screen.queryByText('次要行动')).toBeNull();
    expect(screen.getAllByText('主行动')).toHaveLength(1);

    // Click to expand again
    fireEvent.press(screen.getByText('展开清单'));
    await waitFor(() => expect(screen.getByText('收起清单')).toBeTruthy());
    expect(screen.getByText('次要行动')).toBeTruthy();
    expect(screen.getAllByText('主行动')).toHaveLength(2);
  });

  it('the stats row counts eligible vs filtered and bands the cognitive load', async () => {
    // 300 min > the default 60-minute slot → 'too-long' (filtered).
    setPool([
      nextAction({ id: 'a', title: '任务甲', estMinutes: 40 }),
      nextAction({ id: 'b', title: '任务乙', estMinutes: 40 }),
      nextAction({ id: 'long', title: '超长任务', estMinutes: 300 }),
    ]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    await waitFor(() => expect(screen.getByText('2/3 项')).toBeTruthy());
    // 40+40 = 80 分钟 → 平 (60–180 inclusive).
    expect(screen.getByText('80 分钟')).toBeTruthy();
    expect(screen.getByText('平')).toBeTruthy();
    // The filtered action is not in the list.
    expect(screen.queryByText('超长任务')).toBeNull();
  });

  it('heavy eligible pools are labeled 重', async () => {
    // Four 50-minute actions fit the default 60-minute slot; 200 > 180.
    setPool([
      nextAction({ id: 'a', title: '甲任务', estMinutes: 50 }),
      nextAction({ id: 'b', title: '乙任务', estMinutes: 50 }),
      nextAction({ id: 'c', title: '丙任务', estMinutes: 50 }),
      nextAction({ id: 'd', title: '丁任务', estMinutes: 50 }),
    ]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    await waitFor(() => expect(screen.getByText('4/4 项')).toBeTruthy());
    // 200 分钟 → >180 → 重.
    expect(screen.getByText('200 分钟')).toBeTruthy();
    expect(screen.getByText('重')).toBeTruthy();
  });

  it('context chips filter the list only — the hero recommendation stays put', async () => {
    // Engine context selects BOTH scenes → every tagged action is eligible
    // (the engine's context-mismatch rule); the list filter starts empty.
    presetEngineContext(['c-1', 'c-2']);
    ctxRef.current = [context('c-1', '电脑'), context('c-2', '手机')];
    setPool([
      nextAction({ id: 'desk', title: '电脑上的事', value: 5, contextIds: ['c-1'] }),
      nextAction({ id: 'phone', title: '手机上的事', value: 1, contextIds: ['c-2'] }),
      nextAction({ id: 'any', title: '随地可做', value: 1, contextIds: [] }),
    ]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    await waitFor(() => expect(screen.getByText('全部')).toBeTruthy());
    // Filter chips are name-only (counts removed 2026-09-24) and repeat the
    // engine bar's context names; each visible list row adds its read-only
    // context chip. DOM order: bar chip, filter chip, row chip.
    expect(screen.getAllByText('电脑')).toHaveLength(3);
    expect(screen.getAllByText('手机')).toHaveLength(3);

    // Select 手机 (filter chip) → the 电脑-only action leaves the LIST,
    // while the phone and the context-less actions stay (context-less
    // actions survive every filter)…
    fireEvent.press(screen.getAllByText('手机')[1]!);
    await waitFor(() => expect(screen.getByText('手机上的事')).toBeTruthy());
    expect(screen.getByText('随地可做')).toBeTruthy();
    // …and the HERO still shows the 电脑 action (exactly one occurrence —
    // the hero, not the list).
    expect(screen.getAllByText('电脑上的事')).toHaveLength(1);

    // 全部 resets the filter → all three rows back (the 电脑 action is in
    // the hero AND its row again).
    fireEvent.press(screen.getByText('全部'));
    await waitFor(() => expect(screen.getAllByText('电脑上的事')).toHaveLength(2));
    expect(screen.getByText('手机上的事')).toBeTruthy();
    expect(screen.getByText('随地可做')).toBeTruthy();
  });

  it('a context that matches nothing shows the filtered empty state (hero untouched)', async () => {
    presetEngineContext(['c-1', 'c-2', 'c-9']);
    ctxRef.current = [context('c-1', '电脑'), context('c-9', '沟通')];
    setPool([
      nextAction({ id: 'desk', title: '电脑上的事', value: 5, contextIds: ['c-1'] }),
      // c-2 has no context entity: no filter chip for it, and its action
      // matches no name-based filter selection.
      nextAction({ id: 'orphan', title: '手机上的事', contextIds: ['c-2'] }),
    ]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    await waitFor(() => expect(screen.getByText('全部')).toBeTruthy());
    // Filter chips are name-only: 沟通 appears twice (bar + filter — no
    // 沟通-tagged row), 电脑 thrice (bar + filter + the desk row's chip).
    expect(screen.getAllByText('沟通')).toHaveLength(2);
    expect(screen.getAllByText('电脑')).toHaveLength(3);

    fireEvent.press(screen.getAllByText('沟通')[1]!);
    await waitFor(() => expect(screen.getByText('没有匹配当前情境的可执行事项')).toBeTruthy());
    // The hero (电脑上的事) is untouched.
    expect(screen.getByText('电脑上的事')).toBeTruthy();
  });

  it('list rows show the project chip, read-only context chips and the due label', async () => {
    presetEngineContext(['c-1']);
    ctxRef.current = [context('c-1', '电脑')];
    projectsRef.current = [{ id: 'p-9', title: '周报项目' }];
    setPool([
      nextAction({
        id: 'due',
        title: '快截止的事',
        value: 5,
        contextIds: ['c-1'],
        projectId: 'p-9',
        deadline: new Date(Date.now() + 24 * 3600_000).toISOString(),
      }),
      nextAction({ id: 'free', title: '不着急的事', contextIds: [] }),
    ]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    // The title renders twice — the hero AND its list row.
    await waitFor(() => expect(screen.getAllByText('快截止的事')).toHaveLength(2));
    // Project chip (the hero subtitle is a joined string, not this exact text).
    expect(screen.getByText('周报项目')).toBeTruthy();
    // Read-only context chip — in the engine bar, the filter chips AND the row.
    expect(screen.getAllByText('电脑')).toHaveLength(3);
    // Due chips: tomorrow's deadline → 明天截止 (inside the 48h 「临近」
    // window); the deadline-less row → 随时.
    expect(screen.getByText('明天截止')).toBeTruthy();
    expect(screen.getByText('随时')).toBeTruthy();
  });

  it('each list row carries 完成 (the swipe gesture\'s button twin) plus the swipe hint', async () => {
    setPool([nextAction({ id: 'a-1', title: '整理桌面', value: 2, contextIds: [] })]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });
    await waitFor(() => expect(screen.getAllByText('整理桌面')).toHaveLength(2));

    // The swipe reveals this hint from under the row (issue #17); it is
    // rendered up front, hidden behind the card, so the gesture is not a
    // secret.
    expect(screen.getByText('✓ 完成')).toBeTruthy();

    // …and the same action is reachable by tap, so the gesture is an
    // accelerator rather than the only path (the row's 完成 is the only
    // button with that label on this screen).
    fireEvent.press(screen.getByText('完成'));
    await waitFor(() => expect(completeCalls.count).toBe(1));
    expect(completeCalls.args[0]).toMatchObject({ actionKind: 'next', actionId: 'a-1' });
  });

  it('the empty pool shows the capture hint', async () => {    setPool([]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });
    await waitFor(() => expect(screen.getByText('执行池是空的')).toBeTruthy());
    expect(screen.getByText(/去收件箱捕获一条/)).toBeTruthy();
  });

  it('an all-filtered pool explains why (rule labels, Chinese)', async () => {
    // 300 min > the default 60-minute slot → 'too-long'.
    setPool([nextAction({ id: 'long', estMinutes: 300 })]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    await waitFor(() =>
      expect(screen.getByText('没有任何适合当前场景与时间的行动')).toBeTruthy(),
    );
    expect(screen.getByText('被过滤的事项：')).toBeTruthy();
    expect(screen.getByText('• 写季度总结 — 预估时长超过可用时间')).toBeTruthy();
  });

  it('the re-clarify banner appears at 3 consecutive skips with the count', async () => {
    setPool([nextAction({ id: 'skippy', consecutiveSkips: 3 })]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    await waitFor(() =>
      expect(screen.getByText('这个任务已连续跳过 3 次 — 重新明确下一步？')).toBeTruthy(),
    );
    expect(screen.getByText('重新明晰')).toBeTruthy();
  });

  it('no banner below the threshold (2 skips)', async () => {
    setPool([nextAction({ id: 'once', consecutiveSkips: 2 })]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    await waitFor(() => expect(screen.getAllByText('写季度总结')).toHaveLength(2));
    expect(screen.queryByText(/连续跳过/)).toBeNull();
  });

  it('no re-clarify banner for habit days (habits are not re-clarifiable — db contract)', async () => {
    poolRef.current = {
      actions: [
        {
          id: 'hd-1',
          kind: 'habit',
          title: '晨间拉伸',
          habitId: 'h-1',
          cycleDay: 3,
          cycleDays: 21,
          contextIds: [],
          estMinutes: 10,
          value: 2,
          consecutiveSkips: 3,
          dependencyDone: true,
          createdAt: '2026-09-20T01:00:00.000Z',
        },
      ],
      calendar: [],
      projects: [],
    };
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    await waitFor(() => expect(screen.getAllByText('晨间拉伸')).toHaveLength(2));
    expect(screen.queryByText(/连续跳过/)).toBeNull();
    expect(screen.queryByText('重新明晰')).toBeNull();
  });

  it('changing the available-time chip recomputes the recommendation (AC3)', async () => {
    setPool([
      nextAction({ id: 'long', title: '长任务', value: 5, estMinutes: 25 }),
      nextAction({ id: 'short', title: '短任务', value: 1, estMinutes: 10 }),
    ]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    // Default 60-minute slot: both stay eligible (the list is always open
    // — each title renders in the hero and its row).
    await waitFor(() => expect(screen.getAllByText('长任务')).toHaveLength(2));
    expect(screen.getByText('短任务')).toBeTruthy();
    expect(screen.getByText('2/2 项')).toBeTruthy();

    // A 15-minute slot must drop the 25-min action (too-long) — from the
    // hero AND the list; the pool recomputes from the same settings.
    // The engine bar's minutes option is addressed by its a11y label
    // (the row's underline is the single-select state, not a chip).
    fireEvent.press(screen.getByRole('button', { name: '设置可用时间：15 分钟' }));
    await waitFor(() => {
      expect(screen.getAllByText('短任务')).toHaveLength(2);
      expect(screen.queryByText('长任务')).toBeNull();
    });
    expect(screen.getByText('1/2 项')).toBeTruthy();
  });

  it('"换一个" rotates through the eligible list and wraps (AC3)', async () => {
    setPool([
      nextAction({ id: 'top', title: '头任务', value: 5, estMinutes: 25 }),
      nextAction({ id: 'second', title: '次任务', value: 1, estMinutes: 10 }),
    ]);
    renderRouter('app', { initialUrl: '/(tabs)/now' });

    // The top-scored action is the hero (its est tag is unique — the list
    // rows show no est, the stats row shows the Σ).
    await waitFor(() => expect(screen.getByText('25 分钟')).toBeTruthy());

    // "换一个" persists the skip (mocked no-op) and the hero rotates.
    fireEvent.press(screen.getByRole('button', { name: '换一个' }));
    await waitFor(() => expect(screen.getByText('10 分钟')).toBeTruthy());
    expect(screen.queryByText('25 分钟')).toBeNull();

    // Skipping again wraps back to the top (carousel semantics).
    fireEvent.press(screen.getByRole('button', { name: '换一个' }));
    await waitFor(() => expect(screen.getByText('25 分钟')).toBeTruthy());
  });

  // ── Engine-context bar (the redone 条件栏) ────────────────────────────
  // Regression guard for the rejected design: the selector used to reuse
  // `ContextChip`, whose djb2 name hash gave `office` a warm earth-3 fill
  // that read as "selected" while it was not. Selection must be the ONLY
  // thing that changes a scene option's appearance.
  describe('engine-context bar', () => {
    it('an unselected scene looks identical whatever its name, and only selection lights up', async () => {
      ctxRef.current = [
        context('c-1', 'office'), // the hash that used to fake a selection
        context('c-2', 'computer'),
        context('c-3', '厨房'), // a user-created name, longer label
      ];
      setPool([nextAction({ id: 'a', title: '任务甲', contextIds: ['c-1'] })]);
      renderRouter('app', { initialUrl: '/(tabs)/now' });

      // Nothing selected yet → the bar reports 任意 and NO scene is lit.
      // (Wait on a SCENE, not on 任意 — 任意 renders before the context
      // query resolves, so it is not a readiness signal.)
      await waitFor(() =>
        expect(screen.getByRole('button', { name: '选择场景：office' })).toBeTruthy(),
      );
      expect(screen.getByText('任意')).toBeTruthy();
      for (const name of ['office', 'computer', '厨房']) {
        expect(screen.getByRole('button', { name: `选择场景：${name}` })).toBeTruthy();
        expect(screen.queryByRole('button', { name: `取消场景：${name}` })).toBeNull();
      }
      expect(screen.queryByText(/已选 \d+ 个/)).toBeNull();

      // The real guard: an UNSELECTED option's rendered style is byte-identical
      // across names. The rejected design gave `office` a warmer earth-3
      // fill purely from `contextTone('office')`, so it read as "selected"
      // while it was not. Every unselected scene — seed or user-created —
      // must share one class string.
      const unselectedClasses = ['office', 'computer', '厨房'].map(
        (name) => screen.getByRole('button', { name: `选择场景：${name}` }).props.className,
      );
      expect(new Set(unselectedClasses).size).toBe(1);

      // …and selection is the one thing that changes it.
      fireEvent.press(screen.getByRole('button', { name: '选择场景：office' }));
      await waitFor(() => expect(screen.getByText('已选 1 个')).toBeTruthy());
      const selectedClass = screen.getByRole('button', { name: '取消场景：office' }).props
        .className;
      expect(selectedClass).not.toBe(unselectedClasses[0]);
      expect(screen.getByRole('button', { name: '选择场景：computer' }).props.className).toBe(
        unselectedClasses[0],
      );
      expect(screen.getByRole('button', { name: '选择场景：厨房' }).props.className).toBe(
        unselectedClasses[0],
      );

      expect(screen.getByRole('button', { name: '取消场景：office' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: '选择场景：office' })).toBeNull();
      // The other two are untouched — `computer` (same earth tone as
      // before) never gains a selected state.
      expect(screen.getByRole('button', { name: '选择场景：computer' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '选择场景：厨房' })).toBeTruthy();
      // 「任意」 is no longer a peer chip in the flow; it is the state
      // readout, and clearing is a labelled action on it.
      expect(
        screen.getByRole('button', { name: '清除场景选择，回到任意' }),
      ).toBeTruthy();

      fireEvent.press(screen.getByRole('button', { name: '清除场景选择，回到任意' }));
      await waitFor(() => expect(screen.getByText('任意')).toBeTruthy());
      expect(screen.queryByText(/已选 \d+ 个/)).toBeNull();    });

    it('scenes are multi-select (OR) and minutes are single-select', async () => {
      ctxRef.current = [context('c-1', '电脑'), context('c-2', '手机')];
      setPool([
        nextAction({ id: 'a', title: '电脑活', contextIds: ['c-1'] }),
        nextAction({ id: 'b', title: '手机活', contextIds: ['c-2'] }),
      ]);
      renderRouter('app', { initialUrl: '/(tabs)/now' });

      // Two scenes lit at once — the multi/OR semantics, no hint text.
      await waitFor(() =>
        expect(screen.getByRole('button', { name: '选择场景：电脑' })).toBeTruthy(),
      );
      fireEvent.press(screen.getByRole('button', { name: '选择场景：电脑' }));
      fireEvent.press(screen.getByRole('button', { name: '选择场景：手机' }));
      await waitFor(() => expect(screen.getByText('已选 2 个')).toBeTruthy());
      expect(screen.getByRole('button', { name: '取消场景：电脑' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '取消场景：手机' })).toBeTruthy();
      // Both tagged actions are eligible under the engine's OR contract.
      await waitFor(() => expect(screen.getByText('2/2 项')).toBeTruthy());

      // Minutes: picking 120 REPLACES the previous choice (single-select),
      // and the newly chosen one is the only one reporting selected.
      fireEvent.press(screen.getByRole('button', { name: '设置可用时间：60 分钟' }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: '设置可用时间：120 分钟' })).toBeTruthy(),
      );
      // 60 is the default → re-selecting it changes nothing.
      fireEvent.press(screen.getByRole('button', { name: '设置可用时间：120 分钟' }));
      await waitFor(() => expect(screen.getByText('2/2 项')).toBeTruthy());
    });

    it('the scene bar offers a 管理场景 entry (delete lives on its own screen)', async () => {
      ctxRef.current = [context('c-1', '客厅')];
      renderRouter('app', { initialUrl: '/(tabs)/now' });

      await waitFor(() =>
        expect(screen.getByRole('button', { name: '选择场景：客厅' })).toBeTruthy(),
      );
      // The entry is labelled 「管理场景」, NOT 「管理」 — the habit block's
      // own 管理 button (now-screen.test.tsx 「the one-tap complete chips and
      // the 管理 entry」) must stay unambiguous.
      fireEvent.press(screen.getByRole('button', { name: '管理场景' }));

      await waitFor(() =>
        expect(
          screen.getByText('场景是行动的运行环境 —— Now 屏按当前场景筛选待办。不选即随处可执行。'),
        ).toBeTruthy(),
      );
      expect(screen.getByRole('button', { name: '← 返回' })).toBeTruthy();
    });

    it('re-reads the scenes when the tab regains focus (Rule 7 refresh path)', async () => {
      // The `/contexts` screen writes the same rows, and this bar stays
      // MOUNTED while that route is pushed on top — so a scene deleted
      // there used to linger in the chips until an app restart (found in
      // browser testing). `useFocusEffect` → `useContexts().reload()` is the
      // fix.
      //
      // Asserted via the READ COUNTER, not the chip: under renderRouter the
      // tab remounts on the stack navigation, so the mount-time read already
      // picks the new rows up and "the chip disappeared" passes with `reload`
      // deleted (hook-guidelines Rule 8 — verified by mutation). Counting
      // reads is what actually pins the focus path: on RETURN to an
      // already-mounted bar, a read can only come from the focus effect.
      ctxRef.current = [context('c-1', '客厅')];
      renderRouter('app', { initialUrl: '/(tabs)/now' });
      await waitFor(() =>
        expect(screen.getByRole('button', { name: '选择场景：客厅' })).toBeTruthy(),
      );

      // Baseline AFTER mount — the mount read is not the focus read.
      const base = contextReads.count;

      // Focus the tab again the way returning from a stack route does.
      testRouter.navigate('/settings');
      await waitFor(() => expect(screen.getByText('设备与云同步。')).toBeTruthy());
      testRouter.navigate('/now');

      await waitFor(() => expect(contextReads.count).toBeGreaterThan(base));
    });

    it('opens AddSceneModal when tapping "+ 添加场景" and allows quick creation', async () => {
      renderRouter('app', { initialUrl: '/(tabs)/now' });
      await waitFor(() => expect(screen.getByText('当前场景')).toBeTruthy());

      // Tap "+ 添加场景" button
      fireEvent.press(screen.getByRole('button', { name: '新建场景' }));

      // AddSceneModal appears with title and presets
      await waitFor(() => expect(screen.getByText('添加新场景')).toBeTruthy());
      expect(screen.getByText('情境聚焦')).toBeTruthy();
      expect(screen.getByText('咖啡馆')).toBeTruthy();

      // Tap preset 咖啡馆
      fireEvent.press(screen.getByRole('button', { name: '预设推荐：咖啡馆' }));
      expect(screen.getByDisplayValue('咖啡馆 ☕️')).toBeTruthy();

      // Tap close/cancel to close
      fireEvent.press(screen.getByRole('button', { name: '取消' }));
      await waitFor(() => expect(screen.queryByText('添加新场景')).toBeNull());
    });
  });

  // ── Habit block (task 10-02) ──────────────────────────────────────────
  // The block used to render NOTHING when there were no habit days, so
  // the whole habits feature was undiscoverable. Both states now render,
  // and each carries a way into the habits screen.
  describe('habit block', () => {
    it('zero habits → the block shows the guidance entry (not a silent 0/0 with no way out)', async () => {
      setPool([]);
      renderRouter('app', { initialUrl: '/(tabs)/now' });

      await waitFor(() => expect(screen.getByText('今天习惯 0/0')).toBeTruthy());
      expect(screen.getByText(/还没有习惯/)).toBeTruthy();
      expect(screen.getByRole('button', { name: '去创建习惯' })).toBeTruthy();
    });

    it('with habit days → the count, the one-tap complete chips and the 管理 entry', async () => {
      // TWO habits, one day row each — `(habitId, localDate)` is unique, so
      // one habit can never contribute two rows to today's count.
      habitListRef.current = [
        habitFixture(),
        habitFixture({ id: 'h-2', title: '冥想' }),
      ];
      habitDaysRef.current = [
        habitDayFixture({ id: 'hd-1', habitId: 'h-1', status: 'done' }),
        habitDayFixture({ id: 'hd-2', habitId: 'h-2', status: 'open' }),
      ];
      setPool([]);
      renderRouter('app', { initialUrl: '/(tabs)/now' });

      await waitFor(() => expect(screen.getByText('今天习惯 1/2')).toBeTruthy());
      // The habit's own title comes from listHabits (the day row has no title).
      expect(screen.getByRole('button', { name: '完成习惯：冥想' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '管理' })).toBeTruthy();
      // The empty-state prompt is gone once there is something to show.
      expect(screen.queryByText('去创建习惯')).toBeNull();
      // The done habit offers no check-in — `completeAction` would reject it.
      expect(screen.queryByRole('button', { name: '完成习惯：阅读' })).toBeNull();
      expect(screen.getByText('今天已完成')).toBeTruthy();
    });

    // PRD acceptance: "从习惯屏创建后返回 Now 屏，习惯条立即显示新习惯".
    // What this actually pins: the habit data is re-read on the way back,
    // so a habit created on another screen is on the strip without an app
    // restart.
    //
    // What it does NOT pin — verified by experiment on 2026-10-03: remove
    // the `useFocusEffect` → `reload()` call from now.tsx and this test
    // STILL passes. Under `renderRouter`, pushing /habits REMOUNTS the Now
    // screen, so the mount-time read picks up the new rows. The focus hook
    // is still required for the real app (React Navigation keeps a bottom
    // tab mounted when a stack screen is pushed on top of it, which is the
    // premise of design.md §3) — it just cannot be proven from here: a tab
    // switch does NOT emit focus events in this harness, so there is no
    // navigation-based way to isolate the focus path. See the testing
    // note in .trellis/spec/app/hook-guidelines.md.
    it('shows a habit created on another screen on return, without an app restart', async () => {
      renderRouter('app', { initialUrl: '/(tabs)/now' });

      // Mounted with no habits at all.
      await waitFor(() => expect(screen.getByText('今天习惯 0/0')).toBeTruthy());

      // The user creates a habit elsewhere while Now stays mounted.
      habitListRef.current = [habitFixture()];
      habitDaysRef.current = [habitDayFixture({ id: 'hd-9', status: 'open' })];

      // Push /habits, then come back — the tab is still mounted underneath.
      // (`testRouter` normalizes the group segment: /(tabs)/now → /now.)
      testRouter.navigate('/habits');
      await flushRenders();
      testRouter.navigate('/now');
      await flushRenders();

      // Focus fired → reload() → the new habit is on the strip.
      await waitFor(() => expect(screen.getByText('今天习惯 0/1')).toBeTruthy());
      expect(screen.getByRole('button', { name: '完成习惯：阅读' })).toBeTruthy();
    });

    // Regression (task 10-02): `trashHabit` is a SOFT delete — the habit's
    // HabitDay rows deliberately survive it (PRD F5) and `listHabitDays`
    // cannot see the parent habit. The block iterates the HABITS (not the
    // days) and `listHabits` excludes soft-deleted rows, so a deleted habit
    // drops out structurally. The pool query applies the same gate (pool.ts
    // skips days of deleted / non-active habits); the block must agree.
    it('drops the days of a deleted habit (soft delete keeps the rows, the block must not)', async () => {
      habitListRef.current = [habitFixture({ id: 'h-gone', title: '已删除的习惯' })];
      habitDaysRef.current = [habitDayFixture({ id: 'hd-gone', habitId: 'h-gone', status: 'open' })];
      setPool([]);
      renderRouter('app', { initialUrl: '/(tabs)/now' });

      await waitFor(() => expect(screen.getByText('今天习惯 0/1')).toBeTruthy());
      expect(screen.getByRole('button', { name: '完成习惯：已删除的习惯' })).toBeTruthy();

      // The habit is deleted somewhere else: `listHabits` (which excludes
      // soft-deleted rows) no longer returns it; the day row is still there.
      habitListRef.current = [];
      testRouter.navigate('/habits');
      await flushRenders();
      testRouter.navigate('/now');
      await flushRenders();

      await waitFor(() => expect(screen.getByText('今天习惯 0/0')).toBeTruthy());
      expect(screen.queryByRole('button', { name: '完成习惯：已删除的习惯' })).toBeNull();
    });

    // The block's reason for existing over a bare check-in chip: the
    // challenge context (where you are in the 21 days) that the ranked
    // eligible list cannot show.
    it('shows the challenge day and the cycle done-count per habit', async () => {
      // Started 4 days ago → today is day 5 of 21.
      const startedAt = new Date(Date.now() - 4 * 86_400_000).toISOString();
      habitListRef.current = [habitFixture({ startedAt })];
      habitDaysRef.current = [
        // Three done days inside the cycle, plus today's open row.
        habitDayFixture({
          id: 'hd-p1',
          localDate: localDateKey(new Date(Date.now() - 3 * 86_400_000)),
          status: 'done',
        }),
        habitDayFixture({
          id: 'hd-p2',
          localDate: localDateKey(new Date(Date.now() - 2 * 86_400_000)),
          status: 'done',
        }),
        habitDayFixture({
          id: 'hd-p3',
          localDate: localDateKey(new Date(Date.now() - 86_400_000)),
          status: 'done',
        }),
        habitDayFixture({ id: 'hd-today', status: 'open' }),
      ];
      setPool([]);
      renderRouter('app', { initialUrl: '/(tabs)/now' });

      await waitFor(() => expect(screen.getByText('今天习惯 0/1')).toBeTruthy());
      expect(screen.getByText('第 5/21 天')).toBeTruthy();
      expect(screen.getByText('本期已完成 3 天')).toBeTruthy();
      // Today's row is still open → the check-in is offered.
      expect(screen.getByRole('button', { name: '完成习惯：阅读' })).toBeTruthy();
    });

    // A habit whose weekday mask excluded today has NO HabitDay row — the
    // block must say so rather than render a check-in that would fail.
    it('a habit with no row today reads as 今天无安排, not a check-in', async () => {
      habitListRef.current = [habitFixture()];
      habitDaysRef.current = [];
      setPool([]);
      renderRouter('app', { initialUrl: '/(tabs)/now' });

      // No row today → the habit is still listed (it is active), but the
      // today count only covers habits that generated one.
      await waitFor(() => expect(screen.getByText('今天无安排')).toBeTruthy());
      expect(screen.queryByRole('button', { name: '完成习惯：阅读' })).toBeNull();
    });

    // Regression (found by running the app, 2026-10-07): the check-in
    // wrote correctly but the BLOCK kept the pre-write counters —
    // `useHabits` is a query-style hook (no watch query), so nothing
    // re-read the habits after `completeAction`. The user had to leave
    // the tab and come back for 0/1 → 1/1 to appear.
    //
    // What this pins: the successful write triggers a re-read, so the
    // count and the "今天已完成" state update in place.
    it('re-reads the habits after a successful check-in so the count updates in place', async () => {
      habitListRef.current = [habitFixture()];
      habitDaysRef.current = [habitDayFixture({ id: 'hd-1', status: 'open' })];
      setPool([]);
      renderRouter('app', { initialUrl: '/(tabs)/now' });

      await waitFor(() => expect(screen.getByText('今天习惯 0/1')).toBeTruthy());

      // The write lands: the day's status flips to done.
      habitDaysRef.current = [habitDayFixture({ id: 'hd-1', status: 'done' })];
      const readsBeforePress = habitReads.habits;
      fireEvent.press(screen.getByRole('button', { name: '完成习惯：阅读' }));

      // ...and the block re-reads instead of waiting for a focus event.
      await waitFor(() => expect(screen.getByText('今天习惯 1/1')).toBeTruthy());
      expect(screen.getByText('今天已完成')).toBeTruthy();
      expect(screen.queryByRole('button', { name: '完成习惯：阅读' })).toBeNull();
      expect(habitReads.habits).toBeGreaterThan(readsBeforePress);
    });

    // The mirror of the case above: a REJECTED write must NOT trigger the
    // re-read.
    //
    // Asserting "the screen still shows 0/1" here would prove NOTHING: the
    // rejected write left the source rows untouched, so a re-read returns
    // the same data and renders the same DOM. Verified by mutation —
    // turning the guard into `if (ok || !ok)` kept that assertion green.
    // The observable is the READ ITSELF, so count it.
    it('does not re-read the habits when the check-in write is rejected', async () => {
      habitListRef.current = [habitFixture()];
      habitDaysRef.current = [habitDayFixture({ id: 'hd-1', status: 'open' })];
      setPool([]);
      renderRouter('app', { initialUrl: '/(tabs)/now' });

      await waitFor(() => expect(screen.getByText('今天习惯 0/1')).toBeTruthy());

      completeCalls.shouldFail = true;
      const readsBeforePress = habitReads.habits;
      fireEvent.press(screen.getByRole('button', { name: '完成习惯：阅读' }));

      // Wait for the REJECTION to surface first: its arrival proves the
      // `.then(ok => ...)` callback has already run, so any re-read it may
      // have fired is already in flight. Asserting the read count before
      // this point would race the very thing under test.
      await waitFor(() => expect(screen.getByText('complete rejected')).toBeTruthy());
      await flushRenders();

      expect(completeCalls.count).toBe(1);
      // No re-read was fired for the failed write.
      expect(habitReads.habits).toBe(readsBeforePress);
      // The row is unchanged and still checkable.
      expect(screen.getByText('今天习惯 0/1')).toBeTruthy();
      expect(screen.getByRole('button', { name: '完成习惯：阅读' })).toBeTruthy();
    });

    it('opens EditActionModal on Now screen and saves action edits', async () => {
      setPool([
        nextAction({
          id: 'action-edit-test',
          title: '写需求文档',
          estMinutes: 30,
          value: 3,
        }),
      ]);
      renderRouter('app', { initialUrl: '/(tabs)/now' });
      await flushRenders();

      await waitFor(() => expect(screen.getAllByText('写需求文档').length).toBeGreaterThan(0));

      // Tap 编辑 button in the action row or hero
      const editButtons = screen.getAllByRole('button', { name: '编辑' });
      expect(editButtons.length).toBeGreaterThan(0);
      fireEvent.press(editButtons[0]!);
      await flushRenders();

      // Modal is visible with action details
      expect(screen.getByText('编辑行动')).toBeTruthy();
      expect(screen.getByLabelText('行动名称输入框').props.value).toBe('写需求文档');

      // Change title
      fireEvent.changeText(screen.getByLabelText('行动名称输入框'), '写技术设计文档');
      await flushRenders();

      // Tap 保存修改
      fireEvent.press(screen.getByRole('button', { name: '保存修改' }));
      await flushRenders();

      // Verify updateNextAction was called with modified title
      await waitFor(() => expect(updateCalls.count).toBe(1));
      expect(updateCalls.actions[0]).toMatchObject({
        id: 'action-edit-test',
        title: '写技术设计文档',
      });
    });
  });
});
