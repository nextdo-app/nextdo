import { Text, View } from 'react-native';

import { cn } from '../lib/cn';

export type TagTone = 'neutral' | 'accent' | 'warning' | 'danger';

export interface TagProps {
  label: string;
  tone?: TagTone;
  /** A small live-indicator dot before the label (the "正在澄清" badge in
   *  the Paper Serenity mockup, gtd_1). */
  dot?: boolean;
  /** A trailing solid count badge (the "待处理" count in the mockup, gtd_2). */
  count?: number;
  className?: string;
}

/**
 * Small non-interactive label chip (status, kind, flags) — Paper Serenity
 * badge: 22px pill, 11px / weight 500 label, SOLID warm fills from the
 * design baseline (neutral = surface-container, accent = secondary-fixed,
 * warning = the amber earth tone — no washed-out alpha tints).
 */
const BG_CLASSES: Record<TagTone, string> = {
  neutral: 'bg-surface-container dark:bg-surface-container-dark',
  accent: 'bg-secondary-fixed dark:bg-secondary-fixed-dark',
  warning: 'bg-tag-earth-3-bg dark:bg-warning-dark/20',
  danger: 'bg-danger/15',
};

const TEXT_CLASSES: Record<TagTone, string> = {
  neutral: 'text-muted dark:text-ink-dark font-medium',
  accent: 'text-accent dark:text-accent-dark font-medium',
  warning: 'text-tag-earth-3-text dark:text-warning-dark font-medium',
  danger: 'text-danger font-medium',
};

export function Tag({ label, tone = 'neutral', dot = false, count, className }: TagProps) {
  return (
    <View
      accessibilityRole="text"
      className={cn(
        'min-h-[22px] flex-row items-center gap-1 rounded-full px-2.5 py-0.5',
        BG_CLASSES[tone],
        className,
      )}
    >
      {dot ? <View className="h-1.5 w-1.5 rounded-full bg-accent dark:bg-accent-dark" /> : null}
      <Text className={cn('text-[11px] leading-tight', TEXT_CLASSES[tone])} numberOfLines={1}>
        {label}
      </Text>
      {count !== undefined ? (
        <View className="min-h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 dark:bg-accent-dark">
          <Text className="text-[10px] font-bold text-on-accent dark:text-on-accent-dark">{count}</Text>
        </View>
      ) : null}
    </View>
  );
}
