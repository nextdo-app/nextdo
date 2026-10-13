import { Pressable, Text } from 'react-native';

import { cn } from '../lib/cn';

export interface ButtonProps {
  /** Visible label; also the accessibility label (names the action). */
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'tinted';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  className?: string;
}

const VARIANT_CLASSES: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-accent active:opacity-85 dark:bg-accent-dark',
  secondary:
    'border border-border bg-surface active:bg-surface/80 active:opacity-80 dark:border-border-dark dark:bg-surface-dark',
  ghost: 'bg-transparent active:opacity-60',
  tinted: 'bg-accent/15 active:bg-accent/25 dark:bg-accent-dark/20',
};

const VARIANT_TEXT_CLASSES: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'text-on-accent dark:text-on-accent-dark font-semibold',
  secondary: 'text-ink dark:text-ink-dark font-medium',
  ghost: 'text-accent dark:text-accent-dark font-medium',
  tinted: 'text-accent dark:text-accent-dark font-semibold',
};

const SIZE_CLASSES: Record<NonNullable<ButtonProps['size']>, string> = {
  // DESIGN 8px button tier (Paper Serenity): sm/md → rounded-md (8px),
  // lg → rounded-lg (12px). Mobile keeps touch-friendly target (>=44pt for md),
  // while desktop screen收敛 to compact ergonomics (h-8 / h-9 / h-11).
  sm: 'h-9 md:h-8 px-3 md:px-2.5 rounded-md',
  md: 'h-11 md:h-9 px-4 md:px-3.5 rounded-md',
  // lg: 56px hero CTA on mobile, 44px on desktop.
  lg: 'h-14 md:h-11 px-6 md:px-5 rounded-lg',
};

const SIZE_TEXT_CLASSES: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'text-xs',
  md: 'text-sm md:text-xs',
  lg: 'text-base md:text-sm',
};

/**
 * Tappable action button (Paper Serenity: terracotta primary, 8px/12px
 * radius tiers). Touch target ≥ 44pt (tokens.spacing.touch), labelled for
 * accessibility (component-guidelines).
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  className,
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={size === 'sm' ? { top: 4, bottom: 4, left: 4, right: 4 } : undefined}
      onPress={onPress}
      className={cn(
        'items-center justify-center',
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        disabled && 'opacity-40',
        className,
      )}
    >
      <Text className={cn(SIZE_TEXT_CLASSES[size], VARIANT_TEXT_CLASSES[variant])}>
        {label}
      </Text>
    </Pressable>
  );
}
