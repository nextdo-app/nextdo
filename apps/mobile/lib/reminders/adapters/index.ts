/**
 * Platform selection (design §4.3):
 *
 *   Platform.OS === 'web'
 *     ? (isTauriRuntime() ? tauri : noop)
 *     : native
 *
 * The adapter is a MODULE SINGLETON: the root-layout delivery hook and
 * the Settings permission hook share one instance (the OS state — pending
 * schedules, the tauri fired set — is per-device, not per-mount).
 *
 * The tauri plugin is statically imported by `tauri.ts` but is stubbed to
 * an empty module in the NATIVE bundle (metro.config.js `resolveRequest`,
 * the same pattern as the PowerSync platform split) and is never called
 * on plain web (selection above) — no IPC code reaches a browser.
 */
import { Platform } from 'react-native';
import { createNativeAdapter } from './native';
import { createTauriAdapter } from './tauri';
import { createWebAdapter } from './web';
import type { DeliveryAdapter } from './types';

/**
 * The Tauri shell injects `__TAURI_INTERNALS__` into its webview before
 * the app script runs — the detection the design prescribes (no
 * `@tauri-apps/api` import, which would drag IPC into the bundle graph).
 * The app tsconfig has no DOM lib, so the global is reached through a
 * typed view (the `_layout.tsx` web-font pattern).
 */
function isTauriRuntime(): boolean {
  const host = globalThis as { window?: { __TAURI_INTERNALS__?: unknown } };
  return host.window?.__TAURI_INTERNALS__ !== undefined;
}

function createAdapterForPlatform(): DeliveryAdapter {
  if (Platform.OS === 'web') {
    return isTauriRuntime() ? createTauriAdapter() : createWebAdapter();
  }
  return createNativeAdapter();
}

let instance: DeliveryAdapter | null = null;

/** The device's delivery adapter (created on first use). */
export function getDeliveryAdapter(): DeliveryAdapter {
  if (instance === null) instance = createAdapterForPlatform();
  return instance;
}

/** Jest escape hatch: drop the singleton between tests (module registry
 *  isolation makes a shared instance leak adapter state). */
export function __resetDeliveryAdapterForTests(): void {
  instance?.dispose();
  instance = null;
}

export type {
  DeliveryAdapter,
  DeliveryInitHandlers,
  DeliveryPlatform,
  ReminderPermissionState,
} from './types';
export { KIND_TITLES } from './types';
