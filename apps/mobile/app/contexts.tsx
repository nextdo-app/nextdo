/**
 * The contexts screen (task 10-08 — 场景删除入口): a flat list of the
 * live scenes with a per-row 删除 (soft delete — `trashContext`), plus the
 * inline quick-create the Now screen's "＋ 场景" chip already offers.
 *
 * An ordinary (non-tab) route, reached from the Now screen's engine-context
 * bar (「管理」). Deliberately NOT a tab: scenes are declared rarely and read
 * from Now. Precedent: `habits.tsx` (same list + 删除 + create shape).
 *
 * Presentational: every read comes from `useContexts` and every write from
 * the same hook (`add` / `remove`) — component-guidelines, no db in
 * components. `remove` re-reads on success only (hook-guidelines Rule 9:
 * the hook's own `reloadKey` bump is internal, but a failed write must not
 * clear the read's error state).
 */
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppInsets } from '@/lib/use-app-insets';
import { Button, Card, EmptyState } from '@nextdo/ui';
import { useContexts } from '@/hooks/use-contexts';
import { errorMessage } from '@/lib/error-messages';
import { goBack } from '@/lib/go-back';

const INPUT_CLASS =
  'rounded-md border border-border/80 bg-surface p-3 text-base text-ink placeholder:text-muted focus:border-accent dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

/** One scene: its name + 删除. */
function ContextRow({ name, onTrash }: { name: string; onTrash: () => void }) {
  return (
    <Card className="gap-2 p-3.5">
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-row items-center gap-2.5 flex-1 min-w-0 pr-2">
          <View className="h-8 w-8 rounded-lg bg-surface-container/60 dark:bg-surface-container-dark/60 items-center justify-center shrink-0">
            <Ionicons name="shapes-outline" size={16} color="#716b64" />
          </View>
          <Text className="font-sans text-base font-semibold text-ink dark:text-ink-dark" numberOfLines={1}>
            {name}
          </Text>
        </View>
        <View className="shrink-0">
          <Button size="sm" label="删除" variant="ghost" onPress={onTrash} />
        </View>
      </View>
    </Card>
  );
}

const PRESET_SCENES = ['电脑', '办公室', '电话', '家里', '外出'];

/**
 * The quick-create row. An empty name is a no-op — the form stays OPEN so
 * the typed text is not lost (same guard as the Now screen's "＋ 场景"
 * chip, and the clarify wizard's inline create).
 *
 * `add` is PASSED IN rather than pulled from `useContexts` here: the screen
 * owns the single hook instance (two instances would be two independent
 * read states, and a create would not show up in the list above).
 */
function ContextForm({
  add,
  onAdded,
}: {
  add: (name: string) => Promise<unknown>;
  onAdded: () => void;
}) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim() !== '' && !submitting;

  const submit = () => {
    if (!canSubmit) return;
    setSubmitting(true);
    void add(name.trim()).then(() => {
      setSubmitting(false);
      setName('');
      onAdded();
    });
  };

  return (
    <Card className="gap-3.5 p-4">
      <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">新场景</Text>
      <TextInput
        className={INPUT_CLASS}
        placeholder="场景名（如 客厅）"
        value={name}
        onChangeText={setName}
        accessibilityLabel="新场景名称"
        onSubmitEditing={submit}
      />
      <View className="flex-row flex-wrap items-center gap-1.5 pt-0.5">
        <Text className="font-sans text-xs text-muted dark:text-muted-dark">常用推荐：</Text>
        {PRESET_SCENES.map((scene) => (
          <Pressable
            key={scene}
            accessibilityRole="button"
            accessibilityLabel={`推荐场景：${scene}`}
            onPress={() => setName(scene)}
            className="rounded-full border border-border/80 bg-surface px-2.5 py-1 active:bg-surface-container dark:border-border-dark dark:bg-surface-dark dark:active:bg-surface-container-dark"
          >
            <Text className="font-sans text-xs text-ink dark:text-ink-dark">{scene}</Text>
          </Pressable>
        ))}
      </View>
      <View className="flex-row justify-end">
        <Button size="sm" label="添加场景" disabled={!canSubmit} onPress={submit} />
      </View>
    </Card>
  );
}

export default function ContextsScreen() {
  const { data, error, add, remove } = useContexts();
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);
  const contexts = data ?? [];

  return (
    <ScrollView
      className="flex-1 bg-canvas dark:bg-canvas-dark"
      contentContainerStyle={{ paddingTop: topPadding, paddingHorizontal: 16, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <View className="w-full max-w-2xl mx-auto flex-1">
      <View className="mb-2 flex-row items-center justify-between">
        <Button label="← 返回" variant="ghost" onPress={() => goBack('/(tabs)/now')} />
      </View>
      <Text className="font-display text-3xl font-bold tracking-tight text-ink dark:text-ink-dark">
        场景
      </Text>
      <Text className="mt-1 font-sans text-sm text-muted dark:text-muted-dark">
        场景是行动的运行环境 —— Now 屏按当前场景筛选待办。不选即随处可执行。
      </Text>

      {error !== null ? (
        <Text className="mt-2 font-sans text-sm text-danger dark:text-danger-dark">
          {errorMessage(error)}
        </Text>
      ) : null}

      <View className="mt-3 gap-2">
        {contexts.length === 0 ? (
          <EmptyState
            title="还没有场景"
            hint="还没有场景 —— 不选即随处可执行。也可以现在建一个。"
          />
        ) : (
          contexts.map((context) => (
            <ContextRow
              key={context.id}
              name={context.name}
              onTrash={() => {
                // `remove` re-reads internally, and only on success (it bumps
                // the hook's own reloadKey after a committed write). The
                // `false` branch deliberately does nothing so a rejected write
                // keeps the row and the read's error state.
                void remove(context.id);
              }}
            />
          ))
        )}
      </View>

      <View className="mt-4">
        <ContextForm add={add} onAdded={() => undefined} />
      </View>
      </View>
    </ScrollView>
  );
}
