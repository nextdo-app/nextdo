/**
 * Inline edit-habit form (Issue #19).
 * Pre-filled from an existing Habit row; edits title, actionTitle,
 * estMinutes, value, startDate, windowStart/windowEnd, and frequency (windowDays).
 */
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Button, Card, ValueChips, cn } from '@nextdo/ui';
import {
  checkHabitStartDate,
  hhmmToMinutes,
  localDateKey,
  parseHhmm,
  parseIso,
  type Habit,
  type Value,
} from '@nextdo/core';
import { DateTimePicker } from '@/components/datetime-picker';
import { FormField } from '@/components/form-field';
import { PickerField } from '@/components/picker-field';
import { useAppClock } from '@/hooks/use-app-clock';
import { useUpdateHabit } from '@/hooks/use-update-habit';
import { errorMessage } from '@/lib/error-messages';

const CHIP_HIT_SLOP = { top: 6, bottom: 6, left: 4, right: 4 } as const;

const INPUT_CLASS =
  'rounded-md border border-border/80 bg-surface p-3 text-base text-ink placeholder:text-muted focus:border-accent dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

const WEEKDAYS = [
  { day: 1, label: '一' },
  { day: 2, label: '二' },
  { day: 3, label: '三' },
  { day: 4, label: '四' },
  { day: 5, label: '五' },
  { day: 6, label: '六' },
  { day: 0, label: '日' },
];

function hhmmMinutes(value: string): number | null {
  try {
    return hhmmToMinutes(parseHhmm(value));
  } catch {
    return null;
  }
}

function formatStartDate(dateKey: string, now: Date): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (match === null) return dateKey;
  const picked = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  const offsetDays = Math.round((picked.getTime() - today.getTime()) / 86_400_000);
  if (offsetDays === 0) return '今天 · 挑战第 1 天';
  const day = `${Number(match[2])}月${Number(match[3])}日`;
  return offsetDays > 0 ? `${day} · ${offsetDays} 天后开始` : day;
}

const START_HINTS: Record<'invalid' | 'past', string> = {
  invalid: '起始日期无效。',
  past: '起始日期不能早于今天 —— 挑战周期一次生成，不能补记过去的日子。',
};

export interface EditHabitFormProps {
  habit: Habit;
  onDone: () => void;
  onSaved: () => void;
}

export function EditHabitForm({ habit, onDone, onSaved }: EditHabitFormProps) {
  const now = useAppClock();
  const { update, error } = useUpdateHabit();

  const [title, setTitle] = useState(habit.title);
  const [actionTitle, setActionTitle] = useState(habit.actionTitle);
  const [estMinutes, setEstMinutes] = useState(String(habit.estMinutes));
  const [value, setValue] = useState<Value>(habit.value);

  const initialStartDateKey = localDateKey(parseIso(habit.startedAt));
  const [startDate, setStartDate] = useState(initialStartDateKey);

  const [windowOn, setWindowOn] = useState(
    habit.windowStart !== undefined && habit.windowEnd !== undefined,
  );
  const [windowStart, setWindowStart] = useState(habit.windowStart ?? '');
  const [windowEnd, setWindowEnd] = useState(habit.windowEnd ?? '');

  // windowDays: undefined means all 7 days
  const [selectedDays, setSelectedDays] = useState<number[]>(
    habit.windowDays ?? [0, 1, 2, 3, 4, 5, 6],
  );

  const [openPicker, setOpenPicker] = useState<'start' | 'windowStart' | 'windowEnd' | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleDay = (day: number) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort(),
    );
  };

  const parsedEst = Number(estMinutes.trim());
  const estOk = estMinutes.trim() !== '' && Number.isInteger(parsedEst) && parsedEst >= 1;

  // If start date is unchanged from original, it's valid even if it was started in past
  const isStartUnchanged = startDate === initialStartDateKey;
  const startCheck = isStartUnchanged ? null : checkHabitStartDate(startDate, now);
  const isStartOk = isStartUnchanged || (startCheck !== null && startCheck.ok);
  const startHint =
    startCheck !== null && !startCheck.ok ? START_HINTS[startCheck.problem] : null;

  const startMin = windowOn ? hhmmMinutes(windowStart.trim()) : null;
  const endMin = windowOn ? hhmmMinutes(windowEnd.trim()) : null;
  const windowValid = !windowOn || (startMin !== null && endMin !== null && startMin < endMin);
  const windowHint =
    windowOn && !windowValid ? '时间窗口需要填写完整的起止时间，且开始早于结束。' : null;

  const canSubmit =
    title.trim() !== '' &&
    estOk &&
    isStartOk &&
    windowValid &&
    selectedDays.length > 0 &&
    !submitting;

  const save = async () => {
    if (!canSubmit) return;
    setSubmitting(true);

    const isAllDays = selectedDays.length === 7;
    const ok = await update({
      habit,
      patch: {
        title: title.trim(),
        actionTitle: actionTitle.trim(),
        estMinutes: parsedEst,
        value,
        startDate: isStartUnchanged ? undefined : startDate,
        clearWindow: !windowOn,
        ...(windowOn && startMin !== null && endMin !== null
          ? { windowStart: windowStart.trim(), windowEnd: windowEnd.trim() }
          : {}),
        clearWindowDays: isAllDays,
        windowDays: isAllDays ? undefined : selectedDays,
      },
    });

    setSubmitting(false);
    if (ok) onSaved();
  };

  return (
    <Card className="gap-3.5 p-4">
      <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
        编辑习惯
      </Text>
      <FormField label="习惯名">
        <TextInput
          className={INPUT_CLASS}
          placeholder="习惯名（如 阅读）"
          value={title}
          onChangeText={setTitle}
          accessibilityLabel="编辑习惯名"
        />
      </FormField>
      <FormField label="每日行动">
        <TextInput
          className={INPUT_CLASS}
          placeholder="每日行动（选填，如 阅读 30 min）"
          value={actionTitle}
          onChangeText={setActionTitle}
          accessibilityLabel="编辑每日行动标题"
        />
      </FormField>
      <FormField label="预计分钟">
        <TextInput
          className={INPUT_CLASS}
          placeholder="预计分钟（正整数）"
          keyboardType="number-pad"
          value={estMinutes}
          onChangeText={setEstMinutes}
          accessibilityLabel="编辑预计分钟"
        />
      </FormField>
      <ValueChips value={value} onChange={setValue} />

      {/* Challenge start date */}
      <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
        起始日期
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

      {/* Frequency: Weekday selector */}
      <View className="gap-2">
        <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
          频率（执行日）
        </Text>
        <View className="flex-row items-center gap-1.5">
          {WEEKDAYS.map(({ day, label }) => {
            const active = selectedDays.includes(day);
            return (
              <Pressable
                key={day}
                accessibilityRole="button"
                accessibilityLabel={`周${label}`}
                accessibilityState={{ selected: active }}
                hitSlop={CHIP_HIT_SLOP}
                onPress={() => toggleDay(day)}
                className={cn(
                  'h-8 w-8 items-center justify-center rounded-full border',
                  active
                    ? 'border-accent bg-accent dark:border-accent-dark dark:bg-accent-dark'
                    : 'border-border/80 bg-surface dark:border-border-dark dark:bg-surface-dark',
                )}
              >
                <Text
                  className={cn(
                    'text-xs font-semibold',
                    active ? 'text-on-accent' : 'text-ink dark:text-ink-dark',
                  )}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
          <Text className="ml-2 text-xs text-muted dark:text-muted-dark">
            {selectedDays.length === 7 ? '每天' : `每周 ${selectedDays.length} 天`}
          </Text>
        </View>
      </View>

      {/* Optional time window */}
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
        <View className="flex-row items-end gap-2">
          <FormField label="开始时间" className="flex-1">
            <PickerField
              label="时间窗口开始"
              value={windowStart}
              placeholder="开始时间"
              onPress={() => setOpenPicker('windowStart')}
            />
          </FormField>
          <FormField label="结束时间" className="flex-1">
            <PickerField
              label="时间窗口结束"
              value={windowEnd}
              placeholder="结束时间"
              onPress={() => setOpenPicker('windowEnd')}
            />
          </FormField>
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

      <View className="flex-row gap-2">
        <Button label="保存" disabled={!canSubmit} onPress={() => void save()} />
        <Button label="取消" variant="secondary" onPress={onDone} />
      </View>

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
