/**
 * Device-local calendar-sync state (issue #54): the OS calendar id we write
 * into and the actionId → eventId mapping.
 *
 * Deliberately NOT in PowerSync: an event id is device-specific, so sync
 * would hand one device another device's ids. Same platform matrix as
 * `notification-settings` (native file, web memory).
 */
import { Platform } from 'react-native';
import { logger } from '@nextdo/core';
import type { CalendarSyncMappings } from './reconcile';

export interface CalendarSyncState {
  /** The OS calendar we created/reused for Nextdo events. */
  calendarId: string | null;
  mappings: CalendarSyncMappings;
}

const FILE_NAME = 'nextdo-calendar-sync.json';

type FileSystemLegacy = typeof import('expo-file-system/legacy');

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

function stateFileUri(fs: FileSystemLegacy): string {
  return `${fs.documentDirectory ?? ''}${FILE_NAME}`;
}

async function readRaw(): Promise<string | null> {
  const fs = getFileSystem();
  if (fs === null || fs.documentDirectory === null) return memoryRaw;
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
  if (fs === null || fs.documentDirectory === null) return;
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
  return { calendarId: null, mappings: {} };
}

function parseState(raw: string | null): CalendarSyncState {
  if (raw === null) return emptyState();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return emptyState();
    const record = parsed as Record<string, unknown>;
    const calendarId = typeof record.calendarId === 'string' ? record.calendarId : null;
    const mappings: CalendarSyncMappings = {};
    const rawMappings = record.mappings;
    if (typeof rawMappings === 'object' && rawMappings !== null) {
      for (const [actionId, value] of Object.entries(rawMappings as Record<string, unknown>)) {
        if (typeof value !== 'object' || value === null) continue;
        const entry = value as Record<string, unknown>;
        if (typeof entry.eventId !== 'string' || typeof entry.signature !== 'string') continue;
        mappings[actionId] = { eventId: entry.eventId, signature: entry.signature };
      }
    }
    return { calendarId, mappings };
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
      version: 1,
      calendarId: state.calendarId,
      mappings: state.mappings,
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
