/**
 * The in-app notification master switch (issue #24 R2) — the Settings tab's
 * read/write handle on the stored preference.
 *
 * Deliberately separate from `useReminderPermission`: that hook reads the OS
 * permission (a platform fact the user grants outside the app), this one owns
 * the app's own switch. The screen renders both and must not conflate them.
 *
 * Hook-guidelines: a UI hook (per-screen state over a device-local
 * preference); the storage module owns the platform matrix.
 */
import { useCallback, useEffect, useState } from 'react';
import { logger } from '@nextdo/core';
import {
  loadNotificationSettings,
  saveNotificationSettings,
  subscribeToNotificationSettings,
  type NotificationSettings,
} from '@/lib/notification-settings';

export interface UseNotificationSettingsResult {
  /** null until the first read resolves (every control renders its default). */
  settings: NotificationSettings | null;
  /** Convenience mirror of `settings?.masterEnabled` (the existing switch). */
  masterEnabled: boolean | null;
  /** Persist one or more fields (issue #54: sound + calendar preferences).
   *  Optimistic — the delivery engine re-reconciles on the poke. */
  updateSettings: (patch: Partial<NotificationSettings>) => Promise<void>;
  /** The original single-switch setter, kept for the existing caller. */
  setMasterEnabled: (next: boolean) => Promise<void>;
}

export function useNotificationSettings(): UseNotificationSettingsResult {
  const [settings, setSettingsState] = useState<NotificationSettings | null>(null);

  useEffect(() => {
    let disposed = false;
    void loadNotificationSettings()
      .then((loaded) => {
        if (!disposed) setSettingsState(loaded);
      })
      .catch((error: unknown) => {
        // A failed read keeps the default (ON) — a preference-store failure
        // must never look like the user switched notifications off.
        logger.warn(
          'notification settings read failed',
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    const unsubscribe = subscribeToNotificationSettings((next) => {
      setSettingsState(next);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<NotificationSettings>): Promise<void> => {
      // Optimistic: a switch must not lag the tap, and the write is local.
      setSettingsState((current) => (current === null ? current : { ...current, ...patch }));
      try {
        await saveNotificationSettings(patch);
      } catch (error) {
        logger.warn(
          'notification settings save failed',
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    },
    [],
  );

  const setMasterEnabled = useCallback(
    (next: boolean): Promise<void> => updateSettings({ masterEnabled: next }),
    [updateSettings],
  );

  return {
    settings,
    masterEnabled: settings === null ? null : settings.masterEnabled,
    updateSettings,
    setMasterEnabled,
  };
}
