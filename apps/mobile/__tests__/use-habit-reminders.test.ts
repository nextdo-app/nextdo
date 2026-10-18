/**
 * Habit reminder preferences hook — the issue #45 R3 addition: turning
 * habit check-in reminders ON is one of the three moments the app asks the
 * OS for notification permission (the other two are snooze and calendar
 * submit). Fire-and-forget: a denial must never block the save.
 *
 * The db sync pass is mocked out — it needs a PowerSync database and is not
 * what this test is about.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

const STABLE_POWERSYNC = {};
jest.mock('@powersync/react', () => ({
  // A STABLE reference: a fresh object per render would change `wrapDb`'s
  // memo / the sync callback identity and re-run the effect forever.
  usePowerSync: () => STABLE_POWERSYNC,
}));

jest.mock('@nextdo/db', () => ({
  DEFAULT_HABIT_REMINDER_OPTIONS: { enabled: true, allDayReminderHhmm: '21:00' },
  listHabitDays: jest.fn(async () => []),
  listHabits: jest.fn(async () => []),
  syncHabitCheckInReminders: jest.fn(async () => undefined),
  wrapDb: jest.fn(() => ({})),
}));

jest.mock('@/lib/reminders/permission', () => ({
  maybeRequestNotificationPermission: jest.fn(async () => undefined),
}));

jest.mock('@/lib/habit-reminders', () => ({
  loadHabitReminderOptions: jest.fn(async () => ({ enabled: false, allDayReminderHhmm: '21:00' })),
  saveHabitReminderOptions: jest.fn(async () => undefined),
}));

import { maybeRequestNotificationPermission } from '@/lib/reminders/permission';
import { useHabitReminders } from '@/hooks/use-habit-reminders';

const mockRequestPermission = maybeRequestNotificationPermission as jest.MockedFunction<
  typeof maybeRequestNotificationPermission
>;

const NOW = new Date(2026, 9, 17, 9, 0, 0);

describe('useHabitReminders — the permission ask (issue #45 R3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('asks the OS when habit reminders are switched ON', async () => {
    const { result } = renderHook(() => useHabitReminders(NOW));
    await waitFor(() => expect(result.current.options).not.toBeNull());

    await act(async () => {
      await result.current.update({ enabled: true });
    });

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  });

  it('does NOT ask when the user switches them OFF (no reminder gets armed)', async () => {
    const { result } = renderHook(() => useHabitReminders(NOW));
    await waitFor(() => expect(result.current.options).not.toBeNull());

    await act(async () => {
      await result.current.update({ enabled: false });
    });

    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it('does NOT ask for a plain 时刻 change while reminders are on — only the switch arms them', async () => {
    const { result } = renderHook(() => useHabitReminders(NOW));
    await waitFor(() => expect(result.current.options).not.toBeNull());

    await act(async () => {
      await result.current.update({ enabled: true });
    });
    mockRequestPermission.mockClear();

    await act(async () => {
      await result.current.update({ allDayReminderHhmm: '20:30' });
    });

    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it('a rejected permission request never blocks the save (fire-and-forget)', async () => {
    mockRequestPermission.mockRejectedValueOnce(new Error('denied'));
    const { result } = renderHook(() => useHabitReminders(NOW));
    await waitFor(() => expect(result.current.options).not.toBeNull());

    await act(async () => {
      await result.current.update({ enabled: true });
    });

    expect(result.current.options?.enabled).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
