/**
 * The habits screen (task 10-02 — 习惯创建表单与 21 天挑战启动).
 *
 * An ordinary (non-tab) route, reached from the Settings tab's 「习惯」
 * card and from the Now screen's habit strip (empty-state prompt /
 * 「管理」). Deliberately NOT a tab: habits are entered rarely and read
 * from Now.
 *
 * Two parts:
 *  1. the ACTIVE habits with their challenge progress (「第 N/21 天」)
 *     and a per-row 删除 (soft delete — `trashHabit`);
 *  2. the create form — 习惯名 / 每日行动（选填，留空继承习惯名）/
 *     预计分钟 / 价值 1–5 / 可选时间窗口 — submitting calls the
 *     `startHabit` transaction (INSERT + today's HabitDay seeding in ONE
 *     local transaction), so a habit can never exist without its first
 *     challenge day.
 *
 * Scope guards (PRD 非目标): NO editing / pausing / restarting a broken
 * challenge / habit history / weekday mask (`windowDays`) / custom cycle
 * length / `category`. `cycleDays` is fixed at 21 — a CHALLENGE CYCLE,
 * and the copy below never claims 21 days makes a habit (design.md §7).
 *
 * Presentational: every read comes from `useHabits` and every write from
 * `useStartHabit` / `useTrashHabit` (component-guidelines — no db in
 * components). All validation is a pure computation in render that drives
 * the submit button's `disabled` (design.md §6).
 */
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAppInsets } from '@/lib/use-app-insets';
import { Button, Card, EmptyState, Tag, ValueChips, cn } from '@nextdo/ui';
import { checkHabitStartDate, hhmmToMinutes, parseHhmm, type Value } from '@nextdo/core';
import { DateTimePicker } from '@/components/datetime-picker';
import { PickerField } from '@/components/picker-field';
import { localDateKey } from '@/lib/review-dates';
import { useAppClock } from '@/hooks/use-app-clock';
import { useHabits, type HabitWithProgress } from '@/hooks/use-habits';
import { useStartHabit, HABIT_CYCLE_DAYS } from '@/hooks/use-start-habit';
import { useTrashHabit } from '@/hooks/use-trash-habit';
import { errorMessage } from '@/lib/error-messages';
import { goBack } from '@/lib/go-back';
import { EditHabitForm } from '@/components/edit-habit-form';

/** 32px visual chip (h-8) + hitSlop → a 44pt tap target (accessibility). */
const CHIP_HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 } as const;

const INPUT_CLASS =
  'rounded-md border border-border/80 bg-surface p-3 text-base text-ink placeholder:text-muted focus:border-accent dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

/** Minutes-since-midnight for a valid "HH:mm"; null when malformed. */
function hhmmMinutes(value: string): number | null {
  try {
    return hhmmToMinutes(parseHhmm(value));
  } catch {
    return null;
  }
}

/**
 * A start date as the user reads it: "今天 · 挑战第 1 天", or "10月20日 ·
 * 9 天后开始" for a challenge booked ahead. The countdown is what makes a
 * future start comprehensible — the challenge has not begun yet, so there
 * is no cycle day to show.
 *
 * Whether the pick is legal at all is `checkHabitStartDate`'s job, not
 * this formatter's; an unparseable key falls through as-is.
 */
function formatStartDate(dateKey: string, now: Date): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (match === null) return dateKey;
  const picked = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  // Noon anchors on both sides, so a DST shift inside the gap cannot round
  // an off-by-one into the readout.
  const offsetDays = Math.round((picked.getTime() - today.getTime()) / 86_400_000);
  if (offsetDays === 0) return '今天 · 挑战第 1 天';
  const day = `${Number(match[2])}月${Number(match[3])}日`;
  return offsetDays > 0 ? `${day} · ${offsetDays} 天后开始` : day;
}

/** One hint line per rejected start date — the user picks the fix. */
const START_HINTS: Record<'invalid' | 'past', string> = {
  invalid: '起始日期无效。',
  past: '起始日期不能早于今天 —— 挑战周期在创建时一次生成，不能补记已经过去的日子。',
};

/** One active habit: name, daily action, 第 N/21 天, window (全天 when
 *  none), estimate, value + 编辑 + 删除. */
function HabitRow({
  entry,
  onTrash,
  onReload,
}: {
  entry: HabitWithProgress;
  onTrash: () => void;
  onReload: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const { habit, cycleDay, doneCount, startsInDays } = entry;
  const hasWindow = habit.windowStart !== undefined && habit.windowEnd !== undefined;

  if (isEditing) {
    return (
      <EditHabitForm
        habit={habit}
        onDone={() => setIsEditing(false)}
        onSaved={() => {
          setIsEditing(false);
          onReload();
        }}
      />
    );
  }

  return (
    <Card className="gap-2 p-3.5">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 font-sans text-base font-semibold text-ink dark:text-ink-dark">
          {habit.title}
        </Text>
        <Tag
          label={
            cycleDay !== null
              ? `第 ${cycleDay}/${habit.cycleDays} 天`
              : startsInDays !== null
                ? `${startsInDays} 天后开始`
                : `本期 ${habit.cycleDays} 天`
          }
          tone="accent"
        />
      </View>
      <Text className="font-sans text-sm text-muted dark:text-muted-dark">
        每日行动：{habit.actionTitle}
      </Text>
      <View className="flex-row flex-wrap items-center gap-1.5">
        <Tag label={`${habit.estMinutes} 分钟`} />
        <Tag label={`价值 ${habit.value}`} />
        <Tag label={hasWindow ? `${habit.windowStart}–${habit.windowEnd}` : '全天'} />
        <Tag label={`本期已完成 ${doneCount} 天`} />
      </View>
      <View className="flex-row justify-end gap-2">
        <Button
          size="sm"
          label="编辑"
          variant="ghost"
          onPress={() => setIsEditing(true)}
        />
        <Button
          size="sm"
          label="删除"
          variant="ghost"
          onPress={() => {
            onTrash();
          }}
        />
      </View>
    </Card>
  );
}

/**
 * The create form. `windowOn` is the single switch that decides whether
 * a window is written at all (off → BOTH halves are `undefined` = an
 * all-day habit); on → both must be valid HH:mm with start < end.
 */
function HabitForm({ onStarted }: { onStarted: () => void }) {
  const { start, error } = useStartHabit();
  const [title, setTitle] = useState('');
  const [actionTitle, setActionTitle] = useState('');
  const [estMinutes, setEstMinutes] = useState('');
  const [value, setValue] = useState<Value>(3);
  const [windowOn, setWindowOn] = useState(false);
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const now = useAppClock();
  const [startDate, setStartDate] = useState(() => localDateKey(now));
  const [openPicker, setOpenPicker] = useState<'start' | 'windowStart' | 'windowEnd' | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Pure validation in render (design.md §6) — nothing is stored twice.
  const parsedEst = Number(estMinutes.trim());
  const estOk = estMinutes.trim() !== '' && Number.isInteger(parsedEst) && parsedEst >= 1;
  const startCheck = checkHabitStartDate(startDate, now);
  const startHint = startCheck.ok ? null : START_HINTS[startCheck.problem];
  const startMin = windowOn ? hhmmMinutes(windowStart.trim()) : null;
  const endMin = windowOn ? hhmmMinutes(windowEnd.trim()) : null;
  const windowValid =
    !windowOn || (startMin !== null && endMin !== null && startMin < endMin);
  // The ONE hint the user needs: an enabled window that can't submit.
  const windowHint =
    windowOn && !windowValid ? '时间窗口需要填写完整的起止时间，且开始早于结束。' : null;
  const canSubmit =
    title.trim() !== '' && estOk && startCheck.ok && windowValid && !submitting;

  const reset = () => {
    setTitle('');
    setActionTitle('');
    setEstMinutes('');
    setValue(3);
    setWindowOn(false);
    setWindowStart('');
    setWindowEnd('');
    setStartDate(localDateKey(now));
    setOpenPicker(null);
  };

  // Stay on the screen after a successful create (design.md §5): the
  // user can add several habits in a row and the list updates in place.
  const submit = () => {
    if (!canSubmit) return;
    setSubmitting(true);
    void start({
      title,
      actionTitle,
      estMinutes: parsedEst,
      value,
      startDate,
      ...(windowOn && startMin !== null && endMin !== null
        ? { windowStart: windowStart.trim(), windowEnd: windowEnd.trim() }
        : {}),
    }).then((ok) => {
      setSubmitting(false);
      if (!ok) return;
      reset();
      onStarted();
    });
  };

  return (
    <Card className="gap-3.5 p-4">
      <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
        新习惯 · {HABIT_CYCLE_DAYS} 天挑战
      </Text>
      <TextInput
        className={INPUT_CLASS}
        placeholder="习惯名（如 阅读）"
        value={title}
        onChangeText={setTitle}
        accessibilityLabel="习惯名"
      />
      <TextInput
        className={INPUT_CLASS}
        placeholder="每日行动（选填，如 阅读 30 min）"
        value={actionTitle}
        onChangeText={setActionTitle}
        accessibilityLabel="每日行动标题（选填）"
      />
      <TextInput
        className={INPUT_CLASS}
        placeholder="预计分钟（正整数）"
        keyboardType="number-pad"
        value={estMinutes}
        onChangeText={setEstMinutes}
        accessibilityLabel="预计分钟"
      />
      <ValueChips value={value} onChange={setValue} />

      {/* Challenge start date — the app never hand-types a date
          (component-guidelines §Forms): the picker owns the value, and the
          readout spells out which cycle day the pick lands on. */}
      <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
        起始日期（第 1 天）
      </Text>
      <PickerField
        label="起始日期"
        value={formatStartDate(startDate, now)}
        placeholder="选择起始日期"
        onPress={() => setOpenPicker('start')}
      />
      {startHint !== null ? (
        <Text className="font-sans text-xs text-danger dark:text-danger-dark">{startHint}</Text>
      ) : null}

      {/* Optional time window — two HH:mm pickers, never typed by hand
          (issue #13). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={windowOn ? '关闭时间窗口' : '开启时间窗口'}
        accessibilityState={{ selected: windowOn }}
        hitSlop={CHIP_HIT_SLOP}
        onPress={() => setWindowOn((prev) => !prev)}
        className="flex-row items-center gap-2"
      >
        <View
          className={cn(
            'h-5 w-5 items-center justify-center rounded-md border',
            windowOn
              ? 'border-accent bg-accent dark:border-accent-dark dark:bg-accent-dark'
              : 'border-border/80 bg-surface dark:border-border-dark dark:bg-surface-dark',
          )}
        >
          {windowOn ? (
            <Text className="font-sans text-xs font-bold leading-none text-on-accent dark:text-on-accent-dark">
              ✓
            </Text>
          ) : null}
        </View>
        <Text className="font-sans text-sm text-muted dark:text-muted-dark">
          限定时间窗口（不开启 = 全天可执行）
        </Text>
      </Pressable>

      {windowOn ? (
        <View className="flex-row items-center gap-2">
          <PickerField
            label="时间窗口开始"
            value={windowStart}
            placeholder="开始时间"
            onPress={() => setOpenPicker('windowStart')}
          />
          <PickerField
            label="时间窗口结束"
            value={windowEnd}
            placeholder="结束时间"
            onPress={() => setOpenPicker('windowEnd')}
          />
        </View>
      ) : null}

      {windowHint !== null ? (
        <Text className="font-sans text-xs text-danger dark:text-danger-dark">{windowHint}</Text>
      ) : null}
      {error !== null ? (
        <Text className="font-sans text-sm text-danger dark:text-danger-dark">
          {errorMessage(error)}
        </Text>
      ) : null}

      <Button
        label={`开始 ${HABIT_CYCLE_DAYS} 天挑战`}
        className="w-full"
        disabled={!canSubmit}
        onPress={submit}
      />

      {/* One modal, three targets — only the field that was tapped mounts
          the picker, so the value it receives is the one being edited. */}
      {openPicker !== null ? (
        <DateTimePicker
          mode={openPicker === 'start' ? 'date' : 'time'}
          title={
            openPicker === 'start'
              ? '选择起始日期'
              : openPicker === 'windowStart'
                ? '选择开始时间'
                : '选择结束时间'
          }
          value={
            openPicker === 'start'
              ? startDate
              : openPicker === 'windowStart'
                ? windowStart
                : windowEnd
          }
          now={now}
          onConfirm={(val) => {
            if (openPicker === 'start') setStartDate(val);
            else if (openPicker === 'windowStart') setWindowStart(val);
            else setWindowEnd(val);
            setOpenPicker(null);
          }}
          onClose={() => setOpenPicker(null)}
        />
      ) : null}
    </Card>
  );
}

export default function HabitsScreen() {
  const now = useAppClock();
  const { data, error, reload } = useHabits(now);
  const { trash, error: trashError } = useTrashHabit();
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);
  const habits = data ?? [];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-canvas dark:bg-canvas-dark"
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: topPadding, paddingHorizontal: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-2 flex-row items-center justify-between">
          <Button label="← 现在" variant="ghost" onPress={() => goBack('/(tabs)/now')} />
        </View>
        <Text className="font-display text-3xl font-bold tracking-tight text-ink dark:text-ink-dark">
          习惯
        </Text>
        <Text className="mt-1 font-sans text-sm text-muted dark:text-muted-dark">
          {HABIT_CYCLE_DAYS} 天是一个挑战周期 —— 它给你一个起点，不是「一定能养成」的保证。
        </Text>

        {trashError !== null ? (
          <Text className="mt-2 font-sans text-sm text-danger dark:text-danger-dark">
            {errorMessage(trashError)}
          </Text>
        ) : null}

        <View className="mt-4 gap-2.5">
          {error !== null ? (
            <EmptyState title="加载习惯失败" hint={errorMessage(error)} />
          ) : data === null ? (
            <EmptyState title="加载中…" />
          ) : habits.length === 0 ? (
            <EmptyState
              title="还没有习惯"
              hint="习惯会在每天生成一条行动，并出现在「现在」的执行池里。用下面的表单创建第一个。"
            />
          ) : (
            habits.map((entry) => (
              <HabitRow
                key={entry.habit.id}
                entry={entry}
                onReload={reload}
                onTrash={() => {
                  void trash(entry.habit.id).then((ok) => {
                    if (ok) reload();
                  });
                }}
              />
            ))
          )}
        </View>

        <View className="mt-4">
          <HabitForm onStarted={reload} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}