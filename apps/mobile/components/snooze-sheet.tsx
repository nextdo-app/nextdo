/**
 * Snooze choice sheet (acceptance feedback 2026-10-01, supersedes the
 * 09-22-app-ui-screens design §4.7 four-option list): ONE common shortcut
 * (10 分钟后) + 自定义时间 (the app's DateTimePicker 'datetime' mode —
 * 7-day strip + two-column Hour/Minute selector, device-local).
 *
 * Shared by the Now screen and the project detail. A confirmed custom
 * target in the past is rejected with an inline message — a past reminder
 * row would fire within the desktop grace window / fail the native OS
 * schedule (R7: past rows are never (re)scheduled).
 */
import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useAppInsets } from '@/lib/use-app-insets';
import { Button } from '@nextdo/ui';
import { DateTimePicker } from '@/components/datetime-picker';
import {
  commonSnoozeOption,
  customSnoozeSeed,
  parseLocalDateTimeString,
} from '@/lib/snooze-options';

export interface SnoozeSheetProps {
  open: boolean;
  /** Wall clock used for seed & common shortcut (hook-guidelines Rule 4). */
  now: Date;
  onSelect: (target: Date) => void;
  onClose: () => void;
}

function formatTargetTime(target: Date, now: Date): string {
  const sameDay =
    target.getFullYear() === now.getFullYear() &&
    target.getMonth() === now.getMonth() &&
    target.getDate() === now.getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  const hhmm = `${pad(target.getHours())}:${pad(target.getMinutes())}`;
  if (sameDay) return `今天 ${hhmm}`;

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    target.getFullYear() === tomorrow.getFullYear() &&
    target.getMonth() === tomorrow.getMonth() &&
    target.getDate() === tomorrow.getDate();
  if (isTomorrow) return `明天 ${hhmm}`;

  return `${target.getMonth() + 1}月${target.getDate()}日 ${hhmm}`;
}

export function SnoozeSheet({ open, now, onSelect, onClose }: SnoozeSheetProps) {
  const insets = useAppInsets();
  const bottomPadding = Math.max(insets.bottom, 16);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerValue, setPickerValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  // The sheet stays mounted (the parent flips `open`) — reset the
  // transient picker state every time it opens fresh.
  useEffect(() => {
    if (open) {
      setPickerOpen(false);
      setPickerValue('');
      setError(null);
    }
  }, [open]);

  const common = commonSnoozeOption(now);

  function openCustomPicker() {
    setError(null);
    setPickerValue(customSnoozeSeed(now));
    setPickerOpen(true);
  }

  function confirmCustom(value: string) {
    const target = parseLocalDateTimeString(value);
    if (target === null) return;
    if (target.getTime() <= now.getTime()) {
      setError('所选时间已过，请选晚于现在的时间');
      return;
    }
    onSelect(target);
    onClose();
  }

  return (
    <>
      <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
        <View className="flex-1 justify-end bg-black/40 md:items-center md:justify-center md:p-6">
          <Pressable className="flex-1" onPress={onClose} />
          <View className="w-full items-center md:contents">
            <View
              style={{ paddingBottom: bottomPadding }}
              className="w-full max-w-lg gap-3.5 rounded-t-[32px] border-t border-border/80 bg-surface p-6 shadow-2xl dark:border-border-dark/80 dark:bg-surface-dark md:rounded-2xl md:border"
            >
              {/* Top drag handle indicator on mobile */}
              <View className="mx-auto mb-1 h-1.5 w-12 rounded-full bg-border/80 dark:bg-border-dark/80 md:hidden" />

              <View className="flex-row items-center justify-between pb-1">
                <View className="gap-0.5">
                  <Text className="font-sans text-lg font-bold text-ink dark:text-ink-dark">
                    稍后提醒
                  </Text>
                  <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                    选择何时重新提醒
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="关闭"
                  onPress={onClose}
                  className="h-8 w-8 items-center justify-center rounded-full bg-surface-container/60 active:bg-surface-container dark:bg-surface-container-dark/60"
                >
                  <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
                    ✕
                  </Text>
                </Pressable>
              </View>

              <View className="gap-3">
                {/* 10 分钟后 shortcut card */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${common.label}（${formatTargetTime(common.target, now)}）`}
                  className="flex-row items-center justify-between rounded-2xl border border-border/70 bg-surface-container/40 p-4 active:bg-surface-container/80 dark:border-border-dark/70 dark:bg-surface-container-dark/40 dark:active:bg-surface-container-dark/80"
                  onPress={() => {
                    onSelect(common.target);
                    onClose();
                  }}
                >
                  <View className="flex-row items-center gap-3.5">
                    <View className="h-10 w-10 items-center justify-center rounded-xl bg-accent/10 dark:bg-accent-dark/15">
                      <Text className="font-sans text-base">⚡</Text>
                    </View>
                    <View className="gap-0.5">
                      <Text className="font-sans text-base font-bold text-ink dark:text-ink-dark">
                        {common.label}
                      </Text>
                      <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                        常用快捷档位
                      </Text>
                    </View>
                  </View>
                  <View className="rounded-full border border-accent/25 bg-accent/10 px-3 py-1.5 dark:border-accent-dark/30 dark:bg-accent-dark/15">
                    <Text className="font-sans text-xs font-bold text-accent dark:text-accent-dark">
                      {formatTargetTime(common.target, now)}
                    </Text>
                  </View>
                </Pressable>

                {/* 自定义时间 card */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="自定义时间"
                  className="flex-row items-center justify-between rounded-2xl border border-border/70 bg-surface-container/40 p-4 active:bg-surface-container/80 dark:border-border-dark/70 dark:bg-surface-container-dark/40 dark:active:bg-surface-container-dark/80"
                  onPress={openCustomPicker}
                >
                  <View className="flex-row items-center gap-3.5">
                    <View className="h-10 w-10 items-center justify-center rounded-xl bg-surface-container dark:bg-surface-container-dark">
                      <Text className="font-sans text-base">⏱</Text>
                    </View>
                    <View className="gap-0.5">
                      <Text className="font-sans text-base font-bold text-ink dark:text-ink-dark">
                        自定义时间
                      </Text>
                      <Text className="font-sans text-xs text-muted dark:text-muted-dark">
                        自选日期和时刻
                      </Text>
                    </View>
                  </View>
                  <View className="rounded-full bg-surface-container/60 px-3 py-1.5 dark:bg-surface-container-dark/60">
                    <Text className="font-sans text-xs font-bold text-accent dark:text-accent-dark">
                      选择 ›
                    </Text>
                  </View>
                </Pressable>
              </View>

              {error !== null ? (
                <View className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3">
                  <Text className="font-sans text-sm font-semibold text-danger dark:text-danger-dark">
                    {error}
                  </Text>
                </View>
              ) : null}

              <View className="pt-1">
                <Button label="取消" variant="secondary" onPress={onClose} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
      {pickerOpen ? (
        <DateTimePicker
          mode="datetime"
          title="自定义提醒时间"
          value={pickerValue}
          now={now}
          onConfirm={confirmCustom}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </>
  );
}
