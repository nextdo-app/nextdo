/**
 * Live reference-library preference (issue #90). Reads the device-local blob
 * and follows writes from any screen — flipping the Settings switch updates
 * the Now entry and the Clarify wizard without a reload.
 *
 * `enabled` defaults to true while the blob is loading, matching the stored
 * default; `loaded` lets a screen that must not flash distinguish the two.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_REFERENCE_LIBRARY_SETTINGS,
  loadReferenceLibrarySettings,
  saveReferenceLibrarySettings,
  subscribeToReferenceLibrarySettings,
  type ReferenceLibrarySettings,
} from '@/lib/reference-library-settings';

export interface UseReferenceLibrarySettingsResult {
  enabled: boolean;
  loaded: boolean;
  /** The last failed write, kept so a screen can say the switch did not save. */
  error: unknown | null;
  setEnabled: (enabled: boolean) => Promise<void>;
}

export function useReferenceLibrarySettings(): UseReferenceLibrarySettingsResult {
  const [settings, setSettings] = useState<ReferenceLibrarySettings | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    void loadReferenceLibrarySettings()
      .then((loaded) => {
        if (active) setSettings(loaded);
      })
      .catch(() => {
        if (active) setSettings(DEFAULT_REFERENCE_LIBRARY_SETTINGS);
      });
    const unsubscribe = subscribeToReferenceLibrarySettings((next) => {
      if (active) setSettings(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const setEnabled = useCallback(async (enabled: boolean) => {
    setError(null);
    // Optimistic: the switch moves immediately; a failed write falls back to
    // the last persisted value (save is write-first, so the cache is honest).
    setSettings((prev) => (prev === null ? prev : { ...prev, enabled }));
    try {
      const saved = await saveReferenceLibrarySettings({ enabled });
      setSettings(saved);
    } catch (err: unknown) {
      setError(err);
      try {
        setSettings(await loadReferenceLibrarySettings());
      } catch {
        setSettings((prev) => (prev === null ? prev : { ...prev, enabled: !enabled }));
      }
    }
  }, []);

  return {
    enabled: settings?.enabled ?? DEFAULT_REFERENCE_LIBRARY_SETTINGS.enabled,
    loaded: settings !== null,
    error,
    setEnabled,
  };
}
