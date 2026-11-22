/**
 * The Waiting For screen: manage items delegated to others or pending external responses.
 *
 * Conforms to GTD core workflows and project component-guidelines.
 * Reached via Inbox screen's Waiting For capsule/entry.
 *
 * Issue #94: the form now owns `expectedBy` and `followUpAt` (the review's
 * due source), and each row can be edited in place. Dates are picked with
 * the app's DateTimePicker; the stored ISO follows the same local-day
 * conventions as the Clarify wizard (date-only → that day's end,
 * datetime → that exact local moment).
 */
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useAppInsets } from '@/lib/use-app-insets';
import { Button, Card, EmptyState, Tag, cn } from '@nextdo/ui';
import { FormField } from '@/components/form-field';
import { DateTimePicker } from '@/components/datetime-picker';
import { useWaitingForItems, type UpdateWaitingForPatch } from '@/hooks/use-waiting-for';
import { useAppClock } from '@/hooks/use-app-clock';
import { errorMessage } from '@/lib/error-messages';
import { formatLocalDate, formatLocalDateTime } from '@/lib/format';
import { formatDateTimeValue } from '@/lib/datetime-field';
import { localDateTimeKey, localDateTimeToIso } from '@/lib/clarify-flow';
import { goBack } from '@/lib/go-back';
import { isDateOnlyDeadline, type WaitingForItem } from '@nextdo/core';

const INPUT_CLASS =
  'rounded-xl border border-border/80 bg-surface px-3.5 py-3 text-base text-ink placeholder:text-muted shadow-2xs focus:border-accent dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

type WaitingKind = NonNullable<WaitingForItem['kind']>;

/** The form's values, already converted to stored ISO datetimes. */
interface WaitingFormValues {
  title: string;
  waitingOn: string;
  kind: WaitingKind;
  expectedBy?: string;
  followUpAt?: string;
}

/** A picker trigger + its DateTimePicker modal (the Clarify wizard's field,
 *  screen-local so this screen does not depend on the wizard). */
function WaitingDateField({
  value,
  mode,
  label,
  placeholder,
  now,
  onChange,
  onClear,
}: {
  value: string;
  mode: 'date' | 'datetime';
  label: string;
  placeholder: string;
  now: Date;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View className="gap-1.5">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`选择${label}`}
        onPress={() => setOpen(true)}
        className={cn(INPUT_CLASS, 'flex-row items-center justify-between gap-2')}
      >
        <Text
          className={cn(
            'font-sans text-base',
            value === ''
              ? 'text-muted dark:text-muted-dark'
              : 'text-ink dark:text-ink-dark',
          )}
        >
          {value === '' ? placeholder : formatDateTimeValue(value)}
        </Text>
        <Text className="font-sans text-xs text-muted dark:text-muted-dark">点击选择</Text>
      </Pressable>
      {value !== '' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`清除${label}`}
          onPress={onClear}
          className="self-start px-1 py-0.5"
        >
          <Text className="font-sans text-xs text-muted dark:text-muted-dark">清除</Text>
        </Pressable>
      ) : null}
      {open ? (
        <DateTimePicker
          mode={mode}
          title={label}
          value={value}
          now={now}
          onConfirm={(picked) => {
            onChange(picked);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </View>
  );
}

/** One waiting item row with delegation details, edit, and finish action. */
function WaitingRow({
  item,
  now,
  submitting,
  onFinish,
  onSave,
}: {
  item: WaitingForItem;
  now: Date;
  submitting: boolean;
  onFinish: (id: string) => void;
  onSave: (item: WaitingForItem, patch: UpdateWaitingForPatch) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const isOverdue =
    Boolean(item.expectedBy) && new Date(item.expectedBy!).getTime() < now.getTime();
  const followUpDue =
    Boolean(item.followUpAt) && new Date(item.followUpAt!).getTime() < now.getTime();

  if (editing) {
    return (
      <WaitingForm
        title="编辑等待事项"
        submitLabel="保存修改"
        initial={item}
        now={now}
        submitting={submitting}
        onSubmit={async (values) => {
          const saved = await onSave(item, values);
          if (saved) setEditing(false);
          return saved;
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <Card className="gap-3 p-4 rounded-2xl border-border/70 bg-surface dark:border-border-dark/70 dark:bg-surface-dark shadow-2xs">
      <View className="flex-row items-start justify-between gap-2">
        <Text className="flex-1 font-sans text-base font-semibold text-ink dark:text-ink-dark">
          {item.title}
        </Text>
        <Tag label={`等待: ${item.waitingOn}`} tone="accent" />
      </View>

      <View className="gap-2 pt-1">
        <View className="flex-row flex-wrap items-center gap-2">
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
          {item.followUpAt ? (
            <Tag
              label={`${followUpDue ? '待跟进' : '跟进'}: ${
                isDateOnlyDeadline(item.followUpAt)
                  ? formatLocalDate(item.followUpAt)
                  : formatLocalDateTime(item.followUpAt)
              }`}
              tone={followUpDue ? 'danger' : 'neutral'}
            />
          ) : null}
        </View>

        <View className="flex-row justify-end gap-2">
          <Button
            size="sm"
            label="编辑"
            variant="ghost"
            disabled={submitting}
            onPress={() => setEditing(true)}
          />
          <Button
            size="sm"
            label="已得到结果"
            variant="secondary"
            onPress={() => onFinish(item.id)}
          />
        </View>
      </View>
    </Card>
  );
}

/** Create/edit card for WaitingForItem entries. */
function WaitingForm({
  title,
  submitLabel,
  initial,
  now,
  submitting,
  onSubmit,
  onCancel,
}: {
  title: string;
  submitLabel: string;
  initial?: WaitingForItem;
  now: Date;
  submitting: boolean;
  onSubmit: (values: WaitingFormValues) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [itemTitle, setItemTitle] = useState(initial?.title ?? '');
  const [waitingOn, setWaitingOn] = useState(initial?.waitingOn ?? '');
  const [kind, setKind] = useState<WaitingKind>(initial?.kind ?? 'waiting');
  // The pickers speak 'YYYY-MM-DD' / 'YYYY-MM-DDTHH:mm' (device-local);
  // the stored values are ISO. `localDateTimeKey` produces both shapes and
  // collapses the end-of-day sentinel back to a plain date.
  const initialExpectedBy = initial?.expectedBy
    ? localDateTimeKey(initial.expectedBy).slice(0, 10)
    : '';
  const initialFollowUpAt = initial?.followUpAt ? localDateTimeKey(initial.followUpAt) : '';
  const [expectedBy, setExpectedBy] = useState(initialExpectedBy);
  // Dirty = the user changed the field. Edits send only dirty date fields, so
  // an untouched ISO keeps its exact stored instant — re-encoding a legacy
  // end-of-day sentinel in another timezone would shift it (#94 review R2).
  const [expectedByDirty, setExpectedByDirty] = useState(false);
  const [followUpAt, setFollowUpAt] = useState(initialFollowUpAt);
  const [followUpAtDirty, setFollowUpAtDirty] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const canSubmit = itemTitle.trim() !== '' && waitingOn.trim() !== '' && !submitting;

  const changeExpectedBy = (value: string) => {
    setExpectedBy(value);
    setExpectedByDirty(value !== initialExpectedBy);
  };
  const changeFollowUpAt = (value: string) => {
    setFollowUpAt(value);
    setFollowUpAtDirty(value !== initialFollowUpAt);
  };

  const submit = async () => {
    if (!canSubmit) return;
    const values: WaitingFormValues = {
      title: itemTitle.trim(),
      waitingOn: waitingOn.trim(),
      kind,
    };
    if (initial === undefined || expectedByDirty) {
      const expectedByIso = expectedBy === '' ? undefined : localDateTimeToIso(expectedBy);
      if (expectedBy !== '' && expectedByIso === null) {
        setFormError('预期日期格式无效，请重新选择');
        return;
      }
      values.expectedBy = expectedByIso ?? undefined;
    }
    if (initial === undefined || followUpAtDirty) {
      const followUpAtIso = followUpAt === '' ? undefined : localDateTimeToIso(followUpAt);
      if (followUpAt !== '' && followUpAtIso === null) {
        setFormError('跟进时间格式无效，请重新选择');
        return;
      }
      values.followUpAt = followUpAtIso ?? undefined;
    }
    setFormError(null);
    const success = await onSubmit(values);
    if (success && initial === undefined) {
      setItemTitle('');
      setWaitingOn('');
      setExpectedBy('');
      setFollowUpAt('');
      setExpectedByDirty(false);
      setFollowUpAtDirty(false);
    }
  };

  return (
    <Card className="gap-3.5 p-4 rounded-2xl border-border/70 bg-surface dark:border-border-dark/70 dark:bg-surface-dark shadow-2xs">
      <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
        {title}
      </Text>
      <FormField label="事项名称">
        <TextInput
          className={INPUT_CLASS}
          placeholder="事项名称（例如：等发票报销、等设计稿回复）"
          value={itemTitle}
          onChangeText={setItemTitle}
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
      <FormField label="预期日期（可选）">
        <WaitingDateField
          value={expectedBy}
          mode="date"
          label="预期日期"
          placeholder="选择期望对方完成的日期"
          now={now}
          onChange={changeExpectedBy}
          onClear={() => changeExpectedBy('')}
        />
      </FormField>
      <FormField label="跟进时间（可选）">
        <WaitingDateField
          value={followUpAt}
          mode="datetime"
          label="跟进时间"
          placeholder="到点后进入每日回顾"
          now={now}
          onChange={changeFollowUpAt}
          onClear={() => changeFollowUpAt('')}
        />
      </FormField>
      {formError !== null ? (
        <Text accessibilityRole="alert" className="font-sans text-xs text-danger dark:text-danger-dark">
          {formError}
        </Text>
      ) : null}
      <View className="flex-row justify-end gap-2 pt-1">
        {onCancel !== undefined ? (
          <Button size="sm" label="取消" variant="secondary" disabled={submitting} onPress={onCancel} />
        ) : null}
        <Button
          size="sm"
          label={submitLabel}
          disabled={!canSubmit}
          onPress={() => void submit()}
        />
      </View>
    </Card>
  );
}

export default function WaitingScreen() {
  const { data, error, add, update, trash, submitting, mutationError } = useWaitingForItems();
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
        <WaitingForm
          title="新增等待事项"
          submitLabel="添加等待"
          now={now}
          submitting={submitting}
          onSubmit={add}
        />
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
              submitting={submitting}
              onFinish={(id) => void trash(id)}
              onSave={(target, patch) => update(target, patch)}
            />
          ))
        )}
      </View>
      </View>
    </ScrollView>
  );
}
