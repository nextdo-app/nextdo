/**
 * The Settings screen's calendar-permission handle (issue #54): a fresh read
 * of the OS permission plus the explicit request. The request lives in the UI
 * (not the sync engine) so the OS dialog always follows a user action.
 */
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import {
  getCalendarPermission,
  requestCalendarPermission,
  type CalendarPermission,
} from '@/lib/calendar-sync/device';

export interface UseCalendarPermissionResult {
  /** The OS can write to a calendar at all on this platform. */
  supported: boolean;
  /** null until the first read resolves. */
  permission: CalendarPermission | null;
  requestAccess: () => Promise<CalendarPermission>;
  openSystemSettings: () => Promise<void>;
}

export function useCalendarPermission(): UseCalendarPermissionResult {
  const supported = Platform.OS === 'ios' || Platform.OS === 'android';
  const [permission, setPermission] = useState<CalendarPermission | null>(null);

  useEffect(() => {
    if (!supported) return;
    let disposed = false;
    void getCalendarPermission().then((state) => {
      if (!disposed) setPermission(state);
    });
    return () => {
      disposed = true;
    };
  }, [supported]);

  const requestAccess = useCallback(async (): Promise<CalendarPermission> => {
    const next = await requestCalendarPermission();
    setPermission(next);
    return next;
  }, []);

  const openSystemSettings = useCallback(async (): Promise<void> => {
    await Linking.openSettings();
  }, []);

  return { supported, permission, requestAccess, openSystemSettings };
}
