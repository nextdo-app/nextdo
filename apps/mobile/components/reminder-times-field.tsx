/**
 * ReminderTimesField — the multi-select 「提醒时间」 field (task 10-26).
 *
 * One action may remind at several moments (calendar-style: 「提前一天」 plus
 * 「当天早上」 plus 「一小时前」). Each picked moment is one chip with its own
 * remove button; the 「添加提醒」 row opens the same `DateTimePicker` the
 * single-value field used.
 *
 * Presentational on purpose: the values and the mutations come from
 * `useActionReminderField` (hooks/use-action-reminder.ts), so the picker
 * modal stays owned by the form that already renders a deadline picker —
 * one `DateTimePicker` instance per form, not one per chip.
 */
import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { cn } from '@nextdo/ui';

import { formatDateTimeValue, type ReminderValues } from '@/lib/datetime-field';

export interface ReminderTimesFieldProps {
  /** Picker values (`YYYY-MM-DDTHH:mm`), earliest first. */
  values: ReminderValues;
  /** Open the form's `DateTimePicker` to append one moment. */
  onAdd: () => void;
  /** Drop the moment at `index`. */
  onRemove: (index: number) => void;
}

export function ReminderTimesField({ values, onAdd, onRemove }: ReminderTimesFieldProps) {
  return (
    <View className="gap-2">
      {values.length === 0 ? (
        <Text className="font-sans text-sm text-muted dark:text-muted-dark">不提醒</Text>
      ) : (
        <View className="flex-row flex-wrap gap-2">
          {values.map((value, index) => (
            <View
              key={value}
              className="flex-row items-center gap-1 rounded-full border border-border/80 bg-surface pl-3 pr-1.5 py-1 dark:border-border-dark dark:bg-surface-dark"
            >
              <Text className="font-sans text-sm text-ink dark:text-ink-dark">
                {formatDateTimeValue(value)}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`移除提醒 ${formatDateTimeValue(value)}`}
                onPress={() => onRemove(index)}
                className="h-6 w-6 items-center justify-center rounded-full"
                hitSlop={6}
              >
                <Ionicons name="close" size={14} color="#8a8a8e" />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="添加提醒时间"
        onPress={onAdd}
        className={cn(
          'flex-row items-center justify-center gap-1 rounded-md border border-dashed border-border/80 py-2 dark:border-border-dark',
        )}
      >
        <Ionicons name="add" size={16} color="#8a8a8e" />
        <Text className="font-sans text-sm text-muted dark:text-muted-dark">添加提醒</Text>
      </Pressable>
    </View>
  );
}
