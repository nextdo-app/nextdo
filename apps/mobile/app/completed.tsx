/**
 * The 「已完成行动」 window (issue 27).
 *
 * A focus session ending no longer completes its action (see focus/[id].tsx),
 * so "done" became a decision the user makes — and therefore a decision the
 * user can take back. This screen is where both halves live:
 *
 *   - every completed NextAction / CalendarAction / HabitDay with the instant of
 *     its latest completion (the live list from `useCompletedActions`);
 *   - a per-row 「恢复」 that runs the restore transaction (status → open,
 *     CompletionRecords soft-deleted) — the action goes straight back into
 *     the Now screen's execution pool, and its focus history is untouched.
 *
 * Habit 打卡 (HabitDay) are in this list on purpose: they are pool rows with
 * their own 完成 button, so excluding them would make "完成即可逆" false for
 * the entries the user taps most often. Their title/estimate/project come
 * from the parent Habit — the day row itself carries none.
 */
import { FlatList, Text, View } from 'react-native';
import { Button, Card, EmptyState, Tag } from '@nextdo/ui';
import type { CompletedAction } from '@nextdo/db';
import { useAppInsets } from '@/lib/use-app-insets';
import { useCompletedActions } from '@/hooks/use-completed-actions';
import { useReopenAction } from '@/hooks/use-reopen-action';
import { useProjectTitles } from '@/hooks/use-project-titles';
import { errorMessage } from '@/lib/error-messages';
import { formatLocalDateTime } from '@/lib/format';
import { KIND_LABELS } from '@/lib/kind-labels';
import { goBack } from '@/lib/go-back';

/** One completed action + the 恢复 that takes it back. */
function CompletedRow({
  entry,
  projectName,
  onRestore,
}: {
  entry: CompletedAction;
  projectName: string | undefined;
  onRestore: () => void;
}) {
  return (
    <Card variant="outlined" className="gap-2 p-3.5">
      <View className="flex-row items-start gap-2">
        <View className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-accent/70 dark:bg-accent-dark/70" />
        <Text className="flex-1 font-sans text-base font-medium text-ink dark:text-ink-dark">
          {entry.title}
        </Text>
      </View>
      <View className="flex-row flex-wrap items-center gap-1.5">
        <Tag label={KIND_LABELS[entry.kind]} />
        {projectName !== undefined ? <Tag label={projectName} /> : null}
        {entry.estMinutes > 0 ? (
          <Text className="font-sans text-xs text-muted dark:text-muted-dark">
            预计 {entry.estMinutes} 分钟
          </Text>
        ) : null}
      </View>
      <View className="flex-row items-center justify-between gap-2 mt-1">
        <Text className="flex-1 font-sans text-xs text-muted dark:text-muted-dark">
          {entry.completedAt === null ? '完成时间未知' : `完成于 ${formatLocalDateTime(entry.completedAt)}`}
        </Text>
        <View className="shrink-0">
          <Button
            size="sm"
            label="恢复为未完成"
            variant="secondary"
            onPress={onRestore}
          />
        </View>
      </View>
    </Card>
  );
}

export default function CompletedScreen() {
  const { data, error } = useCompletedActions();
  const { reopen, error: reopenError } = useReopenAction();
  const projectTitles = useProjectTitles();
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);
  const rows = data;
  const errorMessageText = error ?? reopenError;

  return (
    <View
      style={{ paddingTop: topPadding }}
      className="flex-1 bg-canvas px-4 pb-4 dark:bg-canvas-dark"
    >
      <View className="w-full max-w-4xl mx-auto flex-1">
        <View className="mb-4 flex-row items-center justify-between">
          <Button label="← 现在" variant="ghost" onPress={() => goBack('/(tabs)/now')} />
          <Text className="text-lg font-semibold text-ink dark:text-ink-dark">已完成行动</Text>
          <View className="w-16" />
        </View>

        <Text className="mb-3 font-sans text-xs leading-relaxed text-muted dark:text-muted-dark">
          一次专注结束只记录专注，不会替你判定行动完成。完成由你单独确认；点错了可以在这里恢复为未完成，专注记录会保留。
        </Text>

        {errorMessageText !== null ? (
          <Text className="mb-2 font-sans text-sm text-danger">{errorMessage(errorMessageText)}</Text>
        ) : null}

        {rows.length === 0 ? (
          <EmptyState
            className="flex-initial py-8"
            title="还没有已完成的行动"
            hint="在「现在」页点完成，或专注结束后确认行动完成，就会出现在这里。"
          />
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(item) => `${item.kind}:${item.id}`}
            contentContainerClassName="gap-2.5 pb-8"
            renderItem={({ item }) => (
              <CompletedRow
                entry={item}
                projectName={item.projectId === null ? undefined : projectTitles[item.projectId]}
                onRestore={() => {
                  void reopen({ actionKind: item.kind, actionId: item.id });
                }}
              />
            )}
          />
        )}
      </View>
    </View>
  );
}