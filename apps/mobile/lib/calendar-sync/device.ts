/**
 * The OS-calendar boundary (issue #54) — everything that touches
 * `expo-calendar` lives here, so the sync engine and the Settings screen
 * never import the native module directly.
 *
 * The module is loaded lazily: `expo-calendar` pulls in a native module at
 * import time, which must not break a jest render or a web bundle that never
 * uses calendar sync.
 *
 * API note (SDK 57): the root entry is the new instance API —
 * `getCalendars()`, `createCalendar()`, `calendar.createEvent()`,
 * `ExpoCalendarEvent.get(id)` + `event.update/delete()`. The deprecated
 * `*Async` functions are never used here.
 */
import { logger } from '@nextdo/core';
import { Linking } from 'react-native';
import type { Alarm, ExpoCalendar, ExpoCalendarEvent } from 'expo-calendar';
import {
  calendarEventSignature,
  type CalendarSyncEventSpec,
  type CalendarSyncMapping,
  type CalendarSyncUpdate,
} from './reconcile';

type ExpoCalendarModule = typeof import('expo-calendar');

/** The name of the calendar we own on the device. */
const CALENDAR_TITLE = 'Nextdo';

/** Fire the calendar alarm at the event's start (0 minutes before). */
const ALARM_MINUTES_BEFORE = 0;

const EVENT_NOTE = '由 Nextdo 自动同步';

let calendarModule: ExpoCalendarModule | null | undefined;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function getCalendarModule(): ExpoCalendarModule | null {
  if (calendarModule !== undefined) return calendarModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    calendarModule = require('expo-calendar') as ExpoCalendarModule;
  } catch (error) {
    logger.warn('calendar module unavailable', toError(error));
    calendarModule = null;
  }
  return calendarModule;
}

export type CalendarPermission = 'granted' | 'denied' | 'undetermined';

function normalizePermission(response: { granted: boolean; status: string }): CalendarPermission {
  if (response.granted) return 'granted';
  return response.status === 'undetermined' ? 'undetermined' : 'denied';
}

/** Read-only check — never shows the OS dialog. */
export async function getCalendarPermission(): Promise<CalendarPermission> {
  const module = getCalendarModule();
  if (module === null) return 'denied';
  try {
    const response = await module.getCalendarPermissions(false);
    return normalizePermission(response);
  } catch (error) {
    logger.warn('calendar permission read failed', toError(error));
    return 'denied';
  }
}

/** Requests FULL access (needed to list and clean up the events we wrote). */
export async function requestCalendarPermission(): Promise<CalendarPermission> {
  const module = getCalendarModule();
  if (module === null) return 'denied';
  try {
    const response = await module.requestCalendarPermissions(false);
    return normalizePermission(response);
  } catch (error) {
    logger.warn('calendar permission request failed', toError(error));
    return 'denied';
  }
}

function pickWritable(calendars: readonly ExpoCalendar[]): ExpoCalendar | null {
  const writable = calendars.find((calendar) => calendar.allowsModifications !== false);
  return writable ?? calendars[0] ?? null;
}

/**
 * A calendar the user may point the sync at, as the settings picker sees it.
 *
 * `source` is the account the OS attributes the calendar to — 'iCloud',
 * 'Gmail', 'Google', 'Outlook', a local store. It is what lets the user tell
 * two same-titled calendars apart, and it is the only way to name Google /
 * iCloud in the UI: the account is already in the system database, Nextdo
 * only writes into it.
 */
export interface WritableCalendar {
  id: string;
  title: string;
  source: string | null;
  /** False for read-only (subscribed / holiday) calendars — not offered. */
  allowsModifications: boolean;
}

function describeCalendar(calendar: ExpoCalendar): WritableCalendar {
  const owner = (calendar as { ownerAccount?: unknown }).ownerAccount;
  const sourceName =
    typeof owner === 'object' && owner !== null
      ? (owner as { name?: unknown }).name
      : (calendar as { source?: unknown }).source;
  return {
    id: calendar.id,
    title: calendar.title,
    source: typeof sourceName === 'string' && sourceName.length > 0 ? sourceName : null,
    allowsModifications: calendar.allowsModifications !== false,
  };
}

/**
 * Every calendar the OS exposes, for the settings picker.
 *
 * Read-only calendars are returned too — the picker filters them out, but the
 * caller may want to explain why a Google calendar is missing (a subscribed
 * holiday calendar cannot take writes).
 */
export async function listCalendars(): Promise<WritableCalendar[]> {
  const module = getCalendarModule();
  if (module === null) return [];
  try {
    const calendars = await module.getCalendars();
    return calendars.map(describeCalendar);
  } catch (error) {
    logger.warn('listing calendars failed', toError(error));
    return [];
  }
}

/**
 * Resolve one calendar by id; null when it no longer exists.
 *
 * The id comes from the user's choice, persisted in the device-local sync
 * state. A calendar can vanish (account signed out, calendar deleted), which
 * is a normal answer here — the caller falls back to the default target.
 */
export async function findCalendar(calendarId: string): Promise<ExpoCalendar | null> {
  const module = getCalendarModule();
  if (module === null) return null;
  try {
    const calendars = await module.getCalendars();
    return calendars.find((calendar) => calendar.id === calendarId) ?? null;
  } catch (error) {
    logger.warn('listing calendars failed', toError(error));
    return null;
  }
}

/**
 * The calendar we write into.
 *
 * A user-picked calendar wins (`preferredCalendarId`): that is how a reminder
 * lands in the Google or iCloud calendar the user actually looks at, instead
 * of a Nextdo-only calendar the system never surfaces in their day view.
 * Without a pick: the Nextdo one when present, else a newly created one, else
 * any existing writable calendar (a device whose account refuses third-party
 * calendars must still get reminders).
 */
export async function ensureCalendar(preferredCalendarId?: string | null): Promise<ExpoCalendar | null> {
  const module = getCalendarModule();
  if (module === null) return null;
  try {
    const calendars = await module.getCalendars();
    if (preferredCalendarId !== undefined && preferredCalendarId !== null) {
      const preferred = calendars.find((calendar) => calendar.id === preferredCalendarId);
      if (preferred !== undefined && preferred.allowsModifications !== false) return preferred;
      logger.warn(
        `the chosen calendar ${preferredCalendarId} is gone or read-only — falling back`,
        new Error('calendar target unavailable'),
      );
    }
    const existing = calendars.find((calendar) => calendar.title === CALENDAR_TITLE);
    if (existing !== undefined) return existing;
    try {
      return await module.createCalendar({ title: CALENDAR_TITLE });
    } catch (error) {
      logger.warn(
        'creating the Nextdo calendar failed — falling back to an existing writable calendar',
        toError(error),
      );
      return pickWritable(calendars);
    }
  } catch (error) {
    logger.warn('listing calendars failed', toError(error));
    return null;
  }
}

type CreateEventDetails = Parameters<ExpoCalendar['createEvent']>[0];

function eventDetails(spec: CalendarSyncEventSpec): CreateEventDetails {
  const alarms: Alarm[] = [{ relativeOffset: ALARM_MINUTES_BEFORE }];
  return {
    title: spec.title,
    startDate: new Date(spec.startsAt),
    endDate: new Date(spec.endsAt),
    // The action's own note wins: for a reminder-delivered event it is the
    // context the user would otherwise have to dig out of the original
    // message or file.
    notes: spec.notes ?? EVENT_NOTE,
    alarms,
  };
}

/** Create one event; null = a logged failure (retried on the next pass). */
export async function createCalendarEvent(
  calendar: ExpoCalendar,
  spec: CalendarSyncEventSpec,
): Promise<CalendarSyncMapping | null> {
  try {
    const event = await calendar.createEvent(eventDetails(spec));
    return { eventId: event.id, signature: calendarEventSignature(spec) };
  } catch (error) {
    logger.warn(`creating the calendar event for ${spec.actionId} failed`, toError(error));
    return null;
  }
}

/** Update one event; null = the caller must re-create it. */
export async function updateCalendarEvent(
  item: CalendarSyncUpdate,
): Promise<CalendarSyncMapping | null> {
  const module = getCalendarModule();
  if (module === null) return null;
  try {
    const event: ExpoCalendarEvent = await module.ExpoCalendarEvent.get(item.eventId);
    await event.update(eventDetails(item));
    return { eventId: item.eventId, signature: calendarEventSignature(item) };
  } catch (error) {
    // The event may have been deleted from the system Calendar app — the
    // caller falls back to creating a fresh one.
    logger.warn(`updating the calendar event for ${item.actionId} failed`, toError(error));
    return null;
  }
}

/** Delete one event. Best-effort by design (see the caller). */
export async function deleteCalendarEvent(eventId: string): Promise<boolean> {
  const module = getCalendarModule();
  if (module === null) return false;
  try {
    const event: ExpoCalendarEvent = await module.ExpoCalendarEvent.get(eventId);
    await event.delete();
    return true;
  } catch (error) {
    logger.warn(`deleting the calendar event ${eventId} failed`, toError(error));
    return false;
  }
}

/**
 * Open this app's entry in the OS settings, where calendar access is granted.
 *
 * On iOS the calendar toggle lives in the app's own settings page, which is
 * what `openSettings()` opens; Android lands on the app detail screen.
 */
export async function openCalendarSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch (error) {
    logger.warn('opening the app settings failed', toError(error));
  }
}
