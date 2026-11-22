/**
 * Issue #100: the Now screen's system-calendar import hook.
 *
 * The pure filter has its own test; this file pins the wiring the user can
 * feel: the switch gates every calendar read, Nextdo's own events never come
 * back as external busy time, a failed refresh keeps the previous snapshot
 * and surfaces the Chinese notice, and turning the switch off clears it.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/lib/calendar-sync', () => ({
  listEventsForImport: jest.fn(),
}));

jest.mock('@/lib/calendar-sync/store', () => ({
  loadCalendarSyncState: jest.fn(),
}));

jest.mock('@/lib/notification-settings', () => {
  const state: {
    settings: { calendarImportEnabled: boolean };
    listeners: Set<(settings: { calendarImportEnabled: boolean }) => void>;
  } = {
    settings: { calendarImportEnabled: false },
    listeners: new Set(),
  };
  return {
    loadNotificationSettings: jest.fn(async () => state.settings),
    subscribeToNotificationSettings: (
      listener: (settings: { calendarImportEnabled: boolean }) => void,
    ) => {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
    __setSettings: (settings: { calendarImportEnabled: boolean }) => {
      state.settings = settings;
      for (const listener of state.listeners) listener(settings);
    },
  };
});

import {
  CALENDAR_IMPORT_ERROR,
  __resetExternalCalendarBlocksForTests,
  useExternalCalendarBlocks,
} from '@/hooks/use-external-calendar-blocks';
import { listEventsForImport } from '@/lib/calendar-sync';
import { loadCalendarSyncState } from '@/lib/calendar-sync/store';

const mockListEvents = listEventsForImport as jest.Mock;
const mockLoadState = loadCalendarSyncState as jest.Mock;
const settingsMock = jest.requireMock<{
  __setSettings: (settings: { calendarImportEnabled: boolean }) => void;
}>('@/lib/notification-settings');

const emptyState = {
  calendarId: null,
  preferredCalendarId: null,
  mappings: {},
  reminderMappings: {},
  focusMappings: {},
  focusRecordSince: null,
};

const busyEvent = {
  id: 'evt-meeting',
  title: '组会',
  startsAt: '2026-11-21T09:00:00.000Z',
  endsAt: '2026-11-21T10:00:00.000Z',
  allDay: false,
  availability: 'busy',
  status: 'confirmed',
  notes: null,
};

function enableImport(): void {
  act(() => {
    settingsMock.__setSettings({ calendarImportEnabled: true });
  });
}

describe('useExternalCalendarBlocks — system calendar import (issue #100)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetExternalCalendarBlocksForTests();
    mockLoadState.mockResolvedValue(emptyState);
    mockListEvents.mockResolvedValue([busyEvent]);
    // The mocked module starts with the switch OFF; enable it per test.
    settingsMock.__setSettings({ calendarImportEnabled: false });
  });

  it('reads nothing while the switch is off', async () => {
    const { result } = renderHook(() => useExternalCalendarBlocks());
    await act(async () => {});
    await act(async () => {});

    expect(mockListEvents).not.toHaveBeenCalled();
    expect(result.current.blocks).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('turns timed busy events into hard blocks when enabled', async () => {
    const { result } = renderHook(() => useExternalCalendarBlocks());
    enableImport();
    await waitFor(() => expect(result.current.blocks).toHaveLength(1));

    expect(mockListEvents).toHaveBeenCalledTimes(1);
    expect(result.current.blocks).toEqual([
      { start: busyEvent.startsAt, end: busyEvent.endsAt },
    ]);
    expect(result.current.error).toBeNull();
  });

  it('excludes the events Nextdo itself wrote (mapping ids)', async () => {
    mockLoadState.mockResolvedValue({
      ...emptyState,
      mappings: { 'act-1': { eventId: 'evt-own', signature: 'sig' } },
    });
    mockListEvents.mockResolvedValue([
      busyEvent,
      { ...busyEvent, id: 'evt-own' },
    ]);
    const { result } = renderHook(() => useExternalCalendarBlocks());
    enableImport();
    await waitFor(() => expect(result.current.blocks).toHaveLength(1));

    expect(result.current.blocks).toEqual([
      { start: busyEvent.startsAt, end: busyEvent.endsAt },
    ]);
  });

  it('keeps the previous blocks and shows the Chinese notice when a refresh fails', async () => {
    const { result } = renderHook(() => useExternalCalendarBlocks());
    enableImport();
    await waitFor(() => expect(result.current.blocks).toHaveLength(1));

    mockListEvents.mockRejectedValueOnce(new Error('calendar access revoked'));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.blocks).toHaveLength(1);
    expect(result.current.error).toBe(CALENDAR_IMPORT_ERROR);
    expect(CALENDAR_IMPORT_ERROR).toContain('系统日历读取失败');
  });

  it('clears the blocks and the notice when the switch is turned off', async () => {
    const { result } = renderHook(() => useExternalCalendarBlocks());
    enableImport();
    await waitFor(() => expect(result.current.blocks).toHaveLength(1));

    act(() => {
      settingsMock.__setSettings({ calendarImportEnabled: false });
    });

    expect(result.current.blocks).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('does not report an error on a host with no readable calendar', async () => {
    mockListEvents.mockResolvedValue(null);
    const { result } = renderHook(() => useExternalCalendarBlocks());
    enableImport();
    await act(async () => {});
    await act(async () => {});

    expect(result.current.blocks).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});
