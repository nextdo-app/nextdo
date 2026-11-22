/**
 * Integration test — the WEB (browser) delivery wiring (issue #92)
 * (hooks/use-reminder-delivery + lib/reminders/adapters/web).
 *
 * Covers the broken link this issue reports:
 *   - the web adapter is selected on Platform.OS 'web' without the tauri
 *     webview marker;
 *   - the mount reconcile delivers a past-within-grace row;
 *   - the 30 s in-session tick delivers a FUTURE row that crosses fires_at
 *     while the page is untouched (no data change, no focus, no action);
 *   - the session dedupe keeps a delivered reminder from firing again;
 *   - a data change (onChange) also reconciles;
 *   - the in-app master switch off suppresses delivery, and flipping it on
 *     delivers on the poke's reconcile;
 *   - a rejected browser notification is exposed through the shared
 *     feedback store (the Settings hint).
 *
 * Platform.OS is forced to 'web' at runtime — the jest-expo default is iOS.
 * The browser Notification constructor is faked on `globalThis` (jest-expo
 * aliases `window` to the global object; the adapter reads `window`).
 */
import { act, renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';

const mockRouterReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockRouterReplace }),
}));

let onChangeListener: (() => void) | null = null;
const mockPowersync = {
  onChange: (_options: { onChange: () => void }) => {
    onChangeListener = _options.onChange;
    return () => undefined;
  },
};
jest.mock('@powersync/react', () => ({
  usePowerSync: () => mockPowersync,
}));

const mockRowsRef: { current: Array<Record<string, unknown>> } = { current: [] };
jest.mock('@nextdo/db', () => ({
  wrapDb: () => ({}),
  listScheduledReminders: jest.fn(async () => mockRowsRef.current),
}));

import { useReminderDelivery } from '@/hooks/use-reminder-delivery';
import { __resetDeliveryAdapterForTests, getDeliveryAdapter } from '@/lib/reminders/adapters';
import {
  __resetReminderDeliveryFeedbackForTests,
  getReminderDeliveryFailure,
} from '@/lib/reminders/delivery-feedback';
import {
  __setNotificationSettingsStoreForTests,
  DEFAULT_NOTIFICATION_SETTINGS,
  saveNotificationSettings,
  type NotificationSettings,
} from '@/lib/notification-settings';

const flush = async (): Promise<void> => {
  await act(async () => {});
};

/** The preference-store backend the delivery hook reads (issue #24 R2). */
function memoryStoreWith(patch: Partial<NotificationSettings>): {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
} {
  let raw: string | null = JSON.stringify({ ...DEFAULT_NOTIFICATION_SETTINGS, ...patch });
  return {
    async getItem() {
      return raw;
    },
    async setItem(_key, value) {
      raw = value;
    },
  };
}

function seedRow(id: string, firesInMs: number): void {
  mockRowsRef.current = [
    {
      id,
      kind: 'next',
      actionId: `a-${id}`,
      firesAt: new Date(Date.now() + firesInMs).toISOString(),
      intensity: 'normal',
      title: '测试行动',
    },
  ];
}

type FakeNotification = jest.Mock & {
  permission: 'granted' | 'denied' | 'default';
  requestPermission: jest.Mock;
};

function installNotification(
  permission: 'granted' | 'denied' | 'default' = 'granted',
  onConstruct?: () => void,
): FakeNotification {
  const ctor = jest.fn(() => {
    onConstruct?.();
  }) as unknown as FakeNotification;
  ctor.permission = permission;
  ctor.requestPermission = jest.fn(async () => permission);
  (globalThis as unknown as { Notification?: unknown }).Notification = ctor;
  return ctor;
}

describe('web delivery wiring (issue #92)', () => {
  let originalOS: string;

  beforeEach(() => {
    jest.useFakeTimers();
    mockRowsRef.current = [];
    onChangeListener = null;
    __resetDeliveryAdapterForTests();
    __resetReminderDeliveryFeedbackForTests();
    __setNotificationSettingsStoreForTests(memoryStoreWith(DEFAULT_NOTIFICATION_SETTINGS));
    // jest-expo aliases window to the global object; keep the web adapter's
    // `window.Notification` lookup pointed at the fake below and make sure
    // no tauri marker survives.
    (globalThis as { window?: unknown; __TAURI_INTERNALS__?: unknown }).window = globalThis;
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      configurable: true,
      writable: true,
    });
    originalOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  });

  afterEach(() => {
    jest.useRealTimers();
    (globalThis as unknown as { Notification?: unknown }).Notification = undefined;
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  });

  it('selects the web adapter without the tauri marker', () => {
    installNotification();
    expect(getDeliveryAdapter().platform).toBe('web');
  });

  it('delivers a past-within-grace row on mount, exactly once', async () => {
    const notify = installNotification();
    seedRow('web-mount', -60_000);

    renderHook(() => useReminderDelivery());
    await flush();

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('稍后提醒', expect.objectContaining({ body: '测试行动' }));

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('delivers a FUTURE row on the idle tick, with no data change or focus event', async () => {
    const notify = installNotification();
    seedRow('web-idle', 10_000);

    renderHook(() => useReminderDelivery());
    await flush();
    expect(notify).not.toHaveBeenCalled();

    // 30 s later the row crossed fires_at — the tick alone must deliver it.
    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('稍后提醒', expect.objectContaining({ body: '测试行动' }));

    // …and the next tick does not repeat it.
    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('reconciles on a data change (the web watch is connected)', async () => {
    const notify = installNotification();
    renderHook(() => useReminderDelivery());
    await flush();
    expect(notify).not.toHaveBeenCalled();

    seedRow('web-change', -60_000);
    onChangeListener?.();
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    await flush();

    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('delivers nothing while the in-app master switch is off, and delivers on the switch-on poke', async () => {
    const notify = installNotification();
    seedRow('web-switch', -60_000);
    __setNotificationSettingsStoreForTests(memoryStoreWith({ masterEnabled: false }));

    renderHook(() => useReminderDelivery());
    await flush();
    expect(notify).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    await flush();
    expect(notify).not.toHaveBeenCalled();

    await act(async () => {
      await saveNotificationSettings({ masterEnabled: true });
    });
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('exposes a rejected browser notification through the Settings feedback store', async () => {
    installNotification('granted', () => {
      throw new Error('browser refused');
    });
    seedRow('web-failure', -60_000);

    renderHook(() => useReminderDelivery());
    await flush();

    expect(getReminderDeliveryFailure()).toMatchObject({
      reminderId: 'web-failure',
      message: 'browser refused',
    });
  });

  it('suppresses a send whose service worker resolves after the switch is turned off', async () => {
    const notify = installNotification();
    seedRow('web-switch-race', -60_000);
    const showNotification = jest.fn(async () => undefined);
    let resolveReady: (registration: { showNotification: typeof showNotification }) => void =
      () => undefined;
    const ready = new Promise<{ showNotification: typeof showNotification }>((resolve) => {
      resolveReady = resolve;
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        serviceWorker: { ready },
      },
      configurable: true,
      writable: true,
    });

    renderHook(() => useReminderDelivery());
    await flush();
    // The reconcile is parked on the pending service worker; turning the
    // switch off now must suppress the send when it resolves.
    await act(async () => {
      await saveNotificationSettings({ masterEnabled: false });
    });
    resolveReady({ showNotification });
    await flush();

    expect(showNotification).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not duplicate an in-flight send when the hook remounts', async () => {
    const notify = installNotification();
    seedRow('web-remount-race', -60_000);
    const showNotification = jest.fn(async () => undefined);
    let resolveReady: (registration: { showNotification: typeof showNotification }) => void =
      () => undefined;
    const ready = new Promise<{ showNotification: typeof showNotification }>((resolve) => {
      resolveReady = resolve;
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        serviceWorker: { ready },
      },
      configurable: true,
      writable: true,
    });

    const first = renderHook(() => useReminderDelivery());
    await flush();
    // Unmount while the first apply is still waiting; the second mount
    // reconciles the same due row and must NOT start a second send.
    first.unmount();
    renderHook(() => useReminderDelivery());
    await flush();
    resolveReady({ showNotification });
    await flush();

    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });
});
