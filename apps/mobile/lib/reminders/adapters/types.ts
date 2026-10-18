/**
 * Delivery adapter contract (task 09-30 design §4) — one adapter per
 * platform, selected once in `adapters/index.ts`:
 *
 * - `native` (iOS / Android): expo-notifications — OS-persisted scheduling
 *   (the notification still fires after the app is force-killed);
 * - `tauri` (desktop webview): tauri-plugin-notification — in-session
 *   delivery only (the desktop plugin cannot schedule, research-verified);
 * - `web` (plain browser): no-op (R6).
 *
 * The hook (`hooks/use-reminder-delivery.ts`) is the only consumer. The
 * adapters are THIN wrappers over the platform modules — the pure decision
 * logic (which rows to schedule / cancel / fire) lives in
 * `reminder-scheduler.ts` and is unit-tested there.
 */
import type { ReconcileOutput } from '../reminder-scheduler';

/** The adapter's delivery platform (drives the Settings copy, R5). */
export type DeliveryPlatform = 'native' | 'tauri' | 'web';

/**
 * The OS notification permission, normalized for the Settings block (R5):
 * three states + a "can we prompt again" flag (denied + !canAskAgain →
 * the iOS "去系统设置" button).
 */
export interface ReminderPermissionState {
  /** Which adapter answered — the Settings copy differs per platform. */
  platform: DeliveryPlatform;
  status: 'undetermined' | 'granted' | 'denied';
  /** Native only: whether the OS will show the prompt again. */
  canAskAgain: boolean;
}

export interface DeliveryAdapter {
  readonly platform: DeliveryPlatform;
  /**
   * One-time setup (foreground presentation handler + channels + the
   * notification-click listener). Idempotent across init/dispose cycles
   * (React StrictMode double-mount in dev must not double-register).
   * @param onNotificationOpened the user tapped a notification (hot or
   *   cold start) — the hook routes to the Now tab (R4).
   */
  init(onNotificationOpened: () => void): Promise<void>;
  /**
   * Reminder row ids currently armed in the OS (the reconcile join key —
   * the schedule identifier). tauri/web: always empty (no OS-side pending
   * state). A FAILURE here must reject (a wrong/empty set would make the
   * reconcile (re)schedule rows that are already armed — duplicates).
   */
  listPendingIds(): Promise<Set<string>>;
  /** Apply one reconcile output (the adapter honors the parts its mode
   *  produces: native → schedule/cancel, tauri → fireNow). */
  apply(output: ReconcileOutput): Promise<void>;
  /** The current OS permission state (R5). */
  permission(): Promise<ReminderPermissionState>;
  /** Ask the OS (native: the system prompt, only while undetermined;
   *  tauri: always granted, no prompt exists; web: no-op). */
  requestPermission(): Promise<ReminderPermissionState>;
  /** Native: jump to this app's system notification settings (the denied
   *  state, R5) — iOS `app-settings:`; Android
   *  `ACTION_APP_NOTIFICATION_SETTINGS` with the package, falling back to
   *  the app details page. No-op on tauri/web. */
  openSystemSettings(): Promise<void>;
  /** Tauri-only reconcile context (the in-session fired set + session
   *  start) — native/web adapters omit it (their modes don't consume it). */
  tauriContext?(): { firedIds: ReadonlySet<string>; sessionStart: Date };
  /** Release listeners (hook unmount). Idempotent. */
  dispose(): void;
}

/**
 * The notification TITLE per action kind (design §2.2) — shared by every
 * adapter that renders content, Chinese like the rest of the app.
 */
export const KIND_TITLES = {
  next: '稍后提醒',
  calendar: '即将开始',
  habit: '习惯提醒',
} as const;
