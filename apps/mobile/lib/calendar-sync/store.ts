/**
 * Device-local calendar-sync state (issue #54): the OS calendar id we write
 * into and the actionId → eventId mapping.
 *
 * Deliberately NOT in PowerSync: an event id is device-specific, so sync
 * would hand one device another device's ids. Same platform matrix as
 * `notification-settings`: native file, browser/Tauri `localStorage`.
 *
 * The desktop shell matters here: it runs the web bundle, and a mapping lost
 * on restart would re-create every event on the next launch — the user would
 * see the same reminder twice. `localStorage` survives a webview reload, so
 * the web branch persists rather than degrading to memory.
 */
import { Platform } from 'react-native';
import { logger } from '@nextdo/core';
import type { CalendarSyncMappings } from './reconcile';

export interface CalendarSyncState {
  /** The OS calendar we created/reused for Nextdo events. */
  calendarId: string | null;
  /**
   * The calendar the user picked in settings, or null for "Nextdo default".
   *
   * Device-local like the ids below: a calendar id names a row in this
   * device's system database, so syncing it would hand another device an id
   * that means nothing (or something else) there.
   */
  preferredCalendarId: string | null;
  mappings: CalendarSyncMappings;
  /**
   * Issue #63: reminderId → event. Kept apart from `mappings` because the
   * two sources are switched independently — turning calendar sync off must
   * not withdraw the events a reminder channel owns (and vice versa).
   */
  reminderMappings: CalendarSyncMappings;
  /**
   * focusSessionId → event: the calendar record of a finished focus session.
   * Separate again, because it answers a different question ("what did I do
   * today") and outlives the action it was performed on.
   */
  focusMappings: CalendarSyncMappings;
  /**
   * ISO-8601 moment calendar sync was first enabled — the boundary for focus
   * records. Turning the switch on must not materialize years of history;
   * a session that ENDS after this moment is always recorded.
   */
  focusRecordSince: string | null;
}

const FILE_NAME = 'nextdo-calendar-sync.json';

/** Webview key — mirrors the file name the native branch uses. */
const WEB_KEY = 'nextdo.calendar-sync';

type FileSystemLegacy = typeof import('expo-file-system/legacy');

interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let cached: CalendarSyncState | null = null;
let memoryRaw: string | null = null;
let fileSystem: FileSystemLegacy | null | undefined;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Lazy: the legacy shim touches a native module at import time, which must
 * not break a jest render (or a web bundle) that never uses calendar sync.
 */
function getFileSystem(): FileSystemLegacy | null {
  if (fileSystem !== undefined) return fileSystem;
  if (Platform.OS === 'web') {
    fileSystem = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fileSystem = require('expo-file-system/legacy') as FileSystemLegacy;
  } catch (error) {
    logger.warn('calendar sync storage unavailable', toError(error));
    fileSystem = null;
  }
  return fileSystem;
}

/** Absent on Node/jest — the memory fallback then covers the case. */
function getWebStorage(): WebStorageLike | null {
  const host = globalThis as {
    window?: { localStorage?: WebStorageLike };
    localStorage?: WebStorageLike;
  };
  return host.window?.localStorage ?? host.localStorage ?? null;
}

function stateFileUri(fs: FileSystemLegacy): string {
  return `${fs.documentDirectory ?? ''}${FILE_NAME}`;
}

async function readRaw(): Promise<string | null> {
  const fs = getFileSystem();
  if (fs === null || fs.documentDirectory === null) {
    try {
      return getWebStorage()?.getItem(WEB_KEY) ?? memoryRaw;
    } catch {
      return memoryRaw;
    }
  }
  const uri = stateFileUri(fs);
  try {
    const info = await fs.getInfoAsync(uri);
    if (!info.exists) return null;
    return await fs.readAsStringAsync(uri);
  } catch (error) {
    // A corrupt/unreadable file means "no mappings" — the next reconcile
    // re-creates what it needs (the OS events may be duplicated, which is
    // recoverable by the user turning the switch off, never by a crash).
    logger.warn('calendar sync state read failed', toError(error));
    return null;
  }
}

async function writeRaw(raw: string | null): Promise<void> {
  memoryRaw = raw;
  const fs = getFileSystem();
  if (fs === null || fs.documentDirectory === null) {
    try {
      const storage = getWebStorage();
      if (storage === null) return;
      if (raw === null) storage.removeItem(WEB_KEY);
      else storage.setItem(WEB_KEY, raw);
    } catch (error) {
      // Private mode / quota: the in-memory copy still serves this session.
      logger.warn('calendar sync state write failed', toError(error));
    }
    return;
  }
  const uri = stateFileUri(fs);
  try {
    if (raw === null) {
      await fs.deleteAsync(uri, { idempotent: true });
      return;
    }
    await fs.writeAsStringAsync(uri, raw);
  } catch (error) {
    logger.warn('calendar sync state write failed', toError(error));
  }
}

function emptyState(): CalendarSyncState {
  return {
    calendarId: null,
    preferredCalendarId: null,
    mappings: {},
    reminderMappings: {},
    focusMappings: {},
    focusRecordSince: null,
  };
}

/** One `id → mapping` bag from the stored JSON; malformed entries are dropped. */
function parseMappings(value: unknown): CalendarSyncMappings {
  const mappings: CalendarSyncMappings = {};
  if (typeof value !== 'object' || value === null) return mappings;
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.eventId !== 'string' || typeof record.signature !== 'string') continue;
    mappings[id] = { eventId: record.eventId, signature: record.signature };
  }
  return mappings;
}

function parseState(raw: string | null): CalendarSyncState {
  if (raw === null) return emptyState();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return emptyState();
    const record = parsed as Record<string, unknown>;
    const calendarId = typeof record.calendarId === 'string' ? record.calendarId : null;
    const preferredCalendarId =
      typeof record.preferredCalendarId === 'string' ? record.preferredCalendarId : null;
    return {
      calendarId,
      preferredCalendarId,
      mappings: parseMappings(record.mappings),
      reminderMappings: parseMappings(record.reminderMappings),
      focusMappings: parseMappings(record.focusMappings),
      focusRecordSince: typeof record.focusRecordSince === 'string' ? record.focusRecordSince : null,
    };
  } catch {
    return emptyState();
  }
}

export async function loadCalendarSyncState(): Promise<CalendarSyncState> {
  if (cached !== null) return cached;
  cached = parseState(await readRaw());
  return cached;
}

export async function saveCalendarSyncState(state: CalendarSyncState): Promise<void> {
  cached = state;
  await writeRaw(
    JSON.stringify({
      version: 4,
      calendarId: state.calendarId,
      preferredCalendarId: state.preferredCalendarId,
      mappings: state.mappings,
      reminderMappings: state.reminderMappings,
      focusMappings: state.focusMappings,
      focusRecordSince: state.focusRecordSince,
    }),
  );
}

/** Turning the switch off drops the file entirely (nothing left to clean). */
export async function clearCalendarSyncState(): Promise<void> {
  cached = emptyState();
  await writeRaw(null);
}

/** Test seam — the module-level cache would otherwise leak between cases. */
export function __resetCalendarSyncStoreForTests(): void {
  cached = null;
  memoryRaw = null;
  fileSystem = undefined;
}
