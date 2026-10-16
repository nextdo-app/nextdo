/**
 * `NotificationOptinDialog` / `NotificationOptinNotifier` (issue #24 R1).
 *
 * The notifier carries the logic worth pinning: it must appear for a user who
 * has never been asked, and never again after EITHER answer (AC3 — a declined
 * user is not re-nagged). The OS-permission hook is mocked here; its real
 * adapter integration is covered by `settings-screen.test.tsx`. The preference
 * store is the REAL module, pointed at an in-memory backend.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  NotificationOptinDialog,
  NotificationOptinNotifier,
} from '@/components/notification-optin-dialog';
import {
  __setNotificationSettingsStoreForTests,
  loadNotificationSettings,
  NOTIFICATION_SETTINGS_KEY,
} from '@/lib/notification-settings';
import type { ReminderPermissionState } from '@/lib/reminders/adapters';
import { useReminderPermission } from '@/hooks/use-reminder-permission';

jest.mock('@/hooks/use-reminder-permission', () => ({
  useReminderPermission: jest.fn(),
}));

const mockUseReminderPermission = useReminderPermission as jest.MockedFunction<
  typeof useReminderPermission
>;

const NATIVE_UNDETERMINED: ReminderPermissionState = {
  platform: 'native',
  status: 'undetermined',
  canAskAgain: true,
};

let requestPermission: jest.Mock;

function setPermission(state: ReminderPermissionState | null): void {
  mockUseReminderPermission.mockReturnValue({
    state,
    openSystemSettings: jest.fn(),
    requestPermission,
  });
}

/** An in-memory backend for the real preference store. */
function memoryStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    async getItem(key: string): Promise<string | null> {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    async setItem(key: string, value: string): Promise<void> {
      map.set(key, value);
    },
  };
}

/** Seed the real store with an already-answered user. */
function seedSeen(): void {
  __setNotificationSettingsStoreForTests(
    memoryStore({
      [NOTIFICATION_SETTINGS_KEY]: JSON.stringify({
        masterEnabled: true,
        optInPromptSeen: true,
      }),
    }),
  );
}

async function flush(rounds = 6): Promise<void> {
  let p: Promise<unknown> = Promise.resolve();
  for (let i = 0; i < rounds; i++) {
    p = p.then(() => act(async () => {}));
  }
  await p;
}

beforeEach(() => {
  __setNotificationSettingsStoreForTests(memoryStore());
  requestPermission = jest.fn(async () => NATIVE_UNDETERMINED);
  setPermission(NATIVE_UNDETERMINED);
});

describe('NotificationOptinDialog', () => {
  it('renders the explainer with both actions when visible', () => {
    render(<NotificationOptinDialog visible onConfirm={jest.fn()} onDismiss={jest.fn()} />);

    expect(screen.getByText('开启提醒通知')).toBeTruthy();
    expect(screen.getByRole('button', { name: '开启通知' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '暂不' })).toBeTruthy();
  });

  it('renders nothing when not visible', () => {
    render(
      <NotificationOptinDialog visible={false} onConfirm={jest.fn()} onDismiss={jest.fn()} />,
    );

    expect(screen.queryByText('开启提醒通知')).toBeNull();
  });

  it('routes each action to its own callback', () => {
    const onConfirm = jest.fn();
    const onDismiss = jest.fn();
    render(<NotificationOptinDialog visible onConfirm={onConfirm} onDismiss={onDismiss} />);

    fireEvent.press(screen.getByRole('button', { name: '暂不' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: '开启通知' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('NotificationOptinNotifier — the one-shot guide (AC1 / AC3)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Mount, then let both the store read and the display delay land. */
  async function mountAndSettle(): Promise<void> {
    render(<NotificationOptinNotifier />);
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    await flush();
  }

  it('shows the guide for a never-asked native user (AC1)', async () => {
    await mountAndSettle();
    expect(screen.getByText('开启提醒通知')).toBeTruthy();
  });

  it('never appears again after 暂不 (AC3)', async () => {
    await mountAndSettle();
    fireEvent.press(screen.getByRole('button', { name: '暂不' }));
    await flush();

    expect(screen.queryByText('开启提醒通知')).toBeNull();
    await expect(loadNotificationSettings()).resolves.toMatchObject({
      optInPromptSeen: true,
    });
  });

  it('asks the OS and records the answer when 开启通知 is pressed', async () => {
    await mountAndSettle();
    fireEvent.press(screen.getByRole('button', { name: '开启通知' }));
    await flush();

    expect(requestPermission).toHaveBeenCalledTimes(1);
    await expect(loadNotificationSettings()).resolves.toMatchObject({
      optInPromptSeen: true,
    });
  });

  it('stays hidden for a user the guide was already shown to', async () => {
    seedSeen();
    await mountAndSettle();

    expect(screen.queryByText('开启提醒通知')).toBeNull();
  });

  it('stays hidden once the OS already decided (granted)', async () => {
    setPermission({ platform: 'native', status: 'granted', canAskAgain: true });
    await mountAndSettle();

    expect(screen.queryByText('开启提醒通知')).toBeNull();
  });

  it('stays hidden once the OS already decided (denied) — no re-nagging', async () => {
    setPermission({ platform: 'native', status: 'denied', canAskAgain: false });
    await mountAndSettle();

    expect(screen.queryByText('开启提醒通知')).toBeNull();
  });

  it('never shows on the desktop shell (tauri has no prompt model)', async () => {
    setPermission({ platform: 'tauri', status: 'granted', canAskAgain: true });
    await mountAndSettle();

    expect(screen.queryByText('开启提醒通知')).toBeNull();
  });

  it('stays hidden until the permission read resolves', async () => {
    setPermission(null);
    await mountAndSettle();

    expect(screen.queryByText('开启提醒通知')).toBeNull();
  });
});
