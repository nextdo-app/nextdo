/**
 * Quick time presets for `DateTimePicker` (issue #105).
 *
 * The picker's 「常用时段」 chips used to be a fixed morning-heavy list; the
 * issue asks for two things:
 *
 * - the user's MOST-USED times come first (usage frequency, not a static
 *   guess), and
 * - the row still covers morning / afternoon / evening instead of only 上午.
 *
 * Usage is a device-local UI convenience (not account data), so it lives on
 * the device only:
 *   native (iOS/Android) → a JSON file under `expo-file-system`
 *   browser web / Tauri → `localStorage`
 *   Node / jest         → in-memory
 *
 * Usage counters are non-secret device preferences. Native storage uses a
 * plain JSON file; task and account data use their own storage contracts.
 *
 * Stored shape (JSON): `{ "counts": { "HH:mm": <uses> } }`. Reads are cached
 * in the module so a reopened modal renders its presets without a flash; the
 * hook (`use-quick-time-presets`) refreshes the cache from storage on mount.
 */
import { logger } from '@nextdo/core';
import { isReactNativeRuntime } from '@nextdo/db';

export const TIME_PRESETS_SETTINGS_KEY = 'nextdo.settings.time-presets';

/** At most this many usage-ranked times are shown before the defaults. */
const MAX_USED_PRESETS = 4;

export interface QuickTimePreset {
  h: number;
  m: number;
  /** Display + accessibility label, `HH:mm`. */
  label: string;
  /** Coarse day-part label shown next to the time. */
  period: string;
}

export type TimeUseCounts = Readonly<Record<string, number>>;

/**
 * The fallback chips. Deliberately spread across the day — morning
 * (07:30 / 09:00), noon (12:30), afternoon (14:00 / 18:30) and evening
 * (19:30 / 21:30 / 22:30) — so a user with no history still gets all three
 * periods the issue names.
 */
const DEFAULT_QUICK_TIMES: ReadonlyArray<{ h: number; m: number }> = [
  { h: 7, m: 30 },
  { h: 9, m: 0 },
  { h: 12, m: 30 },
  { h: 14, m: 0 },
  { h: 18, m: 30 },
  { h: 19, m: 30 },
  { h: 21, m: 30 },
  { h: 22, m: 30 },
];

const pad = (n: number): string => String(n).padStart(2, '0');

/** The coarse day-part used by both the chip label and coverage tests. */
export function timePeriodLabel(hour: number): string {
  if (hour < 6) return '凌晨';
  if (hour < 12) return '上午';
  if (hour < 18) return '下午';
  return '晚间';
}

/** `HH:mm` for a stored/usage key. */
export function timePresetLabel(hour: number, minute: number): string {
  return `${pad(hour)}:${pad(minute)}`;
}

const TIME_KEY = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isValidTimeKey(key: string): boolean {
  return TIME_KEY.test(key);
}

/**
 * Usage-ranked presets first (top `MAX_USED_PRESETS`), then every default
 * chip — deduplicated, usage wins the ordering. Defaults are never trimmed:
 * they are what guarantees the three-period coverage.
 */
export function buildQuickTimePresets(counts: TimeUseCounts): QuickTimePreset[] {
  const ranked = Object.entries(counts)
    .filter(([key, uses]) => isValidTimeKey(key) && Number.isFinite(uses) && uses > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_USED_PRESETS);

  const seen = new Set<string>();
  const presets: QuickTimePreset[] = [];
  const push = (h: number, m: number): void => {
    if (h < 0 || h > 23 || m < 0 || m > 59) return;
    const label = timePresetLabel(h, m);
    if (seen.has(label)) return;
    seen.add(label);
    presets.push({ h, m, label, period: timePeriodLabel(h) });
  };

  for (const [label] of ranked) {
    const match = TIME_KEY.exec(label);
    if (match === null) continue;
    push(Number(match[1]), Number(match[2]));
  }
  for (const time of DEFAULT_QUICK_TIMES) push(time.h, time.m);
  return presets;
}

/** Tolerant parse of the stored blob; anything unreadable falls back to {}. */
export function parseTimeUseCounts(raw: string | null): TimeUseCounts {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const rawCounts = (parsed as { counts?: unknown }).counts;
    if (typeof rawCounts !== 'object' || rawCounts === null) return {};
    const counts: Record<string, number> = {};
    for (const [key, value] of Object.entries(rawCounts)) {
      if (!isValidTimeKey(key)) continue;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) continue;
      counts[key] = Math.min(value, 9999);
    }
    return counts;
  } catch {
    return {};
  }
}

interface KeyValue {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

function createMemoryStore(): KeyValue {
  const map = new Map<string, string>();
  return {
    async getItem(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
  };
}

interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getWebLocalStorage(): WebStorageLike | null {
  const g = globalThis as {
    window?: { localStorage?: WebStorageLike };
    localStorage?: WebStorageLike;
  };
  return g.window?.localStorage ?? g.localStorage ?? null;
}

function createWebStore(): KeyValue {
  return {
    async getItem(key) {
      try {
        return getWebLocalStorage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    async setItem(key, value) {
      try {
        getWebLocalStorage()?.setItem(key, value);
      } catch {
        // A quota / private-mode refusal must not break time selection — the
        // in-memory cache keeps this session consistent either way.
      }
    },
  };
}

interface ExpoFileSystemLegacy {
  documentDirectory: string | null;
  makeDirectoryAsync(path: string, options?: { intermediates?: boolean }): Promise<void>;
  readAsStringAsync(path: string): Promise<string>;
  writeAsStringAsync(path: string, contents: string): Promise<void>;
}

/**
 * Native store: one JSON file for non-secret usage counters.
 * null when the module or its documents directory is unavailable (a bare
 * Node/jest fallback then takes over instead of the whole read throwing).
 */
function createFileStore(): KeyValue | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('expo-file-system/legacy') as ExpoFileSystemLegacy;
    if (fs.documentDirectory === null) return null;
    const directory = `${fs.documentDirectory}nextdo`;
    const file = `${directory}/time-presets.json`;
    return {
      async getItem() {
        try {
          return await fs.readAsStringAsync(file);
        } catch {
          return null;
        }
      },
      async setItem(_key, value) {
        try {
          await fs.makeDirectoryAsync(directory, { intermediates: true });
        } catch {
          // already exists
        }
        await fs.writeAsStringAsync(file, value);
      },
    };
  } catch {
    return null;
  }
}

let backend: KeyValue | null = null;
let cachedCounts: TimeUseCounts | null = null;
let pendingLoad: Promise<TimeUseCounts> | null = null;
let writeChain: Promise<void> = Promise.resolve();

function getBackend(): KeyValue {
  if (backend === null) {
    const file = isReactNativeRuntime() ? createFileStore() : null;
    backend = file ?? (getWebLocalStorage() !== null ? createWebStore() : createMemoryStore());
  }
  return backend;
}

/** The already-loaded counters (`{}` before the first read). */
export function getCachedTimeUseCounts(): TimeUseCounts {
  return cachedCounts ?? {};
}

/** Load the counters once; repeated calls share the in-flight promise. */
export async function readTimeUseCounts(): Promise<TimeUseCounts> {
  if (cachedCounts !== null) return cachedCounts;
  if (pendingLoad === null) {
    pendingLoad = getBackend()
      .getItem(TIME_PRESETS_SETTINGS_KEY)
      .then((raw) => {
        cachedCounts = parseTimeUseCounts(raw);
        return cachedCounts;
      })
      .catch((err: unknown) => {
        logger.warn('time preset read failed', err instanceof Error ? err : new Error(String(err)));
        cachedCounts = {};
        return cachedCounts;
      })
      .finally(() => {
        pendingLoad = null;
      });
  }
  return pendingLoad;
}

/**
 * Count one confirmed time selection and persist the blob. Persistence is
 * fire-and-forget from the picker's perspective (`void recordTimeUse(...)`):
 * a failed write must never block closing the modal, and the in-memory cache
 * already reflects the new count for this session.
 */
export async function recordTimeUse(hour: number, minute: number): Promise<void> {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return;
  // Load once, then read the cache AFTER the await: several confirmations in
  // the same tick all resolve from the same in-flight load, and the awaited
  // value would be the pre-increment snapshot for each of them.
  await readTimeUseCounts();
  const current = cachedCounts ?? {};
  const label = timePresetLabel(hour, minute);
  // Every legal time keeps its counter: `HH:mm` has at most 1440 keys, so
  // the blob is inherently bounded. A top-N storage cap would evict times
  // the user actually selects — with two new times alternating, each write
  // could drop the other before it reached count 2. Only the DISPLAY is
  // limited (MAX_USED_PRESETS).
  const counts: Record<string, number> = {
    ...current,
    [label]: (current[label] ?? 0) + 1,
  };
  cachedCounts = counts;
  const value = JSON.stringify({ counts });
  writeChain = writeChain.then(() => getBackend().setItem(TIME_PRESETS_SETTINGS_KEY, value)).catch(
    (err: unknown) => {
      logger.warn('time preset write failed', err instanceof Error ? err : new Error(String(err)));
    },
  );
  return writeChain;
}
