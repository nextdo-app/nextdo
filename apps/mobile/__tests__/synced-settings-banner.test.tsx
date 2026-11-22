/**
 * Global retry banner for uncommitted settings writes (issue #97).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SyncedSettingsBanner } from '@/components/synced-settings-banner';
import {
  __flushSyncedSettingWritesForTests,
  __resetSyncedSettingsBusForTests,
  __setSyncedSettingsPendingStoreForTests,
  registerSyncedSettingWriter,
  writeSyncedSetting,
} from '@/lib/synced-settings-bus';

const BANNER = '设置未同步到账本，已保留在本机。';

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

describe('SyncedSettingsBanner', () => {
  it('renders nothing while every write is healthy', () => {
    render(<SyncedSettingsBanner />);
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it('surfaces a failed write and clears after a successful retry', async () => {
    const writer = jest
      .fn<Promise<void>, [key: string, value: string]>()
      .mockRejectedValueOnce(new Error('injected settings write failure'))
      .mockResolvedValueOnce(undefined);
    registerSyncedSettingWriter(writer);
    render(<SyncedSettingsBanner />);

    await act(async () => {
      writeSyncedSetting('engine-context', '{"availableMinutes":120}');
      await __flushSyncedSettingWritesForTests();
    });
    expect(screen.getByText(BANNER)).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: '重试同步设置' }));
    await act(async () => {
      await __flushSyncedSettingWritesForTests();
    });

    expect(writer).toHaveBeenLastCalledWith('engine-context', '{"availableMinutes":120}');
    expect(writer).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(BANNER)).toBeNull();
  });
});
