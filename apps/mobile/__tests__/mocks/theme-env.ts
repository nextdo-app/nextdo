/**
 * Global web stand-ins for the theme tests.
 *
 * `theme.ts` captures its storage handle at MODULE LOAD, and ES imports are
 * hoisted above statements — so a `localStorage` defined in the test body
 * would be installed too late. Importing this module FIRST (it must stay the
 * first import in the test file) guarantees the globals exist before
 * `@/lib/theme` is evaluated, without needing a jest setup file or a module
 * registry reset (which would hand the hook a different React instance).
 */

/** The persisted preference. `null` = fresh install. */
export const mockThemeStore = new Map<string, string>();

/** The `<html class="dark">` flag the hook owns. Read through
 *  `htmlClass()` — a `let` export would be snapshotted by the CJS transform,
 *  so importers would never see later mutations. */
let htmlClassValue = '';

/** The current `<html class="dark">` value. */
export function htmlClass(): string {
  return htmlClassValue;
}

export function resetThemeEnv(): void {
  mockThemeStore.clear();
  htmlClassValue = '';
}

/** Every Tauri IPC call made while the stub is installed, in call order. */
export const mockTauriCalls: Array<{
  command: string;
  args?: Record<string, unknown>;
}> = [];

let previousWindow: PropertyDescriptor | undefined;

/**
 * Installs a `window.__TAURI_INTERNALS__` stub so desktop-only theme bridging
 * (the shell's `set_window_theme` push) can be observed. The real desktop app
 * injects this object before any script runs; in jest there is no Tauri host.
 */
export function installTauriStub(): void {
  mockTauriCalls.length = 0;
  previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args?: Record<string, unknown>) => {
          mockTauriCalls.push({ command, args });
        },
      },
    },
  });
}

/** Restores whatever `window` looked like before `installTauriStub()`. */
export function removeTauriStub(): void {
  if (previousWindow) {
    Object.defineProperty(globalThis, 'window', previousWindow);
  } else {
    delete (globalThis as unknown as { window?: unknown }).window;
  }
  previousWindow = undefined;
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => mockThemeStore.get(k) ?? null,
    setItem: (k: string, v: string) => void mockThemeStore.set(k, v),
  },
});

Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: {
    documentElement: {
      classList: {
        add(token: string) {
          if (!htmlClassValue.split(' ').includes(token)) {
            htmlClassValue = htmlClassValue ? `${htmlClassValue} ${token}` : token;
          }
        },
        remove(token: string) {
          htmlClassValue = htmlClassValue
            .split(' ')
            .filter((t) => t !== token)
            .join(' ');
        },
      },
    },
  },
});
