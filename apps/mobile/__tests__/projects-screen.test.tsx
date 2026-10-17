/**
 * Component tests — the Projects tab + project detail route (design
 * §4.2): the project cards with derived stats (progress, deadline chip,
 * the current next-action sub-card, the missing-next warning + CTA, the
 * 14-day stall tag), the filter chips (进行中 / 无下一步 / 已归档, counts
 * derived live), the inline new-project form (required-field gate), and
 * the detail's per-project open action rows (client-side projectId filter,
 * read-only context chips) + the mutation wiring.
 *
 * The PowerSync layer is mocked at the package boundary (same shell mocks
 * as tabs.smoke.test.tsx): `useQuery` returns `dataRef.cards` for the
 * tab's watched `projectCardsWatchQuery`, so the fixtures are
 * ProjectCard-shaped rows (the detail screen consumes the same rows via
 * `projectsWatchQuery` and reads `hasOpenAction`). The time-sensitive
 * stall flag is derived against the REAL app clock, so the progress
 * fixtures are relative to Date.now() (same determinism pattern as the
 * Inbox 24h test).
 */
const dataRef: {
  cards: Record<string, unknown>[];
  nextActions: Record<string, unknown>[];
  contexts: Record<string, unknown>[];
  habits: Record<string, unknown>[];
  habitDays: Record<string, unknown>[];
} = {
  cards: [],
  nextActions: [],
  contexts: [],
  habits: [],
  habitDays: [],
};

// Read counter for the project's habit block (see the `listHabits` mock
// below). Not a jest.fn: it must survive `jest.clearAllMocks()` so a test
// can read the baseline taken AFTER mount.
const habitReads = { habits: 0, days: 0 };

jest.mock('@nextdo/db', () => {
  const compilable = () => ({
    compile: () => ({ sql: 'SELECT 1', parameters: [] }),
    execute: async () => [],
  });
  // The REAL cycle-day rule: the project detail's habit block derives the
  // 21-day challenge position through it. Re-implementing it in the mock
  // would assert a second copy of the rule (same reasoning as
  // now-screen.test.tsx / habits-screen.test.tsx).
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
    projectsWatchQuery: compilable,
    projectCardsWatchQuery: compilable,
    // Pure stall predicate — a mirror of the real 14-day definition
    // (lastProgressAt ?? createdAt ≥ 14 days; corrupt → false). The mock
    // must not drag the whole db package into the component test.
    isStalled: (last: string | null, created: string | null, now: Date) => {
      const anchor = last ?? created;
      if (anchor === null) return false;
      const ms = new Date(anchor).getTime();
      if (Number.isNaN(ms)) return false;
      return now.getTime() - ms >= 14 * 24 * 60 * 60 * 1000;
    },
    listNextActions: async () => dataRef.nextActions,
    listContexts: async () => dataRef.contexts,
    // The project's habit block (task 10-07) — `useProjectHabits` reads
    // both on every mount / reload. Without these the read throws inside
    // the hook and the whole detail screen renders nothing
    // (testing-guidelines: the factory must provide every @nextdo/db
    // export the mounted tree touches).
    // `habitReads` counts real re-reads of the project's habit block so a
    // test can assert *whether* a refresh happened, not just what the UI
    // happens to show. Asserting the UI alone is a false negative here:
    // after a failed write the rows are unchanged either way, so
    // "counters didn't move" passes even with the reload removed
    // (the mutation trap in now-screen.test.tsx, same class of bug).
    listHabits: async () => {
      habitReads.habits += 1;
      return dataRef.habits;
    },
    listHabitDays: async () => {
      habitReads.days += 1;
      return dataRef.habitDays;
    },
    // The REAL cycle-day rule (the block derives the 21-day challenge
    // position through it). The previous hand-rolled copy in this factory
    // was a second implementation of the same rule; `now-screen` and
    // `habits-screen` both delegate to the real export for this reason.
    habitCycleDay: actual.habitCycleDay,
    startHabit: jest.fn(async (_db: unknown, habit: Record<string, unknown>, now: Date) => {
      dataRef.habits.push(habit);
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const date = String(now.getDate()).padStart(2, '0');
      const todayKey = `${y}${m}${date}`;
      const todayDay = {
        id: `hd-${habit.id}-${todayKey}`,
        habitId: habit.id,
        localDate: todayKey,
        status: 'open',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        deletedAt: null,
        consecutiveSkips: 0,
      };
      dataRef.habitDays.push(todayDay);
      return { habit, today: todayDay };
    }),
    addProject: jest.fn(async () => undefined),
    addNextAction: jest.fn(async () => undefined),
    completeAction: jest.fn(async () => undefined),
    snoozeAction: jest.fn(async () => undefined),
    trashAction: jest.fn(async () => undefined),
    trashProject: jest.fn(async (_db: unknown, args: { id: string }) => {
      const index = dataRef.cards.findIndex((card) => card.id === args.id);
      if (index >= 0) dataRef.cards.splice(index, 1);
      return undefined;
    }),
    trashHabit: jest.fn(async (_db: unknown, args: { id: string }) => {
      const index = dataRef.habits.findIndex((habit) => habit.id === args.id);
      if (index >= 0) dataRef.habits.splice(index, 1);
      return undefined;
    }),
    // Task 09-28 (R1–R4): the edit/archive mutations APPLY to the watched
    // fixtures, so the header / action rows re-render with the new values
    // after save (simulating the live PowerSync watch refresh).
    updateProject: jest.fn(async (_db: unknown, project: Record<string, unknown>) => {
      const index = dataRef.cards.findIndex((card) => card.id === project.id);
      if (index >= 0) dataRef.cards[index] = { ...dataRef.cards[index], ...project };
      return project;
    }),
    updateNextAction: jest.fn(async (_db: unknown, action: Record<string, unknown>) => {
      const index = dataRef.nextActions.findIndex((entry) => entry.id === action.id);
      if (index >= 0) dataRef.nextActions[index] = action;
      return action;
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
      data: dataRef.cards,
      error: undefined,
      isLoading: false,
      isFetching: false,
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

import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import {
  addNextAction,
  addProject,
  completeAction,
  startHabit,
  trashAction,
  trashHabit,
  trashProject,
  updateNextAction,
  updateProject,
} from '@nextdo/db';
import { formatDeadline } from '@nextdo/core';

const mockedAddProject = addProject as jest.Mock;
const mockedAddNextAction = addNextAction as jest.Mock;
const mockedCompleteAction = completeAction as jest.Mock;
const mockedStartHabit = startHabit as jest.Mock;
const mockedTrashAction = trashAction as jest.Mock;
const mockedTrashProject = trashProject as jest.Mock;
const mockedTrashHabit = trashHabit as jest.Mock;
const mockedUpdateProject = updateProject as jest.Mock;
const mockedUpdateNextAction = updateNextAction as jest.Mock;

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY).toISOString();

/** `YYYY-MM-DD` for a day relative to today, in the picker's own format. */
function dayKey(offset: number): string {
  const day = new Date();
  day.setDate(day.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/**
 * Open the first 截止 field on screen, pick `dateKey`, confirm.
 *
 * The deadline field is read-only (issue #16) — its value only ever arrives
 * through the picker modal, which renders real calendar days only.
 */
async function pickDeadline(dateKey: string): Promise<void> {
  fireEvent.press(screen.getAllByRole('button', { name: /^截止/ })[0]!);
  const [year, month, day] = dateKey.split('-');
  fireEvent.press(screen.getByLabelText(`年 ${year}`));
  fireEvent.press(screen.getByLabelText(`月 ${Number(month)}`));
  fireEvent.press(screen.getByLabelText(`日 ${Number(day)}`));
  fireEvent.press(screen.getByRole('button', { name: '确定' }));
}

function action(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'a-1',
    createdAt: daysAgo(3),
    updatedAt: daysAgo(3),
    deletedAt: null,
    title: '运行 baseline A',
    projectId: 'p-1',
    contextIds: [],
    estMinutes: 40,
    value: 3,
    category: null,
    dueDate: null,
    deadline: null,
    dependsOnId: null,
    windowStart: null,
    windowEnd: null,
    windowDays: null,
    consecutiveSkips: 0,
    status: 'open',
    sourceInboxId: null,
    replacesActionId: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  habitReads.habits = 0;
  habitReads.days = 0;
  dataRef.contexts = [
    {
      id: 'c-1',
      createdAt: daysAgo(30),
      updatedAt: daysAgo(30),
      deletedAt: null,
      name: '电脑',
    },
  ];
  // ProjectCard-shaped rows (the tab's watch query); the same rows feed the
  // detail screen's useProjects (it reads `hasOpenAction` off them).
  dataRef.cards = [
    {
      // healthy active project: 1 open + 3 done, progress 5 days ago
      id: 'p-1',
      createdAt: daysAgo(10),
      updatedAt: daysAgo(10),
      deletedAt: null,
      title: '论文实验',
      outcome: '跑出 baseline 结果',
      value: 4,
      status: 'active',
      hasOpenAction: true,
      openCount: 1,
      completedCount: 3,
      earliestOpenDeadline: null,
      lastProgressAt: daysAgo(5),
      nextAction: {
        id: 'a-1',
        title: '运行 baseline A',
        contextIds: ['c-1'],
        deadline: daysFromNow(3),
        estMinutes: 40,
      },
    },
    {
      // active + quiet: open actions exist, no progress for 30 days → stalled
      id: 'p-2',
      createdAt: daysAgo(60),
      updatedAt: daysAgo(60),
      deletedAt: null,
      title: '停滞的项目',
      outcome: '整理服务器',
      value: 2,
      status: 'active',
      hasOpenAction: true,
      openCount: 2,
      completedCount: 1,
      earliestOpenDeadline: null,
      lastProgressAt: daysAgo(30),
      nextAction: {
        id: 'a-9',
        title: '停滞项目的行动',
        contextIds: [],
        deadline: null,
        estMinutes: 30,
      },
    },
    {
      // active with NO open actions → the missing-next warning
      id: 'p-3',
      createdAt: daysAgo(20),
      updatedAt: daysAgo(20),
      deletedAt: null,
      title: '缺下一步的项目',
      outcome: '迁完数据',
      value: 3,
      status: 'active',
      hasOpenAction: false,
      openCount: 0,
      completedCount: 1,
      earliestOpenDeadline: null,
      lastProgressAt: daysAgo(25),
      nextAction: null,
    },
    {
      // archived (on-hold) → only visible under the 已归档 filter
      id: 'p-4',
      createdAt: daysAgo(40),
      updatedAt: daysAgo(40),
      deletedAt: null,
      title: '搁置的项目',
      outcome: '写小 CLI',
      value: 2,
      status: 'on-hold',
      hasOpenAction: false,
      openCount: 0,
      completedCount: 0,
      earliestOpenDeadline: null,
      lastProgressAt: null,
      nextAction: null,
    },
  ];
  dataRef.nextActions = [
    action({ contextIds: ['c-1'] }),
    action({ id: 'a-2', title: '没有项目的行动', projectId: null }),
    action({ id: 'a-3', title: '已完成的行动', status: 'done' }),
  ];

  const todayDate = new Date();
  const y = todayDate.getFullYear();
  const m = String(todayDate.getMonth() + 1).padStart(2, '0');
  const d = String(todayDate.getDate()).padStart(2, '0');
  const todayKey = `${y}${m}${d}`;

  dataRef.habits = [
    {
      id: 'h-1',
      title: '读文献习惯',
      actionTitle: '读一章文献',
      projectId: 'p-1',
      cycleDays: 21,
      startedAt: daysAgo(2),
      status: 'active',
      value: 3,
      estMinutes: 25,
      createdAt: daysAgo(2),
      updatedAt: daysAgo(2),
      deletedAt: null,
    },
    {
      id: 'h-2',
      title: '其他项目习惯',
      actionTitle: '其他行动',
      projectId: 'p-2',
      cycleDays: 21,
      startedAt: daysAgo(1),
      status: 'active',
      value: 3,
      estMinutes: 20,
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
      deletedAt: null,
    },
  ];
  dataRef.habitDays = [
    {
      id: `hd-h-1-${todayKey}`,
      habitId: 'h-1',
      localDate: todayKey,
      status: 'open',
      createdAt: daysAgo(0),
      updatedAt: daysAgo(0),
      deletedAt: null,
      consecutiveSkips: 0,
    },
  ];
});

describe('Projects tab', () => {
  it('renders the header, subtitle, active count and the three filter chips with counts', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/projects' });

    await waitFor(() => expect(screen.getByText('论文实验')).toBeTruthy());
    expect(
      screen.getByText('需要多个行动才能完成的具体结果。每个进行中的项目都应有一个明确的下一步。'),
    ).toBeTruthy();
    // Header count chip (n 进行中) — 3 active projects.
    expect(screen.getByText('3 进行中')).toBeTruthy();
    // Filter chips: 进行中 3 / 无下一步 1 (p-3) / 已归档 1 (p-4).
    expect(screen.getByText('进行中 3')).toBeTruthy();
    expect(screen.getByText('无下一步 1')).toBeTruthy();
    expect(screen.getByText('已归档 1')).toBeTruthy();
    // The archived project is out of the default (进行中) list.
    expect(screen.queryByText('搁置的项目')).toBeNull();
  });

  it('lists the project card with progress, the next-action sub-card and the deadline chip', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/projects' });

    await waitFor(() => expect(screen.getByText('论文实验')).toBeTruthy());
    // p-1: 3 done of 4 total.
    expect(screen.getByText('3/4 行动')).toBeTruthy();
    // The current next-action sub-card — p-1 AND p-2 both have one.
    expect(screen.getAllByText('▶ 当前下一步行动')).toHaveLength(2);
    expect(screen.getByText('运行 baseline A')).toBeTruthy();
    expect(screen.getByText('电脑')).toBeTruthy();
    // The next-action sub-card's deadline chip (3 days out → 「M月D日 截止」,
    // spoken by core's `formatDeadline` rather than the card's own wording —
    // the project and action chips must never describe the same instant two
    // different ways).
    expect(screen.getByText(formatDeadline(daysFromNow(3), new Date()))).toBeTruthy();
  });

  it('the filter chips switch between 进行中 / 无下一步 / 已归档', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/projects' });

    await waitFor(() => expect(screen.getByText('论文实验')).toBeTruthy());
    // Default = 进行中: the missing-next project is in, the archived one out.
    expect(screen.getByText('缺下一步的项目')).toBeTruthy();
    expect(screen.queryByText('搁置的项目')).toBeNull();

    fireEvent.press(screen.getByText('无下一步 1'));
    await waitFor(() => expect(screen.queryByText('论文实验')).toBeNull());
    expect(screen.getByText('缺下一步的项目')).toBeTruthy();
    expect(screen.queryByText('停滞的项目')).toBeNull();

    fireEvent.press(screen.getByText('已归档 1'));
    await waitFor(() => expect(screen.getByText('搁置的项目')).toBeTruthy());
    expect(screen.queryByText('缺下一步的项目')).toBeNull();
  });

  it('projects without open actions show the missing-next warning; its CTA opens the detail', async () => {
    const view = renderRouter('app', { initialUrl: '/(tabs)/projects' });

    await waitFor(() => expect(screen.getByText('缺下一步的项目')).toBeTruthy());
    // Exactly one warning in the default view (p-3; the archived p-4 is out).
    expect(screen.getAllByText(/缺少下一步/)).toHaveLength(1);
    fireEvent.press(screen.getByText('澄清下一步'));

    await waitFor(() => expect(view.getPathname()).toBe('/projects/p-3'));
  });

  it('stalled projects carry the 14 天无进展 tag; fresh ones do not', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/projects' });

    await waitFor(() => expect(screen.getByText('停滞的项目')).toBeTruthy());
    // p-2 (progress 30 days ago) is stalled; p-1 (5 days) is not — one tag.
    expect(screen.getAllByText('14 天无进展')).toHaveLength(1);
  });

  it('the new-project form gates on title + outcome, then calls addProject', async () => {
    renderRouter('app', { initialUrl: '/(tabs)/projects' });
    await waitFor(() => expect(screen.getByText('＋ 新建项目（明确具体成果）')).toBeTruthy());
    fireEvent.press(screen.getByText('＋ 新建项目（明确具体成果）'));

    expect(screen.getByPlaceholderText('项目标题')).toBeTruthy();
    // Empty form: pressing 创建 does nothing.
    fireEvent.press(screen.getByText('创建'));
    await waitFor(() => expect(mockedAddProject).not.toHaveBeenCalled());

    fireEvent.changeText(screen.getByPlaceholderText('项目标题'), '写周报自动化');
    fireEvent.changeText(screen.getByPlaceholderText('完成是什么样（结果）'), '脚本自动汇总');
    fireEvent.press(screen.getByText('创建'));

    await waitFor(() =>
      expect(mockedAddProject).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ title: '写周报自动化', outcome: '脚本自动汇总', value: 3, status: 'active' }),
      ),
    );
  });
});

describe('Project detail', () => {
  it('shows the header and only this project\'s open actions', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });

    await waitFor(() => expect(screen.getByText('运行 baseline A')).toBeTruthy());
    // Header.
    expect(screen.getByText('论文实验')).toBeTruthy();
    expect(screen.getByText('完成是什么样：跑出 baseline 结果')).toBeTruthy();
    expect(screen.getByText('有进行中的行动')).toBeTruthy();
    // Client-side projectId filter: other-project / done actions are out.
    expect(screen.queryByText('没有项目的行动')).toBeNull();
    expect(screen.queryByText('已完成的行动')).toBeNull();
    // Row actions.
    expect(screen.getByText('完成')).toBeTruthy();
    expect(screen.getByText('稍后')).toBeTruthy();
    expect(screen.getByText('删除')).toBeTruthy();
  });

  it('deep-load without a parent: ← 项目 replaces to the projects tab (web refresh case)', async () => {
    const view = renderRouter('app', { initialUrl: '/projects/p-1' });
    await waitFor(() => expect(screen.getByText('论文实验')).toBeTruthy());

    fireEvent.press(screen.getByText('← 项目'));

    // The stack has no parent route → goBack replaces to the tab root.
    await waitFor(() => expect(view.getPathname()).toBe('/projects'));
    await waitFor(() =>
      expect(
        screen.getByText('需要多个行动才能完成的具体结果。每个进行中的项目都应有一个明确的下一步。'),
      ).toBeTruthy(),
    );
  });

  it('action rows show the read-only context chips (names resolved from contexts)', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });

    await waitFor(() => expect(screen.getByText('运行 baseline A')).toBeTruthy());
    // a-1 carries context c-1 (电脑) → the row renders the read-only chip.
    expect(screen.getByText('电脑')).toBeTruthy();
  });

  it('pressing 完成 calls completeAction with the next kind + action id', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });
    await waitFor(() => expect(screen.getByText('运行 baseline A')).toBeTruthy());

    fireEvent.press(screen.getByText('完成'));

    await waitFor(() =>
      expect(mockedCompleteAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actionKind: 'next', actionId: 'a-1' }),
      ),
    );
  });

  it('the add-action form submits with the projectId and the picked estimate', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });
    await waitFor(() => expect(screen.getByText('＋ 添加行动')).toBeTruthy());
    fireEvent.press(screen.getByText('＋ 添加行动'));

    expect(screen.getByPlaceholderText('下一步行动（具体的、单步的）')).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText('下一步行动（具体的、单步的）'), '整理实验数据');
    // Pick the 30-minute estimate chip (label is unique among chips).
    fireEvent.press(screen.getByText('30'));
    fireEvent.press(screen.getByText('添加'));

    await waitFor(() =>
      expect(mockedAddNextAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ title: '整理实验数据', estMinutes: 30, projectId: 'p-1', value: 3 }),
        // Task 10-17: the reminder input travels next to the row.
        expect.objectContaining({ reminderAt: null }),
      ),
    );
  });

  it('a picked deadline is stored as that local day\'s end-of-day ISO', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });
    await waitFor(() => expect(screen.getByText('＋ 添加行动')).toBeTruthy());
    fireEvent.press(screen.getByText('＋ 添加行动'));

    fireEvent.changeText(screen.getByPlaceholderText('下一步行动（具体的、单步的）'), '整理实验数据');
    fireEvent.press(screen.getByText('30'));
    await pickDeadline(dayKey(5));
    fireEvent.press(screen.getByText('添加'));

    await waitFor(() => expect(mockedAddNextAction).toHaveBeenCalledTimes(1));
    const picked = new Date(dayKey(5));
    expect(mockedAddNextAction.mock.calls[0][1]).toMatchObject({
      title: '整理实验数据',
      estMinutes: 30,
      projectId: 'p-1',
      deadline: new Date(
        picked.getFullYear(),
        picked.getMonth(),
        picked.getDate(),
        23,
        59,
        59,
      ).toISOString(),
    });
  });

  it('the deadline field is a picker, not a free-text box, and 清除 empties it', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });
    await waitFor(() => expect(screen.getByText('＋ 添加行动')).toBeTruthy());
    fireEvent.press(screen.getByText('＋ 添加行动'));

    // The old hand-typed box is gone: the field is a button that opens the
    // picker, so an impossible date such as 2026-02-30 cannot be entered at
    // all — the picker only ever renders real calendar days.
    expect(screen.queryByPlaceholderText('截止（YYYY-MM-DD，可选）')).toBeNull();
    const field = screen.getByRole('button', { name: /^截止时间，未选择/ });
    await pickDeadline(dayKey(5));
    const picked = new Date(dayKey(5));
    // The field reads the picked day back as Chinese copy (task 10-17); a
    // date-only pick carries no time, so no HH:mm shows up.
    expect(screen.getByText(`${picked.getMonth() + 1}月${picked.getDate()}日`)).toBeTruthy();

    // Clearing returns the field to its unset wording.
    fireEvent.press(screen.getByRole('button', { name: '清除截止时间' }));
    expect(screen.getByRole('button', { name: /^截止时间，未选择/ })).toBeTruthy();
    expect(field).toBeTruthy();
  });

  it('editing a project: a picked deadline is saved and 清除 removes it', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });
    await waitFor(() => expect(screen.getByText('论文实验')).toBeTruthy());

    fireEvent.press(screen.getAllByText('编辑')[0]!);
    await pickDeadline(dayKey(5));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(mockedUpdateProject).toHaveBeenCalledTimes(1));
    const picked = new Date(dayKey(5));
    expect(mockedUpdateProject.mock.calls[0][1]).toMatchObject({
      id: 'p-1',
      deadline: new Date(
        picked.getFullYear(),
        picked.getMonth(),
        picked.getDate(),
        23,
        59,
        59,
      ).toISOString(),
    });

    // Re-open and clear: `deadline: undefined` must reach the row so the
    // column is written back as NULL.
    fireEvent.press(screen.getAllByText('编辑')[0]!);
    fireEvent.press(screen.getByRole('button', { name: '清除截止时间' }));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(mockedUpdateProject).toHaveBeenCalledTimes(2));
    expect(mockedUpdateProject.mock.calls[1][1]).toHaveProperty('deadline', undefined);
  });

  it('editing the project (R1): saving updates the header with the new fields', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });
    await waitFor(() => expect(screen.getByText('论文实验')).toBeTruthy());

    // Header [编辑] — the action row's 编辑 button renders later in the tree.
    fireEvent.press(screen.getAllByText('编辑')[0]!);
    expect(screen.getByPlaceholderText('项目标题')).toBeTruthy();
    // Pre-filled from the current row — change only the title.
    fireEvent.changeText(screen.getByPlaceholderText('项目标题'), '毕业论文实验（终稿）');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(screen.getByText('毕业论文实验（终稿）')).toBeTruthy());
    expect(mockedUpdateProject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'p-1',
        title: '毕业论文实验（终稿）',
        outcome: '跑出 baseline 结果',
        value: 4,
        status: 'active',
      }),
    );
  });

  it('editing the project (R1): an empty title or empty outcome cannot submit', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });
    await waitFor(() => expect(screen.getByText('论文实验')).toBeTruthy());
    fireEvent.press(screen.getAllByText('编辑')[0]!);

    // Whitespace-only title.
    fireEvent.changeText(screen.getByPlaceholderText('项目标题'), '   ');
    fireEvent.press(screen.getByText('保存'));
    expect(mockedUpdateProject).not.toHaveBeenCalled();
    // …and an empty outcome with a valid title.
    fireEvent.changeText(screen.getByPlaceholderText('项目标题'), '毕业论文实验');
    fireEvent.changeText(screen.getByPlaceholderText('完成是什么样（结果）'), '');
    fireEvent.press(screen.getByText('保存'));
    expect(mockedUpdateProject).not.toHaveBeenCalled();
  });

  it('archiving an active project (R2): no confirm, tag 搁置, button becomes 恢复', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });
    await waitFor(() => expect(screen.getByText('归档')).toBeTruthy());

    fireEvent.press(screen.getByText('归档'));

    // No confirmation dialog in between — the status update went straight
    // to the db and the header re-derives from the (mocked) live row.
    await waitFor(() => expect(screen.getByText('搁置')).toBeTruthy());
    expect(mockedUpdateProject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'p-1', status: 'on-hold' }),
    );
    expect(screen.getByText('恢复')).toBeTruthy();
    expect(screen.queryByText('归档')).toBeNull();
  });

  it('resuming an on-hold project (R3): back to active with the 归档 button', async () => {
    renderRouter('app', { initialUrl: '/projects/p-4' });
    await waitFor(() => expect(screen.getByText('恢复')).toBeTruthy());

    fireEvent.press(screen.getByText('恢复'));

    await waitFor(() => expect(screen.getByText('进行中')).toBeTruthy());
    expect(mockedUpdateProject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'p-4', status: 'active' }),
    );
    expect(screen.getByText('归档')).toBeTruthy();
    expect(screen.queryByText('搁置')).toBeNull();
  });

  it('an on-hold project keeps its action rows operable (R6): complete / edit / trash still work', async () => {
    // Give the on-hold project an open action of its own (fixture p-4 has none).
    dataRef.cards = dataRef.cards.map((card) =>
      card.id === 'p-4'
        ? {
            ...card,
            hasOpenAction: true,
            openCount: 1,
            nextAction: {
              id: 'a-4',
              title: '搁置项目里还开着的行动',
              contextIds: [],
              deadline: null,
              estMinutes: 20,
            },
          }
        : card,
    );
    dataRef.nextActions = [
      ...dataRef.nextActions,
      action({ id: 'a-4', title: '搁置项目里还开着的行动', projectId: 'p-4', estMinutes: 20 }),
    ];

    renderRouter('app', { initialUrl: '/projects/p-4' });
    await waitFor(() => expect(screen.getByText('搁置项目里还开着的行动')).toBeTruthy());
    // All four row actions are still rendered (编辑 ×2 = header quick action + row).
    expect(screen.getByText('完成')).toBeTruthy();
    expect(screen.getByText('稍后')).toBeTruthy();
    expect(screen.getAllByText('编辑')).toHaveLength(2);
    expect(screen.getByText('删除')).toBeTruthy();

    // Complete still reaches the db layer.
    fireEvent.press(screen.getByText('完成'));
    await waitFor(() =>
      expect(mockedCompleteAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actionKind: 'next', actionId: 'a-4' }),
      ),
    );

    // Edit still opens the inline form (the row's 编辑 — the header's is first).
    fireEvent.press(screen.getAllByText('编辑')[1]!);
    expect(screen.getByText('编辑行动')).toBeTruthy();
    fireEvent.press(screen.getByText('取消'));

    // Trash still reaches the db layer.
    fireEvent.press(screen.getByText('删除'));
    await waitFor(() =>
      expect(mockedTrashAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actionKind: 'next', actionId: 'a-4' }),
      ),
    );
  });

  it('editing an action (R4): saving updates the row with the new fields', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });
    await waitFor(() => expect(screen.getByText('运行 baseline A')).toBeTruthy());

    // The action row's 编辑 (the header's 编辑 is first in the tree).
    fireEvent.press(screen.getAllByText('编辑')[1]!);
    expect(screen.getByText('编辑行动')).toBeTruthy();
    // Pre-filled title — change it and pick the 30-minute estimate chip.
    fireEvent.changeText(screen.getByPlaceholderText('下一步行动（具体的、单步的）'), '运行 baseline B');
    fireEvent.press(screen.getByText('30'));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(screen.getByText('运行 baseline B')).toBeTruthy());
    expect(mockedUpdateNextAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'a-1', title: '运行 baseline B', estMinutes: 30, value: 3 }),
      // No deadline and no stored reminder → the reminder field stays empty
      // and this save leaves the reminders table alone (task 10-17).
      undefined,
    );
    // The row re-renders from the (mocked) live data — new estimate tag.
    expect(screen.getByText('30 分钟')).toBeTruthy();
  });

  it('deleting a project: armed confirm and calls trashProject', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });
    await waitFor(() => expect(screen.getByText('论文实验')).toBeTruthy());

    expect(screen.getByText('删除项目')).toBeTruthy();
    fireEvent.press(screen.getByText('删除项目'));

    expect(screen.getByText('确认删除项目？')).toBeTruthy();
    fireEvent.press(screen.getByText('确认删除项目？'));

    await waitFor(() =>
      expect(mockedTrashProject).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 'p-1' }),
      ),
    );
  });

  it('deleting a project habit: armed confirm and calls trashHabit', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });
    await waitFor(() => expect(screen.getByText('读文献习惯')).toBeTruthy());

    expect(screen.getByText('删除习惯')).toBeTruthy();
    fireEvent.press(screen.getByText('删除习惯'));

    expect(screen.getByText('确认删除习惯？')).toBeTruthy();
    fireEvent.press(screen.getByText('确认删除习惯？'));

    await waitFor(() =>
      expect(mockedTrashHabit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 'h-1' }),
      ),
    );
  });

  it('a done project (terminal) shows no edit / status buttons', async () => {
    dataRef.cards = [
      ...dataRef.cards,
      {
        ...dataRef.cards[0],
        id: 'p-5',
        title: '已完结的项目',
        outcome: '论文交付',
        value: 5,
        status: 'done',
        hasOpenAction: false,
        openCount: 0,
        completedCount: 4,
        earliestOpenDeadline: null,
        lastProgressAt: daysAgo(2),
        nextAction: null,
      },
    ];
    renderRouter('app', { initialUrl: '/projects/p-5' });
    await waitFor(() => expect(screen.getByText('已完结的项目')).toBeTruthy());
    // Terminal audit state: the status Tag only — no edit, no 归档/恢复.
    expect(screen.getByText('已完成')).toBeTruthy();
    expect(screen.queryByText('编辑')).toBeNull();
    expect(screen.queryByText('归档')).toBeNull();
    expect(screen.queryByText('恢复')).toBeNull();
  });

  it('a dropped project (terminal) shows no edit / status buttons', async () => {
    dataRef.cards = [
      ...dataRef.cards,
      {
        ...dataRef.cards[0],
        id: 'p-6',
        title: '已取消的项目',
        outcome: '设备更换',
        value: 2,
        status: 'dropped',
        hasOpenAction: false,
        openCount: 0,
        completedCount: 1,
        earliestOpenDeadline: null,
        lastProgressAt: daysAgo(30),
        nextAction: null,
      },
    ];
    renderRouter('app', { initialUrl: '/projects/p-6' });
    await waitFor(() => expect(screen.getByText('已取消的项目')).toBeTruthy());
    expect(screen.getByText('已放弃')).toBeTruthy();
    expect(screen.queryByText('编辑')).toBeNull();
    expect(screen.queryByText('归档')).toBeNull();
    expect(screen.queryByText('恢复')).toBeNull();
  });

  it('renders the project habits section with habit progress, grid and today check-in', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });

    await waitFor(() => expect(screen.getByText('项目习惯')).toBeTruthy());
    expect(screen.getByText('读文献习惯')).toBeTruthy();
    expect(screen.getByText('每日行动：读一章文献')).toBeTruthy();
    expect(screen.getByText('第 3/21 天')).toBeTruthy();
    expect(screen.getByText('已打卡 0 天')).toBeTruthy();
    expect(screen.getAllByText('今日打卡').length).toBeGreaterThan(0);
    // h-2 belongs to p-2 -> filtered out from p-1
    expect(screen.queryByText('其他项目习惯')).toBeNull();
  });

  it('pressing 今日打卡 on a habit day calls completeAction with habit kind', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });
    await waitFor(() => expect(screen.getByText('读文献习惯')).toBeTruthy());

    fireEvent.press(screen.getAllByText('今日打卡')[0]!);

    await waitFor(() =>
      expect(mockedCompleteAction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actionKind: 'habit', actionId: expect.stringContaining('hd-h-1-') }),
      ),
    );
  });

  it('a successful habit check-in re-reads the habit block (counters would be stale otherwise)', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });
    await waitFor(() => expect(screen.getByText('读文献习惯')).toBeTruthy());
    // Baseline AFTER mount: the mount-time read must not count as a reload.
    const base = { ...habitReads };

    fireEvent.press(screen.getAllByText('今日打卡')[0]!);

    await waitFor(() => expect(habitReads.habits).toBeGreaterThan(base.habits));
  });

  it('a failed habit check-in does not re-read: same rows come back and the error state survives', async () => {
    mockedCompleteAction.mockRejectedValueOnce(new Error('complete rejected'));
    renderRouter('app', { initialUrl: '/projects/p-1' });
    await waitFor(() => expect(screen.getByText('读文献习惯')).toBeTruthy());
    const base = { ...habitReads };

    fireEvent.press(screen.getAllByText('今日打卡')[0]!);

    // Wait for the error text — that proves the `.then` callback has run,
    // so a still-zero counter means "did not reload", not "not yet reloaded".
    await waitFor(() => expect(screen.getByText(/complete rejected/)).toBeTruthy());
    expect(habitReads.habits).toBe(base.habits);
    expect(habitReads.days).toBe(base.days);
  });

  it('shows empty state when project has no habits', async () => {
    renderRouter('app', { initialUrl: '/projects/p-3' });

    await waitFor(() => expect(screen.getByText('项目习惯')).toBeTruthy());
    expect(screen.getByText('暂无项目习惯')).toBeTruthy();
    expect(screen.getByText('这个项目还没有习惯 —— 点「＋ 添加习惯」建立 21 天挑战。')).toBeTruthy();
  });

  it('the inline add-habit form submits with the projectId and refreshes list', async () => {
    renderRouter('app', { initialUrl: '/projects/p-1' });
    await waitFor(() => expect(screen.getByText('＋ 添加习惯')).toBeTruthy());

    fireEvent.press(screen.getByText('＋ 添加习惯'));
    expect(screen.getByPlaceholderText('习惯名（如 每日晨读文献）')).toBeTruthy();

    fireEvent.changeText(screen.getByPlaceholderText('习惯名（如 每日晨读文献）'), '每日写代码');
    fireEvent.changeText(screen.getByPlaceholderText('每日行动（如 读一章论文，留空同习惯名）'), '提交一个 PR');
    fireEvent.press(screen.getByText('开始挑战'));

    await waitFor(() =>
      expect(mockedStartHabit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          title: '每日写代码',
          actionTitle: '提交一个 PR',
          projectId: 'p-1',
          cycleDays: 21,
          status: 'active',
        }),
        expect.anything(),
      ),
    );
  });
});
