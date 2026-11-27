/**
 * Diagnostics event log.
 *
 * Wires `@nextdo/core`'s logger to the durable store: every warn/error line
 * is appended as one JSON object, and uncaught JS errors are routed through
 * `logger.error` so they land in the same place. Severity levels below warn
 * stay console-only — the in-app log is for problems, not for playback.
 *
 * Scope limit (documented in the diagnostics screen): a native crash such as
 * an Android process death cannot be caught from JS. The log covers JS and
 * application events; a native crash still needs `adb logcat`.
 */
import {
  clearRecentLogs,
  getRecentLogs,
  logger,
  subscribeToLogs,
  type LogEntry,
  type LogErrorInfo,
  type LogLevel,
} from '@nextdo/core';
import { Platform } from 'react-native';

import {
  DIAGNOSTIC_RETENTION_MS,
  appendDiagnosticLine,
  clearDiagnosticLines,
  readDiagnosticLines,
} from './storage';

const PERSISTED_LEVELS: ReadonlySet<LogLevel> = new Set(['warn', 'error']);

/** Persist one line — JSON keeps parsing independent of message contents. */
export function serializeLogEntry(entry: LogEntry): string {
  return JSON.stringify({
    ts: entry.ts,
    level: entry.level,
    message: entry.message,
    error: entry.error,
  });
}

function isLevel(value: unknown): value is LogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
}

function parseErrorInfo(value: unknown): LogErrorInfo | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as { name?: unknown; message?: unknown; stack?: unknown };
  if (typeof raw.name !== 'string' || typeof raw.message !== 'string') return null;
  return {
    name: raw.name,
    message: raw.message,
    stack: typeof raw.stack === 'string' ? raw.stack : null,
  };
}

/** Tolerant line parse; a damaged line is skipped rather than failing the read. */
export function parseLogEntry(line: string): LogEntry | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const raw = parsed as { ts?: unknown; level?: unknown; message?: unknown; error?: unknown };
    if (typeof raw.ts !== 'string' || !isLevel(raw.level) || typeof raw.message !== 'string') {
      return null;
    }
    if (Number.isNaN(Date.parse(raw.ts))) return null;
    return {
      ts: raw.ts,
      level: raw.level,
      message: raw.message,
      error: parseErrorInfo(raw.error),
    };
  } catch {
    return null;
  }
}

function isPersisted(entry: LogEntry): boolean {
  return PERSISTED_LEVELS.has(entry.level);
}

function entryKey(entry: LogEntry): string {
  return `${entry.ts}|${entry.level}|${entry.message}`;
}

/**
 * Persisted lines plus the current in-memory tail (the sink may still be
 * writing), deduplicated and bounded by the retention window.
 */
export async function loadDiagnosticEntries(): Promise<LogEntry[]> {
  const persisted = (await readDiagnosticLines())
    .map(parseLogEntry)
    .filter((entry): entry is LogEntry => entry !== null);
  const cutoff = Date.now() - DIAGNOSTIC_RETENTION_MS;
  const merged = new Map<string, LogEntry>();
  for (const entry of [...persisted, ...getRecentLogs().filter(isPersisted)]) {
    if (Date.parse(entry.ts) < cutoff) continue;
    merged.set(entryKey(entry), entry);
  }
  return [...merged.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}

/** Clear both the durable store and the in-memory tail. */
export async function clearAllDiagnosticLogs(): Promise<void> {
  clearRecentLogs();
  await clearDiagnosticLines();
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

interface ErrorUtilsLike {
  getGlobalHandler?: () => GlobalHandler;
  setGlobalHandler: (handler: GlobalHandler) => void;
}

/** Minimal DOM shape — RN's tsconfig carries no DOM lib. */
interface WebWindow {
  addEventListener(
    type: 'error',
    listener: (event: { error?: unknown; message?: string }) => void,
  ): void;
  addEventListener(
    type: 'unhandledrejection',
    listener: (event: { reason?: unknown }) => void,
  ): void;
}

/**
 * Route uncaught JS errors into the same log. The previous handler is always
 * called afterwards so crash reporting / dev overlay behaviour is unchanged.
 */
function installGlobalErrorHandlers(): void {
  const candidate = (globalThis as typeof globalThis & { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (candidate !== undefined && typeof candidate.setGlobalHandler === 'function') {
    const previous = candidate.getGlobalHandler?.();
    candidate.setGlobalHandler((error, isFatal) => {
      logger.error(isFatal === true ? 'uncaught fatal JS error' : 'uncaught JS error', error);
      if (previous !== undefined) previous(error, isFatal);
    });
  }

  // RN Web does not expose ErrorUtils; the DOM events are the equivalent.
  const webWindow = (globalThis as typeof globalThis & { window?: WebWindow }).window;
  if (Platform.OS === 'web' && webWindow !== undefined) {
    webWindow.addEventListener('error', (event) => {
      logger.error('uncaught window error', event.error ?? event.message);
    });
    webWindow.addEventListener('unhandledrejection', (event) => {
      logger.error('unhandled promise rejection', event.reason);
    });
  }
}

let logInstalled = false;

/** Idempotent: subscribe the durable sink and install the global handlers. */
export function installDiagnosticLog(): void {
  if (logInstalled) return;
  logInstalled = true;
  subscribeToLogs((entry) => {
    if (!isPersisted(entry)) return;
    void appendDiagnosticLine(serializeLogEntry(entry));
  });
  installGlobalErrorHandlers();
}
