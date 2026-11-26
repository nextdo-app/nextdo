/**
 * Durable store for diagnostic log lines.
 *
 * Only warn/error lines are persisted: those are written by the app itself
 * and never contain user content (the logging rule in
 * `packages/core/src/lib/logger.ts`). Storage follows the same platform
 * matrix as the app's other device preferences:
 *
 *   native (iOS/Android) → `expo-file-system/legacy`, a 0600 file under the
 *                          app's document directory
 *   web / Tauri          → `localStorage`
 *   Node / jest          → in-memory (the module still works without RN)
 *
 * Both backends are bounded like Tungsten Edge's IssueLog: 14 days and
 * 256 KB. Old lines are dropped before a write, so the store can never grow
 * without limit.
 */
import { Platform } from 'react-native';

export const DIAGNOSTIC_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export const DIAGNOSTIC_MAX_BYTES = 256 * 1024;
export const DIAGNOSTIC_FILE_NAME = 'diagnostics.log.jsonl';
export const DIAGNOSTIC_WEB_KEY = 'nextdo.diagnostics.log';

interface FileSystemLegacy {
  documentDirectory: string | null;
  makeDirectoryAsync(path: string, options?: { intermediates?: boolean }): Promise<void>;
  readAsStringAsync(path: string): Promise<string>;
  writeAsStringAsync(path: string, contents: string): Promise<void>;
  deleteAsync(path: string, options?: { idempotent?: boolean }): Promise<void>;
}

let fileSystem: FileSystemLegacy | null | undefined;
let memoryText = '';
let writeChain: Promise<void> = Promise.resolve();

function getFileSystem(): FileSystemLegacy | null {
  if (fileSystem !== undefined) return fileSystem;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fileSystem = require('expo-file-system/legacy') as FileSystemLegacy;
  } catch {
    fileSystem = null;
  }
  return fileSystem;
}

function useWebStorage(): boolean {
  return Platform.OS === 'web' && typeof globalThis.localStorage !== 'undefined';
}

function webStorage(): Storage | null {
  return useWebStorage() ? globalThis.localStorage : null;
}

function webGet(): string {
  const storage = webStorage();
  if (storage === null) return memoryText;
  try {
    return storage.getItem(DIAGNOSTIC_WEB_KEY) ?? '';
  } catch {
    return memoryText;
  }
}

function webSet(value: string): void {
  const storage = webStorage();
  if (storage === null) {
    memoryText = value;
    return;
  }
  try {
    if (value === '') storage.removeItem(DIAGNOSTIC_WEB_KEY);
    else storage.setItem(DIAGNOSTIC_WEB_KEY, value);
  } catch {
    // Quota / private mode — keep the session usable through memory.
    memoryText = value;
  }
}

function nativeDirectory(): string | null {
  const fs = getFileSystem();
  if (fs === null || fs.documentDirectory === null) return null;
  return `${fs.documentDirectory}diagnostics`;
}

function nativeFile(): string | null {
  const directory = nativeDirectory();
  return directory === null ? null : `${directory}/${DIAGNOSTIC_FILE_NAME}`;
}

/** UTF-8 byte length without relying on TextEncoder (absent on some Hermes builds). */
function utf8Bytes(value: string): number {
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
  const fs = getFileSystem();
  const file = nativeFile();
  if (fs !== null && file !== null && !useWebStorage()) {
    try {
      return await fs.readAsStringAsync(file);
    } catch {
      return '';
    }
  }
  return webGet();
}

async function writeText(value: string): Promise<void> {
  const fs = getFileSystem();
  const file = nativeFile();
  if (fs !== null && file !== null && !useWebStorage()) {
    const directory = nativeDirectory();
    if (directory !== null) {
      try {
        await fs.makeDirectoryAsync(directory, { intermediates: true });
      } catch {
        // already exists
      }
    }
    await fs.writeAsStringAsync(file, value);
    return;
  }
  webSet(value);
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
