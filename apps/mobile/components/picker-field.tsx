/**
 * A read-only field that opens the `DateTimePicker` modal.
 *
 * The app never hand-types a date or an `HH:mm` string (spec:
 * app/component-guidelines.md §Forms) — a text input for a value the
 * picker already owns is a defect, not a shortcut. This field is how a
 * form shows such a value: the current selection as text, plus an explicit
 * 「选择」 affordance rather than relying on colour alone.
 *
 * Lives in `components/` because issue #16 gave it a second and third
 * caller (the project create/edit forms); it was private to `app/habits.tsx`
 * until then.
 */
import { Pressable, Text, View } from 'react-native';
import { cn } from '@nextdo/ui';

/** Same token string the screens use for their own text inputs. */
const INPUT_CLASS =
  'rounded-md border border-border/80 bg-surface p-3 text-base text-ink placeholder:text-muted focus:border-accent dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

export interface PickerFieldProps {
  /** Field name, used in the accessibility label. */
  label: string;
  /** Current value in the target mode's format; '' means unset. */
  value: string;
  placeholder: string;
  onPress: () => void;
  /**
   * When provided, a 「清除」 button appears. The `DateTimePicker` modal
   * itself only offers 取消/确定 — clearing an optional field is the form's
   * job, not the modal's.
   */
  onClear?: () => void;
}

export function PickerField({
  label,
  value,
  placeholder,
  onPress,
  onClear,
}: PickerFieldProps) {
  const empty = value === '';
  return (
    <View className="flex-row items-center gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={empty ? `${label}，未选择` : `${label}，当前 ${value}`}
        onPress={onPress}
        className={cn(INPUT_CLASS, 'flex-1 flex-row items-center justify-between gap-2')}
      >
        <Text
          className={cn(
            'flex-1 font-sans text-base',
            empty
              ? 'text-muted dark:text-muted-dark'
              : 'text-ink dark:text-ink-dark',
          )}
          numberOfLines={1}
        >
          {empty ? placeholder : value}
        </Text>
        <Text className="font-sans text-xs font-semibold text-accent dark:text-accent-dark">
          选择
        </Text>
      </Pressable>
      {onClear !== undefined && !empty ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`清除${label}`}
          onPress={onClear}
          className="rounded-md px-2 py-2 active:opacity-60"
        >
          <Text className="font-sans text-xs font-semibold text-muted dark:text-muted-dark">
            清除
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}