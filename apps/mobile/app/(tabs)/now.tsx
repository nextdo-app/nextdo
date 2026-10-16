/**
 * The Now tab (design stitch_scene_design/_1 & _2 rework):
 *
 *   TopHeader (Now + 专注模式 badge + subhead + quick action button) →
 *   FilterContextCard (Current Context scrollable pills with + 添加场景
 *     triggering AddSceneModal bottom sheet, and 5-col Available Time pills) →
 *   re-clarify banner →
 *   STATS ROW (可执行 n/总 · 预计耗时 Σ est · 认知负荷 三档) →
 *   Recommendation Hero Card (kind / est / 项目·截止 / Why this? top-3 / 开始 / 换一个 / 稍后) →
 *   CONTEXT FILTER chips (local UI state — list area only) →
 *   The eligible list (collapsible with counter) →
 *   EmptyExecutionPool (delicate clock illustration + capture button) →
 *   TodayHabitSection (today's habit cards with daily rhythm guide).
 *
 * Presentational only: data arrives from `useNow` (+ contexts / habit-days
 * hooks); every mutation goes through a mutation hook.
 */
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useAppInsets } from '@/lib/use-app-insets';
import { router, useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, Card, ContextChip, SceneOption, Tag, colors, cn } from '@nextdo/ui';
import { formatDeadline, toIso, type CandidateKind, type NextAction, type NextCandidate } from '@nextdo/core';
import { useNow, shouldOfferReclarify, type NowEligible } from '@/hooks/use-now';
import { useAppClock } from '@/hooks/use-app-clock';
import { useSkipAction } from '@/hooks/use-skip-action';
import { useSnoozeAction } from '@/hooks/use-snooze-action';
import { useTrashAction } from '@/hooks/use-trash-action';
import { useCompleteAction } from '@/hooks/use-complete-action';
import { useContexts } from '@/hooks/use-contexts';
import { useHabits, type HabitWithProgress } from '@/hooks/use-habits';
import { useProjectTitles } from '@/hooks/use-project-titles';
import { useEngineContextSettings, type EngineContextSettings } from '@/lib/engine-context';
import { errorMessage } from '@/lib/error-messages';
import { cognitiveLoadLabel } from '@/lib/cognitive-load';
import { FILTER_RULE_LABELS, REASON_LABELS } from '@/lib/reason-labels';
import { KIND_LABELS } from '@/lib/kind-labels';
import { formatLocalDateTime } from '@/lib/format';
import { SnoozeSheet } from '@/components/snooze-sheet';
import { useSwipeReveal } from '@/hooks/use-swipe-reveal';
import { DeadlineChip } from '@/components/deadline-chip';
import { AddSceneModal } from '@/components/add-scene-modal';
import { EditActionModal } from '@/components/edit-action-modal';
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
 * Title "现在", "专注模式" badge, and subtitle with quick action icon.
 */
function TopHeader({ onQuickAction }: { onQuickAction?: () => void }) {
  const { isDark } = useAppTheme();
  return (
    <View className="mb-3.5 flex-row items-center justify-between">
      <View>
        <View className="flex-row items-center gap-2">
          <Text className="font-display text-2xl font-bold tracking-tight text-ink dark:text-ink-dark">
            现在
          </Text>
          <View className="flex-row items-center gap-1 rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 dark:border-accent-dark/30 dark:bg-accent-dark/20">
            <View className="h-1.5 w-1.5 rounded-full bg-accent dark:bg-accent-dark" />
            <Text className="font-sans text-[11px] font-medium text-accent dark:text-accent-dark">
              专注模式
            </Text>
          </View>
        </View>
        <Text className="mt-0.5 font-sans text-xs font-medium tracking-wide text-muted dark:text-muted-dark">
          根据情境匹配最佳下一步行动
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="管理场景快捷入口"
        hitSlop={CHIP_HIT_SLOP}
        onPress={onQuickAction ?? (() => router.push('/contexts'))}
        className="h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-surface shadow-2xs active:scale-95 dark:border-border-dark dark:bg-surface-dark"
      >
        <Ionicons name="options-outline" size={16} color={isDark ? colors.mutedDark : colors.muted} />
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
 * FilterContextCard (stitch_scene_design/_1 & _2):
 * Displays the current context pills with "+ 添加场景" button,
 * and the 5-col available time selector.
 */
function FilterContextCard({
  settings,
  update,
}: {
  settings: EngineContextSettings | null;
  update: (patch: Partial<EngineContextSettings>) => Promise<void>;
}) {
  const { data: contexts, add, reload: reloadContexts } = useContexts();
  const [modalVisible, setModalVisible] = useState(false);
  const { isDark } = useAppTheme();

  useFocusEffect(
    useCallback(() => {
      reloadContexts();
    }, [reloadContexts]),
  );

  const contextIds = settings?.contextIds ?? [];
  const availableMinutes = settings?.availableMinutes ?? 60;
  const anyScene = contextIds.length === 0;

  const toggleContext = (id: string) => {
    const next = contextIds.includes(id)
      ? contextIds.filter((entry) => entry !== id)
      : [...contextIds, id];
    void update({ contextIds: next });
  };

  const handleSaveAndActivate = async (name: string) => {
    const createdId = await add(name);
    if (createdId) {
      void update({ contextIds: [...contextIds, createdId] });
    }
  };

  const timeEstimateText = useMemo(() => {
    if (availableMinutes >= 120) return `预计当前空闲 ~${Math.round(availableMinutes / 60)}小时`;
    if (availableMinutes === 60) return '预计当前空闲 ~1小时';
    return `预计当前空闲 ~${availableMinutes}分钟`;
  }, [availableMinutes]);

  return (
    <Card variant="outlined" className="gap-3.5 p-4 rounded-2xl border-border/70 bg-surface dark:border-border-dark/70 dark:bg-surface-dark shadow-2xs">
      {/* Dimension 1: Scene row */}
      <View className="gap-2.5">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-1.5">
            <View className="h-1.5 w-1.5 rounded-full bg-accent dark:bg-accent-dark" />
            <Text className="font-sans text-xs font-semibold tracking-wider text-muted dark:text-muted-dark">
              当前场景
            </Text>
          </View>

          <View className="flex-row items-center gap-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="管理场景"
              hitSlop={CHIP_HIT_SLOP}
              onPress={() => router.push('/contexts')}
              className="flex-row items-center gap-1 py-0.5 active:opacity-75"
            >
              <Text className="font-sans text-[11px] font-medium text-muted dark:text-muted-dark">
                管理场景
              </Text>
              <Ionicons name="chevron-forward" size={12} color={isDark ? colors.mutedDark : colors.muted} />
            </Pressable>

            {/* Any scene toggle pill */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="清除场景选择，回到任意"
              accessibilityState={{ selected: anyScene }}
              hitSlop={CHIP_HIT_SLOP}
              onPress={() => void update({ contextIds: [] })}
              className={cn(
                'flex-row items-center gap-1 rounded-full px-2.5 py-0.5 active:scale-95',
                anyScene
                  ? 'bg-surface-container dark:bg-surface-container-dark'
                  : 'border border-accent/40 bg-accent/10 dark:border-accent-dark/40 dark:bg-accent-dark/20',
              )}
            >
              <Text
                className={cn(
                  'font-sans text-xs font-medium',
                  anyScene
                    ? 'text-ink dark:text-ink-dark'
                    : 'text-accent dark:text-accent-dark',
                )}
              >
                {anyScene ? '任意' : `已选 ${contextIds.length} 个`}
              </Text>
              {!anyScene ? (
                <Text className="font-sans text-xs text-accent dark:text-accent-dark">✕</Text>
              ) : null}
            </Pressable>
          </View>
        </View>

        {/* Horizontal scroll of scene options */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, alignItems: 'center', paddingVertical: 2 }}
        >
          {(contexts ?? []).map((context) => (
            <SceneOption
              key={context.id}
              label={context.name}
              selected={contextIds.includes(context.id)}
              onPress={() => toggleContext(context.id)}
            />
          ))}

          {/* "+ 添加场景" pill button */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="新建场景"
            hitSlop={CHIP_HIT_SLOP}
            onPress={() => setModalVisible(true)}
            className="h-8 flex-row items-center gap-1 rounded-full border border-dashed border-border/80 bg-surface px-3 active:scale-95 dark:border-border-dark dark:bg-surface-dark"
          >
            <Ionicons name="add" size={14} color={isDark ? colors.mutedDark : colors.muted} />
            <Text className="font-sans text-xs font-medium text-muted dark:text-muted-dark">
              添加场景
            </Text>
          </Pressable>
        </ScrollView>
      </View>

      {/* Subtle divider */}
      <View className="h-px bg-border/40 dark:bg-border-dark/40" />

      {/* Dimension 2: Available time row */}
      <View className="gap-2">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-1.5">
            <View className="h-1.5 w-1.5 rounded-full bg-accent/70 dark:bg-accent-dark/70" />
            <Text className="font-sans text-xs font-semibold tracking-wider text-muted dark:text-muted-dark">
              可用时间{' '}
              <Text className="font-normal text-muted/70 dark:text-muted-dark/70">(分钟)</Text>
            </Text>
          </View>
          <Text className="font-mono text-[11px] text-muted dark:text-muted-dark">
            {timeEstimateText}
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

      <AddSceneModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSaveAndActivate={handleSaveAndActivate}
      />
    </Card>
  );
}

/**
 * Filter chip for the candidate list area.
 * Intentionally uses a subtle segmented tag style (rounded-xl) with neutral ink tones,
 * clearly distinguishing it from the engine's primary SceneOption chips above.
 */
function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={CHIP_HIT_SLOP}
      onPress={onPress}
      className={cn(
        'h-8 flex-row items-center justify-center rounded-xl px-3.5 transition-colors active:scale-95',
        active
          ? 'bg-ink shadow-2xs dark:bg-ink-dark'
          : 'border border-border/80 bg-surface active:bg-surface-container dark:border-border-dark dark:bg-surface-dark dark:active:bg-surface-container-dark',
      )}
    >
      <Text
        className={cn(
          'font-sans text-xs',
          active
            ? 'font-semibold text-canvas dark:text-canvas-dark'
            : 'font-medium text-muted dark:text-muted-dark',
        )}
      >
        {label}
      </Text>
    </Pressable>
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
  contextName,
  onComplete,
  onSnooze,
  onTrash,
  onEdit,
}: {
  entry: NowEligible;
  now: Date;
  projectName: string | undefined;
  contextName: (id: string) => string;
  onComplete: (kind: CandidateKind, id: string) => void;
  onSnooze: (kind: CandidateKind, id: string) => void;
  onTrash: (kind: CandidateKind, id: string) => void;
  onEdit: (candidate: NextCandidate) => void;
}) {
  const action = entry.action;
  // Swipe right reveals the 完成 button (issue #17, reworked by issue 27):
  // the gesture is a shortcut to the CONFIRMATION, never past it — the
  // action is completed only when that revealed button is pressed. The
  // button below is the same action, and on web it is the ONLY path (the
  // gesture is not registered there at all), so no platform needs a swipe.
  const swipe = useSwipeReveal(() => onComplete(action.kind, action.id));
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
      <Pressable
        onPress={() => {
          // Tapping the row itself dismisses the exposed button.
          if (swipe.revealed) swipe.close();
        }}
      >
        <Animated.View
          testID={`swipe-row-${action.id}`}
          {...swipe.panHandlers}
          style={{ transform: [{ translateX: swipe.translateX }] }}
        >
          <Card variant="outlined" className="gap-2.5 p-3.5 rounded-2xl border-border/70 bg-surface dark:border-border-dark/70 dark:bg-surface-dark shadow-2xs">
            <View className="flex-row items-start gap-2.5">
              <View className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent/80 dark:bg-accent-dark/80" />
              <Text className="flex-1 font-sans text-base font-medium leading-snug text-ink dark:text-ink-dark">
                {action.title}
              </Text>
            </View>
            <View className="flex-row flex-wrap items-center gap-1.5">
              {projectName !== undefined ? <Tag label={projectName} tone="neutral" /> : null}
              {action.contextIds.map((id) => (
                <ContextChip key={id} name={contextName(id)} />
              ))}
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
            <View className="flex-row justify-end gap-1.5 pt-0.5 border-t border-border/40 dark:border-border-dark/40">
              <Button size="sm" label="完成" variant="ghost" onPress={() => onComplete(action.kind, action.id)} />
              <Button size="sm" label="稍后" variant="ghost" onPress={() => onSnooze(action.kind, action.id)} />
              {action.kind === 'next' ? (
                <Button size="sm" label="编辑" variant="ghost" onPress={() => onEdit(action as NextCandidate)} />
              ) : null}
              <Button size="sm" label="删除" variant="ghost" onPress={() => onTrash(action.kind, action.id)} />
            </View>
          </Card>
        </Animated.View>
      </Pressable>
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
        去收件箱捕获一条待办，系统将根据情境排好你接下来该做的事。
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

/** One habit row in the habit section. */
const HabitBlockRow = memo(function HabitBlockRow({
  row,
  onComplete,
  onCatchUp,
}: {
  row: HabitWithProgress;
  onComplete: () => void;
  onCatchUp?: () => void;
}) {
  const { habit, cycleDay, doneCount, today, yesterday, extendedDays } = row;
  const open = today !== null && today.status === 'open';
  const cycleLabel =
    cycleDay === null ? `本期 ${habit.cycleDays} 天` : `第 ${cycleDay}/${habit.cycleDays} 天`;

  return (
    <View className="gap-1.5">
      <View className="flex-row items-center gap-2">
        <Text
          className="flex-1 font-sans text-sm font-medium text-ink dark:text-ink-dark"
          numberOfLines={1}
        >
          {habit.title}
        </Text>
        {extendedDays > 0 ? (
          <Tag label={`顺延+${extendedDays}天`} tone="neutral" />
        ) : null}
        <Tag label={cycleLabel} tone="accent" />
      </View>
      <View className="flex-row items-center gap-2">
        <Text className="font-sans text-xs text-muted dark:text-muted-dark">
          本期已完成 {doneCount} 天
          {habit.windowStart && habit.windowEnd ? ` · 窗口 ${habit.windowStart}–${habit.windowEnd}` : ''}
        </Text>
        <View className="ml-auto flex-row items-center gap-1.5">
          {yesterday !== null && onCatchUp ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`补打卡昨天：${habit.title}`}
              hitSlop={CHIP_HIT_SLOP}
              className="h-8 items-center justify-center rounded-full border border-accent/60 bg-accent/10 px-3 shadow-2xs active:bg-accent/20 dark:border-accent-dark/60 dark:bg-accent-dark/20"
              onPress={onCatchUp}
            >
              <Text className="font-sans text-xs font-medium text-accent dark:text-accent-dark">
                + 补昨日卡
              </Text>
            </Pressable>
          ) : null}
          {open ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`完成习惯：${habit.title}`}
              hitSlop={CHIP_HIT_SLOP}
              className="h-8 items-center justify-center rounded-full border border-border/80 bg-surface px-3.5 shadow-2xs active:bg-surface-container dark:border-border-dark dark:bg-surface-dark dark:active:bg-surface-container-dark"
              onPress={onComplete}
            >
              <Text className="font-sans text-xs font-medium text-ink dark:text-ink-dark">
                ✓ 打卡
              </Text>
            </Pressable>
          ) : (
            <Text className="font-sans text-xs text-muted dark:text-muted-dark">
              {today === null ? '今天无安排' : '今天已完成'}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
});

/**
 * TodayHabitSection (stitch_scene_design/_1):
 * Shows habit count badge, habit items, or inspiring guidance to start habits.
 */
function TodayHabitSection({
  habits,
  todayDone,
  todayRowsCount,
  onCompleteHabit,
  onCatchUpHabit,
}: {
  habits: HabitWithProgress[];
  todayDone: number;
  todayRowsCount: number;
  onCompleteHabit: (habitDayId: string, habit?: HabitWithProgress['habit']) => void;
  onCatchUpHabit: (habitDayId: string) => void;
}) {
  const { isDark } = useAppTheme();
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
        habits.map((row) => (
          <HabitBlockRow
            key={row.habit.id}
            row={row}
            onComplete={() => {
              if (row.today !== null) {
                onCompleteHabit(row.today.id, row.habit);
              }
            }}
            onCatchUp={
              row.yesterday !== null
                ? () => onCatchUpHabit(row.yesterday!.id)
                : undefined
            }
          />
        ))
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

export default function NowScreen() {
  const now = useAppClock();
  const { isDark } = useAppTheme();
  const { settings, update } = useEngineContextSettings();
  const { data, error } = useNow(settings);
  const { skip, error: skipError } = useSkipAction();
  const { snooze, error: snoozeError } = useSnoozeAction();
  const { trash, error: trashError } = useTrashAction();
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
  const { data: contexts } = useContexts();
  const [snoozeTarget, setSnoozeTarget] = useState<{ kind: CandidateKind; id: string } | null>(null);
  const [editingAction, setEditingAction] = useState<NextAction | null>(null);
  const [skippedViewIds, setSkippedViewIds] = useState<string[]>([]);
  const [windowConfirm, setWindowConfirm] = useState<{
    habitDayId: string;
    habitTitle: string;
    windowStart: string;
    windowEnd: string;
  } | null>(null);
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
  const [isListExpanded, setIsListExpanded] = useState(true);
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);
  const mutationError = skipError ?? snoozeError ?? trashError ?? completeError ?? habitError;

  const eligible = data?.eligible ?? [];
  const displayed = useMemo(
    () =>
      eligible.find((entry) => !skippedViewIds.includes(entry.action.id)) ??
      eligible[0] ??
      null,
    [eligible, skippedViewIds],
  );

  const totalCount = eligible.length + (data?.filtered.length ?? 0);
  const totalEst = useMemo(
    () => eligible.reduce((sum, entry) => sum + entry.action.estMinutes, 0),
    [eligible],
  );

  const visible = useMemo(
    () =>
      eligible.filter(
        (entry) =>
          selectedContextIds.length === 0 ||
          entry.action.contextIds.length === 0 ||
          entry.action.contextIds.some((id) => selectedContextIds.includes(id)),
      ),
    [eligible, selectedContextIds],
  );

  const toggleFilterContext = useCallback(
    (contextId: string) =>
      setSelectedContextIds((prev) =>
        prev.includes(contextId) ? prev.filter((id) => id !== contextId) : [...prev, contextId],
      ),
    [],
  );

  const contextName = useCallback(
    (id: string) => contexts?.find((entry) => entry.id === id)?.name ?? id,
    [contexts],
  );

  const handleSkip = useCallback(() => {
    if (displayed === null) return;
    void skip({ actionKind: displayed.action.kind, actionId: displayed.action.id });
    setSkippedViewIds((prev) =>
      prev.includes(displayed.action.id)
        ? [displayed.action.id]
        : [...prev, displayed.action.id],
    );
  }, [displayed, skip]);

  const handleSnooze = useCallback((kind: CandidateKind, id: string) => {
    setSnoozeTarget({ kind, id });
  }, []);

  const handleTrash = useCallback(
    (actionKind: CandidateKind, actionId: string) => {
      void trash({ actionKind, actionId });
    },
    [trash],
  );

  /** Row-level 完成 — one definition for the button and the swipe gesture
   *  (issue #17), so the two can never diverge. */
  const handleComplete = useCallback(
    (actionKind: CandidateKind, actionId: string) => {
      void complete({ actionKind, actionId });
    },
    [complete],
  );

  const handleEdit = useCallback(
    (candidate: NextCandidate) => {
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

  const handleCompleteHabit = useCallback(
    (habitDayId: string, habit?: HabitWithProgress['habit']) => {
      void complete({ actionKind: 'habit', actionId: habitDayId }).then((ok) => {
        if (ok) {
          reloadHabits();
        } else if (habit?.windowStart && habit?.windowEnd) {
          setWindowConfirm({
            habitDayId,
            habitTitle: habit.title,
            windowStart: habit.windowStart,
            windowEnd: habit.windowEnd,
          });
        }
      });
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
        <View className="w-full flex-1">
        {/* Top Header */}
        <TopHeader />

        {mutationError !== null ? (
          <Text className="mt-2 font-sans text-sm text-danger">{errorMessage(mutationError)}</Text>
        ) : null}

        <View className="mt-3 gap-3.5">
          {error !== null ? (
            <Card className="items-center p-6 text-center">
              <Text className="font-sans text-sm font-semibold text-danger">加载执行池失败</Text>
              <Text className="mt-1 font-sans text-xs text-muted">{errorMessage(error)}</Text>
            </Card>
          ) : data === null ? (
            <Card className="items-center p-6 text-center">
              <Text className="font-sans text-sm font-medium text-muted">加载中…</Text>
            </Card>
          ) : data.poolEmpty ? (
            <>
              <EmptyExecutionPool />
              <FilterContextCard settings={settings} update={update} />
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
                      {displayed.action.kind === 'next' ? (
                        <Button
                          size="sm"
                          label="编辑"
                          variant="ghost"
                          onPress={() => handleEdit(displayed.action as NextCandidate)}
                        />
                      ) : null}
                    </View>
                    <Text className="font-display text-xl font-bold tracking-tight leading-snug text-ink dark:text-ink-dark sm:text-2xl">
                      {displayed.action.title}
                    </Text>
                    {subtitleParts.length > 0 ? (
                      <Text className="mt-1.5 font-sans text-xs text-muted dark:text-muted-dark">
                        {subtitleParts.join(' · ')}
                      </Text>
                    ) : null}

                    {displayed.reasons.length > 0 ? (
                      <View className="mt-4 rounded-xl border border-border/50 bg-surface-container/50 p-3 dark:border-border-dark/50 dark:bg-surface-container-dark/50">
                        <Text className="mb-2 font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                          为什么是它？
                        </Text>
                        <View className="flex-row flex-wrap gap-1.5">
                          {displayed.reasons.slice(0, 3).map((reason, idx) => (
                            <View
                              key={`${reason.type}-${reason.code}`}
                              className={cn(
                                'flex-row items-center rounded-lg px-2.5 py-1',
                                idx === 0
                                  ? 'border border-accent/25 bg-accent/10 dark:border-accent-dark/30 dark:bg-accent-dark/20'
                                  : 'border border-border/60 bg-surface/80 dark:border-border-dark/60 dark:bg-surface-dark/80',
                              )}
                            >
                              <Text
                                className={cn(
                                  'font-sans text-xs',
                                  idx === 0
                                    ? 'font-medium text-accent dark:text-accent-dark'
                                    : 'text-ink/80 dark:text-ink-dark/80',
                                )}
                              >
                                {idx === 0 ? '★ ' : ''}
                                {REASON_LABELS[reason.code]}
                              </Text>
                            </View>
                          ))}
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
                      onPress={() =>
                        router.push(`/focus/${displayed.action.id}?kind=${displayed.action.kind}`)
                      }
                    />
                    <View className="flex-row gap-3">
                      <View className="flex-1">
                        <Button
                          label="换一个"
                          variant="secondary"
                          className="w-full"
                          onPress={handleSkip}
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
                  </View>
                </>
              ) : (
                <Card className="items-center p-6 text-center">
                  <Text className="font-sans text-base font-semibold text-ink dark:text-ink-dark">
                    没有任何适合当前场景与时间的行动
                  </Text>
                  <Text className="mt-1 font-sans text-xs text-muted dark:text-muted-dark">
                    试试切换下方的场景或时间。
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

              {/* Filter and Context Card — contextual fine-tuning after hero card */}
              <FilterContextCard settings={settings} update={update} />

              {/* Stats row — pool overview */}
              <View className="flex-row items-center rounded-2xl border border-border/60 bg-surface/70 px-2 py-1.5 shadow-2xs backdrop-blur-sm dark:border-border-dark/60 dark:bg-surface-dark/70">
                <StatsCell label="可执行" value={`${eligible.length}/${totalCount} 项`} />
                <View className="h-6 w-px bg-border/40 dark:bg-border-dark/40" />
                <StatsCell label="预计耗时" value={`${totalEst} 分钟`} />
                <View className="h-6 w-px bg-border/40 dark:bg-border-dark/40" />
                <StatsCell label="认知负荷" value={cognitiveLoadLabel(totalEst)} />
              </View>

              {/* The 已完成行动 window's entry (issue 27) — completion is a
                  separate, reversible decision, so it needs a place to be
                  reviewed and undone. */}
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

              {displayed !== null ? (
                <>
                  {/* Context filter chips for list area */}
                  <View className="flex-row flex-wrap gap-2">
                    <Chip
                      label="全部"
                      active={selectedContextIds.length === 0}
                      onPress={() => setSelectedContextIds([])}
                    />
                    {(contexts ?? []).map((context) => (
                      <Chip
                        key={context.id}
                        label={context.name}
                        active={selectedContextIds.includes(context.id)}
                        onPress={() => toggleFilterContext(context.id)}
                      />
                    ))}
                  </View>

                  {/* Eligible list header & collapsible body */}
                  {visible.length === 0 ? (
                    <Card className="items-center p-6 text-center">
                      <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
                        没有匹配当前情境的可执行事项
                      </Text>
                      <Text className="mt-1 font-sans text-xs text-muted dark:text-muted-dark">
                        换一批情境 chip，或点「全部」看所有可执行事项。
                      </Text>
                    </Card>
                  ) : (
                    <View className="gap-2.5">
                      <View className="flex-row items-center justify-between px-1">
                        <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                          可执行备选事项 ({visible.length})
                        </Text>
                        <Button
                          size="sm"
                          variant="ghost"
                          label={isListExpanded ? '收起清单' : '展开清单'}
                          onPress={() => setIsListExpanded((prev) => !prev)}
                        />
                      </View>
                      {isListExpanded ? (
                        visible.map((entry) => (
                          <ActionRow
                            key={entry.action.id}
                            entry={entry}
                            now={now}
                            projectName={
                              entry.action.projectId !== undefined
                                ? projectTitles[entry.action.projectId]
                                : undefined
                            }
                            contextName={contextName}
                            onComplete={() => handleComplete(entry.action.kind, entry.action.id)}
                            onSnooze={handleSnooze}
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
                            已折叠 {visible.length} 项备选事项 · 点击展开查看完整列表
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                </>
              ) : null}
            </>
          )}

          {/* Habit Section */}
          {habitRows !== null ? (
            <TodayHabitSection
              habits={habits}
              todayDone={todayDone}
              todayRowsCount={todayRows.length}
              onCompleteHabit={handleCompleteHabit}
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
        onSelect={(target) => {
          if (snoozeTarget !== null) {
            void snooze({
              actionKind: snoozeTarget.kind,
              actionId: snoozeTarget.id,
              snoozedUntil: target,
            });
          }
        }}
      />

      <EditActionModal
        action={editingAction}
        visible={editingAction !== null}
        onClose={() => setEditingAction(null)}
        onSaved={() => setEditingAction(null)}
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
