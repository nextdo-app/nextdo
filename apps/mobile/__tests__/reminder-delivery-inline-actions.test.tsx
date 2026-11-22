/**
 * Issue #99: the delivery hook's inline-action handling — the notification
 * buttons run the SAME DB transactions as the screens, snooze uses the app's
 * 10-minute common shortcut, and a failed write becomes a visible in-app
 * notice (the notification is already gone by then).
 */
import { act, renderHook } from '@testing-library/react-native';
import { ValidationNextdoError } from '@nextdo/core';

const mockRouterReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockRouterReplace }),
}));

const mockPowersync = { onChange: () => () => undefined };
jest.mock('@powersync/react', () => ({
  usePowerSync: () => mockPowersync,
}));

jest.mock('@nextdo/db', () => ({
  isReactNativeRuntime: () => false,
  wrapDb: () => ({}),
  listScheduledReminders: jest.fn(async () => []),
  completeAction: jest.fn(async () => undefined),
  snoozeAction: jest.fn(async () => undefined),
  skipAction: jest.fn(async () => undefined),
}));

jest.mock('@/lib/calendar-sync', () => ({
  getCalendarPermission: jest.fn(async () => 'denied'),
}));

interface CapturedHandlers {
  onNotificationOpened: (route?: string) => void;
  onNotificationAction: (action: {
    kind: 'complete' | 'snooze' | 'skip';
    actionKind: 'next' | 'calendar' | 'habit';
    actionId: string;
  }) => void;
}

jest.mock('@/lib/reminders/adapters', () => {
  const state: { handlers: unknown } = { handlers: null };
  // A SINGLETON, like the real adapter: the hook's effects depend on this
  // identity, so returning a fresh object every render would loop forever.
  const adapter = {
    platform: 'native',
    init: async (handlers: unknown) => {
      state.handlers = handlers;
    },
    listPendingIds: async () => new Set<string>(),
    apply: async () => undefined,
    permission: async () => ({ platform: 'native', status: 'granted', canAskAgain: true }),
    requestPermission: async () => ({
      platform: 'native',
      status: 'granted',
      canAskAgain: true,
    }),
    openSystemSettings: async () => undefined,
    dispose: () => undefined,
  };
  return {
    getDeliveryAdapter: () => adapter,
    __state: state,
  };
});

const adapterMock = jest.requireMock<{ __state: { handlers: CapturedHandlers | null } }>(
  '@/lib/reminders/adapters',
);

import {
  __setNotificationSettingsStoreForTests,
  DEFAULT_NOTIFICATION_SETTINGS,
} from '@/lib/notification-settings';
import { completeAction, skipAction, snoozeAction } from '@nextdo/db';
import { useReminderDelivery } from '@/hooks/use-reminder-delivery';

const mockComplete = completeAction as jest.Mock;
const mockSnooze = snoozeAction as jest.Mock;
const mockSkip = skipAction as jest.Mock;

const memoryStore = {
  async getItem(): Promise<string> {
    return JSON.stringify(DEFAULT_NOTIFICATION_SETTINGS);
  },
  async setItem(): Promise<void> {
    // The switch never changes in these tests.
  },
};

/** Let init + the queued transaction settle (a few microtask rounds). */
async function flush(rounds = 8): Promise<void> {
  let chain: Promise<unknown> = Promise.resolve();
  for (let i = 0; i < rounds; i++) {
    chain = chain.then(() => act(async () => {}));
  }
  await chain;
}

function handlers(): CapturedHandlers {
  const captured = adapterMock.__state.handlers;
  if (captured === null) throw new Error('adapter.init was not called');
  return captured;
}

describe('notification inline actions — delivery hook (issue #99)', () => {
  beforeEach(() => {
    mockRouterReplace.mockClear();
    mockComplete.mockClear();
    mockSnooze.mockClear();
    mockSkip.mockClear();
    mockComplete.mockResolvedValue(undefined);
    mockSnooze.mockResolvedValue(undefined);
    mockSkip.mockResolvedValue(undefined);
    adapterMock.__state.handlers = null;
    __setNotificationSettingsStoreForTests(memoryStore);
  });

  it('completes through the canonical transaction', async () => {
    const { result } = renderHook(() => useReminderDelivery());
    await flush();

    act(() => {
      handlers().onNotificationAction({
        kind: 'complete',
        actionKind: 'next',
        actionId: 'act-1',
      });
    });
    await flush();

    expect(mockComplete).toHaveBeenCalledTimes(1);
    const [db, args] = mockComplete.mock.calls[0] as [
      unknown,
      { actionKind: string; actionId: string; now: Date },
    ];
    expect(db).toEqual({});
    expect(args).toMatchObject({ actionKind: 'next', actionId: 'act-1' });
    expect(args.now).toBeInstanceOf(Date);
    expect(mockSnooze).not.toHaveBeenCalled();
    expect(mockSkip).not.toHaveBeenCalled();
    expect(result.current.actionNotice).toBeNull();
  });

  it('snoozes 10 minutes from the action moment', async () => {
    renderHook(() => useReminderDelivery());
    await flush();

    act(() => {
      handlers().onNotificationAction({
        kind: 'snooze',
        actionKind: 'calendar',
        actionId: 'act-2',
      });
    });
    await flush();

    expect(mockSnooze).toHaveBeenCalledTimes(1);
    const [, args] = mockSnooze.mock.calls[0] as [
      unknown,
      { actionKind: string; actionId: string; snoozedUntil: Date; now: Date },
    ];
    expect(args.actionKind).toBe('calendar');
    expect(args.actionId).toBe('act-2');
    expect(args.snoozedUntil.getTime() - args.now.getTime()).toBe(10 * 60_000);
  });

  it('skips through the canonical transaction', async () => {
    renderHook(() => useReminderDelivery());
    await flush();

    act(() => {
      handlers().onNotificationAction({
        kind: 'skip',
        actionKind: 'habit',
        actionId: 'act-3',
      });
    });
    await flush();

    expect(mockSkip).toHaveBeenCalledTimes(1);
    expect(mockSkip.mock.calls[0][1]).toMatchObject({
      actionKind: 'habit',
      actionId: 'act-3',
    });
  });

  it('shows a Chinese notice when the write fails, and can dismiss it', async () => {
    mockComplete.mockRejectedValueOnce(
      new ValidationNextdoError('action.not-found', 'The action no longer exists'),
    );
    const { result } = renderHook(() => useReminderDelivery());
    await flush();

    act(() => {
      handlers().onNotificationAction({
        kind: 'complete',
        actionKind: 'next',
        actionId: 'gone',
      });
    });
    await flush();

    expect(result.current.actionNotice).toBe('这个行动不存在了（可能已被删除）');

    act(() => {
      result.current.dismissActionNotice();
    });
    await flush();
    expect(result.current.actionNotice).toBeNull();
  });

  it.each(['snooze', 'skip'] as const)(
    'surfaces the stale-action notice when an old notification %ss a completed action',
    async (kind) => {
      // Issue #99 review: the notification was delivered before the action
      // was completed elsewhere. The DB transaction now refuses it with
      // `action.not-open`; the user must see why the button did nothing.
      const target = kind === 'snooze' ? mockSnooze : mockSkip;
      target.mockRejectedValueOnce(
        new ValidationNextdoError(
          'action.not-open',
          'Cannot act on a next action whose status is done',
        ),
      );
      const { result } = renderHook(() => useReminderDelivery());
      await flush();

      act(() => {
        handlers().onNotificationAction({
          kind,
          actionKind: 'next',
          actionId: 'done-1',
        });
      });
      await flush();

      expect(result.current.actionNotice).toBe('这个行动已完成或被删除，请刷新后再试');
    },
  );

  it('clears an old failure after the next successful action', async () => {
    mockSkip.mockRejectedValueOnce(new Error('database is locked'));
    const { result } = renderHook(() => useReminderDelivery());
    await flush();

    act(() => {
      handlers().onNotificationAction({ kind: 'skip', actionKind: 'next', actionId: 'a' });
    });
    await flush();
    expect(result.current.actionNotice).toBe('database is locked');

    act(() => {
      handlers().onNotificationAction({
        kind: 'complete',
        actionKind: 'next',
        actionId: 'a',
      });
    });
    await flush();
    expect(result.current.actionNotice).toBeNull();
  });

  it('still opens the app for a plain tap (deep link and default route)', async () => {
    renderHook(() => useReminderDelivery());
    await flush();

    act(() => {
      handlers().onNotificationOpened('/focus/act-1?kind=next');
    });
    expect(mockRouterReplace).toHaveBeenCalledWith('/focus/act-1?kind=next');

    act(() => {
      handlers().onNotificationOpened(undefined);
    });
    expect(mockRouterReplace).toHaveBeenLastCalledWith('/(tabs)/now');
  });
});
