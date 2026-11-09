import { useId, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { cn } from '../lib/cn';
import { ProgressBar } from './progress-bar';

export interface FocusIslandProps {
  title: string;
  clock: string;
  stateLabel: string;
  expanded: boolean;
  onToggle: () => void;
  /** Opt in only for the desktop menu-bar capsule; touch layouts keep their size. */
  isCompact?: boolean;
  progress?: number | null;
  children?: ReactNode;
  className?: string;
}

/** Shared capsule; time and commands are owned by its host, never this view. */
export function FocusIsland({
  title,
  clock,
  stateLabel,
  expanded,
  onToggle,
  isCompact = false,
  progress = null,
  children,
  className,
}: FocusIslandProps) {
  const compact = isCompact && !expanded;
  const descriptionId = useId();
  return (
    <View
      className={cn(
        'w-full overflow-hidden border border-border bg-surface shadow-lg dark:border-border-dark dark:bg-surface-dark',
        compact ? 'h-8 rounded-b-xl' : expanded ? 'rounded-3xl' : 'rounded-full',
        className,
      )}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? '收起专注岛' : '展开专注岛'}
        accessibilityState={{ expanded }}
        aria-describedby={compact ? descriptionId : undefined}
        aria-expanded={expanded}
        onPress={onToggle}
        className={cn(
          'flex-row items-center active:opacity-80',
          compact ? 'flex-1 gap-2 px-3' : 'min-h-16 gap-3 px-5 py-3',
        )}
      >
        {compact ? (
          <Text className="shrink-0 font-sans text-xs text-muted dark:text-muted-dark">
            {stateLabel}
          </Text>
        ) : (
          <View className="h-3 w-3 shrink-0 rounded-full bg-accent dark:bg-accent-dark" />
        )}
        <View className="min-w-0 flex-1 gap-1">
          <Text
            numberOfLines={expanded ? undefined : 1}
            className={cn(
              'font-sans font-semibold text-ink dark:text-ink-dark',
              compact ? 'text-xs' : 'text-sm',
            )}
          >
            {title}
          </Text>
          {!compact ? (
            <Text className="font-sans text-xs text-muted dark:text-muted-dark">{stateLabel}</Text>
          ) : null}
        </View>
        <Text
          className={cn(
            'shrink-0 font-mono font-bold text-ink dark:text-ink-dark',
            compact ? 'text-sm' : 'text-xl',
          )}
        >
          {clock}
        </Text>
        {!compact ? (
          <Text accessibilityElementsHidden className="text-sm text-muted dark:text-muted-dark">
            {expanded ? '⌃' : '⌄'}
          </Text>
        ) : null}
      </Pressable>
      {compact ? (
        <Text nativeID={descriptionId} className="sr-only">
          {title}，{stateLabel}，{clock}
        </Text>
      ) : null}
      {progress !== null ? (
        <View
          pointerEvents={compact ? 'none' : undefined}
          className={compact ? 'absolute inset-x-0 bottom-0 h-0.5 overflow-hidden' : undefined}
        >
          <ProgressBar value={progress} className="h-1 rounded-none" />
        </View>
      ) : null}
      {expanded && children ? <View className="gap-4 px-5 pb-5 pt-4">{children}</View> : null}
    </View>
  );
}
