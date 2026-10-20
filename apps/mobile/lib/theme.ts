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

export interface ThemeSnapshot {
  preference: ThemePreference;
  colorScheme: ResolvedColorScheme;
  isDark: boolean;
  loaded: boolean;
}

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

/* ---------------- Preference & theme store ----------------
 *
 * Module-level (not per-hook-instance) because `useAppTheme` is called from
 * multiple places (root layout, tab layout, Settings, modals). Per-instance state
 * previously caused independent resolvers racing to call `setColorScheme` and
 * mutating DOM classList out of order, leading to half-dark/half-light tear.
 *
 * One immutable snapshot + one subscriber queue, fanned out through
 * `useSyncExternalStore`.
 */

let cachedPreference: ThemePreference | null = null;
let loadStarted = false;
const listeners = new Set<() => void>();

interface WebMediaQueryList {
  matches: boolean;
  addEventListener?(type: string, listener: (e: { matches: boolean }) => void): void;
  addListener?(listener: (e: { matches: boolean }) => void): void;
}

interface TauriInternals {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

interface WebHost {
  window?: {
    matchMedia?(query: string): WebMediaQueryList;
    __TAURI_INTERNALS__?: TauriInternals;
  };
  document?: {
    documentElement?: {
      classList: {
        add(token: string): void;
        remove(token: string): void;
      };
    };
    querySelectorAll?(selector: string): ArrayLike<{
      setAttribute(name: string, value: string): void;
    }>;
  };
}

/** The single writer of `<html class="dark">`. No-ops off web (native has no
 *  document; NativeWind resolves `dark:` variants from its observable there). */
function applyWebDarkClass(isDark: boolean): void {
  const root = (globalThis as unknown as WebHost).document?.documentElement;
  if (root === undefined) return;
  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

function syncMetaThemeColor(isDark: boolean): void {
  const host = globalThis as unknown as WebHost;
  const doc = host.document;
  if (!doc?.querySelectorAll) return;
  const metas = doc.querySelectorAll('meta[name="theme-color"]');
  if (metas && metas.length > 0) {
    const color = isDark ? '#171412' : '#faf9f6';
    for (let i = 0; i < metas.length; i++) {
      const el = metas[i];
      if (el) {
        el.setAttribute('content', color);
      }
    }
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

function getRawSystemScheme(): ResolvedColorScheme {
  const host = globalThis as unknown as WebHost;
  if (typeof host.window?.matchMedia === 'function') {
    try {
      return host.window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      // Fallback
    }
  }
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

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
let authenticSystemScheme: ResolvedColorScheme = getRawSystemScheme();

function computeSnapshot(
  preference: ThemePreference | null,
  systemScheme: ResolvedColorScheme,
): ThemeSnapshot {
  const resolvedSystemScheme =
    preference === 'system' || preference === null
      ? systemScheme
      : authenticSystemScheme;
  const colorScheme = resolveColorScheme(preference, resolvedSystemScheme);
  return {
    preference: preference ?? 'system',
    colorScheme,
    isDark: colorScheme === 'dark',
    loaded: preference !== null,
  };
}

let currentSnapshot: ThemeSnapshot = computeSnapshot(cachedPreference, authenticSystemScheme);
// Sync web dark class at module load so initial paint is already synchronized
applyWebDarkClass(currentSnapshot.isDark);

function syncTauriWindowTheme(colorScheme: ResolvedColorScheme): void {
  const host = globalThis as unknown as WebHost;
  const internals = host.window?.__TAURI_INTERNALS__;
  if (internals?.invoke) {
    void internals.invoke('set_window_theme', { theme: colorScheme }).catch(() => {});
  }
}

function syncPlatformTheme(snapshot: ThemeSnapshot): void {
  applyWebDarkClass(snapshot.isDark);
  syncMetaThemeColor(snapshot.isDark);
  syncTauriWindowTheme(snapshot.colorScheme);
  if (typeof isReactNativeRuntime === 'function' && isReactNativeRuntime()) {
    try {
      Appearance.setColorScheme(snapshot.colorScheme);
    } catch {
      // Appearance.setColorScheme may throw in test or unsupported environments
    }
  }
}

function updateThemeState(
  newPref: ThemePreference | null,
  newSystem: ResolvedColorScheme,
): void {
  cachedPreference = newPref;
  authenticSystemScheme = newSystem;
  const nextSnapshot = computeSnapshot(newPref, newSystem);
  if (
    nextSnapshot.preference === currentSnapshot.preference &&
    nextSnapshot.colorScheme === currentSnapshot.colorScheme &&
    nextSnapshot.isDark === currentSnapshot.isDark &&
    nextSnapshot.loaded === currentSnapshot.loaded
  ) {
    return;
  }
  currentSnapshot = nextSnapshot;
  syncPlatformTheme(currentSnapshot);
  for (const listener of Array.from(listeners)) {
    listener();
  }
}

function handleSystemSchemeChange(nextScheme: ResolvedColorScheme): void {
  if (cachedPreference === 'system' || cachedPreference === null) {
    updateThemeState(cachedPreference, nextScheme);
  } else {
    authenticSystemScheme = nextScheme;
  }
}

// 1. Web / Desktop media query listener (modern addEventListener with addListener fallback)
const webHost = globalThis as unknown as WebHost;
if (typeof webHost.window?.matchMedia === 'function') {
  try {
    const mql = webHost.window.matchMedia('(prefers-color-scheme: dark)');
    const onMediaChange = (e: { matches: boolean }) => {
      handleSystemSchemeChange(e.matches ? 'dark' : 'light');
    };
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onMediaChange);
    } else if (typeof mql.addListener === 'function') {
      mql.addListener(onMediaChange);
    }
  } catch {
    // Ignored in test/unsupported environments
  }
}

// 2. Tauri desktop native theme detection (queries macOS native appearance directly)
if (webHost.window?.__TAURI_INTERNALS__?.invoke) {
  void webHost.window.__TAURI_INTERNALS__
    .invoke('get_system_theme', {})
    .then((theme) => {
      if (theme === 'dark' || theme === 'light') {
        handleSystemSchemeChange(theme);
      }
    })
    .catch(() => {});
}

// 3. React Native Appearance change listener
try {
  Appearance.addChangeListener((preferences) => {
    if (preferences.colorScheme === 'dark' || preferences.colorScheme === 'light') {
      handleSystemSchemeChange(preferences.colorScheme);
    }
  });
} catch {
  // Ignored in test/unsupported environments
}

function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  if (!loadStarted) {
    loadStarted = true;
    void storage.getItem(THEME_PREFERENCE_KEY).then((stored) => {
      // A fresh install has no stored value, and a corrupted one may hold
      // junk: both resolve to 'system' (the default the UI shows first).
      const next: ThemePreference =
        stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
      updateThemeState(next, authenticSystemScheme);
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

function getThemeSnapshot(): ThemeSnapshot {
  return currentSnapshot;
}

export function useAppTheme() {
  const { setColorScheme } = useNativeWindColorScheme();
  const systemScheme = useSystemColorScheme();

  const rawSnapshot = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getThemeSnapshot,
  );

  // If live system scheme (from useColorScheme or media query) changed while in system mode,
  // derive the effective snapshot immediately for this render pass to eliminate visual lag.
  const snapshot =
    (systemScheme === 'dark' || systemScheme === 'light') &&
    systemScheme !== authenticSystemScheme &&
    (rawSnapshot.preference === 'system' || !rawSnapshot.loaded)
      ? computeSnapshot(rawSnapshot.preference, systemScheme)
      : rawSnapshot;

  useEffect(() => {
    if (
      (systemScheme === 'dark' || systemScheme === 'light') &&
      systemScheme !== authenticSystemScheme &&
      (rawSnapshot.preference === 'system' || !rawSnapshot.loaded)
    ) {
      updateThemeState(cachedPreference, systemScheme);
    }
  }, [systemScheme, rawSnapshot.preference, rawSnapshot.loaded]);

  useEffect(() => {
    try {
      setColorScheme(snapshot.colorScheme);
    } catch {
      // NativeWind throws when darkMode isn't 'class' or when there is no
      // window (jest). The class below is the web source of truth anyway.
    }
    applyWebDarkClass(snapshot.isDark);
  }, [snapshot.colorScheme, snapshot.isDark, setColorScheme]);

  const updatePreference = useCallback(async (next: ThemePreference) => {
    updateThemeState(next, authenticSystemScheme);
    await storage.setItem(THEME_PREFERENCE_KEY, next);
  }, []);

  return {
    /** The stored PREFERENCE (what the Settings row highlights). `null`
     *  until the first read lands; reported as 'system' meanwhile. */
    preference: snapshot.preference,
    isDark: snapshot.isDark,
    colorScheme: snapshot.colorScheme,
    updatePreference,
    loaded: snapshot.loaded,
  };
}
