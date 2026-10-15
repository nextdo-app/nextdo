/**
 * Smoke test: the four tabs (Now / Inbox / Projects / Review) render
 * without crashing — empty states are the expected content (no synced data
 * exists in the test environment).
 *
 * The PowerSync layer is mocked at the package boundary — this test
 * exercises the SHELL (route tree, root layout, tab bar, screens, empty
 * states), not sync. The data path is covered by the packages/db query
 * tests. The mocks are self-contained factories (jest.mock hoisting).
 */
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
    addInboxItem: async () => undefined,
    trashInboxItem: async () => undefined,
    listInboxItems: async () => [],
    listProjects: async () => [],
    listProjectActions: async () => [],
    listContexts: async () => [],
    addContext: async () => undefined,
    listHabits: async () => [],
    listHabitDays: async () => [],
    DEFAULT_HABIT_REMINDER_OPTIONS: { enabled: true, allDayReminderHhmm: '21:00' },
    syncHabitCheckInReminders: async () => ({ inserted: 0, removed: 0 }),
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
  // Stable identity across renders — the real hook only returns a new
  // result reference when the query's result set changes; a fresh object
  // per render would loop the Now hook's recompute effect.
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

import { act, renderRouter, screen } from 'expo-router/testing-library';

/** Each tab's expected empty-state title (unique per screen). */
const TABS = [
  { url: '/(tabs)/now', emptyState: '执行池是空的' },
  { url: '/(tabs)/inbox', emptyState: '收件箱是空的' },
  { url: '/(tabs)/projects', emptyState: '还没有进行中的项目' },
  { url: '/(tabs)/review', emptyState: '还没有回顾记录' },
];

describe('mobile shell smoke', () => {
  it.each(TABS)('renders the $url tab without crashing', async ({ url, emptyState }) => {
    // RNTL wraps render in act itself — do not nest another act around it.
    renderRouter('app', { initialUrl: url });
    // Flush the mocked async pool computation BEFORE asserting: the Now
    // screen distinguishes "loading" from "empty pool" (the pool mock
    // resolves in a microtask).
    await act(async () => {});
    expect(screen.getByText(emptyState)).toBeTruthy();
  });

  it('redirects root / to the Inbox tab', async () => {
    const view = renderRouter('app', { initialUrl: '/' });
    await act(async () => {});
    expect(view.getPathname()).toBe('/inbox');
  });
});
