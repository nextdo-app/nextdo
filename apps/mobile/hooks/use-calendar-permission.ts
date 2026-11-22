/**
 * The Settings screen's calendar-permission handle (issue #54): a fresh read
 * of the OS permission plus the explicit request. The request lives in the UI
 * (not the sync engine) so the OS dialog always follows a user action.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  getCalendarPermission,
  isCalendarImportSupported,
  isCalendarSupported,
  openCalendarSettings,
  requestCalendarPermission,
  type CalendarPermission,
} from '@/lib/calendar-sync';

export interface UseCalendarPermissionResult {
  /** The OS can write to a calendar at all on this host (false until the
   *  platform probe resolves — the desktop answer comes from the shell). */
  supported: boolean;
  /** The OS calendar can also be READ for the busy-time import (issue #100
   *  review R1). Writing and reading are separate capabilities: the macOS
   *  bridge writes but exposes no read command, so it is false there. */
  importSupported: boolean;
  /** null until the first read resolves. */
  permission: CalendarPermission | null;
  requestAccess: () => Promise<CalendarPermission>;
  openSystemSettings: () => Promise<void>;
}

export function useCalendarPermission(): UseCalendarPermissionResult {
  const [supported, setSupported] = useState(false);
  const [importSupported, setImportSupported] = useState(false);
  const [permission, setPermission] = useState<CalendarPermission | null>(null);

  useEffect(() => {
    let disposed = false;
    void Promise.all([isCalendarSupported(), isCalendarImportSupported()]).then(
      ([available, canImport]) => {
        if (disposed) return;
        setSupported(available);
        setImportSupported(canImport);
        if (!available) return;
        void getCalendarPermission().then((state) => {
          if (!disposed) setPermission(state);
        });
      },
    );
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

  return { supported, importSupported, permission, requestAccess, openSystemSettings };
}
