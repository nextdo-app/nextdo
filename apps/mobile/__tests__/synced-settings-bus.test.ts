/**
 * Synced-settings writer bus (issue #97).
 *
 * A failed settings-table write must keep the newest user intent pending so
 * the bridge can ignore stale downloaded rows, a retry must clear the failure
 * only after the row actually commits, and a reload/restart must restore the
 * pending intent from device storage.
 */
import {
  __flushSyncedSettingWritesForTests,
  __resetSyncedSettingsBusForTests,
  __setSyncedSettingsPendingStoreForTests,
  getSyncedSettingFailureCount,
  hasPendingSyncedSetting,
  registerSyncedSettingWriter,
  restorePendingSyncedSettings,
  retrySyncedSettingWrites,
  writeSyncedSetting,
} from '@/lib/synced-settings-bus';

function memoryStore(): {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
} {
  const raw = new Map<string, string>();
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
});

describe('synced-settings bus', () => {
  it('keeps a failed write pending and counts the failure', async () => {
    const writer = jest.fn<Promise<void>, [key: string, value: string]>(async () => {
      throw new Error('injected settings write failure');
    });
    registerSyncedSettingWriter(writer);

    writeSyncedSetting('engine-context', '{"availableMinutes":120}');
    await __flushSyncedSettingWritesForTests();

    expect(writer).toHaveBeenCalledTimes(1);
    expect(hasPendingSyncedSetting('engine-context')).toBe(true);
    expect(getSyncedSettingFailureCount()).toBe(1);
  });

  it('retries the newest intent and clears it only after success', async () => {
    const writer = jest
      .fn<Promise<void>, [key: string, value: string]>()
      .mockRejectedValueOnce(new Error('injected settings write failure'))
      .mockResolvedValueOnce(undefined);
    registerSyncedSettingWriter(writer);

    writeSyncedSetting('focus', '{"lastMinutes":25}');
    await __flushSyncedSettingWritesForTests();
    expect(getSyncedSettingFailureCount()).toBe(1);

    retrySyncedSettingWrites();
    // Still visible while the retry is in flight.
    expect(getSyncedSettingFailureCount()).toBe(1);
    await __flushSyncedSettingWritesForTests();

    expect(writer).toHaveBeenLastCalledWith('focus', '{"lastMinutes":25}');
    expect(getSyncedSettingFailureCount()).toBe(0);
    expect(hasPendingSyncedSetting('focus')).toBe(false);
  });

  it('a newer save supersedes the failed intent', async () => {
    const writer = jest
      .fn<Promise<void>, [key: string, value: string]>()
      .mockRejectedValueOnce(new Error('injected settings write failure'))
      .mockResolvedValueOnce(undefined);
    registerSyncedSettingWriter(writer);

    writeSyncedSetting('focus', '{"lastMinutes":25}');
    await __flushSyncedSettingWritesForTests();
    expect(getSyncedSettingFailureCount()).toBe(1);

    writeSyncedSetting('focus', '{"lastMinutes":60}');
    await __flushSyncedSettingWritesForTests();

    expect(writer).toHaveBeenLastCalledWith('focus', '{"lastMinutes":60}');
    expect(getSyncedSettingFailureCount()).toBe(0);
    expect(hasPendingSyncedSetting('focus')).toBe(false);
  });

  it('restores a pending write after a restart and clears it after a successful retry', async () => {
    const writer = jest.fn<Promise<void>, [key: string, value: string]>(async () => {
      throw new Error('injected settings write failure');
    });
    registerSyncedSettingWriter(writer);

    writeSyncedSetting('engine-context', '{"availableMinutes":120}');
    await __flushSyncedSettingWritesForTests();
    expect(getSyncedSettingFailureCount()).toBe(1);

    // Restart: in-memory state is gone, device storage stays.
    __resetSyncedSettingsBusForTests({ keepStore: true });
    expect(getSyncedSettingFailureCount()).toBe(0);
    await restorePendingSyncedSettings();
    expect(hasPendingSyncedSetting('engine-context')).toBe(true);
    expect(getSyncedSettingFailureCount()).toBe(1);

    const succeeding = jest.fn<Promise<void>, [key: string, value: string]>(
      async () => undefined,
    );
    registerSyncedSettingWriter(succeeding);
    retrySyncedSettingWrites();
    await __flushSyncedSettingWritesForTests();

    expect(succeeding).toHaveBeenCalledWith('engine-context', '{"availableMinutes":120}');
    expect(getSyncedSettingFailureCount()).toBe(0);
    expect(hasPendingSyncedSetting('engine-context')).toBe(false);

    // A later restart has nothing left to restore.
    __resetSyncedSettingsBusForTests({ keepStore: true });
    await restorePendingSyncedSettings();
    expect(getSyncedSettingFailureCount()).toBe(0);
  });

  it('keeps another tab’s pending key when this tab commits a different setting', async () => {
    const store = memoryStore();
    __setSyncedSettingsPendingStoreForTests(store);

    // Tab A: the engine write fails and is persisted.
    const failing = jest.fn<Promise<void>, [key: string, value: string]>(async () => {
      throw new Error('injected settings write failure');
    });
    registerSyncedSettingWriter(failing);
    writeSyncedSetting('engine-context', '{"availableMinutes":120}');
    await __flushSyncedSettingWritesForTests();
    expect(getSyncedSettingFailureCount()).toBe(1);

    // Tab B is a separate module instance sharing the same device storage.
    // It commits a different setting successfully.
    let busB!: typeof import('@/lib/synced-settings-bus');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      busB = require('@/lib/synced-settings-bus') as typeof import('@/lib/synced-settings-bus');
    });
    busB.__setSyncedSettingsPendingStoreForTests(store);
    const succeeding = jest.fn<Promise<void>, [key: string, value: string]>(
      async () => undefined,
    );
    busB.registerSyncedSettingWriter(succeeding);
    busB.writeSyncedSetting('focus', '{"lastMinutes":45}');
    await busB.__flushSyncedSettingWritesForTests();
    expect(succeeding).toHaveBeenCalledWith('focus', '{"lastMinutes":45}');

    // Tab A restarts: its engine intent must still be there.
    __resetSyncedSettingsBusForTests({ keepStore: true });
    await restorePendingSyncedSettings();
    expect(hasPendingSyncedSetting('engine-context')).toBe(true);
    expect(hasPendingSyncedSetting('focus')).toBe(false);
    expect(getSyncedSettingFailureCount()).toBe(1);
  });
});
