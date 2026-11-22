/**
 * The recycle bin (issue #89).
 *
 * Every delete in the app is a soft delete (`deleted_at`), and the Clarify
 * wizard already promised 「删除后进回收站，可找回」. This screen is that
 * promise: one live list of every trashed user-facing row with a per-row
 * 恢复 that clears `deleted_at`.
 *
 * Restoring puts the row back in its original list. A child whose parent is
 * still deleted is refused with a visible message (restore the project or
 * habit first) — the row stays in the bin, and the relation is never silently
 * dropped. Reminders are NOT resurrected: trashing cancelled them and
 * `cancelled` is terminal; the user arms a new reminder on the restored
 * action. Historical copies made by archive/re-clarify also appear here;
 * restoring one does not undo the conversion.
 */
import { FlatList, Text, View } from 'react-native';
import { Button, Card, EmptyState, Tag } from '@nextdo/ui';
import type { TrashKind, TrashedItem } from '@nextdo/db';
import { useAppInsets } from '@/lib/use-app-insets';
import { trashKey, useTrashedItems } from '@/hooks/use-trashed-items';
import { errorMessage } from '@/lib/error-messages';
import { formatLocalDateTime } from '@/lib/format';
import { goBack } from '@/lib/go-back';

const TRASH_KIND_LABELS: Record<TrashKind, string> = {
  inbox: '收件箱',
  'next-action': '下一步行动',
  'calendar-action': '日历行动',
  'habit-day': '习惯打卡',
  project: '项目',
  habit: '习惯挑战',
  someday: 'Someday/Maybe',
  waiting: '等待事项',
  reference: '资料',
};

/** One trashed row + the 恢复 that brings it back. */
function TrashRow({
  entry,
  restoring,
  onRestore,
}: {
  entry: TrashedItem;
  restoring: boolean;
  onRestore: () => void;
}) {
  return (
    <Card variant="outlined" className="gap-2 p-3.5">
      <View className="flex-row items-start gap-2">
        <View className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-muted/60 dark:bg-muted-dark/60" />
        <Text className="flex-1 font-sans text-base font-medium text-ink dark:text-ink-dark">
          {entry.title}
        </Text>
      </View>
      <View className="flex-row flex-wrap items-center gap-1.5">
        <Tag label={TRASH_KIND_LABELS[entry.kind]} />
        {entry.detail !== null ? (
          <Text
            numberOfLines={1}
            className="flex-1 font-sans text-xs text-muted dark:text-muted-dark"
          >
            {entry.detail}
          </Text>
        ) : null}
      </View>
      <View className="mt-1 flex-row items-center justify-between gap-2">
        <Text className="flex-1 font-sans text-xs text-muted dark:text-muted-dark">
          {entry.deletedAt === ''
            ? '删除时间未知'
            : `删除于 ${formatLocalDateTime(entry.deletedAt)}`}
        </Text>
        <View className="shrink-0">
          <Button
            size="sm"
            label={restoring ? '恢复中…' : '恢复'}
            variant="secondary"
            disabled={restoring}
            accessibilityLabel={`恢复${TRASH_KIND_LABELS[entry.kind]}：${entry.title}`}
            onPress={onRestore}
          />
        </View>
      </View>
    </Card>
  );
}

export default function TrashScreen() {
  const { data, error, isLoading, restoring, restore, mutationError } = useTrashedItems();
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);
  const message = error ?? mutationError;

  return (
    <View
      style={{ paddingTop: topPadding }}
      className="flex-1 bg-canvas px-4 pb-4 dark:bg-canvas-dark"
    >
      <View className="mx-auto w-full max-w-4xl flex-1">
        <View className="mb-2 flex-row items-center justify-between">
          <Button label="← 设置" variant="ghost" onPress={() => goBack('/(tabs)/settings')} />
        </View>

        <Text className="font-display text-3xl font-bold tracking-tight text-ink dark:text-ink-dark">
          回收站
        </Text>
        <Text className="mt-1 font-sans text-sm text-muted dark:text-muted-dark">
          删除的事项会先放在这里，可以恢复。恢复行动后，原来的提醒不会自动回来，需要重新设置。
          已澄清的收件箱记录、转为 Someday/Maybe 或重新明晰前的旧行动也会以副本形式出现；
          恢复这些副本不会撤销已完成的转换。若所属项目或习惯还在回收站，请先恢复它们。
        </Text>

        {message !== null ? (
          <Text className="mt-2 font-sans text-sm text-danger dark:text-danger-dark">
            {errorMessage(message)}
          </Text>
        ) : null}

        <Text className="mb-2 mt-4 font-sans text-sm font-medium text-muted dark:text-muted-dark">
          已删除 ({data.length})
        </Text>

        {data.length === 0 ? (
          isLoading ? (
            <Text className="mt-2 font-sans text-sm text-muted dark:text-muted-dark">加载中…</Text>
          ) : error !== null ? (
            <EmptyState
              title="回收站加载失败"
              hint="请检查后重试；已删除的数据仍在本机，不会因为这次读取失败而丢失。"
            />
          ) : (
            <EmptyState
              title="回收站是空的"
              hint="在收件箱、现在、项目或习惯页删除的事项，会先出现在这里。"
            />
          )
        ) : (
          <FlatList
            data={data}
            keyExtractor={(item) => `${item.kind}:${item.id}`}
            contentContainerClassName="gap-2.5 pb-20 md:pb-6"
            renderItem={({ item }) => (
              <TrashRow
                entry={item}
                restoring={restoring.has(trashKey(item.kind, item.id))}
                onRestore={() => {
                  void restore({ kind: item.kind, id: item.id });
                }}
              />
            )}
          />
        )}
      </View>
    </View>
  );
}
