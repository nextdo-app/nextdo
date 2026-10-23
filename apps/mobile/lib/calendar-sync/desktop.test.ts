/**
 * The desktop branch of the OS-calendar boundary (task 10-23).
 *
 * Two things are worth pinning down without a Mac in the loop:
 *
 * 1. The FACADE picks the backend by PROBING the shell, not by reading
 *    `Platform.OS` — a Tauri webview reports `web` exactly like a browser,
 *    and a Windows/Linux shell must fall back to "no calendar" rather than
 *    calling EventKit commands that were never compiled in.
 * 2. The IPC arg shape: times cross the boundary as epoch milliseconds and
 *    the alarm is the event start, because that is what the Rust side
 *    deserializes.
 */
import { Platform } from 'react-native';

const mockInvoke = jest.fn(async (command: string, args?: unknown): Promise<unknown> => {
  void args;
  void command;
  return undefined;
});

jest.mock('@nextdo/core', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import {
  __resetCalendarBackendForTests,
  createCalendarEvent,
  ensureCalendar,
  getCalendarPermission,
  isCalendarSupported,
  openCalendarSettings,
  requestCalendarPermission,
} from './index';

const SPEC = {
  actionId: 'action-1',
  title: '给王老师回电话',
  startsAt: '2026-10-23T09:00:00.000Z',
  endsAt: '2026-10-23T09:15:00.000Z',
  notes: '问一下周三的课',
};

describe('desktop calendar boundary', () => {
  let originalOS: string;

  beforeEach(() => {
    jest.clearAllMocks();
    __resetCalendarBackendForTests();
    originalOS = Platform.OS;
    // The shell's webview surface — the same value a browser reports.
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = undefined;
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  });

  function mountShell(behaviour: (command: string, args?: unknown) => unknown): void {
    mockInvoke.mockImplementation(async (command, args) => behaviour(command, args));
    (globalThis as { window?: unknown }).window = {
      __TAURI_INTERNALS__: { invoke: mockInvoke },
    };
  }

  it('is unsupported on a plain browser (no shell to ask)', async () => {
    (globalThis as { window?: unknown }).window = { localStorage: {} };
    await expect(isCalendarSupported()).resolves.toBe(false);
    expect(mockInvoke).not.toHaveBeenCalled();
    await expect(getCalendarPermission()).resolves.toBe('denied');
  });

  it('is unsupported when the shell has no EventKit bridge (Windows/Linux build)', async () => {
    mountShell(() => {
      throw new Error('command calendar_supported not found');
    });
    await expect(isCalendarSupported()).resolves.toBe(false);
    // …and the fallback writes nothing.
    await expect(ensureCalendar()).resolves.toBeNull();
  });

  it('resolves the desktop backend once the probe answers true', async () => {
    mountShell((command) => {
      if (command === 'calendar_supported') return true;
      if (command === 'calendar_permission') return 'authorized';
      return undefined;
    });

    await expect(isCalendarSupported()).resolves.toBe(true);
    await expect(getCalendarPermission()).resolves.toBe('granted');
    await expect(ensureCalendar()).resolves.toEqual({ kind: 'desktop', id: 'nextdo' });

    // The probe is memoized: the backend cannot change mid-session.
    await isCalendarSupported();
    expect(mockInvoke.mock.calls.filter(([command]) => command === 'calendar_supported')).toHaveLength(
      1,
    );
  });

  it('maps the EventKit authorization states onto the shared vocabulary', async () => {
    mountShell((command) => {
      if (command === 'calendar_supported') return true;
      if (command === 'calendar_permission') return 'notDetermined';
      if (command === 'calendar_request_permission') return 'restricted';
      return undefined;
    });

    await expect(getCalendarPermission()).resolves.toBe('undetermined');
    await expect(requestCalendarPermission()).resolves.toBe('denied');
  });

  it('sends epoch milliseconds and a start-anchored alarm on create', async () => {
    mountShell((command) => {
      if (command === 'calendar_supported') return true;
      if (command === 'calendar_permission') return 'authorized';
      if (command === 'calendar_upsert_event') return { eventId: 'EK-1' };
      return undefined;
    });

    const mapping = await createCalendarEvent({ kind: 'desktop', id: 'nextdo' }, SPEC);

    expect(mapping).toEqual({
      eventId: 'EK-1',
      signature: expect.any(String),
    });
    const [, args] = mockInvoke.mock.calls.find(
      ([command]) => command === 'calendar_upsert_event',
    ) as [string, { args: Record<string, unknown> }];
    expect(args.args).toEqual({
      title: SPEC.title,
      notes: SPEC.notes,
      startsAt: Date.parse(SPEC.startsAt),
      durationMinutes: 15,
      alarmOffsetMinutes: 0,
    });
    // A create carries no eventId — that is what makes the Rust upsert create.
    expect(args.args).not.toHaveProperty('eventId');
  });

  it('opens the privacy pane through the shell, not Linking', async () => {
    mountShell((command) => {
      if (command === 'calendar_supported') return true;
      return undefined;
    });

    await openCalendarSettings();
    expect(mockInvoke).toHaveBeenCalledWith('calendar_open_settings', undefined);
  });
});
