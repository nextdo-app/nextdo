import { createWebAdapter } from '../lib/reminders/adapters/web';

describe('createWebAdapter', () => {
  const originalNotification = (globalThis as unknown as { Notification?: unknown }).Notification;
  const originalNavigator = globalThis.navigator;

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
    const mockNotificationCtor = jest.fn();
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
  });
});
