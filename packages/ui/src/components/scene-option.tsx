import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { cn } from '../lib/cn';

export interface SceneOptionProps {
  /** The scene display name (e.g. "office", "computer"). */
  label: string;
  /** Selection state. Selected shows accent background, border, shadow, and checkmark. */
  selected: boolean;
  /** Tappable click/press handler. */
  onPress: () => void;
  /** Custom accessibility label. Defaults to `${selected ? '取消场景' : '选择场景'}：${label}`. */
  accessibilityLabel?: string;
  /** Optional extra classes for screen-specific layout (built with `cn`). */
  className?: string;
}

export const SCENE_OPTION_HIT_SLOP = { top: 6, bottom: 6, left: 4, right: 4 } as const;

export const SCENE_OPTION_UNSELECTED_CLASS =
  'h-8 flex-row items-center rounded-full border border-border/80 bg-surface px-3.5 active:bg-surface-container shrink-0 dark:border-border-dark dark:bg-surface-dark dark:active:bg-surface-container-dark';

export const SCENE_OPTION_SELECTED_CLASS =
  'h-8 flex-row items-center rounded-full border border-accent bg-accent px-3.5 shadow-xs shrink-0 dark:border-accent-dark dark:bg-accent-dark';

/**
 * SceneOption — Paper Serenity interactive scene selector pill (32px height,
 * fully-rounded pill with uniform unselected surface styling and accent fill + checkmark on selection).
 *
 * Used in:
 * - "现在" tab filter engine
 * - "收集箱厘清" (clarify wizard) execution context multi-select
 */
export const SceneOption = memo(function SceneOption({
  label,
  selected,
  onPress,
  accessibilityLabel,
  className,
}: SceneOptionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ?? `${selected ? '取消场景' : '选择场景'}：${label}`
      }
      accessibilityState={{ selected }}
      hitSlop={SCENE_OPTION_HIT_SLOP}
      onPress={onPress}
      className={cn(
        selected ? SCENE_OPTION_SELECTED_CLASS : SCENE_OPTION_UNSELECTED_CLASS,
        className,
      )}
    >
      {selected ? (
        <View className="mr-1.5 h-3.5 w-3.5 items-center justify-center rounded-full bg-on-accent/25 dark:bg-on-accent-dark/25">
          <Text className="font-sans text-[10px] font-bold leading-none text-on-accent dark:text-on-accent-dark">
            ✓
          </Text>
        </View>
      ) : null}
      <Text
        numberOfLines={1}
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
