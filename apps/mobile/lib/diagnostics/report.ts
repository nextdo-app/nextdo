/**
 * Plain-text diagnostic report — what the user copies and pastes into a
 * GitHub issue.
 *
 * The report is written for the maintainer: labels stay English in every UI
 * language, and it carries only what the app itself wrote. Log lines follow
 * the `packages/core` logging rule (no user free-text), so task titles,
 * notes and project names never reach this text. The feedback screen says so
 * too.
 */
import { getLogLevel, type LogEntry } from '@nextdo/core';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { DIAGNOSTIC_RETENTION_MS } from './storage';

/** Keep the paste small enough for a GitHub issue text box. */
const MAX_REPORT_BYTES = 60 * 1024;
const MAX_ISSUES = 50;
const MAX_STACK_LINES = 8;

export interface DiagnosticEnvironment {
  appVersion: string;
  /** `android` / `ios` / `web`. */
  platform: string;
  osVersion: string;
  deviceModel: string;
  locale: string;
  theme: 'light' | 'dark';
  logLevel: string;
}

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

function readDevice(): { model: string; os: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const device = require('expo-device') as {
      modelName?: string | null;
      osName?: string | null;
      osVersion?: string | null;
    };
    const os = [device.osName, device.osVersion].filter((part) => part !== null && part !== undefined && part !== '').join(' ');
    return {
      model: device.modelName ?? 'unknown',
      os: os === '' ? 'unknown' : os,
    };
  } catch {
    return { model: 'unknown', os: 'unknown' };
  }
}

function readLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return 'unknown';
  }
}

/** Environment metadata shown on the diagnostics screen and copied with it. */
export function collectDiagnosticEnvironment(theme: 'light' | 'dark'): DiagnosticEnvironment {
  const device = readDevice();
  return {
    appVersion: Constants.expoConfig?.version ?? 'unknown',
    platform: Platform.OS,
    osVersion: device.os === 'unknown' ? String(Platform.Version ?? 'unknown') : device.os,
    deviceModel: device.model,
    locale: readLocale(),
    theme,
    logLevel: getLogLevel(),
  };
}

function stackLines(stack: string | null): string[] {
  if (stack === null || stack === '') return [];
  return stack
    .split('\n')
    .slice(1, MAX_STACK_LINES + 1)
    .map((line) => `    ${line.trim()}`);
}

/** One log entry as it appears in the copied report. */
export function formatIssue(entry: LogEntry): string {
  const head = `${entry.ts} ${entry.level.toUpperCase()} ${entry.message}`;
  if (entry.error === null) return head;
  return [head, `  ${entry.error.name}: ${entry.error.message}`, ...stackLines(entry.error.stack)].join('\n');
}

/**
 * Build the full report. `now` is injected so the retention window is
 * testable and no hidden clock is read here.
 */
export function buildDiagnosticReport(
  entries: readonly LogEntry[],
  environment: DiagnosticEnvironment,
  now: Date,
): string {
  const cutoff = now.getTime() - DIAGNOSTIC_RETENTION_MS;
  const recent = entries
    .filter((entry) => {
      const ts = Date.parse(entry.ts);
      return !Number.isNaN(ts) && ts >= cutoff;
    })
    .slice(-MAX_ISSUES);

  const header = [
    'Nextdo diagnostics',
    `app: ${environment.appVersion}`,
    `platform: ${environment.platform} ${environment.osVersion}`.trim(),
    `device: ${environment.deviceModel}`,
    `locale: ${environment.locale}`,
    `theme: ${environment.theme}`,
    `log level: ${environment.logLevel}`,
    `issues: ${recent.length} (last 14 days)`,
  ].join('\n');

  const body = recent.length === 0 ? '(none)' : recent.map(formatIssue).join('\n\n');
  const report = `${header}\n\nrecent issues:\n${body}`;
  if (utf8Bytes(report) <= MAX_REPORT_BYTES) return report;

  // Trim from the OLDEST side: the newest issues are the ones worth reading.
  let tail = body;
  while (tail.length > 0 && utf8Bytes(`${header}\n\nrecent issues (truncated):\n…${tail}`) > MAX_REPORT_BYTES) {
    const nextBreak = tail.indexOf('\n\n');
    if (nextBreak === -1) {
      tail = '';
      break;
    }
    tail = tail.slice(nextBreak + 2);
  }
  return `${header}\n\nrecent issues (truncated):\n…${tail}`;
}
