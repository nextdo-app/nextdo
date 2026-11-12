import { useId, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { cn } from '../lib/cn';
import { ProgressBar } from './progress-bar';

/** Compact desktop pill follows the focus/break phase like the reference island. */
export type FocusIslandTone = 'focus' | 'break';

const TONE_COLORS: Record<FocusIslandTone, string> = {
  focus: '#e85d3a',
  break: '#3a9e6e',
};

// The desktop capsule window is 320x34; the ring mirrors the reference
// rounded-rect border. react-native-svg has no `pathLength`, so the
// rounded-rect perimeter is the dash length.
const PILL_WIDTH = 320;
const PILL_HEIGHT = 34;
const RING_INSET = 1.5;
const RING_RADIUS = PILL_HEIGHT / 2 - RING_INSET;
const RING_PERIMETER =
  2 * (PILL_WIDTH - 2 * RING_INSET) +
  2 * (PILL_HEIGHT - 2 * RING_INSET) +
  2 * Math.PI * RING_RADIUS;

export interface FocusIslandProps {
  title: string;
  clock: string;
  stateLabel: string;
  expanded: boolean;
  onToggle: () => void;
  /** Opt in only for the desktop menu-bar capsule; touch layouts keep their size. */
  isCompact?: boolean;
  progress?: number | null;
  tone?: FocusIslandTone;
  /** Compact only: stops the pulse and shows the paused glyph. */
  paused?: boolean;
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
  tone = 'focus',
  paused = false,
  children,
  className,
}: FocusIslandProps) {
  const compact = isCompact && !expanded;
  const descriptionId = useId();
  const toneColor = TONE_COLORS[tone];
  return (
    <View
      className={cn(
        'w-full overflow-hidden',
        compact
          ? 'rounded-full'
          : cn(
              'border border-border bg-surface shadow-lg dark:border-border-dark dark:bg-surface-dark',
              expanded ? 'rounded-3xl' : 'rounded-full',
            ),
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
          compact
            ? 'h-[34px] gap-3 rounded-full bg-black/75 px-4'
            : 'min-h-16 gap-3 px-5 py-3',
        )}
      >
        {compact ? (
          <>
            <View
              className={cn('h-2 w-2 shrink-0 rounded-full', !paused && 'animate-pulse')}
              style={{ backgroundColor: toneColor }}
            />
            <Text
              numberOfLines={1}
              className="min-w-0 flex-1 font-sans text-xs font-medium text-white/90"
            >
              {title}
            </Text>
          </>
        ) : (
          <View className="h-3 w-3 shrink-0 rounded-full bg-accent dark:bg-accent-dark" />
        )}
        {!compact ? (
          <View className="min-w-0 flex-1 gap-1">
            <Text
              numberOfLines={expanded ? undefined : 1}
              className="font-sans text-sm font-semibold text-ink dark:text-ink-dark"
            >
              {title}
            </Text>
            <Text className="font-sans text-xs text-muted dark:text-muted-dark">{stateLabel}</Text>
          </View>
        ) : null}
        <View className="shrink-0 flex-row items-center gap-1.5">
          <Text
            className={cn(
              'font-mono font-bold',
              compact ? 'text-sm' : 'text-xl text-ink dark:text-ink-dark',
            )}
            style={compact ? { color: toneColor } : undefined}
          >
            {clock}
          </Text>
          {compact && paused ? <Text className="text-[10px] text-white/20">⏸</Text> : null}
        </View>
        {!compact ? (
          <Text accessibilityElementsHidden className="text-sm text-muted dark:text-muted-dark">
            {expanded ? '⌃' : '⌄'}
          </Text>
        ) : null}
      </Pressable>
      {compact ? (
        <>
          <Svg
            pointerEvents="none"
            width={PILL_WIDTH}
            height={PILL_HEIGHT}
            viewBox={`0 0 ${PILL_WIDTH} ${PILL_HEIGHT}`}
            style={{ position: 'absolute', left: 0, top: 0 }}
          >
            <Rect
              x={RING_INSET}
              y={RING_INSET}
              width={PILL_WIDTH - RING_INSET * 2}
              height={PILL_HEIGHT - RING_INSET * 2}
              rx={RING_RADIUS}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={3}
            />
            <Rect
              x={RING_INSET}
              y={RING_INSET}
              width={PILL_WIDTH - RING_INSET * 2}
              height={PILL_HEIGHT - RING_INSET * 2}
              rx={RING_RADIUS}
              fill="none"
              stroke={paused ? 'rgba(255,255,255,0.45)' : toneColor}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={[RING_PERIMETER, RING_PERIMETER]}
              strokeDashoffset={
                RING_PERIMETER * (1 - Math.min(1, Math.max(0, progress ?? 0)))
              }
              opacity={paused ? 0.35 : 1}
            />
          </Svg>
          <Text nativeID={descriptionId} className="sr-only">
            {title}，{stateLabel}，{clock}
          </Text>
        </>
      ) : null}
      {!compact && progress !== null ? (
        <ProgressBar value={progress} className="h-1 rounded-none" />
      ) : null}
      {expanded && children ? <View className="gap-4 px-5 pb-5 pt-4">{children}</View> : null}
    </View>
  );
}
