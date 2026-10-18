/**
 * Theme persistence and hook.
 *
 * Supports 'system' (default) | 'light' | 'dark'.
 * - Persisted via `expo-secure-store` on native, `localStorage` on web,
 *   in-memory fallback on plain Node / Jest.
 * - Synchronizes with NativeWind's `useColorScheme().setColorScheme(...)`
 *   and, on web, the `dark` class on <html> that Tailwind's
 *   `darkMode: 'class'` emits (`.dark *` selectors).
 *
 * WHY the scheme is RESOLVED here instead of handing 'system' to NativeWind
 * (regression — this is what made 「跟随系统」 render half-dark):
 *
 * `react-native-css-interop`'s web `setColorScheme` treats any value other
 * than 'dark' as "remove the dark class", so `setColorScheme('system')`
 * unconditionally STRIPS `<html class="dark">` — even when the OS is in dark
 * mode. The `dark:` Tailwind variants then go inert while JS-side inline
 * styles (the tab bar reads `colors.surfaceDark`) stay dark: a dark tab bar
 * over washed-out light content.
 *
 * The old workaround (an effect in `_layout.tsx` re-adding the class from
 * `isDark`) could not repair it, because the failing transition is
 * dark → 'system' **on a dark OS**, where `isDark` stays `true` and the
 * effect never re-runs.
 *
 * So this hook owns the whole chain: it resolves the preference against the
 * live system scheme (`resolveColorScheme`), pushes only the CONCRETE
 * 'light' | 'dark' to NativeWind, and is the single writer of the web `dark`
 * class. NativeWind's own class write then agrees with ours instead of
 * fighting it.
 *
 * NOTE: We deliberately do NOT call React Native's `Appearance.setColorScheme()`
 * on Android/iOS because that calls AppCompatDelegate.setDefaultNightMode()
 * on Android, mutating the host Activity Configuration and permanently polluting
 * system theme detection. That pollution previously caused switching back to
 * 「跟随系统」 from dark mode to stay stuck in dark mode.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  Appearance,
  useColorScheme as useSystemColorScheme,
  type ColorSchemeName,
} from 'react-native';
import { useColorScheme as useNativeWindColorScheme } from 'nativewind';
import { isReactNativeRuntime } from '@nextdo/db';

export type ThemePreference = 'system' | 'light' | 'dark';
/** What the UI actually renders — 'system' is always resolved away. */
export type ResolvedColorScheme = 'light' | 'dark';

export const THEME_PREFERENCE_KEY = 'nextdo.settings.theme-preference';

interface KeyValue {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

interface WebStorageHost {
  localStorage?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
  };
}
function createMemoryStore(): KeyValue {
  const map = new Map<string, string>();
  return {
    async getItem(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
  };
}

function createStorage(): KeyValue {
  if (typeof isReactNativeRuntime === 'function' && isReactNativeRuntime()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const store = require('expo-secure-store') as {
        getItemAsync(key: string): Promise<string | null>;
        setItemAsync(key: string, value: string): Promise<void>;
      };
      return {
        getItem: (key) => store.getItemAsync(key),
        setItem: (key, value) => store.setItemAsync(key, value),
      };
    } catch {
      return createMemoryStore();
    }
  }
  const host = globalThis as unknown as WebStorageHost;
  if (host.localStorage !== undefined) {
    const ls = host.localStorage;
    return {
      async getItem(key) {
        return ls.getItem(key);
      },
      async setItem(key, value) {
        ls.setItem(key, value);
      },
    };
  }
  return createMemoryStore();
}

const storage = createStorage();

/* ---------------- Preference store ----------------
 *
 * Module-level (not per-hook-instance) because `useAppTheme` is called from
 * three places (root layout, tab layout, Settings). Per-instance state meant
 * three independent storage reads racing to call `setColorScheme`, so the
 * rendered scheme could depend on which effect resolved last. One cached
 * value + one read, fanned out through `useSyncExternalStore`.
 */

let cachedPreference: ThemePreference | null = null;
let loadStarted = false;
const listeners = new Set<() => void>();

/**
 * Authentic system scheme tracking.
 * On native Android, Appearance.setColorScheme('dark') delegates to
 * AppCompatDelegate.setDefaultNightMode(MODE_NIGHT_YES), which mutates
 * the Activity configuration uiMode to NIGHT. When subsequently switching back
 * to 'system', React Native's Appearance.setColorScheme('unspecified') sets
 * MODE_NIGHT_FOLLOW_SYSTEM, but does NOT reset the already-mutated
 * Activity configuration or dispatch onConfigurationChanged on Android!
 * As a result, useColorScheme() / Appearance.getColorScheme() remains stuck returning 'dark'.
 *
 * To prevent this, we capture the authentic OS scheme at module load
 * (before any override has run) and update it whenever the OS appearance
 * listener fires while in 'system' mode. When resolving 'system', we use
 * this authentic OS scheme and actively force native Appearance back to
 * that concrete scheme (MODE_NIGHT_NO or MODE_NIGHT_YES) so the host Activity
 * immediately switches back.
 */
let authenticSystemScheme: ResolvedColorScheme =
  Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';

try {
  Appearance.addChangeListener((preferences) => {
    if (cachedPreference === 'system' || cachedPreference === null) {
      if (preferences.colorScheme === 'dark' || preferences.colorScheme === 'light') {
        authenticSystemScheme = preferences.colorScheme;
        emitPreferenceChange();
      }
    }
  });
} catch {
  // Ignored in test/unsupported environments
}

function emitPreferenceChange(): void {
  for (const listener of Array.from(listeners)) listener();
}

function subscribePreference(listener: () => void): () => void {
  listeners.add(listener);
  if (!loadStarted) {
    loadStarted = true;
    void storage.getItem(THEME_PREFERENCE_KEY).then((stored) => {
      // A fresh install has no stored value, and a corrupted one may hold
      // junk: both resolve to 'system' (the default the UI shows first).
      const next: ThemePreference =
        stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
      if (next === cachedPreference) return;
      cachedPreference = next;
      emitPreferenceChange();
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

function getPreferenceSnapshot(): ThemePreference | null {
  return cachedPreference;
}

interface WebDocumentHost {
  document?: {
    documentElement?: {
      classList: {
        add(token: string): void;
        remove(token: string): void;
      };
    };
  };
}

/** The single writer of `<html class="dark">`. No-ops off web (native has no
 *  document; NativeWind resolves `dark:` variants from its observable there). */
function applyWebDarkClass(isDark: boolean): void {
  const root = (globalThis as unknown as WebDocumentHost).document?.documentElement;
  if (root === undefined) return;
  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

/** Pure: fold a stored preference + the live system scheme into what the UI
 *  renders. `null` preference means "not loaded yet" → follow the system, so
 *  the first paint is already correct instead of flashing light.
 *
 *  `systemScheme` is RN's `ColorSchemeName` ('light' | 'dark' |
 *  'unspecified'); 'unspecified' means "no preference" and renders light. */
export function resolveColorScheme(
  preference: ThemePreference | null,
  systemScheme: ColorSchemeName,
): ResolvedColorScheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemScheme === 'dark' ? 'dark' : 'light';
}

export function useAppTheme() {
  const { setColorScheme } = useNativeWindColorScheme();
  const preference = useSyncExternalStore(
    subscribePreference,
    getPreferenceSnapshot,
    getPreferenceSnapshot,
  );
  const systemScheme = useSystemColorScheme();

  if (
    (preference === 'system' || preference === null) &&
    (systemScheme === 'dark' || systemScheme === 'light')
  ) {
    authenticSystemScheme = systemScheme;
  }

  // When preference is 'system', use authenticSystemScheme so Android's
  // Activity uiMode override doesn't permanently trap the resolution in dark.
  const resolvedSystemScheme =
    preference === 'system' || preference === null
      ? (systemScheme ?? authenticSystemScheme)
      : authenticSystemScheme;

  // Derived in render (hook-guidelines rule 3), not synced by an effect.
  const colorScheme = resolveColorScheme(preference, resolvedSystemScheme);
  const isDark = colorScheme === 'dark';

  useEffect(() => {
    if (typeof isReactNativeRuntime === 'function' && isReactNativeRuntime()) {
      try {
        const target = preference === 'system' ? colorScheme : (preference ?? colorScheme);
        Appearance.setColorScheme(target);
        setColorScheme(target);
      } catch {
        // Appearance.setColorScheme may throw in test or unsupported environments
      }
    } else {
      // On web/desktop: never hand NativeWind 'system' because it strips the
      // .dark HTML class even on a dark OS. Hand concrete resolved scheme instead.
      try {
        setColorScheme(colorScheme);
      } catch {
        // NativeWind throws when darkMode isn't 'class' or when there is no
        // window (jest). The class below is the web source of truth anyway.
      }
      applyWebDarkClass(isDark);
    }
  }, [colorScheme, isDark, preference, setColorScheme]);

  const updatePreference = useCallback(async (next: ThemePreference) => {
    cachedPreference = next;
    emitPreferenceChange();
    if (typeof isReactNativeRuntime === 'function' && isReactNativeRuntime()) {
      try {
        const target = next === 'system' ? authenticSystemScheme : next;
        Appearance.setColorScheme(target);
        setColorScheme(target);
      } catch {
        // Appearance.setColorScheme may throw in test or unsupported environments
      }
    }
    await storage.setItem(THEME_PREFERENCE_KEY, next);
  }, [setColorScheme]);

  return {
    /** The stored PREFERENCE (what the Settings row highlights). `null`
     *  until the first read lands; reported as 'system' meanwhile. */
    preference: preference ?? 'system',
    isDark,
    colorScheme,
    updatePreference,
    loaded: preference !== null,
  };
}
