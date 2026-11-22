/**
 * Issue #101 — the capture preview for a parsed date/time suggestion.
 *
 * Shown under the capture input in both the quick-capture modal and the
 * inbox's inline card. The raw title is never rewritten: this row only
 * previews what Clarify will prefill, and every part of it is reversible
 * (切换类型 / 修改时间 / 撤销解析).
 */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  captureScheduleFromParts,
  describeCaptureSchedule,
  type CaptureSchedule,
  type CaptureScheduleKind,
} from '@nextdo/core';
import { Tag } from '@nextdo/ui';
import { DateTimePicker } from '@/components/datetime-picker';

export interface CaptureSchedulePreviewProps {
  schedule: CaptureSchedule;
  now: Date;
  /** Edited or type-switched suggestion. */
  onChange: (schedule: CaptureSchedule) => void;
  /** Discard the parse; the original text stays in the input. */
  onClear: () => void;
}

const KIND_LABELS: Record<CaptureScheduleKind, string> = {
  deadline: '截止',
  calendar: '日程',
};

export function CaptureSchedulePreview({
  schedule,
  now,
  onChange,
  onClear,
}: CaptureSchedulePreviewProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  function switchKind(kind: CaptureScheduleKind): void {
    if (kind === schedule.kind) return;
    const next = captureScheduleFromParts(
      kind,
      schedule.date,
      schedule.time,
      schedule.matchedText,
    );
    if (next !== null) onChange(next);
  }

  function confirm(value: string): void {
    const [date, time] = value.split('T');
    if (date === undefined) return;
    const next = captureScheduleFromParts(
      schedule.kind,
      date,
      time ?? null,
      schedule.matchedText,
    );
    if (next !== null) onChange(next);
  }

  return (
    <>
      <View className="mb-3.5 flex-row flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-border/60 bg-surface-container/40 px-3 py-2 dark:border-border-dark/60 dark:bg-surface-container-dark/40">
        <Tag label={describeCaptureSchedule(schedule, now)} tone="accent" />

        <View className="flex-row rounded-full bg-surface p-0.5 dark:bg-surface-dark">
          {(['deadline', 'calendar'] as const).map((kind) => {
            const active = schedule.kind === kind;
            return (
              <Pressable
                key={kind}
                accessibilityRole="button"
                accessibilityLabel={kind === 'deadline' ? '识别为截止时间' : '识别为日程'}
                accessibilityState={{ selected: active }}
                onPress={() => switchKind(kind)}
                className={
                  active
                    ? 'rounded-full bg-accent px-2 py-0.5 dark:bg-accent-dark'
                    : 'rounded-full px-2 py-0.5'
                }
              >
                <Text
                  className={
                    active
                      ? 'font-sans text-[11px] font-semibold text-on-accent dark:text-on-accent-dark'
                      : 'font-sans text-[11px] text-muted dark:text-muted-dark'
                  }
                >
                  {KIND_LABELS[kind]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="修改识别到的时间"
          hitSlop={6}
          onPress={() => setPickerOpen(true)}
        >
          <Text className="font-sans text-xs font-medium text-accent dark:text-accent-dark">
            修改
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="撤销时间解析"
          hitSlop={6}
          onPress={onClear}
        >
          <Text className="font-sans text-xs text-muted dark:text-muted-dark">撤销</Text>
        </Pressable>
      </View>

      {pickerOpen ? (
        <DateTimePicker
          mode="datetime"
          title="修改识别到的时间"
          value={`${schedule.date}T${schedule.time ?? '23:59'}`}
          now={now}
          onConfirm={(value) => {
            setPickerOpen(false);
            confirm(value);
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </>
  );
}
