/**
 * The single logger (spec: project/conventions.md §Logging).
 *
 * Wraps console and is the only allowed logging path — apps and packages
 * import `logger` and never touch console (enforced by ESLint no-console,
 * with this file as the one exception).
 *
 * Rules: log what happened (not stack traces of expected control flow);
 * never log user free-text content (inbox items contain personal data).
 *
 * Diagnostics (in-app feedback): every emitted line is also kept in a
 * bounded in-memory buffer and offered to subscribers, so the mobile app can
 * persist the warn/error lines and let the user copy a diagnostic report.
 * The buffer is deliberately small — it is a convenience for the CURRENT
 * session, not the durable store (the mobile side owns that).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Only the newest lines are kept in memory; the mobile sink persists more. */
const MAX_BUFFER_ENTRIES = 300;
const MAX_ERROR_MESSAGE = 300;
const MAX_STACK = 800;

export interface LogErrorInfo {
  /** `Error` constructor name, or the typeof a non-Error extra. */
  name: string;
  message: string;
  /** Truncated stack — nil for non-Error extras. */
  stack: string | null;
}

export interface LogEntry {
  /** ISO timestamp. */
  ts: string;
  level: LogLevel;
  /** Developer-written, fixed text — never user content. */
  message: string;
  error: LogErrorInfo | null;
}

export type LogListener = (entry: LogEntry) => void;

const buffer: LogEntry[] = [];
const listeners = new Set<LogListener>();

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function clip(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

function safeString(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

/**
 * Reduce an `extra` argument to the three fields diagnostics may carry.
 * Free-form objects are stringified — callers must not pass user content
 * (the logging rule above), and the diagnostic report clips the result.
 */
export function describeLogExtra(extra: unknown): LogErrorInfo | null {
  if (extra === undefined) return null;
  if (extra instanceof Error) {
    return {
      name: extra.name || 'Error',
      message: clip(extra.message, MAX_ERROR_MESSAGE),
      stack: extra.stack === undefined ? null : clip(extra.stack, MAX_STACK),
    };
  }
  if (typeof extra === 'string') {
    return { name: 'Message', message: clip(extra, MAX_ERROR_MESSAGE), stack: null };
  }
  return { name: typeof extra, message: clip(safeString(extra), MAX_ERROR_MESSAGE), stack: null };
}

function emit(level: LogLevel, message: string, extra?: unknown): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[currentLevel]) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}`;
  if (level === 'error') {
    // errors are always paired with an error object
    console.error(line, extra !== undefined ? extra : new Error(message));
  } else if (extra !== undefined) {
    console.log(line, extra);
  } else {
    console.log(line);
  }

  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    message,
    error: describeLogExtra(extra),
  };
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER_ENTRIES) buffer.shift();
  for (const listener of listeners) {
    // A diagnostics sink must never take the app down with it.
    try {
      listener(entry);
    } catch {
      // ignored on purpose — logging is best-effort
    }
  }
}

/** The in-memory log tail, oldest first. */
export function getRecentLogs(): readonly LogEntry[] {
  return [...buffer];
}

/** Drop the in-memory tail (the durable store is the caller's concern). */
export function clearRecentLogs(): void {
  buffer.length = 0;
}

/** Observe new entries. Returns the unsubscribe function. */
export function subscribeToLogs(listener: LogListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const logger = {
  /** Dev-only diagnostics; stripped at release-build level by setLogLevel. */
  debug: (message: string, extra?: unknown): void => emit('debug', message, extra),
  /** Lifecycle: sync connect/disconnect, focus session start/end. */
  info: (message: string, extra?: unknown): void => emit('info', message, extra),
  /** Recoverable: skipped action, conflict resolved. */
  warn: (message: string, extra?: unknown): void => emit('warn', message, extra),
  /** Always paired with an error object. */
  error: (message: string, error?: unknown): void => emit('error', message, error),
};
