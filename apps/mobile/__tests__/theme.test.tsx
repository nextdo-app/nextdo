/**
 * Theme resolution — the 「跟随系统」 half-dark regression.
 *
 * Two defects, both rooted in handing the literal string 'system' to
 * NativeWind:
 *
 *  1. `react-native-css-interop`'s web `setColorScheme` treats every value
 *     that isn't 'dark' as "remove `<html class="dark">`" — including
 *     'system'. So switching 深色模式 → 跟随系统 on a dark OS stripped the
 *     class: `dark:` Tailwind variants went inert (washed-out light
 *     content) while the JS-driven tab bar stayed dark. The old
 *     `_layout.tsx` repair effect couldn't fix it because that transition
 *     leaves `isDark === true`, so an effect keyed on `[isDark]` never
 *     re-ran.
 *  2. With no stored preference (fresh install) the load path skipped
 *     `setColorScheme` entirely, leaving NativeWind's observable parked on
 *     its module-init `initialColor` — always 'light', since the class is
 *     absent at import time — so its `systemColorScheme` fallback was never
 *     reached and a dark-OS install rendered light.
 *
 * The fix resolves the scheme in the hook (`resolveColorScheme`) and pushes
 * only a CONCRETE 'light' | 'dark' onward. These tests assert that
 * contract: NativeWind must never receive 'system', and the web `dark` class
 * must track the resolved scheme on every transition — including the
 * dark → 跟随系统 → dark-OS case that used to strand it.
 *
 * `theme.ts` holds its preference cache at module scope (one read shared by
 * the three `useAppTheme` call sites), so this file exercises the hook as a
 * STATE MACHINE across a single mount rather than resetting modules per case
 * — `jest.resetModules()` would hand the hook a second React instance.
 */
// MUST stay first: installs the localStorage / document stand-ins that
// theme.ts captures at module load (imports are hoisted above statements).
import { htmlClass, mockThemeStore, resetThemeEnv } from './mocks/theme-env';

import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { resolveColorScheme, useAppTheme } from '@/lib/theme';

/* ---------------- mocks ---------------- */

/** Every value the hook pushes into NativeWind, in call order. The core
 *  assertion: none of them is ever 'system'. */
let mockNativeWindCalls: string[] = [];
/** Mutable stand-in for the OS appearance — the value RN's `useColorScheme`
 *  reports. On web that hook is backed by
 *  `matchMedia('(prefers-color-scheme: dark)')`, so this is the seam the
 *  test drives instead of a real appearance change. */
let mockSystemScheme: 'light' | 'dark' = 'light';

jest.mock('nativewind', () => ({
  useColorScheme: () => ({
    colorScheme: 'light',
    setColorScheme: (scheme: string) => {
      mockNativeWindCalls.push(scheme);
    },
    toggleColorScheme: () => {},
  }),
}));

// `useColorScheme` is mocked at the `react-native` boundary rather than by
// mocking RN's internal Appearance module: jest-expo's preset registers its
// own Appearance, so the hook kept reading a different module instance than
// a direct `Appearance` mock. A Proxy (not a spread) keeps RN's lazy getters
// intact — a spread would evaluate every getter and break the module.
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return new Proxy(actual, {
    get(target, prop, receiver) {
      if (prop === 'useColorScheme') return () => mockSystemScheme;
      return Reflect.get(target, prop, receiver);
    },
  });
});

jest.mock('@nextdo/db', () => ({
  isReactNativeRuntime: () => false,
}));

/** Renders the hook and surfaces what it resolved. */
function Probe({ onRender }: { onRender?: (v: ReturnType<typeof useAppTheme>) => void }) {
  const theme = useAppTheme();
  onRender?.(theme);
  return <Text testID="scheme">{theme.colorScheme}</Text>;
}

/** Re-render the mounted tree so the hook re-reads `mockSystemScheme`
 *  (the RN appearance listener in the jest env is inert). */
let mockRerender: (() => void) | null = null;

/** Flip the simulated OS appearance and re-render. */
async function setSystemScheme(next: 'light' | 'dark'): Promise<void> {
  mockSystemScheme = next;
  await act(async () => {
    mockRerender?.();
  });
}

beforeEach(() => {
  mockNativeWindCalls = [];
  mockSystemScheme = 'light';
  mockRerender = null;
  resetThemeEnv();
});

/* ---------------- pure resolver ---------------- */

describe('resolveColorScheme', () => {
  it('resolves 跟随系统 against the live system scheme', () => {
    expect(resolveColorScheme('system', 'dark')).toBe('dark');
    expect(resolveColorScheme('system', 'light')).toBe('light');
  });

  it('an explicit preference overrides the system scheme', () => {
    expect(resolveColorScheme('light', 'dark')).toBe('light');
    expect(resolveColorScheme('dark', 'light')).toBe('dark');
  });

  it('a not-yet-loaded preference (null) follows the system rather than defaulting to light', () => {
    expect(resolveColorScheme(null, 'dark')).toBe('dark');
    expect(resolveColorScheme(null, 'light')).toBe('light');
  });

  it('an unknown system scheme falls back to light', () => {
    // 'unspecified' is RN's "no preference" — it must render light, never
    // leave the UI on a stale scheme.
    expect(resolveColorScheme('system', 'unspecified')).toBe('light');
  });
});

/* ---------------- hook behaviour ---------------- */

describe('useAppTheme', () => {
  it('never hands NativeWind the literal "system" — only a concrete scheme', async () => {
    render(<Probe />);
    await act(async () => {});
    expect(mockNativeWindCalls.length).toBeGreaterThan(0);
    expect(mockNativeWindCalls.every((c) => c === 'light' || c === 'dark')).toBe(true);
  });

  it('walks every transition with the dark class and the resolved scheme in lockstep', async () => {
    // One mount, the full matrix. `theme.ts` caches its preference at module
    // scope, so a fresh install can only be observed on the FIRST mount of
    // the file — hence the state machine rather than one case per scenario.
    mockSystemScheme = 'dark';
    let theme!: ReturnType<typeof useAppTheme>;
    const view = render(<Probe onRender={(v) => (theme = v)} />);
    mockRerender = () => view.rerender(<Probe onRender={(v) => (theme = v)} />);
    await act(async () => {});

    // --- fresh install on a dark OS (regression: the load path used to skip
    // setColorScheme, parking NativeWind on its always-'light' initialColor).
    expect(screen.getByTestId('scheme').props.children).toBe('dark');
    expect(htmlClass()).toContain('dark');

    // --- 深色模式 → 跟随系统 with the OS STILL dark. The half-dark regression:
    // `isDark` stays true, so the old `[isDark]`-keyed repair effect in
    // _layout.tsx never re-ran and the class stayed stripped.
    await act(async () => {
      await theme.updatePreference('dark');
    });
    expect(htmlClass()).toContain('dark');
    await act(async () => {
      await theme.updatePreference('system');
    });
    expect(theme.preference).toBe('system');
    expect(theme.isDark).toBe(true);
    expect(htmlClass()).toContain('dark');
    expect(screen.getByTestId('scheme').props.children).toBe('dark');

    // --- 跟随系统 following a LIVE OS flip to light.
    await setSystemScheme('light');
    expect(theme.isDark).toBe(false);
    expect(htmlClass()).not.toContain('dark');
    expect(screen.getByTestId('scheme').props.children).toBe('light');

    // --- and back to dark, still on 跟随系统.
    await setSystemScheme('dark');
    expect(theme.isDark).toBe(true);
    expect(htmlClass()).toContain('dark');

    // --- an explicit pin wins over the OS in both directions.
    await act(async () => {
      await theme.updatePreference('light');
    });
    expect(htmlClass()).not.toContain('dark');
    await act(async () => {
      await theme.updatePreference('dark');
    });
    expect(htmlClass()).toContain('dark');

    // NativeWind must never have been told 'system' at any point above.
    expect(mockNativeWindCalls.every((c) => c === 'light' || c === 'dark')).toBe(true);
  });

  it('persists the choice so the next launch restores it', async () => {
    let theme!: ReturnType<typeof useAppTheme>;
    render(<Probe onRender={(v) => (theme = v)} />);
    mockRerender = () => {};
    await act(async () => {});

    await act(async () => {
      await theme.updatePreference('light');
    });
    expect(mockThemeStore.get('nextdo.settings.theme-preference')).toBe('light');
    // A brand-new subscriber (a screen mounting later) reads the same value.
    expect(theme.preference).toBe('light');
  });

  it('restores light appearance when switching from dark back to system on a light OS', async () => {
    mockSystemScheme = 'light';
    let theme!: ReturnType<typeof useAppTheme>;
    const view = render(<Probe onRender={(v) => (theme = v)} />);
    mockRerender = () => view.rerender(<Probe onRender={(v) => (theme = v)} />);
    await act(async () => {});

    // Initial state on light OS is light
    expect(theme.colorScheme).toBe('light');
    expect(htmlClass()).not.toContain('dark');

    // Switch to dark mode
    await act(async () => {
      await theme.updatePreference('dark');
    });
    expect(theme.colorScheme).toBe('dark');
    expect(htmlClass()).toContain('dark');

    // Switch back to system -> must resolve to light immediately
    await act(async () => {
      await theme.updatePreference('system');
    });
    expect(theme.preference).toBe('system');
    expect(theme.colorScheme).toBe('light');
    expect(htmlClass()).not.toContain('dark');
  });

  it('multiple subscribers (TabBar and Screen) always update in lockstep when OS theme flips', async () => {
    mockSystemScheme = 'dark';
    let tabTheme!: ReturnType<typeof useAppTheme>;
    let screenTheme!: ReturnType<typeof useAppTheme>;

    function MultiSubscriberProbe() {
      tabTheme = useAppTheme();
      screenTheme = useAppTheme();
      return (
        <Text testID="pair">
          {`${tabTheme.colorScheme}:${screenTheme.colorScheme}`}
        </Text>
      );
    }

    const view = render(<MultiSubscriberProbe />);
    mockRerender = () => view.rerender(<MultiSubscriberProbe />);
    await act(async () => {});

    expect(screen.getByTestId('pair').props.children).toBe('dark:dark');
    expect(tabTheme.isDark).toBe(true);
    expect(screenTheme.isDark).toBe(true);
    expect(htmlClass()).toContain('dark');

    // Flip OS to light
    await setSystemScheme('light');
    expect(screen.getByTestId('pair').props.children).toBe('light:light');
    expect(tabTheme.isDark).toBe(false);
    expect(screenTheme.isDark).toBe(false);
    expect(htmlClass()).not.toContain('dark');

    // Flip OS back to dark
    await setSystemScheme('dark');
    expect(screen.getByTestId('pair').props.children).toBe('dark:dark');
    expect(tabTheme.isDark).toBe(true);
    expect(screenTheme.isDark).toBe(true);
    expect(htmlClass()).toContain('dark');
  });
});
