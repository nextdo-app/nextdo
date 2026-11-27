/**
 * Durable store for diagnostic log lines.
 *
 * Only warn/error lines are persisted: those are written by the app itself
 * and never contain user content (the logging rule in
 * `packages/core/src/lib/logger.ts`). Storage follows the same platform
 * matrix as the app's other device preferences:
 *
 *   native (iOS/Android) → `expo-file-system/legacy`, a file under the
 *                          app's document directory
 *   web / Tauri          → `localStorage`
 *   browser without storage → in-memory
 *
 * Both backends are bounded like Tungsten Edge's IssueLog: 14 days and
 * 256 KB. Old lines are dropped before a write, so the store can never grow
 * without limit.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

export const DIAGNOSTIC_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export const DIAGNOSTIC_MAX_BYTES = 256 * 1024;
export const DIAGNOSTIC_FILE_NAME = 'diagnostics.log.jsonl';
export const DIAGNOSTIC_WEB_KEY = 'nextdo.diagnostics.log';

const directory = Platform.OS !== 'web' && FileSystem.documentDirectory !== null
  ? `${FileSystem.documentDirectory}diagnostics`
  : null;
const file = directory === null ? null : `${directory}/${DIAGNOSTIC_FILE_NAME}`;
let memoryText = '';
let writeChain: Promise<void> = Promise.resolve();

/** UTF-8 byte length without relying on TextEncoder (absent on some Hermes builds). */
export function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function lineTimestamp(line: string): number | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const ts = (parsed as { ts?: unknown }).ts;
    if (typeof ts !== 'string') return null;
    const value = Date.parse(ts);
    return Number.isNaN(value) ? null : value;
  } catch {
    return null;
  }
}

/**
 * Drop unreadable, expired and (once over the bound) oldest lines.
 * Exported for the unit test — the storage path itself only calls it.
 */
export function trimDiagnosticLines(lines: readonly string[], now: Date): string[] {
  const cutoff = now.getTime() - DIAGNOSTIC_RETENTION_MS;
  const kept = lines.filter((line) => {
    const ts = lineTimestamp(line);
    return ts !== null && ts >= cutoff;
  });

  let bytes = kept.reduce((sum, line) => sum + utf8Bytes(line) + 1, 0);
  if (bytes <= DIAGNOSTIC_MAX_BYTES) return kept;

  const target = Math.floor(DIAGNOSTIC_MAX_BYTES * 0.8);
  let start = 0;
  while (bytes > target && start < kept.length) {
    const line = kept[start];
    if (line === undefined) break;
    bytes -= utf8Bytes(line) + 1;
    start += 1;
  }
  return kept.slice(start);
}

async function readText(): Promise<string> {
  if (file !== null) {
    try {
      return await FileSystem.readAsStringAsync(file);
    } catch {
      return '';
    }
  }
  try {
    const storage = globalThis.localStorage;
    return storage === undefined ? memoryText : storage.getItem(DIAGNOSTIC_WEB_KEY) ?? '';
  } catch {
    return memoryText;
  }
}

async function writeText(value: string): Promise<void> {
  if (file !== null && directory !== null) {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    await FileSystem.writeAsStringAsync(file, value);
    return;
  }
  memoryText = value;
  try {
    if (value === '') globalThis.localStorage?.removeItem(DIAGNOSTIC_WEB_KEY);
    else globalThis.localStorage?.setItem(DIAGNOSTIC_WEB_KEY, value);
  } catch {
    // Keep the current session's log when browser storage is unavailable.
  }
}

/** All persisted lines, oldest first. Unreadable stores yield an empty list. */
export async function readDiagnosticLines(): Promise<string[]> {
  const text = await readText();
  return text.split('\n').filter((line) => line.trim() !== '');
}

/** Append one JSON line, trimming the store first. Writes are serialized. */
export function appendDiagnosticLine(line: string): Promise<void> {
  writeChain = writeChain
    .catch(() => undefined)
    .then(async () => {
      const current = await readDiagnosticLines();
      const next = trimDiagnosticLines([...current, line], new Date());
      await writeText(next.length === 0 ? '' : `${next.join('\n')}\n`);
    })
    .catch(() => {
      // A broken store must not break logging or the app.
    });
  return writeChain;
}

/** Remove every persisted line. */
export async function clearDiagnosticLines(): Promise<void> {
  writeChain = writeChain
    .catch(() => undefined)
    .then(async () => {
      await writeText('');
    })
    .catch(() => undefined);
  return writeChain;
}
