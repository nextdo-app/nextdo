/**
 * Issue #99: the native adapter's inline-action plumbing —
 * category registration, the category identifier on scheduled reminders,
 * and response dispatch (hot listener + cold-start read) for the
 * 完成 / 推迟 / 跳过 buttons.
 */
import { mockExpoNotifications } from './mocks/expo-notifications';

jest.mock('expo-notifications', () => mockExpoNotifications);

import * as Notifications from 'expo-notifications';
import { createNativeAdapter } from '@/lib/reminders/adapters/native';
import {
  REMINDER_ACTION_IDS,
  REMINDER_CATEGORY_ID,
} from '@/lib/reminders/inline-actions';

const mockNotifications = Notifications as unknown as {
  setNotificationCategoryAsync: jest.Mock;
  scheduleNotificationAsync: jest.Mock;
  addNotificationResponseReceivedListener: jest.Mock;
  getLastNotificationResponseAsync: jest.Mock;
  clearLastNotificationResponseAsync: jest.Mock;
  setNotificationHandler: jest.Mock;
};

const DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';

function response(
  actionIdentifier: string,
  data: Record<string, unknown> = {},
  notificationId = 'rem-1',
): Notifications.NotificationResponse {
  return {
    actionIdentifier,
    notification: {
      date: 0,
      request: {
        identifier: notificationId,
        content: {
          title: '稍后提醒',
          body: '整理报告',
          data,
        },
        trigger: null,
      },
    },
  } as unknown as Notifications.NotificationResponse;
}

const reminderItem = {
  row: {
    id: 'rem-1',
    kind: 'next' as const,
    actionId: 'act-1',
    firesAt: '2026-11-21T10:00:00.000Z',
    intensity: 'normal' as const,
    title: '整理报告',
    note: null,
    estMinutes: 30,
  },
  title: '整理报告',
};

/** The listener registered by the last init call. */
function lastResponseListener(): (response: Notifications.NotificationResponse) => void {
  const calls = mockNotifications.addNotificationResponseReceivedListener.mock.calls;
  return calls[calls.length - 1][0] as (
    response: Notifications.NotificationResponse,
  ) => void;
}

describe('native adapter inline actions (issue #99)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNotifications.getLastNotificationResponseAsync.mockResolvedValue(null);
  });

  it('registers the 完成 / 推迟 / 跳过 category before scheduling', async () => {
    const adapter = createNativeAdapter();
    await adapter.init({ onNotificationOpened: jest.fn() });

    expect(mockNotifications.setNotificationCategoryAsync).toHaveBeenCalledWith(
      REMINDER_CATEGORY_ID,
      [
        expect.objectContaining({
          identifier: REMINDER_ACTION_IDS.complete,
          buttonTitle: '完成',
        }),
        expect.objectContaining({
          identifier: REMINDER_ACTION_IDS.snooze,
          buttonTitle: '推迟 10 分钟',
        }),
        expect.objectContaining({
          identifier: REMINDER_ACTION_IDS.skip,
          buttonTitle: '跳过',
        }),
      ],
    );
    adapter.dispose();
  });

  it('attaches the category to every scheduled reminder', async () => {
    const adapter = createNativeAdapter();
    await adapter.init({ onNotificationOpened: jest.fn() });
    await adapter.apply({ toSchedule: [reminderItem], toCancel: [], toFireNow: [] });

    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'rem-1',
        content: expect.objectContaining({
          categoryIdentifier: REMINDER_CATEGORY_ID,
          data: { reminderId: 'rem-1', actionKind: 'next', actionId: 'act-1' },
        }),
      }),
    );
    adapter.dispose();
  });

  it('routes a hot action response to the action callback, not the opener', async () => {
    const onNotificationOpened = jest.fn();
    const onNotificationAction = jest.fn();
    const adapter = createNativeAdapter();
    await adapter.init({ onNotificationOpened, onNotificationAction });

    const hotResponse = response(
      REMINDER_ACTION_IDS.complete,
      {
        reminderId: 'rem-hot',
        actionKind: 'next',
        actionId: 'act-1',
      },
      'rem-hot',
    );
    lastResponseListener()(hotResponse);
    // The same response can also arrive through the cold-start read (expo
    // replays pending responses to the emitter); it must dispatch only once.
    lastResponseListener()(hotResponse);

    expect(onNotificationAction).toHaveBeenCalledTimes(1);
    expect(onNotificationAction).toHaveBeenCalledWith({
      kind: 'complete',
      actionKind: 'next',
      actionId: 'act-1',
    });
    expect(onNotificationOpened).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it('keeps a plain tap on the open path (deep link preserved)', async () => {
    const onNotificationOpened = jest.fn();
    const onNotificationAction = jest.fn();
    const adapter = createNativeAdapter();
    await adapter.init({ onNotificationOpened, onNotificationAction });

    lastResponseListener()(
      response(DEFAULT_ACTION, { route: '/focus/act-1?kind=next' }, 'rem-tap'),
    );

    expect(onNotificationOpened).toHaveBeenCalledWith('/focus/act-1?kind=next');
    expect(onNotificationAction).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it('opens the app for an unknown action identifier (degradation)', async () => {
    const onNotificationOpened = jest.fn();
    const onNotificationAction = jest.fn();
    const adapter = createNativeAdapter();
    await adapter.init({ onNotificationOpened, onNotificationAction });

    lastResponseListener()(
      response('some.other.action', { actionKind: 'next', actionId: 'act-1' }, 'rem-other'),
    );

    expect(onNotificationOpened).toHaveBeenCalledWith(undefined);
    expect(onNotificationAction).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it('opens the app for an action tap when no action handler is registered', async () => {
    const onNotificationOpened = jest.fn();
    const adapter = createNativeAdapter();
    await adapter.init({ onNotificationOpened });

    lastResponseListener()(
      response(
        REMINDER_ACTION_IDS.skip,
        { actionKind: 'next', actionId: 'act-1' },
        'rem-no-handler',
      ),
    );

    expect(onNotificationOpened).toHaveBeenCalledWith(undefined);
    adapter.dispose();
  });

  it('dispatches a cold-start action response exactly once and clears it', async () => {
    mockNotifications.getLastNotificationResponseAsync.mockResolvedValueOnce(
      response(
        REMINDER_ACTION_IDS.snooze,
        { actionKind: 'next', actionId: 'act-1' },
        'rem-cold',
      ),
    );
    const onNotificationAction = jest.fn();
    const adapter = createNativeAdapter();
    await adapter.init({
      onNotificationOpened: jest.fn(),
      onNotificationAction,
    });

    expect(onNotificationAction).toHaveBeenCalledWith({
      kind: 'snooze',
      actionKind: 'next',
      actionId: 'act-1',
    });
    expect(mockNotifications.clearLastNotificationResponseAsync).toHaveBeenCalled();
    adapter.dispose();
  });

  it('keeps delivering when category registration fails', async () => {
    mockNotifications.setNotificationCategoryAsync.mockRejectedValueOnce(
      new Error('category unsupported'),
    );
    const adapter = createNativeAdapter();
    await expect(
      adapter.init({ onNotificationOpened: jest.fn() }),
    ).resolves.toBeUndefined();

    await adapter.apply({ toSchedule: [reminderItem], toCancel: [], toFireNow: [] });
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });

  it('ignores a response after dispose (listener removed)', async () => {
    const onNotificationAction = jest.fn();
    const adapter = createNativeAdapter();
    await adapter.init({ onNotificationOpened: jest.fn(), onNotificationAction });
    const listener = lastResponseListener();
    const remove = mockNotifications.addNotificationResponseReceivedListener.mock.results.at(-1)
      ?.value as { remove: jest.Mock };

    adapter.dispose();
    expect(remove.remove).toHaveBeenCalled();
    // The real listener would no longer be invoked; calling the captured
    // function directly must also be inert with no handlers registered.
    listener(
      response(REMINDER_ACTION_IDS.complete, { actionKind: 'next', actionId: 'a' }, 'rem-disposed'),
    );
    expect(onNotificationAction).not.toHaveBeenCalled();
  });
});
