/**
 * The Someday/Maybe screen — GTD's parking lot for 「有空再说」.
 *
 * Entries arrive from two places: the Clarify wizard (~Q1b, non-actionable
 * items) and the Now action menu (「转为 Someday/Maybe」, which retires the
 * action and keeps its title + note here). The weekly review re-asks about
 * every entry (keep / trash) and can turn it back into an action or project;
 * this screen is the always-available list so an archived action does not
 * have to wait for the next review to be seen.
 */
import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { Button, Card, EmptyState, MarkdownNote } from '@nextdo/ui';
import type { SomedayMaybeItem } from '@nextdo/core';
import { useAppInsets } from '@/lib/use-app-insets';
import { useSomedayItems } from '@/hooks/use-someday-items';
import { errorMessage } from '@/lib/error-messages';
import { goBack } from '@/lib/go-back';

/** One parked item; 删除 arms first, then confirms. */
function SomedayRow({
  item,
  onTrash,
}: {
  item: SomedayMaybeItem;
  onTrash: (id: string) => void;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <Card variant="outlined" className="gap-2 p-3.5">
      <Text className="font-sans text-base font-medium text-ink dark:text-ink-dark">
        {item.title}
      </Text>
      {item.note !== undefined ? (
        // The note is the user's raw Markdown and this row IS the content —
        // render it in full (same rule as the project action rows); a parked
        // action must not lose the detail it was archived with.
        <MarkdownNote value={item.note} />
      ) : null}
      <View className="flex-row justify-end">
        {armed ? (
          <Button
            size="sm"
            label="确认删除？"
            variant="secondary"
            onPress={() => {
              setArmed(false);
              onTrash(item.id);
            }}
          />
        ) : (
          <Button size="sm" label="删除" variant="ghost" onPress={() => setArmed(true)} />
        )}
      </View>
    </Card>
  );
}

export default function SomedayScreen() {
  const { data, error, trash, mutationError } = useSomedayItems();
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);
  const message = error ?? mutationError;

  return (
    <View
      style={{ paddingTop: topPadding }}
      className="flex-1 bg-canvas px-4 pb-4 dark:bg-canvas-dark"
    >
      <View className="w-full max-w-4xl mx-auto flex-1">
        <View className="mb-2 flex-row items-center justify-between">
          <Button label="← 收件箱" variant="ghost" onPress={() => goBack('/(tabs)/inbox')} />
        </View>

        <Text className="font-display text-3xl font-bold tracking-tight text-ink dark:text-ink-dark">
          Someday / Maybe
        </Text>
        <Text className="mt-1 font-sans text-sm text-muted dark:text-muted-dark">
          「有空再说」的暂存区。这里的事不是垃圾，只是现在不做；每周检视时会再问你一次。
        </Text>

        {message !== null ? (
          <Text className="mt-2 font-sans text-sm text-danger dark:text-danger-dark">
            {errorMessage(message)}
          </Text>
        ) : null}

        <Text className="mb-2 mt-4 font-sans text-sm font-medium text-muted dark:text-muted-dark">
          暂存清单 ({data.length})
        </Text>

        {data.length === 0 ? (
          <EmptyState
            title="暂时没有搁置的事"
            hint="澄清时选择「有空再说」，或在现在页的行动菜单里「转为 Someday/Maybe」，都会存到这里。"
          />
        ) : (
          <FlatList
            data={data}
            keyExtractor={(item) => item.id}
            contentContainerClassName="gap-2.5 pb-20 md:pb-6"
            renderItem={({ item }) => <SomedayRow item={item} onTrash={(id) => void trash(id)} />}
          />
        )}
      </View>
    </View>
  );
}
