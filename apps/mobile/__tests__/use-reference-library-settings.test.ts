/**
 * Hook regression — the optional reference-library switch (issue #90 R1).
 *
 * A real Web localStorage refusal must reach the hook: the switch rolls back
 * to the last persisted value and the Settings screen can show an error.
 * The module-level unit test covers the adapter; this covers the UI state
 * the user actually sees.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useReferenceLibrarySettings } from '@/hooks/use-reference-library-settings';
import {
  REFERENCE_LIBRARY_SETTINGS_KEY,
  __setReferenceLibrarySettingsStoreForTests,
  loadReferenceLibrarySettings,
} from '@/lib/reference-library-settings';

const G = globalThis as {
  window?: {
    localStorage?: {
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
    };
  };
};

afterEach(() => {
  __setReferenceLibrarySettingsStoreForTests(null);
});

describe('useReferenceLibrarySettings', () => {
  it('rolls back and exposes the error when the Web write fails', async () => {
    const raw = new Map([[REFERENCE_LIBRARY_SETTINGS_KEY, '{"enabled":true}']]);
    const previousWindow = G.window;
    G.window = {
      ...G.window,
      localStorage: {
        getItem: (key) => raw.get(key) ?? null,
        setItem: () => {
          throw new Error('quota exceeded');
        },
      },
    };
    __setReferenceLibrarySettingsStoreForTests(null);

    try {
      const { result } = renderHook(() => useReferenceLibrarySettings());
      await waitFor(() => expect(result.current.loaded).toBe(true));
      expect(result.current.enabled).toBe(true);

      await act(async () => {
        await result.current.setEnabled(false);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      // Optimistic OFF was undone; the persisted value is still ON.
      expect(result.current.enabled).toBe(true);
      expect(await loadReferenceLibrarySettings()).toEqual({ enabled: true });
    } finally {
      G.window = previousWindow;
    }
  });
});
