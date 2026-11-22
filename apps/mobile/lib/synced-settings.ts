/**
 * The synced-settings registry (issue #97): which device preferences follow
 * the account, how their values are parsed, and how they reach the existing
 * theme / focus / engine modules.
 *
 * Only these three keys are synced. Notification settings (whose reminder
 * channel is a documented per-device preference), habit reminders, the
 * app-update channel/skip state and the calendar target stay device-local —
 * they describe this device's permissions, OS schedules and installed build.
 *
 * Values in the `settings` table are JSON text, one row per key:
 *   theme-preference  "\"system\" | \"light\" | \"dark\""
 *   focus             {"lastMinutes": 25 | null}
 *   engine-context    {"availableMinutes": 60}
 */
import { logger } from '@nextdo/core';
import {
  applyEngineContextFromSync,
  MAX_AVAILABLE_MINUTES,
  readStoredEngineContext,
  type EngineContextSettings,
} from './engine-context';
import {
  applyFocusSettingsFromSync,
  normalizeFocusMinutes,
  readStoredFocusSettings,
  type FocusSettings,
} from './focus-settings';
import {
  applyThemePreferenceFromSync,
  readStoredThemePreference,
  type ThemePreference,
} from './theme';

export const SYNCED_SETTING_KEYS = ['theme-preference', 'focus', 'engine-context'] as const;

export type SyncedSettingKey = (typeof SYNCED_SETTING_KEYS)[number];

const THEME_VALUES: readonly ThemePreference[] = ['system', 'light', 'dark'];

function parseTheme(value: string): ThemePreference | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return THEME_VALUES.includes(parsed as ThemePreference) ? (parsed as ThemePreference) : null;
  } catch {
    return null;
  }
}

function parseFocus(value: string): FocusSettings | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const raw = (parsed as { lastMinutes?: unknown }).lastMinutes;
    if (raw === null || raw === undefined) return { lastMinutes: null };
    const minutes = normalizeFocusMinutes(raw);
    return minutes === null ? null : { lastMinutes: minutes };
  } catch {
    return null;
  }
}

function parseEngine(value: string): EngineContextSettings | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const raw = (parsed as { availableMinutes?: unknown }).availableMinutes;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) return null;
    return { availableMinutes: Math.min(Math.round(raw), MAX_AVAILABLE_MINUTES) };
  } catch {
    return null;
  }
}

/** Apply one synced row to its module. Invalid JSON / values are ignored —
 *  a bad row must never take the app down or clear a good local value. */
export function applySyncedSetting(key: string, value: string): boolean {
  switch (key) {
    case 'theme-preference': {
      const parsed = parseTheme(value);
      if (parsed === null) return false;
      applyThemePreferenceFromSync(parsed);
      return true;
    }
    case 'focus': {
      const parsed = parseFocus(value);
      if (parsed === null) return false;
      applyFocusSettingsFromSync(parsed);
      return true;
    }
    case 'engine-context': {
      const parsed = parseEngine(value);
      if (parsed === null) return false;
      applyEngineContextFromSync(parsed);
      return true;
    }
    default:
      // A key from a newer app version — this build does not own it.
      return false;
  }
}

/**
 * The device's explicit value for a key, as the JSON text to seed into the
 * table, or null when the user never set it (do NOT seed defaults — that
 * would overwrite another device's explicit choice on first sync).
 */
export async function readLocalSettingForSync(key: SyncedSettingKey): Promise<string | null> {
  try {
    switch (key) {
      case 'theme-preference': {
        const preference = await readStoredThemePreference();
        return preference === null ? null : JSON.stringify(preference);
      }
      case 'focus': {
        const settings = await readStoredFocusSettings();
        // `{lastMinutes:null}` means "no preference yet" — nothing to seed.
        if (settings === null || settings.lastMinutes === null) return null;
        return JSON.stringify(settings);
      }
      case 'engine-context': {
        const settings = await readStoredEngineContext();
        return settings === null ? null : JSON.stringify(settings);
      }
    }
  } catch (error: unknown) {
    logger.warn('synced settings: local seed read failed', error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}
