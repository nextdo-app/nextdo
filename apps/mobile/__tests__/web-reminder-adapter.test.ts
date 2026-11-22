import { createWebAdapter } from '../lib/reminders/adapters/web';
import {
  __resetReminderDeliveryFeedbackForTests,
  getReminderDeliveryFailure,
} from '../lib/reminders/delivery-feedback';

describe('createWebAdapter', () => {
  const originalNotification = (globalThis as unknown as { Notification?: unknown }).Notification;
  const originalNavigator = globalThis.navigator;

  /** A granted page Notification constructor (the fallback path). */
  function installGrantedCtor(): jest.Mock {
    const ctor = jest.fn();
    Object.assign(ctor, { permission: 'granted', requestPermission: jest.fn() });
    (globalThis as unknown as { Notification?: unknown }).Notification = ctor;
    return ctor;
  }

  function installNavigator(extra: Record<string, unknown> = {}): void {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', ...extra },
      configurable: true,
      writable: true,
    });
  }

  /** A reconcile output that fires the given ids (web never schedules). */
  function fireOutput(...ids: string[]): {
    toCancel: string[];
    toSchedule: never[];
    toFireNow: Array<{
      row: {
        id: string;
        kind: 'next';
        actionId: string;
        firesAt: string;
        intensity: 'normal';
        title: string;
        note: null;
        estMinutes: null;
      };
      title: string;
    }>;
  } {
    return {
      toCancel: [],
      toSchedule: [],
      toFireNow: ids.map((id) => ({
        row: {
          id,
          kind: 'next' as const,
          actionId: `act-${id}`,
          firesAt: '2026-10-09T12:00:00.000Z',
          intensity: 'normal' as const,
          title: id,
          note: null,
          estMinutes: null,
        },
        title: id,
      })),
    };
  }

  beforeEach(() => {
    __resetReminderDeliveryFeedbackForTests();
  });

  afterEach(() => {
    (globalThis as unknown as { Notification?: unknown }).Notification = originalNotification;
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  it('reports undetermined for iOS Safari when Notification API is absent (awaiting home screen install)', async () => {
    delete (globalThis as unknown as { Notification?: unknown }).Notification;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
        maxTouchPoints: 5,
        standalone: false,
      },
      configurable: true,
      writable: true,
    });

    const adapter = createWebAdapter();
    const perm = await adapter.permission();

    expect(perm.platform).toBe('web');
    expect(perm.status).toBe('undetermined');
    expect(perm.canAskAgain).toBe(true);
  });

  it('reports denied when Notification API is absent on desktop/non-iOS browser', async () => {
    delete (globalThis as unknown as { Notification?: unknown }).Notification;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        maxTouchPoints: 0,
      },
      configurable: true,
      writable: true,
    });

    const adapter = createWebAdapter();
    const perm = await adapter.permission();

    expect(perm.platform).toBe('web');
    expect(perm.status).toBe('denied');
    expect(perm.canAskAgain).toBe(false);
  });

  it('reads granted status and requests permission when supported', async () => {
    const mockRequestPermission = jest.fn().mockResolvedValue('granted');
    const mockNotificationCtor = jest.fn();
    Object.assign(mockNotificationCtor, {
      permission: 'default',
      requestPermission: mockRequestPermission,
    });

    (globalThis as unknown as { Notification?: unknown }).Notification = mockNotificationCtor;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      },
      configurable: true,
      writable: true,
    });

    const adapter = createWebAdapter();
    let perm = await adapter.permission();
    expect(perm.status).toBe('undetermined');

    // Request permission
    perm = await adapter.requestPermission();
    expect(mockRequestPermission).toHaveBeenCalled();
    expect(perm.status).toBe('granted');
  });

  it('fires web notification on apply when granted', async () => {
    const notificationInstances: Array<{ onclick: (() => void) | null }> = [];
    const mockNotificationCtor = jest.fn().mockImplementation(() => {
      const instance = { onclick: null as (() => void) | null };
      notificationInstances.push(instance);
      return instance;
    });
    Object.assign(mockNotificationCtor, {
      permission: 'granted',
      requestPermission: jest.fn(),
    });

    (globalThis as unknown as { Notification?: unknown }).Notification = mockNotificationCtor;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      },
      configurable: true,
      writable: true,
    });

    const adapter = createWebAdapter();
    const testItem = {
      row: {
        id: 'rem-1',
        kind: 'next' as const,
        actionId: 'act-1',
        firesAt: '2026-10-09T12:00:00.000Z',
        intensity: 'normal' as const,
        title: '复习英语单词',
        note: null,
        estMinutes: 25,
      },
      title: '复习英语单词',
    };

    await adapter.apply({
      toCancel: [],
      toSchedule: [],
      toFireNow: [testItem],
    });

    expect(mockNotificationCtor).toHaveBeenCalledTimes(1);
    expect(mockNotificationCtor).toHaveBeenCalledWith(
      '稍后提醒',
      expect.objectContaining({
        body: '复习英语单词',
        icon: '/icons/icon-192.png',
      })
    );

    // Re-apply same item does not duplicate
    await adapter.apply({
      toCancel: [],
      toSchedule: [],
      toFireNow: [testItem],
    });
    expect(mockNotificationCtor).toHaveBeenCalledTimes(1);

    // Issue #99 degradation: no inline actions on the plain web surface, but
    // clicking the notification brings the app forward.
    const focus = jest.fn();
    const host = globalThis as unknown as { window: { focus?: () => void } };
    const originalFocus = host.window.focus;
    Object.defineProperty(host.window, 'focus', {
      value: focus,
      configurable: true,
      writable: true,
    });
    try {
      const instance = notificationInstances[0];
      expect(typeof instance?.onclick).toBe('function');
      instance?.onclick?.();
      expect(focus).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(host.window, 'focus', {
        value: originalFocus,
        configurable: true,
        writable: true,
      });
    }
  });

  it('reports a rejected send for the Settings hint, and a success clears it', async () => {
    const refused = new Error('browser refused the notification');
    const mockFailingCtor = jest.fn(() => {
      throw refused;
    });
    Object.assign(mockFailingCtor, {
      permission: 'granted',
      requestPermission: jest.fn(),
    });
    (globalThis as unknown as { Notification?: unknown }).Notification = mockFailingCtor;
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      configurable: true,
      writable: true,
    });

    const failing = createWebAdapter();
    await failing.apply({
      toCancel: [],
      toSchedule: [],
      toFireNow: [
        {
          row: {
            id: 'rem-fail',
            kind: 'next' as const,
            actionId: 'act-fail',
            firesAt: '2026-10-09T12:00:00.000Z',
            intensity: 'normal' as const,
            title: '会失败的行动',
            note: null,
            estMinutes: null,
          },
          title: '会失败的行动',
        },
      ],
    });

    expect(getReminderDeliveryFailure()).toMatchObject({
      reminderId: 'rem-fail',
      message: 'browser refused the notification',
    });

    // A later confirmed send proves the channel works again.
    const mockGoodCtor = jest.fn();
    Object.assign(mockGoodCtor, {
      permission: 'granted',
      requestPermission: jest.fn(),
    });
    (globalThis as unknown as { Notification?: unknown }).Notification = mockGoodCtor;
    const healthy = createWebAdapter();
    await healthy.apply({
      toCancel: [],
      toSchedule: [],
      toFireNow: [
        {
          row: {
            id: 'rem-ok',
            kind: 'next' as const,
            actionId: 'act-ok',
            firesAt: '2026-10-09T12:00:00.000Z',
            intensity: 'normal' as const,
            title: '会成功的行动',
            note: null,
            estMinutes: null,
          },
          title: '会成功的行动',
        },
      ],
    });
    expect(getReminderDeliveryFailure()).toBeNull();
  });

  it('falls back to the page Notification when the service worker never becomes ready', async () => {
    jest.useFakeTimers();
    try {
      const mockNotificationCtor = jest.fn();
      Object.assign(mockNotificationCtor, {
        permission: 'granted',
        requestPermission: jest.fn(),
      });
      (globalThis as unknown as { Notification?: unknown }).Notification = mockNotificationCtor;
      Object.defineProperty(globalThis, 'navigator', {
        value: {
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          serviceWorker: { ready: new Promise(() => undefined) },
        },
        configurable: true,
        writable: true,
      });

      const adapter = createWebAdapter();
      const pending = adapter.apply({
        toCancel: [],
        toSchedule: [],
        toFireNow: [
          {
            row: {
              id: 'rem-sw',
              kind: 'next' as const,
              actionId: 'act-sw',
              firesAt: '2026-10-09T12:00:00.000Z',
              intensity: 'normal' as const,
              title: '等待 SW',
              note: null,
              estMinutes: null,
            },
            title: '等待 SW',
          },
        ],
      });
      await jest.advanceTimersByTimeAsync(2_000);
      await pending;

      expect(mockNotificationCtor).toHaveBeenCalledTimes(1);
      expect(getReminderDeliveryFailure()).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not send when the switch turns off while the service worker is pending', async () => {
    const ctor = installGrantedCtor();
    const showNotification = jest.fn(async () => undefined);
    let resolveReady: (registration: { showNotification: typeof showNotification }) => void =
      () => undefined;
    const ready = new Promise<{ showNotification: typeof showNotification }>((resolve) => {
      resolveReady = resolve;
    });
    installNavigator({ serviceWorker: { ready } });

    const adapter = createWebAdapter();
    const pending = adapter.apply(fireOutput('rem-switch-wait'));
    // The user turns the switch off while showNotification is still waiting
    // on the service worker — the resolved registration must not be used.
    adapter.setDeliveryEnabled?.(false);
    resolveReady({ showNotification });
    await pending;

    expect(showNotification).not.toHaveBeenCalled();
    expect(ctor).not.toHaveBeenCalled();
  });

  it('does not fall back to the page constructor when the switch turns off during the ready timeout', async () => {
    jest.useFakeTimers();
    try {
      const ctor = installGrantedCtor();
      installNavigator({ serviceWorker: { ready: new Promise(() => undefined) } });

      const adapter = createWebAdapter();
      const pending = adapter.apply(fireOutput('rem-switch-timeout'));
      adapter.setDeliveryEnabled?.(false);
      await jest.advanceTimersByTimeAsync(2_000);
      await pending;

      expect(ctor).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops the rest of a batch when the switch turns off during an earlier send', async () => {
    const ctor = installGrantedCtor();
    const adapter = createWebAdapter();
    const showNotification = jest.fn(async () => {
      adapter.setDeliveryEnabled?.(false);
    });
    installNavigator({ serviceWorker: { ready: Promise.resolve({ showNotification }) } });

    await adapter.apply(fireOutput('rem-batch-a', 'rem-batch-b'));

    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(ctor).not.toHaveBeenCalled();
  });

  it('claims an in-flight id so two concurrent applies (hook remount) send once', async () => {
    const ctor = installGrantedCtor();
    const showNotification = jest.fn(async () => undefined);
    let resolveReady: (registration: { showNotification: typeof showNotification }) => void =
      () => undefined;
    const ready = new Promise<{ showNotification: typeof showNotification }>((resolve) => {
      resolveReady = resolve;
    });
    installNavigator({ serviceWorker: { ready } });

    const adapter = createWebAdapter();
    const first = adapter.apply(fireOutput('rem-remount'));
    const second = adapter.apply(fireOutput('rem-remount'));
    resolveReady({ showNotification });
    await Promise.all([first, second]);

    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(ctor).not.toHaveBeenCalled();
  });

  it('releases the in-flight claim after a failed send so a later apply retries', async () => {
    const failing = jest.fn(() => {
      throw new Error('refused');
    });
    Object.assign(failing, { permission: 'granted', requestPermission: jest.fn() });
    (globalThis as unknown as { Notification?: unknown }).Notification = failing;
    installNavigator();

    const adapter = createWebAdapter();
    await adapter.apply(fireOutput('rem-retry'));
    expect(failing).toHaveBeenCalledTimes(1);
    expect(getReminderDeliveryFailure()).toMatchObject({ reminderId: 'rem-retry' });

    const ctor = installGrantedCtor();
    await adapter.apply(fireOutput('rem-retry'));
    expect(ctor).toHaveBeenCalledTimes(1);
  });
});
