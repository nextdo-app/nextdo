/**
 * The Settings screen's calendar-permission handle (issue #54): a fresh read
 * of the OS permission plus the explicit request. The request lives in the UI
 * (not the sync engine) so the OS dialog always follows a user action.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  getCalendarPermission,
  isCalendarSupported,
  openCalendarSettings,
  requestCalendarPermission,
  type CalendarPermission,
} from '@/lib/calendar-sync';

export interface UseCalendarPermissionResult {
  /** The OS can write to a calendar at all on this host (false until the
   *  platform probe resolves — the desktop answer comes from the shell). */
  supported: boolean;
  /** null until the first read resolves. */
  permission: CalendarPermission | null;
  requestAccess: () => Promise<CalendarPermission>;
  openSystemSettings: () => Promise<void>;
}

export function useCalendarPermission(): UseCalendarPermissionResult {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<CalendarPermission | null>(null);

  useEffect(() => {
    let disposed = false;
    void isCalendarSupported().then((available) => {
      if (disposed) return;
      setSupported(available);
      if (!available) return;
      void getCalendarPermission().then((state) => {
        if (!disposed) setPermission(state);
      });
    });
    return () => {
      disposed = true;
    };
  }, []);

  const requestAccess = useCallback(async (): Promise<CalendarPermission> => {
    const next = await requestCalendarPermission();
    setPermission(next);
    return next;
  }, []);

  const openSystemSettings = useCallback(async (): Promise<void> => {
    await openCalendarSettings();
  }, []);

  return { supported, permission, requestAccess, openSystemSettings };
}
