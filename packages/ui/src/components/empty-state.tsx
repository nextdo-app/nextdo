import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { cn } from '../lib/cn';

export interface EmptyStateProps {
  /** What is empty, in plain words ("Inbox is empty"). */
  title: string;
  /** One line of context about what will appear here. */
  hint?: string;
  /** Optional action slot (a `Button`). */
  children?: ReactNode;
  /** Optional container style override. */
  className?: string;
}

/** Centered empty state for list screens. */
export function EmptyState({ title, hint, children, className }: EmptyStateProps) {
  return (
    <View className={cn('flex-1 items-center justify-center gap-2 p-8', className)}>
      <Text className="text-base font-medium text-ink dark:text-ink-dark">{title}</Text>
      {hint !== undefined ? (
        <Text className="text-center text-sm text-muted dark:text-muted-dark">{hint}</Text>
      ) : null}
      {children}
    </View>
  );
}
