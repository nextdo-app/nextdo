/**
 * Issue #60 — the OS-level focus notifications.
 *
 * The in-app tone is the foreground cue; these are the copy that reaches the
 * user when the app is muted / backgrounded. Jest runs as Platform 'ios', so
 * the native branch drives `expo-notifications` (shared mock, overridden per
 * test). The web branch is covered through the typed `window.Notification`
 * stub in the page-timer test.
 */
import { mockExpoNotifications } from '../__tests__/mocks/expo-notifications';

jest.mock('expo-notifications', () => mockExpoNotifications);

import * as Notifications from 'expo-notifications';
import {
  cancelBreakEnd,
  notifyBreakComplete,
  notifyFocusComplete,
  scheduleBreakEnd,
} from './focus-notification';

const schedule = Notifications.scheduleNotificationAsync as jest.Mock;
const cancel = Notifications.cancelScheduledNotificationAsync as jest.Mock;

describe('focus notifications (#60)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('专注结束 schedules an immediate notification carrying the focus deep link', async () => {
    await notifyFocusComplete({
      actionKind: 'next',
      actionId: 'act-1',
      actionTitle: '写季度总结',
      minutes: 25,
    });

    expect(schedule).toHaveBeenCalledTimes(1);
    const call = schedule.mock.calls[0]?.[0] as {
      content: { title: string; body: string; data: Record<string, unknown> };
      trigger: unknown;
    };
    expect(call.content.title).toBe('专注结束');
    expect(call.content.body).toContain('25 分钟');
    expect(call.content.body).toContain('写季度总结');
    // Tapping it must land back on THIS action's focus screen.
    expect(call.content.data.route).toBe('/focus/act-1?kind=next');
    expect(call.trigger).toBeNull();
  });

  it('休息结束 is scheduled ahead with the fixed identifier and a DATE trigger', async () => {
    const endsAt = new Date('2026-10-19T10:25:00.000Z');
    await scheduleBreakEnd(endsAt);

    // The previous break is cancelled first (rescheduling replaces it).
    expect(cancel).toHaveBeenCalledWith('nextdo-focus-break-end');
    expect(schedule).toHaveBeenCalledTimes(1);
    const call = schedule.mock.calls[0]?.[0] as {
      identifier: string;
      content: { title: string };
      trigger: { type: string; date: Date };
    };
    expect(call.identifier).toBe('nextdo-focus-break-end');
    expect(call.content.title).toBe('休息结束');
    expect(call.trigger.type).toBe('date');
    expect(call.trigger.date).toEqual(endsAt);
  });

  it('cancelBreakEnd removes the armed break copy (early end / leaving the screen)', async () => {
    await cancelBreakEnd();
    expect(cancel).toHaveBeenCalledWith('nextdo-focus-break-end');
  });

  it('notifyBreakComplete is a no-op on native (the scheduled copy fires)', () => {
    notifyBreakComplete();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('a failing OS schedule never throws into the timer', async () => {
    schedule.mockRejectedValueOnce(new Error('os unavailable'));
    await expect(
      notifyFocusComplete({
        actionKind: 'next',
        actionId: 'act-1',
        actionTitle: '写季度总结',
        minutes: 25,
      }),
    ).resolves.toBeUndefined();
  });
});
