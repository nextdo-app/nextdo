/**
 * Web PWA notification delivery adapter (issue #92).
 *
 * Supports:
 * - Desktop browsers (Chrome, Edge, Firefox, Safari) via Notification API
 * - iOS 16.4+ in standalone PWA mode (after user added Nextdo to Home Screen)
 * - Service Worker showNotification fallback
 * - Graceful degradation when notifications are unsupported or pending installation
 *
 * Delivery is FOREGROUND ONLY: the reconcile fires while a Nextdo tab is
 * open (the 30 s in-session tick in `use-reminder-delivery`). There is no
 * Web Push subscription/sender yet, so closing the page stops delivery —
 * the Settings copy states that boundary.
 *
 * The adapter is the module singleton selected by `adapters/index.ts`
 * (created once per page session), so its fired-id set is the session
 * dedupe source `computeReconcile` consumes through `sessionContext()`.
 *
 * Two additional race guards live here (issue #92 review):
 * - `setDeliveryEnabled` is a LIVE gate re-read after every await, so a
 *   switch turned off while `serviceWorker.ready` is pending suppresses the
 *   send (including the 2 s timeout fallback path);
 * - `inFlightIds` claims an id BEFORE the first await and releases it on
 *   failure, so a hook remount cannot send an unfinished reminder twice
 *   while a later tick can still retry it.
 */

import { logger } from '@nextdo/core';
import {
  clearReminderDeliveryFailure,
  reportReminderDeliveryFailure,
} from '../delivery-feedback';
import type { ReconcileOutput } from '../reminder-scheduler';
import type { DeliveryAdapter, ReminderPermissionState } from './types';
import { KIND_TITLES } from './types';

const FIRED_IDS_MAX = 500;

/**
 * How long `navigator.serviceWorker.ready` may stay pending before the
 * adapter falls back to `new Notification`. A failed/pending SW
 * registration must not wedge the whole reconcile queue (every future tick
 * awaits this promise).
 */
const SERVICE_WORKER_READY_TIMEOUT_MS = 2_000;

interface WebNotificationOptions {
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  renotify?: boolean;
}

interface WebNotificationCtor {
  new (title: string, options?: WebNotificationOptions): unknown;
  permission: 'default' | 'granted' | 'denied';
  requestPermission(): Promise<'default' | 'granted' | 'denied'>;
}

interface WebServiceWorkerRegistration {
  showNotification(title: string, options?: WebNotificationOptions): Promise<void>;
}

interface WebHostWindow {
  Notification?: WebNotificationCtor;
  navigator?: {
    userAgent?: string;
    maxTouchPoints?: number;
    standalone?: boolean;
    serviceWorker?: {
      ready: Promise<WebServiceWorkerRegistration>;
    };
  };
  matchMedia?: (query: string) => { matches: boolean };
}

function getWebWindow(): WebHostWindow | undefined {
  return typeof globalThis !== 'undefined'
    ? (globalThis as unknown as { window?: WebHostWindow }).window
    : undefined;
}

function isIosNonStandalone(): boolean {
  const win = getWebWindow();
  if (!win?.navigator?.userAgent) return false;

  const ua = win.navigator.userAgent;
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Macintosh') && (win.navigator.maxTouchPoints ?? 0) > 1);

  const isStandalone =
    win.navigator.standalone === true ||
    win.matchMedia?.('(display-mode: standalone)').matches === true;

  return isIos && !isStandalone;
}

/**
 * Wait for the service worker registration, but never longer than the
 * timeout. A rejected/pending `ready` resolves `null` (the caller falls
 * back to the page-scoped Notification constructor).
 */
async function serviceWorkerRegistration(
  win: WebHostWindow,
): Promise<WebServiceWorkerRegistration | null> {
  const ready = win.navigator?.serviceWorker?.ready;
  if (ready === undefined) return null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SERVICE_WORKER_READY_TIMEOUT_MS);
  });
  try {
    const registration = await Promise.race([ready, timeout]);
    return registration ?? null;
  } catch {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export function createWebAdapter(): DeliveryAdapter {
  const firedIds = new Set<string>();
  /**
   * Sends that are awaiting the service worker. The set lives on the
   * module-singleton adapter, NOT on the hook instance: a hook remount
   * creates a new reconcile queue but the old `apply` may still be in
   * flight, and both would otherwise pass the `firedIds` check (which is
   * only updated AFTER a confirmed send) and deliver the same reminder
   * twice. An id is claimed synchronously before the first await and
   * released on failure, so a later tick can retry.
   */
  const inFlightIds = new Set<string>();
  let sessionStart: Date | null = null;
  /** The hook's latest effective switch (issue #92 review): consulted
   *  again after every await, right before the browser API call. */
  let deliveryEnabled = true;

  const rememberFired = (id: string): void => {
    if (firedIds.size >= FIRED_IDS_MAX) {
      const oldest = firedIds.values().next().value;
      if (oldest !== undefined) firedIds.delete(oldest);
    }
    firedIds.add(id);
  };

  /** Whether a send may happen RIGHT NOW: the switch is on and the browser
   *  still grants the permission. Called before each batch item and again
   *  after the service-worker wait — the switch or permission can change
   *  while that promise is pending. */
  const canSend = (win: WebHostWindow): boolean =>
    deliveryEnabled && win.Notification?.permission === 'granted';

  const getPermissionState = async (): Promise<ReminderPermissionState> => {
    const win = getWebWindow();
    if (!win?.Notification) {
      if (isIosNonStandalone()) {
        // On iOS Safari tab, notifications require adding to Home Screen first
        return {
          platform: 'web',
          status: 'undetermined',
          canAskAgain: true,
        };
      }
      return {
        platform: 'web',
        status: 'denied',
        canAskAgain: false,
      };
    }

    const perm = win.Notification.permission;
    if (perm === 'granted') {
      return { platform: 'web', status: 'granted', canAskAgain: true };
    }
    if (perm === 'denied') {
      return { platform: 'web', status: 'denied', canAskAgain: false };
    }
    return { platform: 'web', status: 'undetermined', canAskAgain: true };
  };

  return {
    platform: 'web',
    async init(): Promise<void> {
      // No OS setup exists in the browser (no channels, no scheduling, no
      // notification-click listener). Record the session start for the
      // reconcile's diagnostics.
      sessionStart ??= new Date();
    },

    async listPendingIds(): Promise<Set<string>> {
      return new Set();
    },

    async apply(output: ReconcileOutput): Promise<void> {
      const win = getWebWindow();
      if (win === undefined || !canSend(win)) {
        // Permission denial has its own visible surface in Settings; it is
        // not a send failure, so it must not raise the failure banner. The
        // switch gate reads the same way.
        return;
      }

      for (const item of output.toFireNow) {
        // `inFlightIds` covers a hook remount whose OLD apply has not
        // finished: the new mount sees the same singleton set, but
        // `firedIds` only gains the id after a confirmed send.
        if (firedIds.has(item.row.id) || inFlightIds.has(item.row.id)) continue;
        // An earlier batch item may have flipped the switch while its send
        // was awaited — re-read the gate before claiming this id.
        if (!canSend(win)) return;

        const kindKey = item.row.kind as keyof typeof KIND_TITLES;
        const title = KIND_TITLES[kindKey] ?? 'Nextdo 提醒';
        const body = item.title;
        const options: WebNotificationOptions = {
          body,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: `nextdo-reminder-${item.row.id}`,
        };

        inFlightIds.add(item.row.id);
        try {
          const registration = await serviceWorkerRegistration(win);
          // Ready-resolve AND the 2 s timeout fallback both land here: the
          // switch may have gone off (or the permission been revoked) while
          // waiting. Only the LATEST state may send.
          if (!canSend(win)) return;
          if (registration !== null) {
            await registration.showNotification(title, options);
          } else if (win.Notification !== undefined) {
            new win.Notification(title, options);
          } else {
            return;
          }
          // Only a CONFIRMED send counts as delivered — a failed send is
          // retried by the next tick inside the grace window.
          rememberFired(item.row.id);
          clearReminderDeliveryFailure();
        } catch (err) {
          logger.warn('web notification trigger failed', err);
          reportReminderDeliveryFailure(item.row.id, err);
        } finally {
          inFlightIds.delete(item.row.id);
        }
      }
    },

    setDeliveryEnabled(enabled: boolean): void {
      deliveryEnabled = enabled;
    },

    async permission(): Promise<ReminderPermissionState> {
      return getPermissionState();
    },

    async requestPermission(): Promise<ReminderPermissionState> {
      const win = getWebWindow();
      if (!win?.Notification) {
        return getPermissionState();
      }

      try {
        const result = await win.Notification.requestPermission();
        if (result === 'granted') {
          return { platform: 'web', status: 'granted', canAskAgain: true };
        }
        if (result === 'denied') {
          return { platform: 'web', status: 'denied', canAskAgain: false };
        }
      } catch (err) {
        logger.warn('failed to request web notification permission', err);
      }
      return getPermissionState();
    },

    async openSystemSettings(): Promise<void> {
      // Web browsers have no programmatic API to open browser/OS settings directly
    },

    sessionContext(): { firedIds: ReadonlySet<string>; sessionStart: Date } {
      return { firedIds, sessionStart: sessionStart ?? new Date() };
    },

    dispose(): void {
      // Nothing to release. The fired-id set intentionally survives a
      // hook remount (dev StrictMode) so a due reminder is not delivered
      // twice; a real page reload recreates the adapter.
    },
  };
}
