import { Pressable, Text, View } from 'react-native';
import { cn } from '@nextdo/ui';
import type { HabitDay } from '@nextdo/core';
import type { HabitCellStatus, HabitGridDay } from '@/lib/habit-history';

function formatHabitDate(key: string): string {
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

const STATUS_LABELS: Record<HabitCellStatus, string> = {
  done: '已完成',
  today: '今日未打卡',
  catchup: '可补卡',
  missed: '未打卡',
  future: '未到',
  unscheduled: '未安排',
  unrecorded: '无记录',
};

export interface HabitHistoryGridProps {
  grid: HabitGridDay[];
  priorCompletions: HabitDay[];
  onComplete?: (dayId: string) => void;
}

export function HabitHistoryGrid({ grid, priorCompletions, onComplete }: HabitHistoryGridProps) {
  const first = grid[0];
  const last = grid.at(-1);
  return (
    <View className="gap-2">
      <Text className="text-xs font-medium text-muted dark:text-muted-dark">
        本期打卡记录{first && last ? ` · ${formatHabitDate(first.localDate)} 至 ${formatHabitDate(last.localDate)}` : ''}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {grid.map((cell) => {
          const dayId = cell.day?.id;
          const canComplete = dayId !== undefined && onComplete !== undefined && cell.day?.status === 'open' &&
            (cell.status === 'today' || cell.status === 'catchup');
          const label = `${formatHabitDate(cell.localDate)} ${STATUS_LABELS[cell.status]}`;
          const content = (
            <>
              <Text className={cn('text-xs font-semibold', cell.status === 'done'
                ? 'text-on-accent' : 'text-ink dark:text-ink-dark')}>
                {`${cell.localDate.slice(4, 6)}/${cell.localDate.slice(6, 8)}`}
              </Text>
              <Text className={cn('text-[10px]', cell.status === 'done'
                ? 'text-on-accent' : 'text-muted dark:text-muted-dark')}>
                {STATUS_LABELS[cell.status]}
              </Text>
            </>
          );
          const className = cn(
            'min-h-11 w-16 items-center justify-center rounded-lg border px-1 py-1.5',
            cell.status === 'done'
              ? 'border-accent bg-accent dark:border-accent-dark dark:bg-accent-dark'
              : cell.isToday
                ? 'border-accent bg-accent/10 dark:border-accent-dark dark:bg-accent-dark/10'
                : 'border-border/70 bg-surface dark:border-border-dark dark:bg-surface-dark',
          );
          return canComplete ? (
            <Pressable
              key={cell.localDate}
              accessibilityRole="button"
              accessibilityLabel={`${label}，${cell.status === 'catchup' ? '补打卡' : '今日打卡'}`}
              className={className}
              onPress={() => onComplete?.(dayId)}
            >
              {content}
            </Pressable>
          ) : (
            <View key={cell.localDate} accessible accessibilityLabel={label} className={className}>
              {content}
            </View>
          );
        })}
      </View>
      <Text className="text-xs text-muted dark:text-muted-dark">
        已完成：有打卡记录 · 未打卡：没有完成记录 · 未安排：当天不执行
      </Text>
      {priorCompletions.length > 0 ? (
        <View className="gap-1">
          <Text className="text-xs font-medium text-muted dark:text-muted-dark">其他日期的完成记录（不计入本期）</Text>
          <Text className="text-sm text-ink dark:text-ink-dark">
            {priorCompletions.map((day) => formatHabitDate(day.localDate)).join('、')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
