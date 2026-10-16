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
} from '@/lib/notification-settings';

export interface UseNotificationSettingsResult {
  /** null until the first read resolves (the switch renders its default). */
  masterEnabled: boolean | null;
  /** Persist the new value; the delivery engine re-reconciles on the poke. */
  setMasterEnabled: (next: boolean) => Promise<void>;
}

export function useNotificationSettings(): UseNotificationSettingsResult {
  const [masterEnabled, setMasterEnabledState] = useState<boolean | null>(null);

  useEffect(() => {
    let disposed = false;
    void loadNotificationSettings()
      .then((settings) => {
        if (!disposed) setMasterEnabledState(settings.masterEnabled);
      })
      .catch((error: unknown) => {
        // A failed read keeps the default (ON) — a preference-store failure
        // must never look like the user switched notifications off.
        logger.warn(
          'notification settings read failed',
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    const unsubscribe = subscribeToNotificationSettings((settings) => {
      setMasterEnabledState(settings.masterEnabled);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const setMasterEnabled = useCallback(async (next: boolean): Promise<void> => {
    // Optimistic: the switch must not lag the tap, and the write is a local
    // one. The subscriber above is what feeds the delivery engine.
    setMasterEnabledState(next);
    try {
      await saveNotificationSettings({ masterEnabled: next });
    } catch (error) {
      logger.warn(
        'notification settings save failed',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }, []);

  return { masterEnabled, setMasterEnabled };
}
