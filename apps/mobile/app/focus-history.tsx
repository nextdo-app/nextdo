/**
 * Focus history & statistics (issue #96).
 *
 * The read side of `focus_sessions`: every terminal session (completed or
 * abandoned) with its action title, plus device-local aggregates — a 12-week
 * heatmap and a 7-day / 8-week duration trend. The aggregation rules live in
 * `lib/focus-stats.ts`; this screen only renders them.
 *
 * Entry: the Review tab's 「专注历史」 card. The history is a WATCH query, so
 * a session finished on the Focus screen shows up without a manual reload.
 */
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Button, Card, EmptyState, Tag, cn } from '@nextdo/ui';
import type { FocusHistoryRow } from '@nextdo/db';
import { localDateKey } from '@nextdo/core';
import { useAppInsets } from '@/lib/use-app-insets';
import { useAppClock } from '@/hooks/use-app-clock';
import { useFocusHistory } from '@/hooks/use-focus-history';
import {
  buildFocusStats,
  focusDurationSec,
  type FocusHeatmapDay,
  type FocusHeatmapWeek,
} from '@/lib/focus-stats';
import { errorMessage } from '@/lib/error-messages';
import { goBack } from '@/lib/go-back';
import { KIND_LABELS } from '@/lib/kind-labels';

const HEAT_CELL =
  'h-3.5 w-3.5 rounded-[3px] border border-transparent';
const HEAT_LABELS = ['一', '', '三', '', '五', '', '日'];

/** Device-local YYYYMMDD → 「M月D日」. */
function formatDayKey(key: string): string {
  return `${Number(key.slice(4, 6))}月${Number(key.slice(6, 8))}日`;
}

/** Device-local M/D for the trend axis. */
function shortDayKey(key: string): string {
  return `${Number(key.slice(4, 6))}/${Number(key.slice(6, 8))}`;
}

function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 「M月D日 HH:mm–HH:mm」; the end date is added only when the session
 *  crosses local midnight. Unparseable values show the stored start. */
function formatRange(row: FocusHistoryRow): string {
  const start = new Date(row.startedAt);
  const end = new Date(row.endedAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return row.startedAt;
  const date = `${start.getMonth() + 1}月${start.getDate()}日`;
  const endPrefix =
    localDateKey(end) === localDateKey(start)
      ? ''
      : `${end.getMonth() + 1}月${end.getDate()}日 `;
  return `${date} ${hhmm(start)}–${endPrefix}${hhmm(end)}`;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0 分钟';
  if (seconds < 60) return '<1 分钟';
  return `${Math.round(seconds / 60)} 分钟`;
}

function heatCellClass(day: FocusHeatmapDay): string {
  if (day.isFuture) return 'bg-transparent dark:bg-transparent';
  switch (day.level) {
    case 0:
      return 'border-border/60 bg-surface dark:border-border-dark dark:bg-surface-dark';
    case 1:
      return 'bg-accent/25 dark:bg-accent-dark/25';
    case 2:
      return 'bg-accent/45 dark:bg-accent-dark/45';
    case 3:
      return 'bg-accent/70 dark:bg-accent-dark/70';
    case 4:
      return 'bg-accent dark:bg-accent-dark';
  }
}

function Heatmap({ weeks }: { weeks: FocusHeatmapWeek[] }) {
  return (
    <Card className="gap-2.5 p-4">
      <View className="flex-row items-center justify-between">
        <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
          专注热力图
        </Text>
        <Text className="font-sans text-[11px] text-muted dark:text-muted-dark">近 12 周</Text>
      </View>
      <View className="flex-row gap-1">
        <View className="gap-1 pr-1">
          {HEAT_LABELS.map((label, index) => (
            <Text
              key={`${label}-${index}`}
              className="h-3.5 text-[9px] leading-[14px] text-muted dark:text-muted-dark"
            >
              {label}
            </Text>
          ))}
        </View>
        {weeks.map((week) => (
          <View key={week.start} className="gap-1">
            {week.days.map((day) => (
              <View
                key={day.localDate}
                accessible
                accessibilityLabel={
                  day.isFuture
                    ? `${formatDayKey(day.localDate)} 未到`
                    : `${formatDayKey(day.localDate)} 专注 ${day.minutes} 分钟`
                }
                className={cn(HEAT_CELL, heatCellClass(day))}
              />
            ))}
          </View>
        ))}
      </View>
      <View className="flex-row items-center justify-end gap-1">
        <Text className="font-sans text-[10px] text-muted dark:text-muted-dark">少</Text>
        <View className={cn(HEAT_CELL, 'border-border/60 bg-surface dark:border-border-dark dark:bg-surface-dark')} />
        <View className={cn(HEAT_CELL, 'bg-accent/25 dark:bg-accent-dark/25')} />
        <View className={cn(HEAT_CELL, 'bg-accent/45 dark:bg-accent-dark/45')} />
        <View className={cn(HEAT_CELL, 'bg-accent/70 dark:bg-accent-dark/70')} />
        <View className={cn(HEAT_CELL, 'bg-accent dark:bg-accent-dark')} />
        <Text className="font-sans text-[10px] text-muted dark:text-muted-dark">多</Text>
      </View>
    </Card>
  );
}

function Trend({
  stats,
  mode,
  onModeChange,
}: {
  stats: ReturnType<typeof buildFocusStats>;
  mode: 'day' | 'week';
  onModeChange: (mode: 'day' | 'week') => void;
}) {
  const buckets =
    mode === 'day'
      ? stats.days.map((bucket) => ({ key: bucket.localDate, minutes: bucket.minutes }))
      : stats.weeks.map((bucket) => ({ key: bucket.localDate, minutes: bucket.minutes }));
  const max = Math.max(30, ...buckets.map((bucket) => bucket.minutes));
  return (
    <Card className="gap-2.5 p-4">
      <View className="flex-row items-center justify-between">
        <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
          时长趋势
        </Text>
        <View className="flex-row rounded-full border border-border/70 bg-surface p-0.5 dark:border-border-dark dark:bg-surface-dark">
          {(['day', 'week'] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityLabel={value === 'day' ? '按日查看趋势' : '按周查看趋势'}
              accessibilityState={{ selected: mode === value }}
              onPress={() => onModeChange(value)}
              className={cn(
                'rounded-full px-2.5 py-1',
                mode === value ? 'bg-accent dark:bg-accent-dark' : '',
              )}
            >
              <Text
                className={cn(
                  'font-sans text-[11px] font-medium',
                  mode === value
                    ? 'text-on-accent'
                    : 'text-muted dark:text-muted-dark',
                )}
              >
                {value === 'day' ? '近 7 天' : '近 8 周'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View className="h-24 flex-row items-end gap-1.5">
        {buckets.map((bucket) => (
          <View key={bucket.key} className="flex-1 items-center gap-1">
            <Text className="font-sans text-[9px] text-muted dark:text-muted-dark">
              {bucket.minutes > 0 ? bucket.minutes : ''}
            </Text>
            <View
              accessible
              accessibilityLabel={`${formatDayKey(bucket.key)} 专注 ${bucket.minutes} 分钟`}
              style={{ height: Math.max(2, Math.round((bucket.minutes / max) * 60)) }}
              className={cn(
                'w-full rounded-t',
                bucket.minutes > 0
                  ? 'bg-accent/70 dark:bg-accent-dark/70'
                  : 'bg-border/50 dark:bg-border-dark/50',
              )}
            />
            <Text className="font-sans text-[9px] text-muted dark:text-muted-dark">
              {shortDayKey(bucket.key)}
            </Text>
          </View>
        ))}
      </View>
      <Text className="font-sans text-[10px] text-muted dark:text-muted-dark">
        {mode === 'day'
          ? '按设备本地日期，把每次专注算在开始的那天。'
          : '每周从周一开始；把每次专注算在开始的那周。'}
      </Text>
    </Card>
  );
}

function HistoryRow({ row }: { row: FocusHistoryRow }) {
  const seconds = focusDurationSec(row);
  return (
    <Card variant="outlined" className="gap-1.5 p-3.5">
      <View className="flex-row items-start gap-2">
        <Text className="flex-1 font-sans text-base font-medium text-ink dark:text-ink-dark">
          {row.title ?? '行动已删除'}
        </Text>
        <Tag label={row.status === 'completed' ? '完成' : '放弃'} tone={row.status === 'completed' ? 'accent' : 'neutral'} />
      </View>
      <View className="flex-row flex-wrap items-center gap-1.5">
        <Tag label={KIND_LABELS[row.actionKind]} />
        <Text className="font-sans text-xs text-muted dark:text-muted-dark">
          {formatRange(row)} · {formatDuration(seconds)}
        </Text>
      </View>
    </Card>
  );
}

/**
 * The mounted watch lives here. A retry changes the parent's `key`, which
 * unmounts this component and creates a fresh `useQuery` watch — the SDK's
 * watch result has no `refresh` (see `use-focus-history.ts`).
 */
function FocusHistoryContent({ onRetry }: { onRetry: () => void }) {
  const { data, error, loading } = useFocusHistory();
  const now = useAppClock();
  const insets = useAppInsets();
  const [trendMode, setTrendMode] = useState<'day' | 'week'>('day');
  const stats = buildFocusStats(data, now);
  const topPadding = Math.max(insets.top, 16);

  const header = (
    <View className="gap-3 pb-3">
      <View className="flex-row gap-2">
        {[
          { label: '今日', minutes: stats.todayMinutes },
          { label: '本周', minutes: stats.currentWeekMinutes },
          { label: '总计', minutes: stats.totalMinutes },
        ].map((item) => (
          <View
            key={item.label}
            accessible
            accessibilityLabel={`${item.label}专注 ${item.minutes} 分钟`}
            className="flex-1"
          >
            <Card className="flex-1 items-center gap-0.5 p-3">
              <Text className="font-sans text-[11px] text-muted dark:text-muted-dark">
                {item.label}
              </Text>
              <Text className="font-display text-xl font-bold tracking-tight text-ink dark:text-ink-dark">
                {item.minutes}
                <Text className="font-sans text-[11px] font-medium text-muted dark:text-muted-dark">
                  {' '}分钟
                </Text>
              </Text>
            </Card>
          </View>
        ))}
      </View>
      <Heatmap weeks={stats.heatmap} />
      <Trend stats={stats} mode={trendMode} onModeChange={setTrendMode} />
      <View className="mt-1 flex-row items-center justify-between">
        <Text className="font-sans text-sm font-semibold text-muted dark:text-muted-dark">
          专注记录
        </Text>
        <Text className="font-sans text-xs text-muted dark:text-muted-dark">
          完成 {stats.completedSessions} · 放弃 {stats.abandonedSessions}
        </Text>
      </View>
    </View>
  );

  return (
    <View
      style={{ paddingTop: topPadding }}
      className="flex-1 bg-canvas px-4 dark:bg-canvas-dark"
    >
      <View className="mx-auto w-full max-w-4xl flex-1">
        <View className="mb-3 flex-row items-center justify-between">
          <Button label="← 回顾" variant="ghost" onPress={() => goBack('/(tabs)/review')} />
          <Text className="text-lg font-semibold text-ink dark:text-ink-dark">专注历史</Text>
          <View className="w-16" />
        </View>

        {error !== null ? (
          <View className="gap-2">
            <Text className="font-sans text-sm text-danger dark:text-danger-dark">
              {errorMessage(error)}
            </Text>
            <Button label="重试加载" variant="secondary" onPress={onRetry} />
          </View>
        ) : loading ? (
          <Text className="font-sans text-sm text-muted dark:text-muted-dark">加载中…</Text>
        ) : data.length === 0 ? (
          <EmptyState
            className="flex-initial py-10"
            title="还没有专注记录"
            hint="在行动上开始一次专注，完成或放弃后都会记录在这里。"
          />
        ) : (
          <FlatList
            data={data}
            keyExtractor={(item) => item.id}
            ListHeaderComponent={header}
            contentContainerClassName="pb-8"
            ItemSeparatorComponent={() => <View className="h-2.5" />}
            renderItem={({ item }) => <HistoryRow row={item} />}
          />
        )}
      </View>
    </View>
  );
}

export default function FocusHistoryScreen() {
  const [retryKey, setRetryKey] = useState(0);
  return (
    <FocusHistoryContent
      key={retryKey}
      onRetry={() => setRetryKey((current) => current + 1)}
    />
  );
}
