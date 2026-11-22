/**
 * The Now tab (design stitch_scene_design/_1 & _2 rework):
 *
 *   TopHeader (Now + subhead + quick capture button) →
 *   FilterContextCard (5-col Available Time pills; the 场景/context pills
 *     were retired in issue #46) →
 *   re-clarify banner →
 *   Recommendation Hero Card (kind / est / 项目·截止 / Why this? top-3 /
 *     complete + overflow icons / 开始 / 换一个 / 稍后) →
 *   STATS ROW (可执行 n/总 · 预计耗时 Σ est · 认知负荷 三档) →
 *   CompletedActionsEntry (已完成行动) →
 *   alternative list (every eligible action except the current one) →
 *   EmptyExecutionPool (delicate clock illustration + capture button) →
 *   TodayHabitSection (progress + cycle summary + catch-up chips).
 *
 * Presentational only: data arrives from `useNow` (+ habit-days hooks);
 * every mutation goes through a mutation hook.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useAppInsets } from '@/lib/use-app-insets';
import { router, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, Card, MarkdownNote, ProgressBar, Tag, colors, cn } from '@nextdo/ui';
import {
  formatDeadline,
  toIso,
  type CandidateAction,
  type CandidateKind,
  type CalendarCandidate,
  type NextAction,
  type NextCandidate,
} from '@nextdo/core';
import { useNow, shouldOfferReclarify, type NowEligible } from '@/hooks/use-now';
import { useAppClock } from '@/hooks/use-app-clock';
import { useSkipAction } from '@/hooks/use-skip-action';
import { useSnoozeAction } from '@/hooks/use-snooze-action';
import { useTrashAction } from '@/hooks/use-trash-action';
import { useArchiveAction } from '@/hooks/use-archive-action';
import { useCompleteAction } from '@/hooks/use-complete-action';
import { useHabits, type HabitWithProgress } from '@/hooks/use-habits';
import { useProjectTitles } from '@/hooks/use-project-titles';
import { useEngineContextSettings, type EngineContextSettings } from '@/lib/engine-context';
import { errorMessage } from '@/lib/error-messages';
import { cognitiveLoadLabel } from '@/lib/cognitive-load';
import { DISPLAY_REASON_CODES, FILTER_RULE_LABELS, REASON_LABELS } from '@/lib/reason-labels';
import { KIND_LABELS } from '@/lib/kind-labels';
import { formatLocalDateTime } from '@/lib/format';
import { focusHref } from '@/lib/action-links';
import { SnoozeSheet } from '@/components/snooze-sheet';
import { useSwipeReveal } from '@/hooks/use-swipe-reveal';
import { DeadlineChip } from '@/components/deadline-chip';
import { EditActionModal } from '@/components/edit-action-modal';
import { CalendarEditModal } from '@/components/calendar-edit-modal';
import { ActionMenuModal } from '@/components/action-menu-modal';
import { HabitWindowConfirmModal } from '@/components/habit-window-confirm-modal';
import { useAppTheme } from '@/lib/theme';

function candidateToNextAction(candidate: NextCandidate, now: Date): NextAction {
  return {
    id: candidate.id,
    createdAt: candidate.createdAt,
    updatedAt: toIso(now),
    deletedAt: null,
    title: candidate.title,
    projectId: candidate.projectId,
    contextIds: candidate.contextIds,
    estMinutes: candidate.estMinutes,
    value: candidate.value,
    deadline: candidate.deadline,
    dueDate: candidate.dueDate,
    dependsOnId: candidate.dependsOnId,
    windowStart: candidate.windowStart,
    windowEnd: candidate.windowEnd,
    windowDays: candidate.windowDays,
    snoozedUntil: candidate.snoozedUntil,
    lastSnoozedAt: candidate.lastSnoozedAt,
    consecutiveSkips: candidate.consecutiveSkips,
    lastSkippedAt: candidate.lastSkippedAt,
    note: candidate.note,
    status: 'open',
  };
}

const TIME_CHIPS = [15, 30, 60, 120] as const;

/** 32px visual chip (h-8) + 6pt vertical hitSlop = 44pt tap target (spec/accessibility). */
const CHIP_HIT_SLOP = { top: 6, bottom: 6, left: 4, right: 4 } as const;

/** Extended hitSlop for inputs. */
const FIELD_HIT_SLOP = { top: 6, bottom: 6 } as const;



/**
 * Top header matching stitch_scene_design/_1:
 * Title "现在", subtitle, and the quick capture button.
 */
function TopHeader() {
  const { isDark } = useAppTheme();
  return (
    <View className="mb-3.5 flex-row items-center justify-between">
      <View>
        <Text className="font-display text-2xl font-bold tracking-tight text-ink dark:text-ink-dark">
          现在
        </Text>
        <Text className="mt-0.5 font-sans text-xs font-medium tracking-wide text-muted dark:text-muted-dark">
          按可用时间推荐下一步行动
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="快速记录"
        hitSlop={CHIP_HIT_SLOP}
        onPress={() => router.push('/inbox')}
        className="h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface shadow-2xs active:scale-95 dark:border-border-dark dark:bg-surface-dark"
      >
        <Ionicons name="add" size={16} color={isDark ? colors.mutedDark : colors.muted} />
      </Pressable>
    </View>
  );
}



/**
 * Engine-bar minutes option (5-col grid pill from stitch_scene_design/_1).
 */
const MinutesOption = memo(function MinutesOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`设置可用时间：${label} 分钟`}
      accessibilityState={{ selected }}
      hitSlop={CHIP_HIT_SLOP}
      onPress={onPress}
      className={cn(
        'h-8 flex-1 flex-row items-center justify-center rounded-xl px-1 active:scale-95',
        selected
          ? 'border border-accent bg-accent shadow-xs dark:border-accent-dark dark:bg-accent-dark'
          : 'border border-border/80 bg-surface active:bg-surface-container dark:border-border-dark dark:bg-surface-dark dark:active:bg-surface-container-dark',
      )}
    >
      {selected ? (
        <View className="mr-1 h-1.5 w-1.5 rounded-full bg-on-accent dark:bg-on-accent-dark" />
      ) : null}
      <Text
        className={cn(
          'font-sans text-xs',
          selected
            ? 'font-semibold text-on-accent dark:text-on-accent-dark'
            : 'font-medium text-ink dark:text-ink-dark',
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
});

/** The free-form minutes input pill. */
function CustomMinutesInput({
  value,
  onApply,
}: {
  value: number;
  onApply: (minutes: number) => void;
}) {
  const [custom, setCustom] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const isCustomActive = !TIME_CHIPS.includes(value as (typeof TIME_CHIPS)[number]);

  const applyCustom = () => {
    const parsed = Math.round(Number(custom));
    if (Number.isFinite(parsed) && parsed >= 1) onApply(parsed);
    setCustom('');
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <TextInput
        className="h-8 flex-1 rounded-xl border-2 border-accent bg-accent/5 px-1 text-center font-sans text-xs font-semibold text-accent dark:border-accent-dark dark:bg-accent-dark/10 dark:text-accent-dark"
        style={{
          paddingTop: 0,
          paddingBottom: 0,
          paddingVertical: 0,
          textAlignVertical: 'center',
          fontSize: 12,
        }}
        hitSlop={FIELD_HIT_SLOP}
        autoFocus
        placeholder={`${value}`}
        accessibilityLabel="自定义可用时间（分钟）"
        keyboardType="number-pad"
        value={custom}
        onChangeText={setCustom}
        onSubmitEditing={applyCustom}
        onBlur={applyCustom}
      />
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`自定义可用时间：当前 ${value} 分钟`}
      hitSlop={CHIP_HIT_SLOP}
      onPress={() => setIsEditing(true)}
      className={cn(
        'h-8 flex-1 items-center justify-center rounded-xl px-1 active:scale-95',
        isCustomActive
          ? 'border border-accent bg-accent shadow-xs dark:border-accent-dark dark:bg-accent-dark'
          : 'border border-dashed border-border/80 bg-surface active:bg-surface-container dark:border-border-dark dark:bg-surface-dark',
      )}
    >
      <Text
        numberOfLines={1}
        className={cn(
          'font-sans text-xs',
          isCustomActive
            ? 'font-semibold text-on-accent dark:text-on-accent-dark'
            : 'font-medium text-muted dark:text-muted-dark',
        )}
      >
        {isCustomActive ? `${value}m` : '自定义'}
      </Text>
    </Pressable>
  );
}

/**
 * FilterContextCard:
 * The Now screen's engine input — the 5-col available-time selector.
 * (The scene pills and the add-scene sheet were removed in issue #46.)
 */
function FilterContextCard({
  settings,
  update,
}: {
  settings: EngineContextSettings | null;
  update: (patch: Partial<EngineContextSettings>) => Promise<void>;
}) {
  const availableMinutes = settings?.availableMinutes ?? 60;

  return (
    <Card variant="outlined" className="gap-3.5 p-4 rounded-2xl border-border/70 bg-surface dark:border-border-dark/70 dark:bg-surface-dark shadow-2xs">
      {/* The available-time row (the only engine input left) */}
      <View className="gap-2">
        <View className="flex-row items-center">
          <View className="h-1.5 w-1.5 rounded-full bg-accent/70 dark:bg-accent-dark/70" />
          <Text className="ml-1.5 font-sans text-xs font-semibold tracking-wider text-muted dark:text-muted-dark">
            可用时间{' '}
            <Text className="font-normal text-muted/70 dark:text-muted-dark/70">(分钟)</Text>
          </Text>
        </View>

        {/* 5-column time capsule buttons */}
        <View className="flex-row items-center gap-2 pt-0.5">
          {TIME_CHIPS.map((minutes) => (
            <MinutesOption
              key={minutes}
              label={String(minutes)}
              selected={availableMinutes === minutes}
              onPress={() => void update({ availableMinutes: minutes })}
            />
          ))}
          <CustomMinutesInput
            value={availableMinutes}
            onApply={(minutes) => void update({ availableMinutes: minutes })}
          />
        </View>
      </View>

    </Card>
  );
}

/** One stats cell of the stats row. */
const StatsCell = memo(function StatsCell({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 items-center gap-0.5 px-1 py-1.5">
      <Text className="font-sans text-[11px] font-medium text-muted dark:text-muted-dark">{label}</Text>
      <Text className="font-sans text-sm font-semibold tracking-tight text-ink dark:text-ink-dark">{value}</Text>
    </View>
  );
});

/** Action row in the eligible list. */
const ActionRow = memo(function ActionRow({
  entry,
  now,
  projectName,
  onComplete,
  onSnooze,
  onArchive,
  onTrash,
  onEdit,
}: {
  entry: NowEligible;
  now: Date;
  projectName: string | undefined;
  onComplete: (action: CandidateAction) => void;
  onSnooze: (kind: CandidateKind, id: string) => void;
  onArchive: (kind: 'next' | 'calendar', id: string) => void;
  onTrash: (kind: CandidateKind, id: string) => void;
  onEdit: (candidate: CandidateAction) => void;
}) {
  const action = entry.action;
  const { isDark } = useAppTheme();
  const [showMenu, setShowMenu] = useState(false);
  // Swipe right reveals the 完成 button (issue #17, reworked by issue 27):
  // the gesture is a shortcut to the CONFIRMATION, never past it — the
  // action is completed only when that revealed button is pressed. The
  // button in the card header is the same action.
  const swipe = useSwipeReveal(() => onComplete(action));
  return (
    <View className="overflow-hidden rounded-2xl">
      {/* The affordance the swipe uncovers. Sits UNDER the card, so the row
          slides off it rather than dragging a label along. `w-24` is the
          hook's REVEAL_DX — the two must stay equal or the button is clipped. */}
      <View className="absolute inset-y-0 left-0 w-24 items-center justify-center bg-accent/20 dark:bg-accent-dark/25">
        {swipe.revealed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`完成：${action.title}`}
            onPress={swipe.confirm}
            className="h-full w-full items-center justify-center active:bg-accent/30 dark:active:bg-accent-dark/35"
          >
            <Text className="font-sans text-sm font-semibold text-accent dark:text-accent-dark">
              ✓ 完成
            </Text>
          </Pressable>
        ) : (
          // The idle hint — a live control only once the row is parked open.
          <View pointerEvents="none" className="h-full w-full items-center justify-center">
            <Text className="font-sans text-sm font-semibold text-accent dark:text-accent-dark">
              ✓ 完成
            </Text>
          </View>
        )}
      </View>
      <Animated.View
        testID={`swipe-row-${action.id}`}
        {...swipe.panHandlers}
        style={{ transform: [{ translateX: swipe.translateX }] }}
      >
        <Card variant="outlined" className="p-3.5 rounded-2xl border-border/70 bg-surface dark:border-border-dark/70 dark:bg-surface-dark shadow-2xs">
          <View className="flex-row items-start justify-between gap-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`开始专注：${action.title}`}
              accessibilityHint="点击进入专注模式"
              onPress={() => {
                if (swipe.revealed) {
                  swipe.close();
                  return;
                }
                router.push(focusHref(action));
              }}
              className="flex-1 gap-2 active:opacity-75"
            >
              <View className="flex-row items-start gap-2.5">
                <View className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent/80 dark:bg-accent-dark/80" />
                <Text className="flex-1 font-sans text-base font-medium leading-snug text-ink dark:text-ink-dark">
                  {action.title}
                </Text>
              </View>
              {action.kind === 'next' && (action as NextCandidate).note !== undefined ? (
                // The note rides along on the candidate (issue #63) so the list
                // shows the detail without opening the editor. Rendered as ONE
                // truncated run (task 10-22): the note is Markdown, but a list
                // row must not grow to the size of the document behind it.
                <MarkdownNote
                  mode="inline"
                  numberOfLines={2}
                  value={(action as NextCandidate).note ?? ''}
                />
              ) : null}
              <View className="flex-row flex-wrap items-center gap-1.5">
                {projectName !== undefined ? <Tag label={projectName} tone="neutral" /> : null}
                <View className="ml-auto flex-row items-center gap-1">
                  {action.kind === 'calendar' && action.startsAt !== undefined ? (
                    <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                      开始 {formatLocalDateTime(action.startsAt)}
                    </Text>
                  ) : action.deadline !== undefined ? (
                    /* Same chip the project screens use (issue #16) — the 待办
                       view must say 已逾期 / 今天截止 / 还剩 N 天, not a bare date. */
                    <DeadlineChip deadline={action.deadline} now={now} />
                  ) : (
                    <Text className="font-sans text-xs text-muted dark:text-muted-dark">随时</Text>
                  )}
                </View>
              </View>
            </Pressable>
            <View className="-mr-1 -mt-1 flex-row items-center gap-1">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`完成行动：${action.title}`}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                onPress={() => onComplete(action)}
                className="h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface active:scale-95 dark:border-border-dark dark:bg-surface-dark"
              >
                <Ionicons
                  name="checkmark"
                  size={15}
                  color={isDark ? colors.accentDark : colors.accent}
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`更多操作：${action.title}`}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                onPress={() => setShowMenu(true)}
                className="h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface active:scale-95 dark:border-border-dark dark:bg-surface-dark"
              >
                <Ionicons
                  name="ellipsis-horizontal"
                  size={14}
                  color={isDark ? colors.mutedDark : colors.muted}
                />
              </Pressable>
            </View>
          </View>
        </Card>
      </Animated.View>
      <ActionMenuModal
        visible={showMenu}
        actionTitle={action.title}
        canEdit={action.kind !== 'habit'}
        onClose={() => setShowMenu(false)}
        onEdit={() => onEdit(action)}
        onSnooze={() => onSnooze(action.kind, action.id)}
        onArchiveToSomeday={
          action.kind === 'habit' ? undefined : () => onArchive(action.kind, action.id)
        }
        onTrash={() => onTrash(action.kind, action.id)}
      />
    </View>
  );
});

/**
 * EmptyExecutionPool component (stitch_scene_design/_1 empty state):
 * Serene illustration with glowing icon, helpful guidance, and capture CTA.
 */
function EmptyExecutionPool() {
  const { isDark } = useAppTheme();
  return (
    <View className="items-center justify-center rounded-3xl border border-dashed border-border/80 bg-surface/60 px-4 py-8 text-center dark:border-border-dark/80 dark:bg-surface-dark/60">
      {/* Icon badge with pulsing ambiance */}
      <View className="relative mb-4 h-16 w-16 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 shadow-sm dark:border-accent-dark/30 dark:bg-accent-dark/20">
        <Ionicons name="time-outline" size={32} color={isDark ? colors.accentDark : colors.accent} />
        <View className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-surface bg-accent dark:border-surface-dark dark:bg-accent-dark" />
      </View>

      <Text className="font-display text-base font-bold tracking-tight text-ink dark:text-ink-dark">
        执行池是空的
      </Text>
      <Text className="mt-1 max-w-[260px] text-center font-sans text-xs leading-relaxed text-muted dark:text-muted-dark">
        去收件箱捕获一条待办，系统会按可用时间排好接下来该做的事。
      </Text>

      <View className="mt-5">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="去收件箱捕获"
          hitSlop={CHIP_HIT_SLOP}
          onPress={() => router.push('/(tabs)/inbox')}
          className="flex-row items-center gap-1.5 rounded-full bg-ink px-4 py-2 shadow-sm active:scale-95 dark:bg-ink-dark"
        >
          <Ionicons name="file-tray-outline" size={14} color={isDark ? colors.canvasDark : colors.canvas} />
          <Text className="font-sans text-xs font-semibold text-canvas dark:text-canvas-dark">
            去收件箱捕获
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The cycle length summary shared by the habit block's one-line summary. */
function cycleSummary(habits: HabitWithProgress[]): string {
  const cycles = habits.map((row) => row.habit.cycleDays);
  const min = Math.min(...cycles);
  const max = Math.max(...cycles);
  return min === max ? `${min} 天周期` : `${min}–${max} 天周期`;
}

/**
 * TodayHabitSection (stitch_scene_design/_1):
 * today's progress, the cycle summary and the catch-up chips. Per-habit
 * detail (window, per-day counts) stays on /habits — the top strip already
 * carries the one-tap check-ins.
 */
function TodayHabitSection({
  habits,
  todayDone,
  todayRowsCount,
  onCatchUpHabit,
}: {
  habits: HabitWithProgress[];
  todayDone: number;
  todayRowsCount: number;
  onCatchUpHabit: (habitDayId: string) => void;
}) {
  const { isDark } = useAppTheme();
  const totalDone = useMemo(
    () => habits.reduce((sum, row) => sum + row.doneCount, 0),
    [habits],
  );
  const unscheduledCount = habits.filter((row) => row.today === null).length;
  const catchUpRows = habits.filter((row) => row.yesterday !== null);

  return (
    <Card className="gap-3 p-4 shadow-2xs rounded-2xl border-border/70 bg-surface dark:border-border-dark/70 dark:bg-surface-dark">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <View className="h-6 w-6 items-center justify-center rounded-lg bg-accent/10 dark:bg-accent-dark/20">
            <Ionicons name="checkmark-circle-outline" size={14} color={isDark ? colors.accentDark : colors.accent} />
          </View>
          <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
            今日习惯
          </Text>
        </View>

        <View className="flex-row items-center gap-2">
          {habits.length > 0 ? (
            <Button
              size="sm"
              label="管理"
              variant="ghost"
              onPress={() => router.push('/habits')}
            />
          ) : null}
          <View className="rounded-full bg-surface-container px-2.5 py-0.5 dark:bg-surface-container-dark">
            <Text className="font-mono text-xs font-medium text-muted dark:text-muted-dark">
              今天习惯 {todayDone}/{todayRowsCount}
            </Text>
          </View>
        </View>
      </View>

      {habits.length > 0 ? (
        <>
          <ProgressBar value={todayRowsCount > 0 ? todayDone / todayRowsCount : 0} />
          <Text className="font-sans text-xs text-muted dark:text-muted-dark">
            进行中 {habits.length} 个 · {cycleSummary(habits)} · 本期累计 {totalDone} 天
            {unscheduledCount > 0 ? ` · 今天无安排 ${unscheduledCount} 项` : ''}
          </Text>
          {catchUpRows.length > 0 ? (
            <View className="flex-row flex-wrap items-center gap-1.5">
              <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                可补昨日
              </Text>
              {catchUpRows.map((row) => (
                <Pressable
                  key={row.habit.id}
                  accessibilityRole="button"
                  accessibilityLabel={`补打卡昨天：${row.habit.title}`}
                  hitSlop={CHIP_HIT_SLOP}
                  onPress={() => onCatchUpHabit(row.yesterday!.id)}
                  className="h-8 items-center justify-center rounded-full border border-accent/60 bg-accent/10 px-3 shadow-2xs active:bg-accent/20 dark:border-accent-dark/60 dark:bg-accent-dark/20"
                >
                  <Text className="font-sans text-xs font-medium text-accent dark:text-accent-dark">
                    + {row.habit.title}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <View className="gap-3">
          <Text className="font-sans text-xs leading-relaxed text-muted dark:text-muted-dark">
            还没有习惯 — 创建后每天会生成一条行动，准时出现在这里的执行池中。
          </Text>
          <View className="flex-row items-center justify-between border-t border-border/40 pt-3 dark:border-border-dark/40">
            <Text className="font-sans text-[11px] text-muted/80 dark:text-muted-dark/80">
              建立日常节奏，保持心流
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="去创建习惯"
              hitSlop={CHIP_HIT_SLOP}
              onPress={() => router.push('/habits')}
              className="flex-row items-center gap-1 rounded-lg border border-border/80 bg-surface-container px-3 py-1.5 active:scale-95 dark:border-border-dark dark:bg-surface-container-dark"
            >
              <Ionicons name="add" size={14} color={isDark ? colors.mutedDark : colors.muted} />
              <Text className="font-sans text-xs font-medium text-ink dark:text-ink-dark">
                去创建习惯
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </Card>
  );
}

/**
 * The 已完成行动 window's entry (issue 27) — completion is a separate,
 * reversible decision, so it needs a place to be reviewed and undone. Shared
 * by the populated pool and the empty-pool branch: an empty execution pool
 * must not make completed work unreachable.
 */
function CompletedActionsEntry() {
  const { isDark } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="查看已完成行动"
      hitSlop={CHIP_HIT_SLOP}
      onPress={() => router.push('/completed')}
      className="flex-row items-center justify-between rounded-2xl border border-border/60 bg-surface/70 px-3.5 py-2.5 active:bg-surface-container dark:border-border-dark/60 dark:bg-surface-dark/70 dark:active:bg-surface-container-dark shadow-2xs"
    >
      <View className="flex-row items-center gap-2">
        <Ionicons name="checkmark-done-outline" size={15} color={isDark ? colors.mutedDark : colors.muted} />
        <Text className="font-sans text-sm font-medium text-ink dark:text-ink-dark">
          已完成行动
        </Text>
      </View>
      <View className="flex-row items-center gap-1">
        <Text className="font-sans text-xs text-muted dark:text-muted-dark">查看与恢复</Text>
        <Ionicons name="chevron-forward" size={13} color={isDark ? colors.mutedDark : colors.muted} />
      </View>
    </Pressable>
  );
}

export default function NowScreen() {
  const now = useAppClock();
  const { isDark } = useAppTheme();
  const { settings, update, error: settingsError } = useEngineContextSettings();
  const { data, error, calendarImportError } = useNow(settings);
  const { skip, error: skipError } = useSkipAction();
  const { snooze, error: snoozeError } = useSnoozeAction();
  const { trash, error: trashError } = useTrashAction();
  const { archive, error: archiveError } = useArchiveAction();
  const { complete, error: completeError } = useCompleteAction();
  const { data: habitRows, error: habitError, reload: reloadHabits } = useHabits(now);

  const isFirstHabitFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (isFirstHabitFocusRef.current) {
        isFirstHabitFocusRef.current = false;
        return;
      }
      reloadHabits();
    }, [reloadHabits]),
  );

  const projectTitles = useProjectTitles();
  const [snoozeTarget, setSnoozeTarget] = useState<{ kind: CandidateKind; id: string } | null>(null);
  const [editingAction, setEditingAction] = useState<NextAction | null>(null);
  /** Issue #95: calendar actions edit through their own modal (title, start,
   *  estimate, deadline, note) — the next-action modal owns different fields. */
  const [editingCalendar, setEditingCalendar] = useState<CalendarCandidate | null>(null);
  const [skippedViewIds, setSkippedViewIds] = useState<string[]>([]);
  const skipInFlightRef = useRef(false);
  /**
   * Pinned hero action ID for the overflow sheet. `displayed` can change
   * while the sheet is open (a time-chip change swaps the hero), so the id is
   * captured at open time — otherwise 「删除行动」 would hit whichever action
   * replaced it. The ACTION itself is always re-read from the latest
   * `eligible` entry, so a refresh that rewrites the row (another device
   * edits the note) feeds the editor the new value, not the open-time one.
   */
  const [heroMenuTargetId, setHeroMenuTargetId] = useState<string | null>(null);
  const [windowConfirm, setWindowConfirm] = useState<{
    habitDayId: string;
    habitTitle: string;
    windowStart: string;
    windowEnd: string;
  } | null>(null);
  const [isListExpanded, setIsListExpanded] = useState(true);
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);
  const mutationError = skipError ?? snoozeError ?? trashError ?? archiveError ?? completeError ?? habitError;

  const eligible = data?.eligible ?? [];
  const heroMenuEntry =
    heroMenuTargetId === null
      ? undefined
      : eligible.find((entry) => entry.action.id === heroMenuTargetId);
  // The pinned target left the eligible set (completed, snoozed, or filtered
  // out by a time-chip change): close the sheet rather than leave it acting
  // on an id that is no longer in the pool.
  useEffect(() => {
    if (heroMenuTargetId !== null && heroMenuEntry === undefined) setHeroMenuTargetId(null);
  }, [heroMenuTargetId, heroMenuEntry]);
  const displayed = useMemo(() => {
    if (eligible.length === 0) return null;
    const unvisited = eligible.find((entry) => !skippedViewIds.includes(entry.action.id));
    if (unvisited !== undefined) return unvisited;
    // Every eligible id has been visited — continue after the LAST visited
    // one (access order) instead of sticking to the first item.
    let lastIndex = -1;
    for (const id of skippedViewIds) {
      const index = eligible.findIndex((entry) => entry.action.id === id);
      if (index >= 0) lastIndex = index;
    }
    return eligible[(lastIndex + 1) % eligible.length] ?? null;
  }, [eligible, skippedViewIds]);

  /** Everything except the current recommendation — the list must not repeat
   *  the hero card. */
  const alternativeEntries = useMemo(
    () => eligible.filter((entry) => entry.action.id !== displayed?.action.id),
    [eligible, displayed],
  );

  /** The card's reasons, filtered to those that actually distinguish THIS
   *  action (see DISPLAY_REASON_CODES). */
  const displayReasons = useMemo(
    () =>
      displayed === null
        ? []
        : displayed.reasons
            .filter((reason) => DISPLAY_REASON_CODES.has(reason.code))
            .slice(0, 3),
    [displayed],
  );
  // The star marks the first score reason — an eligibility reason is not a
  // ranking signal.
  const primaryReasonIndex = displayReasons.findIndex((reason) => reason.type === 'score');

  const totalCount = eligible.length + (data?.filtered.length ?? 0);
  const totalEst = useMemo(
    () => eligible.reduce((sum, entry) => sum + entry.action.estMinutes, 0),
    [eligible],
  );

  const handleSkip = useCallback(async () => {
    // One action has nothing to rotate to; the button is disabled, this is
    // the guard for a race with an eligible-set change.
    if (displayed === null || eligible.length < 2 || skipInFlightRef.current) return;
    const { id, kind } = displayed.action;
    if (!skippedViewIds.includes(id)) {
      skipInFlightRef.current = true;
      try {
        const ok = await skip({ actionKind: kind, actionId: id });
        // A failed write stays on the current card — rotating would claim a
        // skip that never happened.
        if (!ok) return;
        setSkippedViewIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      } finally {
        skipInFlightRef.current = false;
      }
      return;
    }
    // Already written this session: rotate only. Moving the id to the end
    // keeps `skippedViewIds` in access order for the wrap-around cursor.
    setSkippedViewIds((prev) => [...prev.filter((skippedId) => skippedId !== id), id]);
  }, [displayed, eligible.length, skip, skippedViewIds]);

  const handleSnooze = useCallback((kind: CandidateKind, id: string) => {
    setSnoozeTarget({ kind, id });
  }, []);

  const handleTrash = useCallback(
    (actionKind: CandidateKind, actionId: string) => {
      void trash({ actionKind, actionId });
    },
    [trash],
  );

  /** Park the action in Someday/Maybe instead of deleting it. Habit days are
   *  excluded at the menu level — a generated day has no parked form. */
  const handleArchive = useCallback(
    (actionKind: 'next' | 'calendar', actionId: string) => {
      void archive({ actionKind, actionId });
    },
    [archive],
  );

  /** Row-level 完成 — one definition for the hero, the list buttons and the
   *  swipe gesture. A windowed habit attempts the write first; the db's
   *  rejection opens the confirmation, and the retry carries the override. */
  const handleComplete = useCallback(
    (action: CandidateAction) => {
      const confirmation =
        action.kind === 'habit' &&
        action.windowStart !== undefined &&
        action.windowEnd !== undefined
          ? {
              habitDayId: action.id,
              habitTitle: action.title,
              windowStart: action.windowStart,
              windowEnd: action.windowEnd,
            }
          : null;
      void complete(
        { actionKind: action.kind, actionId: action.id },
        confirmation !== null ? () => setWindowConfirm(confirmation) : undefined,
      ).then((ok) => {
        if (ok && action.kind === 'habit') reloadHabits();
      });
    },
    [complete, reloadHabits],
  );

  const handleEdit = useCallback(
    (candidate: CandidateAction) => {
      if (candidate.kind === 'calendar') {
        setEditingCalendar(candidate);
        return;
      }
      if (candidate.kind !== 'next') return; // habits have no edit form
      setEditingAction(candidateToNextAction(candidate, now));
    },
    [now],
  );

  const subtitleParts = useMemo(() => {
    const parts: string[] = [];
    if (displayed !== null) {
      if (displayed.action.projectId !== undefined) {
        const title = projectTitles[displayed.action.projectId];
        if (title !== undefined) parts.push(title);
      }
      if (displayed.action.kind === 'calendar') {
        parts.push(`开始 ${formatLocalDateTime(displayed.action.startsAt)}`);
      }
      if (displayed.action.deadline !== undefined) {
        // Spoken the same way the chip speaks it — the screen-reader label
        // and the visible chip must not describe one deadline two ways.
        parts.push(formatDeadline(displayed.action.deadline, now));
      }
    }
    return parts;
  }, [displayed, projectTitles, now]);

  const habits = habitRows ?? [];
  const todayRows = useMemo(() => habits.filter((row) => row.today !== null), [habits]);
  const todayDone = useMemo(
    () => todayRows.filter((row) => row.today?.status === 'done').length,
    [todayRows],
  );
  // Issue #61: habits still open today — the top strip only exists for them
  // (a fully checked-in day needs no nagging card).
  const uncheckedHabits = useMemo(
    () => habits.filter((row) => row.today !== null && row.today.status === 'open'),
    [habits],
  );

  const handleCompleteHabit = useCallback(
    (habitDayId: string, habit?: HabitWithProgress['habit']) => {
      const confirmation = habit?.windowStart && habit.windowEnd ? {
        habitDayId,
        habitTitle: habit.title,
        windowStart: habit.windowStart,
        windowEnd: habit.windowEnd,
      } : null;
      void complete(
        { actionKind: 'habit', actionId: habitDayId },
        confirmation ? () => setWindowConfirm(confirmation) : undefined,
      ).then((ok) => { if (ok) reloadHabits(); });
    },
    [complete, reloadHabits],
  );

  const handleCatchUpHabit = useCallback(
    (habitDayId: string) => {
      void complete({ actionKind: 'habit', actionId: habitDayId }).then((ok) => {
        if (ok) reloadHabits();
      });
    },
    [complete, reloadHabits],
  );

  return (
    <View className="flex-1 bg-canvas dark:bg-canvas-dark">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: topPadding, paddingHorizontal: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="w-full max-w-4xl mx-auto flex-1">
        {/* Top Header */}
        <TopHeader />

        {/* Filter and Context Card — Primary Engine Input */}
        <FilterContextCard settings={settings} update={update} />

        {/* Issue #61: habits are daily and easy to forget — surface the
         *  unchecked ones ABOVE the execution hero, with a one-tap check-in.
         *  Hidden when nothing is open (the bottom section stays as the full
         *  view). */}
        {uncheckedHabits.length > 0 ? (
          <Card className="mt-3 gap-3 rounded-2xl border border-border/70 bg-surface p-4 shadow-2xs dark:border-border-dark/70 dark:bg-surface-dark">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <View className="h-1.5 w-1.5 rounded-full bg-accent dark:bg-accent-dark" />
                <Text className="font-sans text-xs font-semibold tracking-wider text-muted dark:text-muted-dark">
                  今日习惯待打卡
                </Text>
                <View className="rounded-full bg-accent/15 px-2 py-0.5 dark:bg-accent-dark/25">
                  <Text className="font-mono text-[11px] font-bold text-accent dark:text-accent-dark">
                    {uncheckedHabits.length}
                  </Text>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="查看全部习惯"
                hitSlop={CHIP_HIT_SLOP}
                onPress={() => router.push('/habits')}
              >
                <Text className="font-sans text-xs font-medium text-muted hover:text-ink dark:text-muted-dark">
                  全部
                </Text>
              </Pressable>
            </View>
            <View className="gap-2 pt-0.5">
              {uncheckedHabits.slice(0, 3).map((row) => (
                <View
                  key={row.habit.id}
                  className="flex-row items-center justify-between rounded-xl border border-border/40 bg-surface-container/30 px-3.5 py-2 dark:border-border-dark/40 dark:bg-surface-container-dark/30"
                >
                  <Text
                    className="flex-1 font-sans text-sm font-medium text-ink dark:text-ink-dark mr-2"
                    numberOfLines={1}
                  >
                    {row.habit.title}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`快速打卡：${row.habit.title}`}
                    hitSlop={CHIP_HIT_SLOP}
                    onPress={() => handleCompleteHabit(row.today!.id, row.habit)}
                    className="h-7 items-center justify-center rounded-full border border-accent/50 bg-accent/10 px-3 active:scale-95 dark:border-accent-dark/50 dark:bg-accent-dark/20"
                  >
                    <Text className="font-sans text-xs font-semibold text-accent dark:text-accent-dark">
                      ✓ 打卡
                    </Text>
                  </Pressable>
                </View>
              ))}
              {uncheckedHabits.length > 3 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="查看全部未打卡习惯"
                  onPress={() => router.push('/habits')}
                  className="pt-0.5"
                >
                  <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                    还有 {uncheckedHabits.length - 3} 项…
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </Card>
        ) : null}

        {mutationError !== null ? (
          <Text className="mt-2 font-sans text-sm text-danger">{errorMessage(mutationError)}</Text>
        ) : null}
        {settingsError !== null ? (
          <Text className="mt-2 font-sans text-sm text-danger">{errorMessage(settingsError)}</Text>
        ) : null}
        {calendarImportError !== null ? (
          <Text className="mt-2 font-sans text-xs text-muted dark:text-muted-dark">
            {calendarImportError}
          </Text>
        ) : null}

        <View className="mt-3 gap-3.5">
          {error !== null ? (
            <Card className="items-center p-6 text-center">
              <Text className="font-sans text-sm font-semibold text-danger">加载执行池失败</Text>
              <Text className="mt-1 font-sans text-xs text-muted">{errorMessage(error)}</Text>
            </Card>
          ) : data === null ? (
            <Card className="items-center gap-3 p-6 text-center">
              <View className="flex-row items-center gap-2">
                <View className="h-4 w-16 rounded-full bg-surface-container dark:bg-surface-container-dark" />
                <View className="h-4 w-12 rounded-full bg-surface-container/60 dark:bg-surface-container-dark/60" />
              </View>
              <View className="h-6 w-3/4 rounded-lg bg-surface-container dark:bg-surface-container-dark" />
              <Text className="font-sans text-xs font-medium text-muted dark:text-muted-dark">加载中…</Text>
            </Card>
          ) : data.poolEmpty ? (
            <>
              <EmptyExecutionPool />
              <CompletedActionsEntry />
            </>
          ) : (
            <>
              {displayed !== null &&
              displayed.action.kind !== 'habit' &&
              shouldOfferReclarify(displayed.action.consecutiveSkips) ? (
                <Card className="border-warning bg-warning/10 p-3.5">
                  <Text className="font-sans text-sm font-medium text-ink dark:text-ink-dark">
                    这个任务已连续跳过 {displayed.action.consecutiveSkips} 次 — 重新明确下一步？
                  </Text>
                  <View className="mt-2.5">
                    <Button
                      size="sm"
                      label="重新明晰"
                      variant="secondary"
                      onPress={() =>
                        router.push(`/reclarify/${displayed.action.id}?kind=${displayed.action.kind}`)
                      }
                    />
                  </View>
                </Card>
              ) : null}

              {displayed !== null ? (
                <>
                  {/* Recommendation Hero Card — prioritized first */}
                  <Card
                    variant="elevated"
                    className="relative overflow-hidden rounded-2xl border border-accent/25 bg-surface p-5 shadow-sm dark:border-accent-dark/30 dark:bg-surface-dark"
                  >
                    {/* Top decorative accent highlight bar */}
                    <View className="absolute top-0 left-0 right-0 h-1 bg-accent/80 dark:bg-accent-dark/80" />

                    <View className="mb-3 flex-row items-center justify-between">
                      <View className="flex-row items-center gap-2">
                        <Tag label={KIND_LABELS[displayed.action.kind]} tone="accent" />
                        {displayed.action.estMinutes > 0 ? (
                          <Tag label={`${displayed.action.estMinutes} 分钟`} tone="neutral" />
                        ) : null}
                      </View>
                      <View className="-mr-1 -mt-1 flex-row items-center gap-1">
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`完成行动：${displayed.action.title}`}
                          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                          onPress={() => handleComplete(displayed.action)}
                          className="h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface active:scale-95 dark:border-border-dark dark:bg-surface-dark"
                        >
                          <Ionicons
                            name="checkmark"
                            size={15}
                            color={isDark ? colors.accentDark : colors.accent}
                          />
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`更多操作：${displayed.action.title}`}
                          hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                          onPress={() => setHeroMenuTargetId(displayed.action.id)}
                          className="h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface active:scale-95 dark:border-border-dark dark:bg-surface-dark"
                        >
                          <Ionicons
                            name="ellipsis-horizontal"
                            size={14}
                            color={isDark ? colors.mutedDark : colors.muted}
                          />
                        </Pressable>
                      </View>
                    </View>
                    <Text className="font-display text-xl font-bold tracking-tight leading-snug text-ink dark:text-ink-dark sm:text-2xl">
                      {displayed.action.title}
                    </Text>
                    {displayed.action.kind === 'next' &&
                    (displayed.action as NextCandidate).note !== undefined ? (
                      // The hero is the ONLY place this action renders (the
                      // list excludes it), so its note preview must ride here
                      // too — same two-line inline run as an alternative row.
                      <MarkdownNote
                        mode="inline"
                        numberOfLines={2}
                        className="mt-2"
                        value={(displayed.action as NextCandidate).note ?? ''}
                      />
                    ) : null}
                    {subtitleParts.length > 0 ? (
                      <Text className="mt-1.5 font-sans text-xs text-muted dark:text-muted-dark">
                        {subtitleParts.join(' · ')}
                      </Text>
                    ) : null}

                    {displayReasons.length > 0 ? (
                      <View className="mt-4 rounded-xl border border-border/50 bg-surface-container/50 p-3 dark:border-border-dark/50 dark:bg-surface-container-dark/50">
                        <Text className="mb-2 font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                          为什么是它？
                        </Text>
                        <View className="flex-row flex-wrap gap-1.5">
                          {displayReasons.map((reason, idx) => {
                            const primary = idx === primaryReasonIndex;
                            return (
                              <View
                                key={`${reason.type}-${reason.code}`}
                                className={cn(
                                  'flex-row items-center rounded-lg px-2.5 py-1',
                                  primary
                                    ? 'border border-accent/25 bg-accent/10 dark:border-accent-dark/30 dark:bg-accent-dark/20'
                                    : 'border border-border/60 bg-surface/80 dark:border-border-dark/60 dark:bg-surface-dark/80',
                                )}
                              >
                                <Text
                                  className={cn(
                                    'font-sans text-xs',
                                    primary
                                      ? 'font-medium text-accent dark:text-accent-dark'
                                      : 'text-ink/80 dark:text-ink-dark/80',
                                  )}
                                >
                                  {primary ? '★ ' : ''}
                                  {REASON_LABELS[reason.code]}
                                </Text>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    ) : null}
                  </Card>

                  {/* Primary & Secondary Action Button Toolbar */}
                  <View className="gap-2.5">
                    <Button
                      size="lg"
                      label="开始"
                      className="w-full shadow-sm"
                      onPress={() => router.push(focusHref(displayed.action))}
                    />
                    <View className="flex-row gap-3">
                      <View className="flex-1">
                        <Button
                          label="换一个"
                          variant="secondary"
                          className="w-full"
                          disabled={eligible.length < 2}
                          onPress={() => void handleSkip()}
                        />
                      </View>
                      <View className="flex-1">
                        <Button
                          label="稍后"
                          variant="secondary"
                          className="w-full"
                          onPress={() =>
                            setSnoozeTarget({ kind: displayed.action.kind, id: displayed.action.id })
                          }
                        />
                      </View>
                    </View>
                    {eligible.length === 1 ? (
                      <Text className="text-center font-sans text-xs text-muted dark:text-muted-dark">
                        暂无其他备选
                      </Text>
                    ) : null}
                  </View>

                  <ActionMenuModal
                    visible={heroMenuEntry !== undefined}
                    actionTitle={heroMenuEntry?.action.title ?? ''}
                    canEdit={
                      heroMenuEntry !== undefined && heroMenuEntry.action.kind !== 'habit'
                    }
                    onClose={() => setHeroMenuTargetId(null)}
                    onEdit={() => {
                      if (heroMenuEntry !== undefined) {
                        handleEdit(heroMenuEntry.action);
                      }
                    }}
                    onSnooze={() => {
                      if (heroMenuEntry !== undefined) {
                        handleSnooze(heroMenuEntry.action.kind, heroMenuEntry.action.id);
                      }
                    }}
                    onArchiveToSomeday={
                      heroMenuEntry !== undefined && heroMenuEntry.action.kind !== 'habit'
                        ? () =>
                            handleArchive(
                              heroMenuEntry.action.kind as 'next' | 'calendar',
                              heroMenuEntry.action.id,
                            )
                        : undefined
                    }
                    onTrash={() => {
                      if (heroMenuEntry !== undefined) {
                        handleTrash(heroMenuEntry.action.kind, heroMenuEntry.action.id);
                      }
                    }}
                  />
                </>
              ) : (
                <Card className="items-center p-6 text-center">
                  <Text className="font-sans text-base font-semibold text-ink dark:text-ink-dark">
                    没有任何适合当前可用时间的行动
                  </Text>
                  <Text className="mt-1 font-sans text-xs text-muted dark:text-muted-dark">
                    试试调整可用时间。
                  </Text>
                  {data.filtered.length > 0 ? (
                    <View className="mt-4 w-full gap-1 border-t border-border/40 pt-3 dark:border-border-dark/40">
                      <Text className="text-left font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                        被过滤的事项：
                      </Text>
                      {data.filtered.map((entry) => (
                        <Text
                          key={entry.action.id}
                          className="text-left font-sans text-sm text-muted dark:text-muted-dark"
                        >
                          • {entry.action.title} — {FILTER_RULE_LABELS[entry.rule]}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </Card>
              )}

              {/* Stats row — pool overview. Hidden when every candidate was
                  filtered: 0/N · 0 分钟 · 轻 would be noise, not a summary. */}
              {eligible.length > 0 ? (
                <View className="flex-row items-center rounded-2xl border border-border/60 bg-surface/70 px-2 py-1.5 shadow-2xs backdrop-blur-sm dark:border-border-dark/60 dark:bg-surface-dark/70">
                  <StatsCell label="可执行" value={`${eligible.length}/${totalCount} 项`} />
                  <View className="h-6 w-px bg-border/40 dark:bg-border-dark/40" />
                  <StatsCell label="预计耗时" value={`${totalEst} 分钟`} />
                  <View className="h-6 w-px bg-border/40 dark:bg-border-dark/40" />
                  <StatsCell label="认知负荷" value={cognitiveLoadLabel(totalEst)} />
                </View>
              ) : null}

              <CompletedActionsEntry />

              {/* The alternative list — everything except the hero card, so
                  the same action never appears twice. Hidden entirely when
                  the recommendation is the only eligible item. */}
              {alternativeEntries.length > 0 ? (
                <View className="gap-2.5">
                  <View className="flex-row items-center justify-between px-1">
                    <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                      可执行备选事项 ({alternativeEntries.length})
                    </Text>
                    <Button
                      size="sm"
                      variant="ghost"
                      label={isListExpanded ? '收起清单' : '展开清单'}
                      onPress={() => setIsListExpanded((prev) => !prev)}
                    />
                  </View>
                  {isListExpanded ? (
                    alternativeEntries.map((entry) => (
                      <ActionRow
                        key={entry.action.id}
                        entry={entry}
                        now={now}
                        projectName={
                          entry.action.projectId !== undefined
                            ? projectTitles[entry.action.projectId]
                            : undefined
                        }
                        onComplete={handleComplete}
                        onSnooze={handleSnooze}
                        onArchive={handleArchive}
                        onTrash={handleTrash}
                        onEdit={handleEdit}
                      />
                    ))
                  ) : (
                    <Pressable
                      onPress={() => setIsListExpanded(true)}
                      accessibilityRole="button"
                      accessibilityLabel="展开备选事项清单"
                      className="rounded-xl border border-border/50 bg-surface/40 p-3.5 dark:border-border-dark/50 dark:bg-surface-dark/40"
                    >
                      <Text className="text-center font-sans text-xs text-muted dark:text-muted-dark">
                        已折叠 {alternativeEntries.length} 项备选事项 · 点击展开查看完整列表
                      </Text>
                    </Pressable>
                  )}
                </View>
              ) : null}
            </>
          )}

          {/* Habit Section */}
          {habitRows !== null ? (
            <TodayHabitSection
              habits={habits}
              todayDone={todayDone}
              todayRowsCount={todayRows.length}
              onCatchUpHabit={handleCatchUpHabit}
            />
          ) : null}
        </View>
        </View>
      </ScrollView>

      <SnoozeSheet
        open={snoozeTarget !== null}
        now={now}
        onClose={() => setSnoozeTarget(null)}
        onSelect={async (target) => {
          if (snoozeTarget === null) return false;
          return snooze({
            actionKind: snoozeTarget.kind,
            actionId: snoozeTarget.id,
            snoozedUntil: target,
          });
        }}
      />

      <EditActionModal
        action={editingAction}
        visible={editingAction !== null}
        onClose={() => setEditingAction(null)}
        onSaved={() => setEditingAction(null)}
      />

      <CalendarEditModal
        action={editingCalendar}
        visible={editingCalendar !== null}
        onClose={() => setEditingCalendar(null)}
        onSaved={() => setEditingCalendar(null)}
      />

      <HabitWindowConfirmModal
        visible={windowConfirm !== null}
        habitTitle={windowConfirm?.habitTitle ?? ''}
        windowStart={windowConfirm?.windowStart ?? ''}
        windowEnd={windowConfirm?.windowEnd ?? ''}
        onCancel={() => setWindowConfirm(null)}
        onConfirm={() => {
          if (!windowConfirm) return;
          const { habitDayId } = windowConfirm;
          setWindowConfirm(null);
          void complete({ actionKind: 'habit', actionId: habitDayId, overrideWindow: true }).then((ok) => {
            if (ok) reloadHabits();
          });
        }}
      />
    </View>
  );
}
