/**
 * Global retry banner for uncommitted `settings` table writes (issue #97).
 * The bus keeps the user's newest value pending (and persists it in device
 * storage), so a failed or interrupted write survives a reload; this banner
 * makes that state visible on any screen and offers the retry. A successful
 * write clears it automatically.
 */
import { useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  getSyncedSettingFailureCount,
  retrySyncedSettingWrites,
  subscribeToSyncedSettingFailures,
} from '@/lib/synced-settings-bus';

export function SyncedSettingsBanner() {
  const failures = useSyncExternalStore(
    subscribeToSyncedSettingFailures,
    getSyncedSettingFailureCount,
    getSyncedSettingFailureCount,
  );

  if (failures === 0) return null;

  return (
    <View
      accessibilityRole="alert"
      className="absolute left-3 right-3 top-12 z-50 flex-row items-center gap-3 rounded-xl border border-danger/30 bg-canvas px-3 py-2.5 shadow-sm dark:border-danger-dark/40 dark:bg-canvas-dark"
    >
      <Text className="flex-1 font-sans text-xs text-danger dark:text-danger-dark">
        设置未同步到账本，已保留在本机。
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="重试同步设置"
        onPress={retrySyncedSettingWrites}
        className="rounded-lg bg-danger/10 px-3 py-1.5 active:opacity-70 dark:bg-danger-dark/20"
      >
        <Text className="font-sans text-xs font-semibold text-danger dark:text-danger-dark">
          重试
        </Text>
      </Pressable>
    </View>
  );
}
