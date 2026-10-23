/**
 * macOS desktop implementation of the OS-calendar boundary (task 10-23).
 *
 * Same surface as `device.ts` — the facade in `index.ts` picks one — but the
 * work happens in the Rust shell's EventKit bridge
 * (`apps/desktop/src-tauri/src/calendar.rs`). The desktop webview runs the
 * SAME bundle as the web build, so this module is only ever reached through
 * the facade's `calendar_supported()` probe; nothing here imports
 * `@tauri-apps/api` (the bundle-graph constraint documented in
 * `lib/reminders/adapters/index.ts`), and no IPC runs on plain web.
 *
 * Why the calendar matters on desktop at all: `tauri-plugin-notification` has
 * no future scheduling, so the app's own reminders die with the process
 * (design §4.2). An event with an alarm is owned by the system calendar, so
 * it fires with Nextdo closed — the one way the desktop build can deliver a
 * reminder on time.
 *
 * The Rust side owns target-calendar selection (Nextdo's own calendar, else
 * the default one), so `ensureCalendar` returns an opaque handle whose id is
 * informational only.
 */
import { logger } from '@nextdo/core';
import type { CalendarPermission } from './device';
import { calendarEventSignature, type CalendarSyncEventSpec, type CalendarSyncMapping, type CalendarSyncUpdate } from './reconcile';

/** The Tauri v2 IPC bridge injected into the webview (see `adapters/tauri.ts`). */
interface TauriInternals {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

function tauriInvoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  const internals = (
    globalThis as { window?: { __TAURI_INTERNALS__?: TauriInternals } }
  ).window?.__TAURI_INTERNALS__;
  if (internals === undefined) {
    return Promise.reject(new Error('Tauri IPC bridge missing (not running in the desktop shell)'));
  }
  return internals.invoke(command, args);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** The calendar we own — mirrored from the Rust side, informational only. */
const DESKTOP_CALENDAR_ID = 'nextdo';

/**
 * Whether this build can offer the calendar channel.
 *
 * The Rust command only exists on macOS (the module is `#[cfg(target_os =
 * "macos")]`), so a Windows/Linux shell rejects with "command not found" —
 * exactly the answer we want. Any failure means "no channel", never a throw.
 */
export async function isCalendarChannelSupported(): Promise<boolean> {
  try {
    return (await tauriInvoke('calendar_supported')) === true;
  } catch {
    return false;
  }
}

function normalizePermission(raw: unknown): CalendarPermission {
  if (raw === 'authorized') return 'granted';
  if (raw === 'notDetermined') return 'undetermined';
  return 'denied';
}

/** Read-only check — never shows the OS dialog. */
export async function getCalendarPermission(): Promise<CalendarPermission> {
  try {
    return normalizePermission(await tauriInvoke('calendar_permission'));
  } catch (error) {
    logger.warn('desktop calendar permission read failed', toError(error));
    return 'denied';
  }
}

/** Requests FULL access (write-only cannot read back or delete what it wrote). */
export async function requestCalendarPermission(): Promise<CalendarPermission> {
  try {
    return normalizePermission(await tauriInvoke('calendar_request_permission'));
  } catch (error) {
    logger.warn('desktop calendar permission request failed', toError(error));
    return 'denied';
  }
}

/**
 * The target calendar.
 *
 * Rust resolves it per write, so there is nothing to prepare — but a null
 * return means "no writable calendar", which the caller treats as "skip this
 * pass". The permission is checked first so the reason is visible in logs.
 */
export async function ensureCalendar(): Promise<{ id: string } | null> {
  const permission = await getCalendarPermission();
  if (permission !== 'granted') return null;
  return { id: DESKTOP_CALENDAR_ID };
}

/**
 * The IPC arg shape for one write. Times cross the boundary as epoch
 * milliseconds: both sides already hold absolute instants, and a number
 * cannot be mis-parsed as a different date format.
 */
function upsertArgs(spec: CalendarSyncEventSpec, eventId?: string): Record<string, unknown> {
  const startsAtMs = new Date(spec.startsAt).getTime();
  const endsAtMs = new Date(spec.endsAt).getTime();
  const durationMs =
    Number.isFinite(startsAtMs) && Number.isFinite(endsAtMs) ? endsAtMs - startsAtMs : 60_000;
  return {
    args: {
      ...(eventId === undefined ? {} : { eventId }),
      title: spec.title,
      ...(spec.notes === undefined ? {} : { notes: spec.notes }),
      startsAt: startsAtMs,
      durationMinutes: Math.max(durationMs, 60_000) / 60_000,
      // The event's start IS the reminder moment — the system calendar
      // notifies at the start, the same 0-minute offset the native
      // implementation uses.
      alarmOffsetMinutes: 0,
    },
  };
}

async function upsert(
  spec: CalendarSyncEventSpec,
  eventId?: string,
): Promise<CalendarSyncMapping | null> {
  const startsAtMs = new Date(spec.startsAt).getTime();
  if (!Number.isFinite(startsAtMs)) return null;
  try {
    const result = (await tauriInvoke('calendar_upsert_event', upsertArgs(spec, eventId))) as {
      eventId?: unknown;
    };
    if (typeof result?.eventId !== 'string') return null;
    return {
      eventId: result.eventId,
      signature: calendarEventSignature(spec),
    };
  } catch (error) {
    logger.warn(`desktop calendar write for ${spec.actionId} failed`, toError(error));
    return null;
  }
}

/** Create one event; null = a logged failure (retried on the next pass). */
export async function createCalendarEvent(
  spec: CalendarSyncEventSpec,
): Promise<CalendarSyncMapping | null> {
  return upsert(spec);
}

/** Update one event; null = the caller must re-create it. */
export async function updateCalendarEvent(
  item: CalendarSyncUpdate,
): Promise<CalendarSyncMapping | null> {
  return upsert(item, item.eventId);
}

/** Delete one event. Best-effort by design (see the caller). */
export async function deleteCalendarEvent(eventId: string): Promise<boolean> {
  try {
    await tauriInvoke('calendar_delete_event', { eventId });
    return true;
  } catch (error) {
    logger.warn(`desktop calendar delete of ${eventId} failed`, toError(error));
    return false;
  }
}

/**
 * Open the Calendar privacy pane in System Settings.
 *
 * `Linking.openSettings()` (the native path) is a no-op in a desktop webview,
 * and the shell opens the pane itself — no URL-opening plugin is installed
 * just for this one deep link.
 */
export async function openCalendarSettings(): Promise<void> {
  try {
    await tauriInvoke('calendar_open_settings');
  } catch (error) {
    logger.warn('opening the calendar privacy pane failed', toError(error));
  }
}
