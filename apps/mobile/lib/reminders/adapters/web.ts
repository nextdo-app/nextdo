/**
 * Web PWA notification delivery adapter.
 *
 * Supports:
 * - Desktop browsers (Chrome, Edge, Firefox, Safari) via Notification API
 * - iOS 16.4+ in standalone PWA mode (after user added Nextdo to Home Screen)
 * - Service Worker showNotification fallback
 * - Graceful degradation when notifications are unsupported or pending installation
 */

import { logger } from '@nextdo/core';
import type { ReconcileOutput } from '../reminder-scheduler';
import type { DeliveryAdapter, ReminderPermissionState } from './types';
import { KIND_TITLES } from './types';

const FIRED_IDS_MAX = 500;

interface WebNotificationOptions {
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  renotify?: boolean;
}

interface WebNotificationInstance {
  /** Clicking the direct-constructor notification focuses the tab (issue
   *  #99 platform degradation: no inline actions, tap still opens the app). */
  onclick: (() => void) | null;
}

interface WebNotificationCtor {
  new (title: string, options?: WebNotificationOptions): WebNotificationInstance;
  permission: 'default' | 'granted' | 'denied';
  requestPermission(): Promise<'default' | 'granted' | 'denied'>;
}

interface WebServiceWorkerRegistration {
  showNotification(title: string, options?: WebNotificationOptions): Promise<void>;
}

interface WebHostWindow {
  Notification?: WebNotificationCtor;
  /** Focusing the tab on a notification click (jsdom: an assignable stub). */
  focus?: () => void;
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

export function createWebAdapter(): DeliveryAdapter {
  const firedIds = new Set<string>();

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
      // Notification-opened click handler is handled via Service Worker
    },

    async listPendingIds(): Promise<Set<string>> {
      return new Set();
    },

    async apply(output: ReconcileOutput): Promise<void> {
      const win = getWebWindow();
      if (!win?.Notification || win.Notification.permission !== 'granted') {
        return;
      }

      for (const item of output.toFireNow) {
        if (firedIds.has(item.row.id)) continue;

        const kindKey = item.row.kind as keyof typeof KIND_TITLES;
        const title = KIND_TITLES[kindKey] ?? 'Nextdo 提醒';
        const body = item.title;
        const options: WebNotificationOptions = {
          body,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: `nextdo-reminder-${item.row.id}`,
        };

        try {
          if (win.navigator?.serviceWorker?.ready) {
            const reg = await win.navigator.serviceWorker.ready;
            await reg.showNotification(title, options);
          } else {
            const notification = new win.Notification(title, options);
            // Issue #99 degradation: browsers have no inline action buttons
            // here — a click must at least bring the app forward.
            notification.onclick = () => {
              win.focus?.();
            };
          }

          if (firedIds.size >= FIRED_IDS_MAX) {
            const oldest = firedIds.values().next().value;
            if (oldest !== undefined) firedIds.delete(oldest);
          }
          firedIds.add(item.row.id);
        } catch (err) {
          logger.warn('web notification trigger failed', err);
        }
      }
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

    dispose(): void {
      firedIds.clear();
    },
  };
}
