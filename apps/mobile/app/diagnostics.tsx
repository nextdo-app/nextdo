/**
 * Diagnostics & feedback (issue #109 follow-up).
 *
 * The app keeps a small warn/error log on the device (see
 * `lib/diagnostics/event-log.ts`). This screen shows what the log holds,
 * lets the user copy a plain-text report, and links to the GitHub issue
 * form — so a bug report can carry the technical context without asking the
 * user to run adb.
 *
 * The log is bounded and local: 14 days, 256 KB, and only app-written
 * technical lines. Task titles, notes and project names are never logged
 * (the `packages/core` logging rule), and nothing is uploaded automatically.
 *
 * A native crash (Android process death) cannot be caught from JS — the
 * screen says so, so a missing stack trace is not mistaken for a clean run.
 */
import { useEffect, useMemo, useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { LogEntry } from '@nextdo/core';
import { Button, Card, cn } from '@nextdo/ui';
import { useAppTheme } from '@/lib/theme';
import { useAppInsets } from '@/lib/use-app-insets';
import { goBack } from '@/lib/go-back';
import {
  clearAllDiagnosticLogs,
  installDiagnosticLog,
  loadDiagnosticEntries,
} from '@/lib/diagnostics/event-log';
import {
  buildDiagnosticReport,
  collectDiagnosticEnvironment,
} from '@/lib/diagnostics/report';

const ISSUES_URL = 'https://github.com/nextdo-app/nextdo/issues/new';

function formatLogTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-baseline justify-between gap-3">
      <Text className="font-sans text-xs text-muted dark:text-muted-dark">{label}</Text>
      <Text
        numberOfLines={2}
        className="flex-1 text-right font-sans text-xs font-medium text-ink dark:text-ink-dark"
      >
        {value}
      </Text>
    </View>
  );
}

function IssueRow({ entry }: { entry: LogEntry }) {
  return (
    <View className="gap-1 border-b border-border/40 py-2.5 dark:border-border-dark/40">
      <View className="flex-row items-center gap-2">
        <Text
          className={cn(
            'font-sans text-[10px] font-bold uppercase',
            entry.level === 'error'
              ? 'text-danger dark:text-danger-dark'
              : 'text-accent dark:text-accent-dark',
          )}
        >
          {entry.level}
        </Text>
        <Text className="font-sans text-[11px] text-muted dark:text-muted-dark">
          {formatLogTime(entry.ts)}
        </Text>
      </View>
      <Text numberOfLines={3} className="font-sans text-xs text-ink dark:text-ink-dark">
        {entry.message}
      </Text>
      {entry.error !== null ? (
        <Text
          numberOfLines={2}
          className="font-sans text-[11px] text-muted dark:text-muted-dark"
        >
          {entry.error.name}: {entry.error.message}
        </Text>
      ) : null}
    </View>
  );
}

export default function DiagnosticsScreen() {
  const insets = useAppInsets();
  const { isDark } = useAppTheme();
  const environment = useMemo(
    () => collectDiagnosticEnvironment(isDark ? 'dark' : 'light'),
    [isDark],
  );
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [linkFailed, setLinkFailed] = useState(false);
  const [clearStatus, setClearStatus] = useState<'idle' | 'armed' | 'cleared'>('idle');

  useEffect(() => {
    installDiagnosticLog();
    let cancelled = false;
    void loadDiagnosticEntries().then((loaded) => {
      if (!cancelled) setEntries(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (copyStatus !== 'copied') return;
    const timer = setTimeout(() => setCopyStatus('idle'), 2500);
    return () => clearTimeout(timer);
  }, [copyStatus]);

  // The destructive action needs two taps; the arm state expires so a
  // stray first tap never leaves 「再次点击确认」 armed indefinitely.
  useEffect(() => {
    if (clearStatus !== 'armed') return;
    const timer = setTimeout(() => setClearStatus('idle'), 4000);
    return () => clearTimeout(timer);
  }, [clearStatus]);

  async function copyReport(): Promise<void> {
    const report = buildDiagnosticReport(entries ?? [], environment, new Date());
    try {
      const copied = await Clipboard.setStringAsync(report);
      if (copied) setClearStatus('idle');
      setCopyStatus(copied ? 'copied' : 'failed');
    } catch {
      // A denied clipboard (non-secure context, permission prompt dismissed)
      // must say so instead of looking like a successful copy.
      setCopyStatus('failed');
    }
  }

  async function clearLogs(): Promise<void> {
    if (clearStatus !== 'armed') {
      setClearStatus('armed');
      return;
    }
    await clearAllDiagnosticLogs();
    setEntries([]);
    setClearStatus('cleared');
  }

  const recent = (entries ?? []).slice(-20).reverse();
  const total = entries === null ? '读取中…' : String(entries.length);

  return (
    <ScrollView
      className="flex-1 bg-canvas dark:bg-canvas-dark"
      contentContainerStyle={{
        paddingTop: Math.max(insets.top, 16),
        paddingBottom: Math.max(insets.bottom, 24),
      }}
    >
      <View className="mx-auto w-full max-w-4xl px-4">
        <View className="mb-2 flex-row items-center justify-between">
          <Button label="← 设置" variant="ghost" onPress={() => goBack('/(tabs)/settings')} />
        </View>

        <Text className="font-display text-3xl font-bold tracking-tight text-ink dark:text-ink-dark">
          诊断与反馈
        </Text>
        <Text className="mt-1 font-sans text-sm text-muted dark:text-muted-dark">
          遇到问题时，先复制诊断报告，再打开 GitHub Issue 粘贴。日志只保存在这台设备上，
          不会自动上传；记录的是应用事件和技术错误，不包含任务标题、备注或项目名称。
        </Text>

        <Card variant="outlined" className="mt-4 gap-2 p-4">
          <InfoRow label="应用版本" value={environment.appVersion} />
          <InfoRow
            label="平台"
            value={`${environment.platform} ${environment.osVersion}`.trim()}
          />
          <InfoRow label="设备" value={environment.deviceModel} />
          <InfoRow label="语言" value={environment.locale} />
          <InfoRow label="主题" value={environment.theme === 'dark' ? '深色' : '浅色'} />
          <InfoRow label="日志级别" value={environment.logLevel} />
          <InfoRow label="本地日志条数" value={total} />
        </Card>

        <View className="mt-3 gap-2">
          <Button
            label={copyStatus === 'copied' ? '已复制到剪贴板' : copyStatus === 'failed' ? '复制失败，请重试' : '复制诊断报告'}
            onPress={() => {
              void copyReport();
            }}
          />
          <Button
            label={linkFailed ? '打开失败，请重试' : '打开 GitHub Issues'}
            variant="secondary"
            onPress={() => {
              setLinkFailed(false);
              void Linking.openURL(ISSUES_URL).catch(() => setLinkFailed(true));
            }}
          />
          <Button
            label={
              clearStatus === 'armed'
                ? '再次点击确认清空'
                : clearStatus === 'cleared'
                  ? '已清空本机日志'
                  : '清空本机日志'
            }
            variant="ghost"
            onPress={() => {
              void clearLogs();
            }}
          />
        </View>

        <Text className="mt-2 font-sans text-xs text-muted dark:text-muted-dark">
          清空只删除本机日志，不影响任务、项目或同步数据。
        </Text>

        <View className="mt-5 flex-row items-center justify-between">
          <Text className="font-sans text-sm font-medium text-ink dark:text-ink-dark">
            最近事件
          </Text>
          <Text className="font-sans text-xs text-muted dark:text-muted-dark">
            最近 20 条 · 保留 14 天
          </Text>
        </View>

        <Card variant="outlined" className="mt-2 p-4">
          {entries === null ? (
            <Text className="font-sans text-xs text-muted dark:text-muted-dark">读取中…</Text>
          ) : recent.length === 0 ? (
            <Text className="font-sans text-xs text-muted dark:text-muted-dark">
              还没有记录到问题。应用遇到警告或错误时会自动写入本机日志。
            </Text>
          ) : (
            recent.map((entry, index) => (
              <IssueRow key={`${entry.ts}-${entry.level}-${index}`} entry={entry} />
            ))
          )}
        </Card>

        <Text className="mt-3 font-sans text-xs leading-relaxed text-muted dark:text-muted-dark">
          说明：应用层面的错误会记录在这里。系统级崩溃（例如 Android 进程被直接终止）可能
          抓不到堆栈；如果应用闪退后这里没有新增记录，请再用电脑抓取系统日志。
        </Text>
      </View>
    </ScrollView>
  );
}
