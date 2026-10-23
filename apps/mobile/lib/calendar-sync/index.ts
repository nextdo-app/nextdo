/**
 * The OS-calendar boundary, platform-selected (task 10-23).
 *
 * Two implementations, one surface:
 *
 *   iOS / Android  → `device.ts`   (expo-calendar, the native module)
 *   macOS desktop  → `desktop.ts`  (EventKit through the Tauri shell)
 *   anything else  → unsupported   (web has no calendar; Windows/Linux shells
 *                                   have no EventKit)
 *
 * The desktop branch is probed, not assumed: `calendar_supported()` exists
 * only in the macOS build, so the same web bundle answers "no channel" on
 * every other host. `Platform.OS === 'web'` is not enough — the Tauri shell
 * ALSO reports `web`, and that is exactly the case we must distinguish.
 *
 * Nothing here imports `@tauri-apps/api` or `expo-calendar` at runtime: the
 * desktop module talks to the injected `__TAURI_INTERNALS__` bridge, and the
 * native module is required lazily inside `device.ts`.
 */
import { Platform } from 'react-native';
import * as device from './device';
import * as desktop from './desktop';
import type { CalendarTarget } from './target';
import type {
  CalendarSyncEventSpec,
  CalendarSyncMapping,
  CalendarSyncUpdate,
} from './reconcile';

export type { CalendarTarget } from './target';
export type CalendarPermission = device.CalendarPermission;

/** `'native' | 'desktop' | null` — null means "no calendar on this host". */
type CalendarBackend = 'native' | 'desktop' | null;

let resolvedBackend: CalendarBackend | undefined;

function isTauriRuntime(): boolean {
  const host = globalThis as { window?: { __TAURI_INTERNALS__?: unknown } };
  return host.window?.__TAURI_INTERNALS__ !== undefined;
}

/**
 * Which implementation this host uses.
 *
 * Resolved once per session: the shell either ships the EventKit bridge or it
 * does not, and a settings toggle cannot change that. A rejected probe is the
 * normal answer on Windows/Linux ("command not found"), not an error.
 */
export async function resolveCalendarBackend(): Promise<CalendarBackend> {
  if (resolvedBackend !== undefined) return resolvedBackend;
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    resolvedBackend = 'native';
    return resolvedBackend;
  }
  if (Platform.OS === 'web' && isTauriRuntime()) {
    resolvedBackend = (await desktop.isCalendarChannelSupported()) ? 'desktop' : null;
    return resolvedBackend;
  }
  resolvedBackend = null;
  return resolvedBackend;
}

/** Whether this host can write to an OS calendar at all. */
export async function isCalendarSupported(): Promise<boolean> {
  return (await resolveCalendarBackend()) !== null;
}

/** Read-only check — never shows the OS dialog. */
export async function getCalendarPermission(): Promise<CalendarPermission> {
  const backend = await resolveCalendarBackend();
  if (backend === 'native') return device.getCalendarPermission();
  if (backend === 'desktop') return desktop.getCalendarPermission();
  return 'denied';
}

/** Requests FULL access (needed to read back and delete the events we wrote). */
export async function requestCalendarPermission(): Promise<CalendarPermission> {
  const backend = await resolveCalendarBackend();
  if (backend === 'native') return device.requestCalendarPermission();
  if (backend === 'desktop') return desktop.requestCalendarPermission();
  return 'denied';
}

/**
 * The calendar to write into, or null when there is none.
 *
 * Both implementations fall back to a writable calendar when the Nextdo one
 * cannot be created (a read-only account, a shared calendar) — a reminder on
 * the user's default calendar still beats no reminder at all.
 */
export async function ensureCalendar(): Promise<CalendarTarget | null> {
  const backend = await resolveCalendarBackend();
  if (backend === 'native') {
    const calendar = await device.ensureCalendar();
    return calendar === null ? null : { kind: 'native', calendar };
  }
  if (backend === 'desktop') {
    const target = await desktop.ensureCalendar();
    return target === null ? null : { kind: 'desktop', id: target.id };
  }
  return null;
}

/** Create one event; null = a logged failure (retried on the next pass). */
export async function createCalendarEvent(
  target: CalendarTarget,
  spec: CalendarSyncEventSpec,
): Promise<CalendarSyncMapping | null> {
  if (target.kind === 'native') return device.createCalendarEvent(target.calendar, spec);
  return desktop.createCalendarEvent(spec);
}

/** Update one event; null = the caller must re-create it. */
export async function updateCalendarEvent(
  item: CalendarSyncUpdate,
): Promise<CalendarSyncMapping | null> {
  const backend = await resolveCalendarBackend();
  if (backend === 'desktop') return desktop.updateCalendarEvent(item);
  return device.updateCalendarEvent(item);
}

/** Delete one event. Best-effort by design (see the caller). */
export async function deleteCalendarEvent(eventId: string): Promise<boolean> {
  const backend = await resolveCalendarBackend();
  if (backend === 'desktop') return desktop.deleteCalendarEvent(eventId);
  return device.deleteCalendarEvent(eventId);
}

/** Open the OS calendar permission settings (native: app settings). */
export async function openCalendarSettings(): Promise<void> {
  const backend = await resolveCalendarBackend();
  if (backend === 'desktop') {
    await desktop.openCalendarSettings();
    return;
  }
  await device.openCalendarSettings();
}

/** Test seam — the resolved backend must not leak between cases. */
export function __resetCalendarBackendForTests(): void {
  resolvedBackend = undefined;
}
