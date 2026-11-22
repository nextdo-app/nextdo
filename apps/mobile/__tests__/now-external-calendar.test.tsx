/**
 * Issue #100: the Now recommendation must respect external calendar busy
 * time. This is the wiring test between the import hook and the REAL engine
 * (`recommend` runs unmocked): an imported external block filters a
 * CalendarAction that overlaps it as `calendar-conflict`, and the same
 * action is eligible when the import switch is off.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockPoolRef: { current: unknown } = { current: null };

jest.mock('@/hooks/use-action-pool', () => ({
  useActionPool: () => ({ data: mockPoolRef.current, error: null }),
}));

jest.mock('@/hooks/use-app-clock', () => {
  const now = new Date('2026-11-21T10:00:00.000Z');
  return { useAppClock: () => now };
});

jest.mock('@/lib/engine-context', () => ({
  DEFAULT_ENGINE_CONTEXT: { availableMinutes: 60 },
  useEngineContextSettings: () => ({ settings: null, error: null, update: async () => {} }),
}));

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

import { useNow } from '@/hooks/use-now';
import { listEventsForImport } from '@/lib/calendar-sync';
import { loadCalendarSyncState } from '@/lib/calendar-sync/store';

const mockListEvents = listEventsForImport as jest.Mock;
const mockLoadState = loadCalendarSyncState as jest.Mock;
const settingsMock = jest.requireMock<{
  __setSettings: (settings: { calendarImportEnabled: boolean }) => void;
}>('@/lib/notification-settings');

const CAL_ACTION_START = '2026-11-21T10:30:00.000Z';
const CAL_ACTION_END = '2026-11-21T11:00:00.000Z';

const calendarAction = {
  id: 'cal-1',
  kind: 'calendar',
  title: '周会准备',
  contextIds: [],
  estMinutes: 30,
  value: 3,
  startsAt: CAL_ACTION_START,
  consecutiveSkips: 0,
  dependencyDone: true,
  createdAt: '2026-11-20T00:00:00.000Z',
};

const pool = {
  actions: [calendarAction],
  // The action's own block, exactly as queryEnginePool would produce it.
  calendar: [
    { start: CAL_ACTION_START, end: CAL_ACTION_END, sourceActionId: calendarAction.id },
  ],
  projects: [],
};

const externalBusyEvent = {
  id: 'evt-external',
  title: '与客户会议',
  startsAt: '2026-11-21T10:15:00.000Z',
  endsAt: '2026-11-21T10:45:00.000Z',
  allDay: false,
  availability: 'busy',
  status: 'confirmed',
  notes: null,
};

const emptyState = {
  calendarId: null,
  preferredCalendarId: null,
  mappings: {},
  reminderMappings: {},
  focusMappings: {},
  focusRecordSince: null,
};

function enableImport(): void {
  act(() => {
    settingsMock.__setSettings({ calendarImportEnabled: true });
  });
}

describe('useNow — external calendar constraints (issue #100)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPoolRef.current = pool;
    mockLoadState.mockResolvedValue(emptyState);
    mockListEvents.mockResolvedValue([externalBusyEvent]);
    settingsMock.__setSettings({ calendarImportEnabled: false });
  });

  it('filters a CalendarAction that overlaps an imported busy event', async () => {
    const { result } = renderHook(() => useNow({ availableMinutes: 60 }));
    enableImport();
    await waitFor(() => {
      const filtered = result.current.data?.filtered ?? [];
      expect(filtered.some((entry) => entry.action.id === 'cal-1')).toBe(true);
    });

    const filtered = result.current.data?.filtered ?? [];
    expect(filtered.find((entry) => entry.action.id === 'cal-1')?.rule).toBe(
      'calendar-conflict',
    );
    expect(result.current.calendarImportError).toBeNull();
  });

  it('keeps the same action eligible while the import switch is off', async () => {
    const { result } = renderHook(() => useNow({ availableMinutes: 60 }));
    await act(async () => {});
    await act(async () => {});

    const filtered = result.current.data?.filtered ?? [];
    expect(filtered.some((entry) => entry.action.id === 'cal-1')).toBe(false);
    expect(result.current.data?.recommended?.id).toBe('cal-1');
    expect(mockListEvents).not.toHaveBeenCalled();
  });
});
