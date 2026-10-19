/**
 * Tauri desktop adapter (design §4.2): the desktop webview runs the SAME
 * bundle as the web build; the tauri-plugin-notification commands only
 * exist when the Rust shell is present (selected by `window
 * .__TAURI_INTERNALS__` in `adapters/index.ts` — this module is never
 * instantiated on plain web, and Metro stubs it out of the native bundle).
 *
 * Hard constraints (research/tauri-plugin-notification.md, verified in
 * the 2.4.0 crate source):
 *
 * - Desktop has NO native scheduling: the plugin's `show()` is
 *   immediate-only and the `schedule` field is deserialized and never
 *   read. Delivery = the hook's 30 s tick + this adapter's `fireNow`
 *   (grace window in `reminder-scheduler.ts`). **The reminder never
 *   fires while the app is closed** — the v1 desktop limitation
 *   (documented; the Now screen shows the overdue action instead).
 * - The Rust side registers exactly three commands: `notify` /
 *   `request_permission` / `is_permission_granted`. This adapter uses
 *   `isPermissionGranted` (plugin JS — a proper IPC invoke) and the
 *   `notify` command INVOKED DIRECTLY (see `tauriInvoke`). `pending` /
 *   `cancel` / `channels` / `onNotificationReceived` / … would reject
 *   with "command not found" — do not add calls here.
 * - The plugin JS `sendNotification` is deliberately NOT used: in
 *   2.4.0 it does `new window.Notification(...)` and relies on the
 *   plugin's init script having replaced that constructor with a
 *   fire-and-forget IPC call — the constructor's async IIFE is never
 *   returned, so `await sendNotification(...)` can NEVER reject (the
 *   "confirmed send" contract below would be dead code), and with the
 *   init script absent it throws a synchronous TypeError instead. The
 *   direct invoke below is the SAME command the init script calls,
 *   with a real promise: success means the command accepted the
 *   notification, failure reaches the catch and retries within the
 *   grace window.
 * - No click event and no payload read-back on desktop → tapping the
 *   notification just focuses/launches the app (D2's desktop
 *   degradation — no deep-link to the action).
 */
import { isPermissionGranted } from '@tauri-apps/plugin-notification';
import { logger } from '@nextdo/core';
import { playReminderSound } from '../../notification-sound';
import { postDebugLog } from '../debug-log';
import type { ReconcileOutput } from '../reminder-scheduler';
import type { DeliveryAdapter, ReminderPermissionState, ReminderSoundPreferences } from './types';
import { KIND_TITLES } from './types';

/**
 * Fired-id cap (design §4.2): the set bounds one desktop session; beyond
 * the cap the OLDEST id is evicted (a re-delivery of a very old reminder
 * is preferable to unbounded growth — the reconcile's other rules keep
 * duplicates from being a practical problem).
 */
const FIRED_IDS_MAX = 500;

/**
 * Failure-warning throttle (per reminder id): a persistently failing send
 * (e.g. notifications disabled in macOS Settings) would otherwise log once
 * per 30 s tick for the whole 5 min grace window.
 */
const FAILURE_LOG_GAP_MS = 60_000;

/**
 * Session state, module level (the adapter is a module singleton — a
 * hook remount in dev must not reset the dedupe set and re-fire): the ids
 * delivered this launch + the launch moment + the last failure-warning
 * moment per id.
 */
const firedIds = new Set<string>();
const lastFailureLoggedAt = new Map<string, number>();
let sessionStart: Date | null = null;

/** Issue #54: desktop delivery is in-session, so the reminder tone is played
 *  by the app itself. There is no OS scheduling here to mute, so the switch
 *  only gates that playback. Defaults match `DEFAULT_NOTIFICATION_SETTINGS`. */
let soundPreferences: ReminderSoundPreferences = {
  enabled: true,
  tone: 'gentle',
};

/**
 * The Tauri v2 IPC bridge, injected into the webview as a window global
 * by the shell (the same access pattern `packages/db` uses for its
 * stronghold commands — no `@tauri-apps/api` import, which would drag
 * the IPC layer into the bundle graph; see `adapters/index.ts`).
 */
interface TauriInternals {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

function tauriInvoke(
  command: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const internals = (
    globalThis as { window?: { __TAURI_INTERNALS__?: TauriInternals } }
  ).window?.__TAURI_INTERNALS__;
  if (internals === undefined) {
    // Unreachable in practice — the adapter is only created when
    // isTauriRuntime() saw the bridge — but a real rejection is what the
    // "confirmed send" contract needs (never a silent success).
    return Promise.reject(
      new Error('Tauri IPC bridge missing (not running in the desktop shell)'),
    );
  }
  return internals.invoke(command, args);
}

function rememberFired(ids: string[]): void {
  for (const id of ids) firedIds.add(id);
  while (firedIds.size > FIRED_IDS_MAX) {
    const oldest = firedIds.values().next().value;
    if (oldest === undefined) break;
    firedIds.delete(oldest);
  }
}

export function createTauriAdapter(): DeliveryAdapter {
  return {
    platform: 'tauri',

    async init(): Promise<void> {
      // No OS setup exists on desktop (no channels, no click listener —
      // the plugin emits nothing there). Record the session start for the
      // reconcile's diagnostics.
      sessionStart ??= new Date();
    },

    async listPendingIds(): Promise<Set<string>> {
      // Desktop has no OS-side pending state (nothing persists across
      // restarts) — the reconcile's tauri mode ignores `toCancel` anyway.
      return new Set();
    },

    async apply(output: ReconcileOutput): Promise<void> {
      // toSchedule / toCancel are native-only (the pure reconcile never
      // produces them in tauri mode).
      for (const item of output.toFireNow) {
        // `sound` is intentionally NOT mapped (PRD R3): notify-rust's
        // desktop sound handling is platform-fragile — v1 plays the OS
        // default for every intensity tier.
        try {
          // The Rust `notify` command (same one the plugin's init script
          // calls — see the module doc for why the plugin JS wrapper is
          // bypassed): the arg shape is `{ options: NotificationData }`
          // (tauri-plugin-notification 2.4.0 `src/commands.rs`).
          await tauriInvoke('plugin:notification|notify', {
            options: {
              title: KIND_TITLES[item.row.kind],
              body: item.title,
            },
          });
          // Only a CONFIRMED send counts as delivered: a failed send
          // (permission denied in macOS Settings, IPC error) is retried
          // by the next tick while the row is still inside the grace
          // window, instead of being silently lost for the session.
          rememberFired([item.row.id]);
          lastFailureLoggedAt.delete(item.row.id);
          // Issue #54: audible alert alongside the desktop notification.
          // Fire-and-forget — playback failure must never mark the send as
          // failed (the notification itself was delivered).
          if (soundPreferences.enabled) {
            void playReminderSound();
          }
          postDebugLog({ kind: 'send', ok: true, reminderId: item.row.id, title: item.title });
        } catch (error) {
          const nowMs = Date.now();
          const last = lastFailureLoggedAt.get(item.row.id);
          if (last === undefined || nowMs - last >= FAILURE_LOG_GAP_MS) {
            lastFailureLoggedAt.set(item.row.id, nowMs);
            logger.warn(
              'tauri notify invoke failed (will retry within the grace window)',
              error instanceof Error ? error : new Error(String(error)),
            );
          }
          postDebugLog({
            kind: 'send',
            ok: false,
            reminderId: item.row.id,
            title: item.title,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },

    async permission(): Promise<ReminderPermissionState> {
      try {
        // The desktop Rust side ALWAYS reports granted (no prompt model);
        // it does NOT detect the user having disabled notifications in the
        // OS settings (macOS) — the Settings copy says "跟随系统设置".
        const granted = await isPermissionGranted();
        return {
          platform: 'tauri',
          status: granted ? 'granted' : 'denied',
          canAskAgain: false,
        };
      } catch {
        // Command missing = the shell lacks the notification plugin:
        // delivery is best-effort, report available (nothing to prompt).
        return { platform: 'tauri', status: 'granted', canAskAgain: false };
      }
    },

    async requestPermission(): Promise<ReminderPermissionState> {
      // Desktop: always granted, no prompt exists — same as permission().
      return this.permission();
    },

    async openSystemSettings(): Promise<void> {
      // No-op: the user manages desktop notifications in the OS settings
      // directly (the Settings block only shows text on tauri).
    },

    tauriContext(): { firedIds: ReadonlySet<string>; sessionStart: Date } {
      return { firedIds, sessionStart: sessionStart ?? new Date() };
    },

    setSoundPreferences(preferences: ReminderSoundPreferences): void {
      soundPreferences = preferences;
    },

    dispose(): void {
      // Nothing to release (no listeners exist on desktop).
    },
  };
}
