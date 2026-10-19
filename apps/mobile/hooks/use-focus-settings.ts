/**
 * Focus-duration preference handle for the focus screen (issue #59).
 *
 * UI hook: reads the device-local preference once, follows changes, and
 * exposes the patch writer the pick step calls after a user-initiated start.
 * The storage module owns the platform matrix (hook-guidelines).
 */
import { useCallback, useEffect, useState } from 'react';
import { logger } from '@nextdo/core';
import {
  loadFocusSettings,
  saveFocusSettings,
  subscribeToFocusSettings,
  type FocusSettings,
} from '@/lib/focus-settings';

export interface UseFocusSettingsResult {
  /** null until the first read resolves (the pick step keeps its defaults). */
  settings: FocusSettings | null;
  /** Persist the last user-picked duration (optimistic, local write). */
  updateSettings: (patch: Partial<FocusSettings>) => Promise<void>;
}

export function useFocusSettings(): UseFocusSettingsResult {
  const [settings, setSettingsState] = useState<FocusSettings | null>(null);

  useEffect(() => {
    let disposed = false;
    void loadFocusSettings()
      .then((loaded) => {
        if (!disposed) setSettingsState(loaded);
      })
      .catch((error: unknown) => {
        // A failed read keeps the default (no preference) — the pick step
        // must render the original presets, not wait forever.
        logger.warn('focus settings read failed', error instanceof Error ? error : new Error(String(error)));
      });
    const unsubscribe = subscribeToFocusSettings((next) => {
      setSettingsState(next);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const updateSettings = useCallback(async (patch: Partial<FocusSettings>): Promise<void> => {
    setSettingsState((current) => (current === null ? current : { ...current, ...patch }));
    try {
      await saveFocusSettings(patch);
    } catch (error) {
      logger.warn('focus settings save failed', error instanceof Error ? error : new Error(String(error)));
    }
  }, []);

  return { settings, updateSettings };
}
