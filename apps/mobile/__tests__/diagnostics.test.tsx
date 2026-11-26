/**
 * Diagnostics & feedback (issue #109 follow-up).
 *
 * The screen must (1) show the environment + the warn/error tail, (2) copy a
 * report that carries those lines, (3) clear both the durable store and the
 * in-memory tail behind a two-tap confirmation, and (4) link to the GitHub
 * issue form. The pure report/trim helpers are covered here too — they are
 * what keeps the paste bounded and readable.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { clearRecentLogs, describeLogExtra, logger, type LogEntry } from '@nextdo/core';

let mockClipboardText = '';
let mockFile = '';

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async (text: string) => {
    mockClipboardText = text;
    return true;
  }),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '0.2.1' } },
}));

jest.mock('expo-device', () => ({
  modelName: 'Pixel 7',
  osName: 'Android',
  osVersion: '14',
}));

jest.mock('@/lib/theme', () => ({
  useAppTheme: () => ({ isDark: false }),
}));

jest.mock('@/lib/use-app-insets', () => ({
  useAppInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/lib/go-back', () => ({
  goBack: jest.fn(),
}));

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///nextdo-test/',
  makeDirectoryAsync: jest.fn(async () => undefined),
  readAsStringAsync: jest.fn(async () => mockFile),
  writeAsStringAsync: jest.fn(async (_path: string, text: string) => {
    mockFile = text;
  }),
  deleteAsync: jest.fn(async () => {
    mockFile = '';
  }),
}));

import DiagnosticsScreen from '../app/diagnostics';
import {
  parseLogEntry,
  serializeLogEntry,
} from '@/lib/diagnostics/event-log';
import { buildDiagnosticReport, formatIssue, type DiagnosticEnvironment } from '@/lib/diagnostics/report';
import { DIAGNOSTIC_MAX_BYTES, trimDiagnosticLines } from '@/lib/diagnostics/storage';

const ENVIRONMENT: DiagnosticEnvironment = {
  appVersion: '0.2.1',
  platform: 'android',
  osVersion: 'Android 14',
  deviceModel: 'Pixel 7',
  locale: 'zh-CN',
  theme: 'light',
  logLevel: 'info',
};

const NOW = new Date('2026-11-26T12:00:00.000Z');

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    ts: '2026-11-26T11:00:00.000Z',
    level: 'error',
    message: 'calendar permission read failed',
    error: { name: 'TypeError', message: 'boom', stack: null },
    ...overrides,
  };
}

describe('diagnostics report helpers', () => {
  it('drops expired lines and keeps recent ones', () => {
    const fresh = JSON.stringify(entry({ message: 'fresh' }));
    const old = JSON.stringify(entry({ ts: '2026-11-01T11:00:00.000Z', message: 'old' }));
    expect(trimDiagnosticLines([old, fresh], NOW)).toEqual([fresh]);
  });

  it('keeps the store under the byte bound from the oldest side', () => {
    const big = JSON.stringify(entry({ message: 'x'.repeat(120 * 1024) }));
    const lines = [big, big, big];
    const trimmed = trimDiagnosticLines(lines, NOW);
    const bytes = trimmed.reduce((sum, line) => sum + new TextEncoder().encode(line).length + 1, 0);
    expect(bytes).toBeLessThanOrEqual(DIAGNOSTIC_MAX_BYTES);
    expect(trimmed.length).toBeGreaterThan(0);
    expect(trimmed[trimmed.length - 1]).toBe(big);
  });

  it('parses only well-formed lines', () => {
    expect(parseLogEntry('not json')).toBeNull();
    expect(parseLogEntry(JSON.stringify({ ts: 'nope', level: 'error', message: 'x' }))).toBeNull();
    expect(parseLogEntry(JSON.stringify({ ts: NOW.toISOString(), level: 'verbose', message: 'x' }))).toBeNull();
    const roundTrip = parseLogEntry(serializeLogEntry(entry()));
    expect(roundTrip?.message).toBe('calendar permission read failed');
    expect(roundTrip?.error?.name).toBe('TypeError');
  });

  it('formats the report with environment and issue lines', () => {
    const report = buildDiagnosticReport([entry()], ENVIRONMENT, NOW);
    expect(report).toContain('Nextdo diagnostics');
    expect(report).toContain('app: 0.2.1');
    expect(report).toContain('platform: android Android 14');
    expect(report).toContain('device: Pixel 7');
    expect(report).toContain('issues: 1 (last 14 days)');
    expect(report).toContain('ERROR calendar permission read failed');
    expect(report).toContain('TypeError: boom');
  });

  it('says (none) when there is nothing to report', () => {
    expect(buildDiagnosticReport([], ENVIRONMENT, NOW)).toContain('recent issues:\n(none)');
  });

  it('keeps only the newest 50 issues', () => {
    const entries = Array.from({ length: 60 }, (_, index) =>
      entry({
        ts: new Date(NOW.getTime() - (60 - index) * 60_000).toISOString(),
        message: `issue ${index}`,
      }),
    );
    const report = buildDiagnosticReport(entries, ENVIRONMENT, NOW);
    expect(report).toContain('issues: 50 (last 14 days)');
    expect(report).not.toContain('ERROR issue 9');
    expect(report).toContain('issue 59');
  });

  it('clips long error messages and stacks', () => {
    const info = describeLogExtra(new Error('y'.repeat(1000)));
    expect(info?.message.length).toBeLessThan(400);
    expect(formatIssue(entry({ error: { name: 'Error', message: 'x'.repeat(500), stack: 'Error: x\n  at a\n  at b' } }))).toContain('  at a');
  });
});

describe('DiagnosticsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearRecentLogs();
    mockClipboardText = '';
    mockFile = '';
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function renderLoaded(): Promise<void> {
    render(<DiagnosticsScreen />);
    await waitFor(() => {
      expect(screen.queryByText('读取中…')).toBeNull();
    });
  }

  it('shows the environment and an empty state', async () => {
    await renderLoaded();
    expect(screen.getByText('诊断与反馈')).toBeTruthy();
    expect(screen.getByText('0.2.1')).toBeTruthy();
    expect(screen.getByText('Pixel 7')).toBeTruthy();
    expect(screen.getByText('还没有记录到问题。应用遇到警告或错误时会自动写入本机日志。')).toBeTruthy();
  });

  it('lists the warn/error tail', async () => {
    logger.warn('calendar permission read failed', new Error('boom'));
    await renderLoaded();
    expect(screen.getByText('calendar permission read failed')).toBeTruthy();
    expect(screen.getByText('Error: boom')).toBeTruthy();
  });

  it('copies a report containing the logged issues', async () => {
    logger.error('powersync connect failed', new Error('offline'));
    await renderLoaded();
    fireEvent.press(screen.getByText('复制诊断报告'));
    await waitFor(() => {
      expect(mockClipboardText).toContain('Nextdo diagnostics');
    });
    expect(mockClipboardText).toContain('powersync connect failed');
    expect(mockClipboardText).toContain('Error: offline');
    expect(screen.getByText('已复制到剪贴板')).toBeTruthy();
  });

  it('opens the GitHub issue form', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await renderLoaded();
    fireEvent.press(screen.getByText('打开 GitHub Issues'));
    expect(openURL).toHaveBeenCalledWith('https://github.com/nextdo-app/nextdo/issues/new');
  });

  it('surfaces a clipboard failure instead of pretending to copy', async () => {
    (Clipboard.setStringAsync as jest.Mock).mockRejectedValueOnce(new Error('denied'));
    await renderLoaded();
    fireEvent.press(screen.getByText('复制诊断报告'));
    await waitFor(() => {
      expect(screen.getByText('复制失败，请重试')).toBeTruthy();
    });
  });

  it('surfaces a failed link open', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    await renderLoaded();
    fireEvent.press(screen.getByText('打开 GitHub Issues'));
    await waitFor(() => {
      expect(screen.getByText('打开失败，请重试')).toBeTruthy();
    });
  });

  it('clears logs only after a second tap', async () => {
    logger.warn('something failed', new Error('x'));
    await renderLoaded();
    expect(screen.getByText('something failed')).toBeTruthy();

    fireEvent.press(screen.getByText('清空本机日志'));
    expect(screen.getByText('再次点击确认清空')).toBeTruthy();
    expect(screen.getByText('something failed')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText('再次点击确认清空'));
    });
    await waitFor(() => {
      expect(screen.getByText('还没有记录到问题。应用遇到警告或错误时会自动写入本机日志。')).toBeTruthy();
    });
    expect(mockFile).toBe('');
  });
});
