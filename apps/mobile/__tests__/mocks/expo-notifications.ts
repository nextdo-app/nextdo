/**
 * Shared jest mock for `expo-notifications` (task 09-30).
 *
 * Why every screen test needs it: the root layout now mounts
 * `useReminderDelivery` (inside the PowerSync provider), and jest runs
 * with `Platform.OS = 'ios'` — so the REAL native adapter is instantiated
 * in every `renderRouter` test and drives these APIs. The mock resolves
 * like an idle real module: no pending notifications, permission
 * undetermined.
 *
 * Usage (one line per test file — the `mock`-prefixed export is what
 * babel-plugin-jest-hoist allows the hoisted factory to reference):
 *
 *   import { mockExpoNotifications } from './mocks/expo-notifications';
 *   jest.mock('expo-notifications', () => mockExpoNotifications);
 *
 * Tests that need a different state (e.g. a scheduled notification)
 * override individual `jest.fn()` members — `mockExpoNotifications
 * .getAllScheduledNotificationsAsync.mockResolvedValueOnce(...)`.
 */
export const mockExpoNotifications = {
  // Enums — the native adapter reads them at call time (channel creation
  // on Android, DATE triggers when scheduling).
  AndroidImportance: {
    UNKNOWN: 0,
    UNSPECIFIED: 1,
    NONE: 2,
    MIN: 3,
    LOW: 4,
    DEFAULT: 5,
    HIGH: 6,
    MAX: 7,
  },
  IosAuthorizationStatus: {
    NOT_DETERMINED: 0,
    DENIED: 1,
    AUTHORIZED: 2,
    PROVISIONAL: 3,
    EPHEMERAL: 4,
  },
  SchedulableTriggerInputTypes: {
    CALENDAR: 'calendar',
    TIME_INTERVAL: 'timeInterval',
    DAILY: 'daily',
    WEEKLY: 'weekly',
    MONTHLY: 'monthly',
    YEARLY: 'yearly',
    DATE: 'date',
  },
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',

  // Handler + listeners (the adapter registers them on init).
  setNotificationHandler: jest.fn(),
  // Issue #99: the reminder inline-action category (idle: accepts silently).
  setNotificationCategoryAsync: jest.fn(async (identifier: string) => ({
    identifier,
    actions: [],
  })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),

  // Scheduling (idle OS state: nothing pending).
  scheduleNotificationAsync: jest.fn(async () => 'mock-notification-id'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),

  // Channels (the Android-only path; ios under jest skips creation).
  setNotificationChannelAsync: jest.fn(async () => null),
  getNotificationChannelsAsync: jest.fn(async () => []),

  // Permissions (undetermined → the Settings block renders 尚未授权…).
  getPermissionsAsync: jest.fn(async () => ({
    status: 'undetermined',
    granted: false,
    canAskAgain: true,
    expires: 'never',
  })),
  requestPermissionsAsync: jest.fn(async () => ({
    status: 'granted',
    granted: true,
    canAskAgain: true,
    expires: 'never',
  })),

  // Cold-start click (none pending in the idle state).
  getLastNotificationResponseAsync: jest.fn(async () => null),
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
};
