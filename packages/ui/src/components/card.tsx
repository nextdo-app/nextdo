import type { ReactNode } from 'react';
import { View } from 'react-native';

import { cn } from '../lib/cn';

export type CardVariant = 'elevated' | 'outlined' | 'subtle';

export interface CardProps {
  children: ReactNode;
  /**
   * Card visual weight:
   * - `elevated`: Key focus cards with warm micro-border and soft shadow.
   * - `outlined`: Standard content areas with border only, no shadow.
   * - `subtle`: Low-emphasis background container without shadow.
   */
  variant?: CardVariant;
  /** Optional extra classes for screen-specific layout (built with `cn`). */
  className?: string;
}

const VARIANT_CLASSES: Record<CardVariant, string> = {
  elevated: 'border border-border/70 bg-surface shadow-sm dark:border-border-dark dark:bg-surface-dark',
  outlined: 'border border-border/70 bg-surface shadow-none dark:border-border-dark dark:bg-surface-dark',
  subtle: 'border border-border/40 bg-surface-container/60 shadow-none dark:border-border-dark/40 dark:bg-surface-container-dark/60',
};

/**
 * Surface card — Paper Serenity:
 * Supports distinct visual layers (elevated for primary hero cards, outlined for standard list rows, subtle for secondary areas).
 */
export function Card({ children, variant = 'elevated', className }: CardProps) {
  return (
    <View
      className={cn(
        'rounded-2xl p-4',
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
    </View>
  );
}
