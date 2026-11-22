/**
 * Component tests — synced account settings (issue #97): the bridge applies
 * downloaded rows to the theme / focus / engine modules, seeds a missing row
 * only from an explicit local value, and mirrors user saves into the table.
 *
 * The PowerSync boundary is mocked: `useQuery` returns the current mock rows
 * and `setAppSetting` is a spy. The settings modules themselves are real, so
 * the assertions read exactly what a screen would see.
 */
import type { AppSetting } from '@nextdo/db';

const NOW = '2026-09-21T10:00:00.000Z';

const mockSetAppSetting = jest.fn<
  Promise<undefined>,
  [db: unknown, args: unknown, now: Date, options?: unknown]
>(async () => undefined);

const mockRows: {
  data: AppSetting[];
  isLoading: boolean;
  error: Error | null;
} = { data: [], isLoading: false, error: null };

jest.mock('@nextdo/db', () => ({
  isReactNativeRuntime: () => false,
  wrapDb: () => ({}),
  settingsWatchQuery: () => ({
    compile: () => ({ sql: 'SELECT 1', parameters: [] }),
    execute: async () => [],
  }),
  setAppSetting: (...args: unknown[]) =>
    mockSetAppSetting(...(args as Parameters<typeof mockSetAppSetting>)),
}));

jest.mock('@powersync/react', () => {
  const React = jest.requireActual('react');
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    close: async () => undefined,
    onChange: () => () => undefined,
  };
  return {
    PowerSyncContext: React.createContext(powersync),
    usePowerSync: () => powersync,
    useQuery: () => ({
      data: mockRows.data,
      isLoading: mockRows.isLoading,
      isFetching: false,
      error: mockRows.error,
    }),
  };
});

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useSyncedSettings } from '@/hooks/use-synced-settings';
import { applySyncedSetting } from '@/lib/synced-settings';
import {
  __flushSyncedSettingWritesForTests,
  __resetSyncedSettingsBusForTests,
  __setSyncedSettingsPendingStoreForTests,
  getSyncedSettingFailureCount,
  hasPendingSyncedSetting,
} from '@/lib/synced-settings-bus';
import {
  __setFocusSettingsStoreForTests,
  loadFocusSettings,
  saveFocusSettings,
} from '@/lib/focus-settings';
import {
  __setEngineContextStoreForTests,
  ENGINE_CONTEXT_KEY,
  loadEngineContext,
  readStoredEngineContext,
  saveEngineContext,
} from '@/lib/engine-context';
import { __resetThemeForTests, readStoredThemePreference } from '@/lib/theme';

function memoryStore(seed: Record<string, string> = {}): {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
} {
  const raw = new Map(Object.entries(seed));
  return {
    async getItem(key) {
      return raw.has(key) ? (raw.get(key) as string) : null;
    },
    async setItem(key, value) {
      raw.set(key, value);
    },
    async removeItem(key) {
      raw.delete(key);
    },
  };
}

beforeEach(() => {
  __resetSyncedSettingsBusForTests();
  __setSyncedSettingsPendingStoreForTests(memoryStore());
  jest.clearAllMocks();
  mockRows.data = [];
  mockRows.isLoading = false;
  mockRows.error = null;
  __setFocusSettingsStoreForTests(memoryStore());
  __setEngineContextStoreForTests(memoryStore());
  __resetThemeForTests();
});

function writesFor(key: string): unknown[][] {
  return mockSetAppSetting.mock.calls.filter(
    ([, args]) => (args as { key?: string }).key === key,
  );
}

describe('useSyncedSettings', () => {
  it('does not seed a default when nothing was stored locally', async () => {
    renderHook(() => useSyncedSettings());
    await act(async () => undefined);
    expect(writesFor('engine-context')).toHaveLength(0);
    expect(writesFor('focus')).toHaveLength(0);
  });

  it('does not seed the default that a normal startup read put in the cache', async () => {
    // Loading the Now screen before the watch settles caches the 60-minute
    // default. That is not an explicit choice and must not be seeded.
    await loadEngineContext();
    expect(await readStoredEngineContext()).toBeNull();

    renderHook(() => useSyncedSettings());
    await act(async () => undefined);

    expect(writesFor('engine-context')).toHaveLength(0);
  });
  it('applies an existing account preference that arrives after a fresh device mounts', async () => {
    const { rerender } = renderHook(() => useSyncedSettings());
    await act(async () => undefined);
    expect(await loadEngineContext()).toEqual({ availableMinutes: 60 });

    // No local values were seeded; the account's rows download afterwards.
    mockRows.data = [
      { key: 'engine-context', value: '{"availableMinutes":90}', updatedAt: NOW },
      { key: 'focus', value: '{"lastMinutes":45}', updatedAt: NOW },
    ];
    act(() => {
      rerender(undefined);
    });

    await waitFor(async () => {
      expect(await loadEngineContext()).toEqual({ availableMinutes: 90 });
    });
    expect(await loadFocusSettings()).toEqual({ lastMinutes: 45 });
  });

  it('keeps a failed write over a later stale watch emission', async () => {
    mockRows.data = [
      { key: 'theme-preference', value: '"system"', updatedAt: NOW },
      { key: 'engine-context', value: '{"availableMinutes":60}', updatedAt: NOW },
      { key: 'focus', value: '{"lastMinutes":25}', updatedAt: NOW },
    ];
    const { rerender } = renderHook(() => useSyncedSettings());
    await waitFor(async () => {
      expect(await loadEngineContext()).toEqual({ availableMinutes: 60 });
    });

    mockSetAppSetting.mockRejectedValueOnce(
      new Error('injected settings write failure'),
    );
    await act(async () => {
      await saveEngineContext({ availableMinutes: 120 });
      await __flushSyncedSettingWritesForTests();
    });
    expect(getSyncedSettingFailureCount()).toBe(1);
    expect(hasPendingSyncedSetting('engine-context')).toBe(true);

    // Any other row change re-sends the whole table, including the stale
    // engine row that the failed write never updated.
    mockRows.data = [
      { key: 'theme-preference', value: '"system"', updatedAt: NOW },
      { key: 'engine-context', value: '{"availableMinutes":60}', updatedAt: NOW },
      { key: 'focus', value: '{"lastMinutes":45}', updatedAt: NOW },
    ];
    act(() => {
      rerender(undefined);
    });

    await waitFor(async () => {
      expect(await loadFocusSettings()).toEqual({ lastMinutes: 45 });
    });
    expect(await loadEngineContext()).toEqual({ availableMinutes: 120 });
  });

  it('restores a failed write after a reload before applying the stale row', async () => {
    mockRows.data = [
      { key: 'theme-preference', value: '"system"', updatedAt: NOW },
      { key: 'engine-context', value: '{"availableMinutes":60}', updatedAt: NOW },
      { key: 'focus', value: '{"lastMinutes":25}', updatedAt: NOW },
    ];
    const first = renderHook(() => useSyncedSettings());
    await waitFor(async () => {
      expect(await loadEngineContext()).toEqual({ availableMinutes: 60 });
    });

    mockSetAppSetting.mockRejectedValueOnce(
      new Error('injected settings write failure'),
    );
    await act(async () => {
      await saveEngineContext({ availableMinutes: 120 });
      await __flushSyncedSettingWritesForTests();
    });
    expect(getSyncedSettingFailureCount()).toBe(1);
    first.unmount();

    // Reload: module memory is gone; the device store keeps the local value
    // and the pending intent, while the DB row is still the stale 60.
    __resetSyncedSettingsBusForTests({ keepStore: true });
    __setEngineContextStoreForTests(
      memoryStore({ [ENGINE_CONTEXT_KEY]: '{"availableMinutes":120}' }),
    );
    __setFocusSettingsStoreForTests(memoryStore());
    __resetThemeForTests();

    renderHook(() => useSyncedSettings());
    await waitFor(() => expect(getSyncedSettingFailureCount()).toBe(1));
    await waitFor(async () => {
      expect(await loadFocusSettings()).toEqual({ lastMinutes: 25 });
    });
    expect(await loadEngineContext()).toEqual({ availableMinutes: 120 });
  });

  it('seeds a missing row from the explicit local value, only if missing', async () => {
    await saveFocusSettings({ lastMinutes: 30 }); // local only — no bridge yet
    mockSetAppSetting.mockClear();

    renderHook(() => useSyncedSettings());
    await waitFor(() => expect(writesFor('focus')).toHaveLength(1));

    const firstCall = writesFor('focus')[0];
    if (firstCall === undefined) throw new Error('expected one seed write');
    const [dbArg, argsArg, nowArg, optionsArg] = firstCall;
    expect(dbArg).toEqual({});
    expect(argsArg).toEqual({ key: 'focus', value: '{"lastMinutes":30}' });
    expect(nowArg).toBeInstanceOf(Date);
    expect(optionsArg).toEqual({ onlyIfMissing: true });
  });

  it('mirrors user saves made after the bridge mounted', async () => {
    renderHook(() => useSyncedSettings());

    await act(async () => {
      await saveEngineContext({ availableMinutes: 120 });
      await saveFocusSettings({ lastMinutes: 25 });
      await __flushSyncedSettingWritesForTests();
    });

    expect(mockSetAppSetting).toHaveBeenCalledWith(
      expect.anything(),
      { key: 'engine-context', value: '{"availableMinutes":120}' },
      expect.any(Date),
    );
    expect(mockSetAppSetting).toHaveBeenCalledWith(
      expect.anything(),
      { key: 'focus', value: '{"lastMinutes":25}' },
      expect.any(Date),
    );
  });

  it('applies downloaded focus / engine / theme rows to the modules', async () => {
    mockRows.data = [
      { key: 'focus', value: '{"lastMinutes":45}', updatedAt: NOW },
      { key: 'engine-context', value: '{"availableMinutes":90}', updatedAt: NOW },
      { key: 'theme-preference', value: '"dark"', updatedAt: NOW },
    ];

    renderHook(() => useSyncedSettings());
    await waitFor(async () => {
      expect(await loadFocusSettings()).toEqual({ lastMinutes: 45 });
    });

    expect(await loadEngineContext()).toEqual({ availableMinutes: 90 });
    expect(await readStoredThemePreference()).toBe('dark');
  });

  it('ignores invalid stored values instead of clearing the defaults', async () => {
    expect(applySyncedSetting('focus', '{not json')).toBe(false);
    expect(applySyncedSetting('engine-context', '"90"')).toBe(false);
    expect(applySyncedSetting('theme-preference', '"neon"')).toBe(false);

    expect(await loadFocusSettings()).toEqual({ lastMinutes: null });
    expect(await loadEngineContext()).toEqual({ availableMinutes: 60 });
  });
});
