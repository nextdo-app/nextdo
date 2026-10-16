/**
 * The Review tab (design.md §4.5 — PRD R7): the two entry cards (今日回顾
 * / 本周回顾 → the /review/daily and /review/weekly routes) + the
 * append-only history (newest first — the tab's list query orders by
 * `at` ascending, so the trail is reversed client-side).
 */
import { Card, EmptyState, Tag } from '@nextdo/ui';
import { FlatList, Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppInsets } from '@/lib/use-app-insets';
import { router } from 'expo-router';
import type { ReviewRecord } from '@nextdo/core';
import { useReviewRecords } from '@/hooks/use-review-records';
import { formatLocalDate } from '@/lib/format';

const REVIEW_KIND_LABELS: Record<ReviewRecord['kind'], string> = {
  daily: '日常',
  weekly: '每周',
};

/** A compact one-line digest of what the review decided. */
function recordSummary(record: ReviewRecord): string {
  if (record.kind === 'daily') {
    return `完成 ${record.answers.completedActionIds.length} · 排期 ${record.answers.rescheduled.length} · 明日必做 ${record.answers.tomorrowMustDo.length}`;
  }
  return `项目 ${record.snapshot.projects.length} · 待跟进 ${record.snapshot.waitingFollowUps.length} · Someday ${record.snapshot.somedayCount}`;
}

export default function ReviewScreen() {
  const { data, error } = useReviewRecords();
  // Newest first — the watch query orders by `at` ascending.
  const records = data.slice().reverse();
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);

  return (
    <View
      style={{ paddingTop: topPadding }}
      className="flex-1 w-full bg-canvas px-4 pb-4 dark:bg-canvas-dark"
    >
      <View className="flex-1 w-full max-w-5xl mx-auto">
      <Text className="mb-4 text-2xl font-bold tracking-tight text-ink dark:text-ink-dark">
        回顾
      </Text>

      {/* Two Prominent Action Cards */}
      <View className="flex-row gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="今日回顾"
          onPress={() => router.push('/review/daily')}
          className="flex-1 rounded-2xl border border-border/80 bg-surface p-3.5 shadow-2xs active:bg-surface-container dark:border-border-dark dark:bg-surface-dark dark:active:bg-surface-container-dark"
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <View className="h-7 w-7 rounded-lg bg-accent/15 dark:bg-accent-dark/20 items-center justify-center">
                <Ionicons name="sunny-outline" size={15} color="#c85a17" />
              </View>
              <Text className="font-sans text-base font-semibold text-ink dark:text-ink-dark">
                今日回顾
              </Text>
            </View>
            <View className="h-6 w-6 items-center justify-center rounded-full bg-accent/10 dark:bg-accent-dark/20">
              <Ionicons name="chevron-forward" size={13} color="#c85a17" />
            </View>
          </View>
          <Text className="mt-2 font-sans text-xs text-muted dark:text-muted-dark">
            清点完成 · 规划明日
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="本周回顾"
          onPress={() => router.push('/review/weekly')}
          className="flex-1 rounded-2xl border border-border/80 bg-surface p-3.5 shadow-2xs active:bg-surface-container dark:border-border-dark dark:bg-surface-dark dark:active:bg-surface-container-dark"
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <View className="h-7 w-7 rounded-lg bg-accent/15 dark:bg-accent-dark/20 items-center justify-center">
                <Ionicons name="calendar-outline" size={15} color="#c85a17" />
              </View>
              <Text className="font-sans text-base font-semibold text-ink dark:text-ink-dark">
                本周回顾
              </Text>
            </View>
            <View className="h-6 w-6 items-center justify-center rounded-full bg-accent/10 dark:bg-accent-dark/20">
              <Ionicons name="chevron-forward" size={13} color="#c85a17" />
            </View>
          </View>
          <Text className="mt-2 font-sans text-xs text-muted dark:text-muted-dark">
            纵览项目 · 检视等待
          </Text>
        </Pressable>
      </View>

      <View className="mt-6 flex-1">
        <Text className="mb-2.5 text-sm font-semibold text-muted dark:text-muted-dark">
          历史记录
        </Text>
        {error !== null ? (
          <EmptyState title="加载回顾记录失败" hint={error} />
        ) : records.length === 0 ? (
          <EmptyState
            title="还没有回顾记录"
            hint="做一次日常回顾或周回顾后，记录会留在这里。"
          />
        ) : (
          <FlatList
            data={records}
            keyExtractor={(item) => item.id}
            contentContainerClassName="gap-2.5"
            renderItem={({ item }) => (
              <Card className="gap-1.5 p-4">
                <View className="flex-row items-center justify-between gap-2">
                  <Tag label={REVIEW_KIND_LABELS[item.kind]} tone="accent" />
                  <Text className="text-xs font-medium text-muted dark:text-muted-dark">
                    {formatLocalDate(item.at)}
                  </Text>
                </View>
                <Text className="text-xs text-muted dark:text-muted-dark">
                  {recordSummary(item)}
                </Text>
              </Card>
            )}
          />
        )}
      </View>
      </View>
    </View>
  );
}
