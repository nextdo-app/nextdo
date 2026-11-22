/**
 * Edit Action Modal (Issue #19).
 * Bottom sheet modal for editing a NextAction (title, estMinutes, value, deadline).
 * Can be triggered from the Now screen or any other list.
 */
import { memo, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, MarkdownNote, ValueChips, cn, colors } from '@nextdo/ui';
import {
  hhmmToMinutes,
  parseHhmm,
  type NextAction,
  type Value,
} from '@nextdo/core';
import { DateTimePicker } from '@/components/datetime-picker';
import { PickerField } from '@/components/picker-field';
import { useActionDependencyOptions } from '@/hooks/use-action-dependency-options';
import { useAppClock } from '@/hooks/use-app-clock';
import { useUpdateNextAction } from '@/hooks/use-update-next-action';
import { useAppInsets } from '@/lib/use-app-insets';
import { useAppTheme } from '@/lib/theme';
import { localDateTimeKey, localDateTimeToIso } from '@/lib/clarify-flow';
import { formatDateTimeValue } from '@/lib/datetime-field';
import { useActionReminderField } from '@/hooks/use-action-reminder';
import { ReminderTimesField } from '@/components/reminder-times-field';
import { errorMessage } from '@/lib/error-messages';

export interface EditActionModalProps {
  action: NextAction | null;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const EST_CHIPS = [5, 10, 20, 30, 60, 120] as const;

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Device-local week labels, Monday first (matches the habit editor). */
const WEEKDAYS = [
  { day: 1, label: '一' },
  { day: 2, label: '二' },
  { day: 3, label: '三' },
  { day: 4, label: '四' },
  { day: 5, label: '五' },
  { day: 6, label: '六' },
  { day: 0, label: '日' },
] as const;

const CHIP_HIT_SLOP = { top: 6, bottom: 6, left: 4, right: 4 } as const;

function hhmmMinutes(value: string): number | null {
  try {
    return hhmmToMinutes(parseHhmm(value));
  } catch {
    return null;
  }
}

const INPUT_CLASS =
  'rounded-xl border border-border/80 bg-surface px-3.5 py-3 text-base text-ink placeholder:text-muted shadow-2xs focus:border-accent dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

function EstChip({
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
      accessibilityLabel={`预估 ${label} 分钟`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={cn(
        'h-8 min-w-[36px] px-2.5 items-center justify-center rounded-full border',
        active
          ? 'border-accent bg-accent dark:border-accent-dark dark:bg-accent-dark'
          : 'border-border bg-surface dark:border-border-dark dark:bg-surface-dark',
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
}

function DependencyChip({
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
      accessibilityLabel={`依赖：${label}`}
      accessibilityState={{ selected: active }}
      hitSlop={CHIP_HIT_SLOP}
      onPress={onPress}
      className={cn(
        'min-h-[32px] items-center justify-center rounded-full border px-3 py-1',
        active
          ? 'border-accent bg-accent dark:border-accent-dark dark:bg-accent-dark'
          : 'border-border bg-surface dark:border-border-dark dark:bg-surface-dark',
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
}

export const EditActionModal = memo(function EditActionModal({
  action,
  visible,
  onClose,
  onSaved,
}: EditActionModalProps) {
  const now = useAppClock();
  const { isDark } = useAppTheme();
  const { update, error } = useUpdateNextAction();

  const [title, setTitle] = useState('');
  const [estMinutes, setEstMinutes] = useState<number | null>(null);
  const [value, setValue] = useState<Value>(3);
  const [deadline, setDeadline] = useState('');
  /** Issue #63: free-form note — the detail the user would otherwise have to
   *  dig out of the original message or file. */
  const [note, setNote] = useState('');
  /** Task 10-22: the note box edits RAW Markdown; this toggles the read-only
   *  rendered view. Reset with the rest of the form when another action loads,
   *  so reopening the modal never lands on a stale preview. */
  const [notePreview, setNotePreview] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [customEst, setCustomEst] = useState('');
  const [submitting, setSubmitting] = useState(false);
  /** Issue #98: day mask + optional time range. */
  const [selectedDays, setSelectedDays] = useState<number[]>([...ALL_DAYS]);
  const [windowOn, setWindowOn] = useState(false);
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [timePicker, setTimePicker] = useState<'start' | 'end' | null>(null);
  const [dependsOnId, setDependsOnId] = useState('');
  /** Issue #98 review: a field enters the save patch only after the user
   *  edits it. Untouched keys are omitted, so a stale form snapshot — or a
   *  failed dependency-candidate read — cannot undo a value another tab or
   *  device wrote while this editor was open. */
  const [windowTouched, setWindowTouched] = useState(false);
  const [daysTouched, setDaysTouched] = useState(false);
  const [dependencyTouched, setDependencyTouched] = useState(false);
  // Task 10-17: the stored reminder loads once per action; the save only
  // touches the row when the user changed the field (see `reminder.write`).
  const reminder = useActionReminderField({
    actionId: action?.id ?? null,
    deadlineValue: deadline,
    now,
  });
  const dependencyOptions = useActionDependencyOptions(action?.id ?? null);
  // Must run before the `!visible` return below: the modal mounts hidden, so
  // calling this hook only when visible would change the hook order.
  const insets = useAppInsets();

  useEffect(() => {
    if (action !== null) {
      setTitle(action.title);
      setEstMinutes(action.estMinutes);
      setValue(action.value);
      setDeadline(
        action.deadline === undefined || action.deadline === null
          ? ''
          : localDateTimeKey(action.deadline),
      );
      setCustomEst('');
      setNote(action.note ?? '');
      setNotePreview(false);
      setSelectedDays(action.windowDays ?? [...ALL_DAYS]);
      setWindowOn(action.windowStart !== undefined || action.windowEnd !== undefined);
      setWindowStart(action.windowStart ?? '');
      setWindowEnd(action.windowEnd ?? '');
      setDependsOnId(action.dependsOnId ?? '');
      setWindowTouched(false);
      setDaysTouched(false);
      setDependencyTouched(false);
    }
  }, [action]);

  if (!visible || action === null) return null;

  const applyCustomEst = () => {
    const parsed = Number(customEst);
    if (Number.isFinite(parsed) && parsed >= 1) setEstMinutes(Math.round(parsed));
    setCustomEst('');
  };

  const startMinutes = hhmmMinutes(windowStart.trim());
  const endMinutes = hhmmMinutes(windowEnd.trim());
  // An untouched window keeps the stored shape, including the single-sided
  // window the data layer allows (engine filters handle either bound). Once
  // the user edits it, both ends are required and start must precede end.
  const windowValid =
    !windowTouched ||
    !windowOn ||
    (startMinutes !== null && endMinutes !== null && startMinutes < endMinutes);
  const windowHint =
    windowTouched && windowOn && !windowValid
      ? '时间窗口需要完整的起止时间，且开始早于结束。'
      : null;
  const daysValid = !daysTouched || selectedDays.length > 0;

  // Done NextAction dependencies stay selectable so an already-satisfied
  // dependency can be kept (or cleared). A stored id that is not in this
  // NextAction list is NOT cleared: it may name a completed calendar action
  // or habit, which the engine also accepts as satisfied (issue #98 review).
  const dependencyRows = dependencyOptions.data;
  const currentDependency =
    dependsOnId === '' ? undefined : dependencyRows?.find((row) => row.id === dependsOnId);
  const dependencyChoices =
    dependencyRows?.filter((row) => row.status === 'open' || row.id === dependsOnId) ?? [];
  const dependencyMissing =
    !dependencyTouched &&
    dependsOnId !== '' &&
    dependencyRows !== null &&
    currentDependency === undefined;

  const canSubmit =
    title.trim() !== '' && estMinutes !== null && windowValid && daysValid && !submitting;

  const toggleDay = (day: number) => {
    setDaysTouched(true);
    setSelectedDays((previous) =>
      previous.includes(day)
        ? previous.filter((value) => value !== day)
        : [...previous, day].sort((a, b) => a - b),
    );
  };

  const chooseDependency = (id: string) => {
    setDependencyTouched(true);
    setDependsOnId(id);
  };

  const handleSave = async () => {
    if (!canSubmit || estMinutes === null) return;
    const deadlineIso = deadline === '' ? undefined : (localDateTimeToIso(deadline) ?? undefined);
    setSubmitting(true);
    const ok = await update({
      action,
      patch: {
        title: title.trim(),
        estMinutes,
        value,
        deadline: deadlineIso,
        // An emptied note is `''`, not `undefined`: the patch is a full-row
        // write, so `undefined` would leave the old text in place.
        note: note.trim(),
        ...(reminder.write !== undefined ? { reminderAt: reminder.write } : {}),
        // Issue #98: only fields the user edited are sent. An omitted key
        // keeps the current row value inside the write transaction; an
        // explicit `undefined` clears it ("无依赖" / window switched off).
        ...(dependencyTouched
          ? { dependsOnId: dependsOnId === '' ? undefined : dependsOnId }
          : {}),
        ...(windowTouched
          ? windowOn
            ? { windowStart: windowStart.trim(), windowEnd: windowEnd.trim() }
            : { windowStart: undefined, windowEnd: undefined }
          : {}),
        ...(daysTouched
          ? { windowDays: selectedDays.length === 7 ? undefined : selectedDays }
          : {}),
      },
    });
    setSubmitting(false);
    if (ok) {
      onSaved();
      onClose();
    }
  };

  const bottomPadding = Math.max(insets.bottom, 12);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end bg-black/40 md:items-center md:justify-center md:p-6"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭弹窗遮罩"
          onPress={onClose}
          className="flex-1"
        />

        <View
          style={{ paddingBottom: bottomPadding }}
          className="max-h-[90%] w-full rounded-t-3xl border-t border-border/80 bg-surface p-5 pt-3 shadow-2xl dark:border-border-dark dark:bg-surface-dark md:max-h-[85vh] md:max-w-lg md:rounded-2xl md:border md:p-6"
        >
          {/* Top drag handle indicator (mobile only) */}
          <View className="mx-auto mb-3 h-1 w-10 rounded-full bg-border dark:bg-border-dark md:hidden" />

          {/* Modal Header */}
          <View className="mb-3.5 flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Text className="font-display text-base font-bold tracking-tight text-ink dark:text-ink-dark">
                编辑行动
              </Text>
              <View className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 dark:border-accent-dark/40 dark:bg-accent-dark/20">
                <Text className="font-sans text-[11px] font-medium text-accent dark:text-accent-dark">
                  即时保存
                </Text>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={onClose}
              className="h-7 w-7 items-center justify-center rounded-full bg-surface-container active:scale-95 dark:bg-surface-container-dark"
            >
              <Ionicons name="close" size={16} color={isDark ? colors.mutedDark : colors.muted} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} className="gap-3.5">
            {/* Field 1: Title */}
            <View className="gap-1.5">
              <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                行动名称
              </Text>
              <TextInput
                className={INPUT_CLASS}
                placeholder="下一步行动（具体的、单步的）"
                value={title}
                onChangeText={setTitle}
                accessibilityLabel="行动名称输入框"
              />
            </View>

            {/* Field 2: Estimate Minutes */}
            <View className="gap-1.5">
              <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                预估时长（分钟）
              </Text>
              <View className="flex-row flex-wrap items-center gap-2">
                {EST_CHIPS.map((chip) => (
                  <EstChip
                    key={chip}
                    label={String(chip)}
                    active={estMinutes === chip}
                    onPress={() => setEstMinutes(chip)}
                  />
                ))}
                <TextInput
                  className={`${INPUT_CLASS} h-8 min-w-[76px] px-2 py-0 text-xs`}
                  style={{ minWidth: 76, paddingVertical: 0, paddingHorizontal: 8, textAlignVertical: 'center' }}
                  placeholder="自定义"
                  keyboardType="number-pad"
                  value={customEst}
                  onChangeText={setCustomEst}
                  onSubmitEditing={applyCustomEst}
                  onBlur={applyCustomEst}
                />
              </View>
            </View>

            {/* Field 3: Value */}
            <View className="gap-1.5">
              <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                重要性价值（1~5）
              </Text>
              <ValueChips value={value} onChange={setValue} />
            </View>

            {/* Field 5: Deadline (task 10-17 — a date, plus a time) */}
            <View className="gap-1.5">
              <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                截止时间
              </Text>
              <PickerField
                label="截止时间"
                value={formatDateTimeValue(deadline)}
                placeholder="截止时间（可选）"
                onPress={() => setShowPicker(true)}
                onClear={() => setDeadline('')}
              />
            </View>

            {/* Issue #98: day mask + optional time range. The engine filters
                on both before recommending; all 7 days / no range = no
                restriction. */}
            <View className="gap-1.5">
              <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                适用日
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
                <Text className="ml-2 font-sans text-xs text-muted dark:text-muted-dark">
                  {selectedDays.length === 7 ? '每天' : `每周 ${selectedDays.length} 天`}
                </Text>
              </View>
              {daysTouched && !daysValid ? (
                <Text className="font-sans text-xs text-danger dark:text-danger-dark">
                  至少选择一天。
                </Text>
              ) : null}
            </View>

            <View className="gap-1.5">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={windowOn ? '关闭时间段' : '开启时间段'}
                accessibilityState={{ selected: windowOn }}
                hitSlop={CHIP_HIT_SLOP}
                onPress={() => {
                  setWindowTouched(true);
                  setWindowOn((previous) => !previous);
                }}
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
                  限定时间段（不开启 = 全天可执行）
                </Text>
              </Pressable>
              {windowOn ? (
                <View className="flex-row items-end gap-2">
                  <View className="flex-1 gap-1.5">
                    <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                      开始时间
                    </Text>
                    <PickerField
                      label="时间段开始"
                      value={windowStart}
                      placeholder="开始时间"
                      onPress={() => setTimePicker('start')}
                    />
                  </View>
                  <View className="flex-1 gap-1.5">
                    <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                      结束时间
                    </Text>
                    <PickerField
                      label="时间段结束"
                      value={windowEnd}
                      placeholder="结束时间"
                      onPress={() => setTimePicker('end')}
                    />
                  </View>
                </View>
              ) : null}
              {windowHint !== null ? (
                <Text className="font-sans text-xs text-danger dark:text-danger-dark">
                  {windowHint}
                </Text>
              ) : null}
            </View>

            {/* Issue #98: a single prerequisite. Done prerequisites stay
                visible/selectable — the engine treats them as satisfied. */}
            <View className="gap-1.5">
              <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                前置行动（可选）
              </Text>
              <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                前置行动完成前，这条行动不会进入 Now 推荐。
              </Text>
              {dependencyOptions.error !== null ? (
                <Text className="font-sans text-xs text-danger dark:text-danger-dark">
                  无法读取可依赖的行动，现有依赖保持不变。
                </Text>
              ) : dependencyRows === null ? (
                <Text className="font-sans text-xs text-muted dark:text-muted-dark">加载中…</Text>
              ) : (
                <View className="flex-row flex-wrap gap-2">
                  <DependencyChip
                    label="无依赖"
                    active={dependsOnId === ''}
                    onPress={() => chooseDependency('')}
                  />
                  {dependencyChoices.map((row) => (
                    <DependencyChip
                      key={row.id}
                      label={row.status === 'done' ? `${row.title}（已完成）` : row.title}
                      active={dependsOnId === row.id}
                      onPress={() => chooseDependency(row.id)}
                    />
                  ))}
                </View>
              )}
              {dependencyMissing ? (
                <Text className="font-sans text-xs text-danger dark:text-danger-dark">
                  当前依赖不在可选列表中（可能是已完成的日历或习惯），保持不变。
                </Text>
              ) : null}
            </View>

            {/* Field 6: Reminder (task 10-17; multi-select since 10-26) */}
            <View className="gap-1.5">
              <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                提醒时间（可选）
              </Text>
              <ReminderTimesField
                values={reminder.values}
                onAdd={() => setShowReminderPicker(true)}
                onRemove={reminder.removeValue}
              />
            </View>

            {/* Field 7: Note (issue #63) — kept last: it is the long-form
                field, and putting it above the pickers would push them off a
                small screen. Task 10-22: the value stays RAW Markdown; the
                预览 toggle renders it through the same parser the lists use,
                so what the user checks here is what they will see. */}
            <View className="gap-1.5">
              <View className="flex-row items-center justify-between">
                <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                  备注
                </Text>
                {note.trim() !== '' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={notePreview ? '返回编辑备注' : '预览备注'}
                    onPress={() => setNotePreview((previous) => !previous)}
                    className="px-1 py-0.5"
                  >
                    <Text className="font-sans text-xs font-semibold text-accent dark:text-accent-dark">
                      {notePreview ? '编辑' : '预览'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              {notePreview ? (
                <View className="rounded-xl border border-border/80 bg-surface-container/40 px-3.5 py-3 dark:border-border-dark dark:bg-surface-container-dark/40">
                  <MarkdownNote value={note} />
                </View>
              ) : (
                <TextInput
                  className={`${INPUT_CLASS} min-h-[88px]`}
                  style={{ minHeight: 88, textAlignVertical: 'top' }}
                  placeholder="记下关键信息：链接、编号、对方说了什么……（支持 **粗体**、列表、`代码`）"
                  value={note}
                  onChangeText={setNote}
                  multiline
                  accessibilityLabel="备注输入框"
                  accessibilityHint="支持 Markdown，写的内容会一并写入系统日历事件"
                />
              )}
            </View>

            {error !== null ? (
              <Text className="font-sans text-xs text-danger dark:text-danger-dark">
                {errorMessage(error)}
              </Text>
            ) : null}
          </ScrollView>

          {/* Ergonomic Action Buttons: anchored at the bottom thumb zone */}
          <View className="mt-3 flex-row gap-2.5 border-t border-border/40 pt-3 dark:border-border-dark/40">
            <Button
              label="保存修改"
              className="flex-1"
              disabled={!canSubmit}
              onPress={() => void handleSave()}
            />
            <Button
              label="取消"
              variant="secondary"
              onPress={onClose}
            />
          </View>

          {showPicker ? (
            <DateTimePicker
              mode="datetime"
              title="选择截止时间"
              value={deadline}
              now={now}
              onConfirm={(val) => {
                setDeadline(val);
                setShowPicker(false);
              }}
              onClose={() => setShowPicker(false)}
            />
          ) : null}

          {showReminderPicker ? (
            <DateTimePicker
              mode="datetime"
              title="选择提醒时间"
              value=""
              now={now}
              onConfirm={(val) => {
                reminder.addValue(val);
                setShowReminderPicker(false);
              }}
              onClose={() => setShowReminderPicker(false)}
            />
          ) : null}

          {timePicker !== null ? (
            <DateTimePicker
              mode="time"
              title={timePicker === 'start' ? '选择开始时间' : '选择结束时间'}
              value={timePicker === 'start' ? windowStart : windowEnd}
              now={now}
              onConfirm={(val) => {
                setWindowTouched(true);
                if (timePicker === 'start') setWindowStart(val);
                else setWindowEnd(val);
                setTimePicker(null);
              }}
              onClose={() => setTimePicker(null)}
            />
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});
