/**
 * Regression test — PowerSync watch `error: null` must not crash a screen.
 *
 * `@powersync/react` types the watched-query `error` as `Error | undefined`,
 * but the runtime watch state delivers `null`. The data hooks used to read
 * `error.message` behind an `error === undefined` guard, which throws
 * `Cannot read properties of null` on `null` and — with no error boundary —
 * unmounts the whole tree (blank app). The unit/smoke mocks always returned
 * `error: undefined`, so they never hit the `null` path.
 *
 * This test mocks `useQuery` to return `error: null` (the exact crashing
 * shape) and renders every tab. Any hook that dereferences `null.message`
 * throws during render and fails the test. The fix is a truthy check
 * (`error ? String(error.message) : null`).
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
    settingsWatchQuery: () => ({
      compile: () => ({ sql: 'SELECT 1', parameters: [] }),
      execute: async () => [],
    }),
    setAppSetting: async () => undefined,
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
    somedayItemsWatchQuery: compilable,
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
  // The exact runtime shape that used to crash the hooks: `error` is `null`,
  // not `undefined`.
  const queryResult = {
    data: [],
    isLoading: false,
    isFetching: false,
    error: null,
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

describe('watch query error: null does not crash a screen (regression)', () => {
  it.each(TABS)('renders the $url tab with a null watch error', async ({ url, emptyState }) => {
    renderRouter('app', { initialUrl: url });
    await act(async () => {});
    // If a hook dereferenced null.message this throws and the test fails;
    // reaching the assertion means every tab rendered its empty state.
    expect(screen.getByText(emptyState)).toBeTruthy();
  });
});
