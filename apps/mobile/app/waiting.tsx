/**
 * The Waiting For screen: manage items delegated to others or pending external responses.
 *
 * Conforms to GTD core workflows and project component-guidelines.
 * Reached via Inbox screen's Waiting For capsule/entry.
 */
import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useAppInsets } from '@/lib/use-app-insets';
import { Button, Card, EmptyState, Tag } from '@nextdo/ui';
import { FormField } from '@/components/form-field';
import { useWaitingForItems } from '@/hooks/use-waiting-for';
import { useAppClock } from '@/hooks/use-app-clock';
import { errorMessage } from '@/lib/error-messages';
import { formatLocalDate } from '@/lib/format';
import { goBack } from '@/lib/go-back';
import type { WaitingForItem } from '@nextdo/core';

const INPUT_CLASS =
  'rounded-xl border border-border/80 bg-surface px-3.5 py-3 text-base text-ink placeholder:text-muted shadow-2xs focus:border-accent dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

/** One waiting item row with delegation details and finish/trash action. */
function WaitingRow({
  item,
  now,
  onFinish,
}: {
  item: WaitingForItem;
  now: Date;
  onFinish: (id: string) => void;
}) {
  const isOverdue =
    Boolean(item.expectedBy) && new Date(item.expectedBy!).getTime() < now.getTime();

  return (
    <Card className="gap-3 p-4 rounded-2xl border-border/70 bg-surface dark:border-border-dark/70 dark:bg-surface-dark shadow-2xs">
      <View className="flex-row items-start justify-between gap-2">
        <Text className="flex-1 font-sans text-base font-semibold text-ink dark:text-ink-dark">
          {item.title}
        </Text>
        <Tag label={`等待: ${item.waitingOn}`} tone="accent" />
      </View>

      <View className="flex-row items-center justify-between pt-1">
        <View className="flex-row items-center gap-2">
          {/* Issue #62: 等待 vs 已委派 are distinct action kinds. */}
          <Tag
            label={item.kind === 'delegated' ? '已委派' : '等待外部'}
            tone={item.kind === 'delegated' ? 'neutral' : 'accent'}
          />
          {item.expectedBy ? (
            <Tag
              label={
                isOverdue
                  ? `已逾期: ${formatLocalDate(item.expectedBy)}`
                  : `预期: ${formatLocalDate(item.expectedBy)}`
              }
              tone={isOverdue ? 'danger' : 'neutral'}
            />
          ) : (
            <Text className="font-sans text-xs text-muted dark:text-muted-dark">
              无截止日期
            </Text>
          )}
        </View>

        <Button
          size="sm"
          label="已得到结果"
          variant="secondary"
          onPress={() => onFinish(item.id)}
        />
      </View>
    </Card>
  );
}

/** Quick-create card for new WaitingForItem entries. */
function WaitingForm({
  add,
  onAdded,
}: {
  add: (input: { title: string; waitingOn: string; expectedBy?: string; followUpAt?: string; kind?: WaitingForItem['kind'] }) => Promise<boolean>;
  onAdded: () => void;
}) {
  const [title, setTitle] = useState('');
  const [waitingOn, setWaitingOn] = useState('');
  const [kind, setKind] = useState<NonNullable<WaitingForItem['kind']>>('waiting');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim() !== '' && waitingOn.trim() !== '' && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const success = await add({
      title: title.trim(),
      waitingOn: waitingOn.trim(),
      kind,
    });
    setSubmitting(false);
    if (success) {
      setTitle('');
      setWaitingOn('');
      onAdded();
    }
  };

  return (
    <Card className="gap-3.5 p-4 rounded-2xl border-border/70 bg-surface dark:border-border-dark/70 dark:bg-surface-dark shadow-2xs">
      <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
        新增等待事项
      </Text>
      <FormField label="事项名称">
        <TextInput
          className={INPUT_CLASS}
          placeholder="事项名称（例如：等发票报销、等设计稿回复）"
          value={title}
          onChangeText={setTitle}
          accessibilityLabel="等待事项名称"
        />
      </FormField>
      <FormField label="类型">
        <View className="flex-row gap-2">
          <Button
            size="sm"
            label="等待外部"
            variant={kind === 'waiting' ? 'primary' : 'secondary'}
            onPress={() => setKind('waiting')}
          />
          <Button
            size="sm"
            label="已委派"
            variant={kind === 'delegated' ? 'primary' : 'secondary'}
            onPress={() => setKind('delegated')}
          />
        </View>
      </FormField>
      <FormField label="等待谁">
        <TextInput
          className={INPUT_CLASS}
          placeholder="等待谁？（例如：财务部、张经理、审核系统）"
          value={waitingOn}
          onChangeText={setWaitingOn}
          accessibilityLabel="等待对象"
        />
      </FormField>
      <View className="flex-row justify-end pt-1">
        <Button
          size="sm"
          label="添加等待"
          disabled={!canSubmit}
          onPress={submit}
        />
      </View>
    </Card>
  );
}

export default function WaitingScreen() {
  const { data, error, add, trash, mutationError } = useWaitingForItems();
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);
  const now = useAppClock();
  const items = data ?? [];

  return (
    <ScrollView
      className="flex-1 bg-canvas dark:bg-canvas-dark"
      contentContainerStyle={{ paddingTop: topPadding, paddingHorizontal: 16, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <View className="w-full max-w-4xl mx-auto flex-1">
      <View className="mb-2 flex-row items-center justify-between">
        <Button label="← 收件箱" variant="ghost" onPress={() => goBack('/(tabs)/inbox')} />
      </View>

      <Text className="font-display text-3xl font-bold tracking-tight text-ink dark:text-ink-dark">
        等待事项
      </Text>
      <Text className="mt-1 font-sans text-sm text-muted dark:text-muted-dark">
        跟踪委托给他人、等待外部反馈或交付的事情。收到结果后即可移出。
      </Text>

      {error !== null ? (
        <Text className="mt-2 font-sans text-sm text-danger dark:text-danger-dark">
          {errorMessage(error)}
        </Text>
      ) : null}
      {mutationError !== null ? (
        <Text className="mt-2 font-sans text-sm text-danger dark:text-danger-dark">
          {errorMessage(mutationError)}
        </Text>
      ) : null}

      <View className="mt-3">
        <WaitingForm add={add} onAdded={() => {}} />
      </View>

      <View className="mt-4 gap-2.5">
        <View className="flex-row items-center justify-between">
          <Text className="font-sans text-sm font-medium text-muted dark:text-muted-dark">
            等待中清单 ({items.length})
          </Text>
        </View>

        {items.length === 0 ? (
          <EmptyState
            title="暂无等待事项"
            hint="委托给同事或等待外部响应的事情，可随时在此添加或从厘清流程进入。"
          />
        ) : (
          items.map((item) => (
            <WaitingRow
              key={item.id}
              item={item}
              now={now}
              onFinish={(id) => void trash(id)}
            />
          ))
        )}
      </View>
      </View>
    </ScrollView>
  );
}
