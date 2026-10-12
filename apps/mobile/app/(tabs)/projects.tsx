/**
 * The Projects tab (design §4.2 — Paper Serenity rework): project cards
 * with the derived stats (progress, earliest open deadline, the current
 * next-action sub-card, the missing-next warning, the stall tag) + the
 * filter chips (进行中 / 无下一步 / 已归档, counts derived live) + the
 * inline new-project form.
 *
 * Data: `useProjectCards` (the watched `projectCardsWatchQuery` — counts,
 * deadline, last progress and the next action all re-derive themselves on
 * action changes). The stall flag is derived in this screen from the watch
 * row + the app clock (`isProjectStalled` — the watch mapper does not
 * tick). Presentational otherwise; the new project goes through
 * `useAddProject` (component-guidelines).
 *
 * Row tap → the project detail route (`/projects/[id]`). The inline
 * `NewProjectForm` creates the project ONLY (no first action — contexts
 * belong to actions; the first action lands via the detail's AddActionForm
 * or the Clarify wizard's project form).
 */
import { useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useAppInsets } from '@/lib/use-app-insets';
import { router } from 'expo-router';
import { Button, Card, ContextChip, EmptyState, ProgressBar, Tag, ValueChips, cn } from '@nextdo/ui';
import type { ProjectCard } from '@nextdo/db';
import type { Value } from '@nextdo/core';
import { useProjectCards, isProjectStalled } from '@/hooks/use-project-cards';
import { useAddProject } from '@/hooks/use-add-project';
import { useContexts } from '@/hooks/use-contexts';
import { useAppClock } from '@/hooks/use-app-clock';
import { DateTimePicker } from '@/components/datetime-picker';
import { DeadlineChip } from '@/components/deadline-chip';
import { PickerField } from '@/components/picker-field';
import { endOfLocalDayIso } from '@/lib/clarify-flow';
import { errorMessage } from '@/lib/error-messages';

type FilterKind = 'active' | 'no-next' | 'archived';

const INPUT_CLASS =
  'rounded-md border border-border/80 bg-canvas p-3 text-base text-ink placeholder:text-muted focus:border-accent dark:border-border-dark dark:bg-canvas-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

/** The inline new-project form (title + outcome + value 1–5 + optional
 *  deadline). Project only — no context field (contexts belong to
 *  actions). */
function NewProjectForm({ onDone }: { onDone: () => void }) {
  const { add, error } = useAddProject();
  const now = useAppClock();
  const [title, setTitle] = useState('');
  const [outcome, setOutcome] = useState('');
  const [value, setValue] = useState<Value>(3);
  /** `YYYY-MM-DD` as picked; the row stores it as an ISO datetime. */
  const [deadline, setDeadline] = useState('');
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim() !== '' && outcome.trim() !== '' && !submitting;

  const create = () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const deadlineIso = deadline === '' ? undefined : (endOfLocalDayIso(deadline) ?? undefined);
    void add({ title, outcome, value, deadline: deadlineIso }).then(() => {
      setSubmitting(false);
      setTitle('');
      setOutcome('');
      setValue(3);
      setDeadline('');
      onDone();
    });
  };

  return (
    <Card className="gap-3.5 p-5 shadow-md">
      <Text className="font-sans text-sm font-semibold text-muted dark:text-muted-dark">新项目</Text>
      <TextInput
        className={INPUT_CLASS}
        placeholder="项目标题"
        value={title}
        onChangeText={setTitle}
      />
      <TextInput
        className={INPUT_CLASS}
        placeholder="完成是什么样（结果）"
        value={outcome}
        onChangeText={setOutcome}
      />
      <ValueChips value={value} onChange={setValue} />
      <PickerField
        label="截止"
        value={deadline}
        placeholder="截止日期（可选）"
        onPress={() => setShowDeadlinePicker(true)}
        onClear={() => setDeadline('')}
      />
      {showDeadlinePicker ? (
        <DateTimePicker
          mode="date"
          title="选择截止日期"
          value={deadline}
          now={now}
          onConfirm={setDeadline}
          onClose={() => setShowDeadlinePicker(false)}
        />
      ) : null}
      {error !== null ? <Text className="font-sans text-sm text-danger">{errorMessage(error)}</Text> : null}
      <View className="mt-1 flex-row gap-2.5">
        <Button label="创建" onPress={create} disabled={!canSubmit} />
        <Button label="取消" variant="secondary" onPress={onDone} />
      </View>
    </Card>
  );
}

/** One filter chip (进行中 / 无下一步 / 已归档) with its live count. */
function FilterChip({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${count}`}
      accessibilityState={{ selected: active }}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      onPress={onPress}
      className={cn(
        'h-8 flex-row items-center rounded-full px-3.5',
        active
          ? 'bg-accent dark:bg-accent-dark'
          : 'border border-border/80 bg-surface dark:border-border-dark dark:bg-surface-dark',
      )}
    >
      <Text
        className={cn(
          'font-sans text-xs font-semibold',
          active ? 'text-on-accent dark:text-on-accent-dark' : 'text-ink dark:text-ink-dark',
        )}
      >
        {label} {count}
      </Text>
    </Pressable>
  );
}

/** One project card (design §4.2): status dot + title + deadline chip,
 *  the progress bar, the current next-action sub-card, and the warning
 *  zone (missing-next wins; else the stall tag). */
function ProjectCardRow({
  card,
  now,
  contextName,
}: {
  card: ProjectCard;
  now: Date;
  contextName: (id: string) => string;
}) {
  const total = card.openCount + card.completedCount;
  const missingNext = card.status === 'active' && card.openCount === 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`打开项目：${card.title}`}
      onPress={() => router.push(`/projects/${card.id}`)}
    >
      <Card className="gap-2.5 p-4">
        <View className="flex-row items-center gap-2">
          <View
            className={cn(
              'h-2.5 w-2.5 shrink-0 rounded-full',
              card.status === 'active'
                ? 'bg-accent dark:bg-accent-dark'
                : 'bg-muted dark:bg-muted-dark',
            )}
          />
          <Text
            className="flex-1 font-sans text-base font-semibold text-ink dark:text-ink-dark"
            numberOfLines={1}
          >
            {card.title}
          </Text>
          {/* The PROJECT's own deadline (issue #16) — shown before the
              action-level chip below so the two deadlines are never confused
              for each other. */}
          <DeadlineChip deadline={card.deadline} now={now} />
          {/* …and the soonest deadline among its OPEN actions. Also a
              DeadlineChip so the urgency wording matches everywhere. */}
          <DeadlineChip deadline={card.earliestOpenDeadline} now={now} />
        </View>

        <View className="flex-row items-center gap-2">
          <ProgressBar
            value={total > 0 ? card.completedCount / total : 0}
            className="flex-1"
          />
          <Text className="font-sans text-xs text-muted dark:text-muted-dark">
            {card.completedCount}/{total} 行动
          </Text>
        </View>

        {card.nextAction !== null ? (
          <View className="rounded-lg bg-accent/10 p-3 dark:bg-accent-dark/15">
            <View className="flex-row items-center justify-between gap-2">
              <Text className="font-sans text-xs font-semibold text-accent dark:text-accent-dark">
                ▶ 当前下一步行动
              </Text>
              <DeadlineChip deadline={card.nextAction.deadline} now={now} />
            </View>
            <Text className="mt-1 font-sans text-sm text-ink dark:text-ink-dark" numberOfLines={2}>
              {card.nextAction.title}
            </Text>
            {card.nextAction.contextIds.length > 0 ? (
              <View className="mt-1.5 flex-row flex-wrap gap-1.5">
                {card.nextAction.contextIds.map((id) => (
                  <ContextChip key={id} name={contextName(id)} />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {missingNext ? (
          <View className="gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <Text className="font-sans text-xs font-semibold text-warning">
              ⚠ 缺少下一步 · 项目处于停滞风险
            </Text>
            <Text className="font-sans text-xs text-muted dark:text-muted-dark">
              没有进行中的行动 — 去项目详情加一条明确的下一步。
            </Text>
            <View>
              <Button
                size="sm"
                label="澄清下一步"
                variant="secondary"
                onPress={() => router.push(`/projects/${card.id}`)}
              />
            </View>
          </View>
        ) : isProjectStalled(card, now) ? (
          <Tag label="14 天无进展" tone="neutral" />
        ) : null}
      </Card>
    </Pressable>
  );
}

export default function ProjectsScreen() {
  const { data: cards, error } = useProjectCards();
  const { data: contexts } = useContexts();
  const now = useAppClock();
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<FilterKind>('active');
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);
  // next-action context ids → display names (unknown ids fall back to the id).
  const contextName = (id: string) =>
    contexts?.find((entry) => entry.id === id)?.name ?? id;

  const activeCards = cards.filter((card) => card.status === 'active');
  const noNextCards = activeCards.filter((card) => card.openCount === 0);
  const archivedCards = cards.filter((card) => card.status !== 'active');
  const visible =
    filter === 'active' ? activeCards : filter === 'no-next' ? noNextCards : archivedCards;

  const filterMeta: Record<
    FilterKind,
    { label: string; count: number; emptyTitle: string; emptyHint: string }
  > = {
    active: {
      label: '进行中',
      count: activeCards.length,
      emptyTitle: '还没有进行中的项目',
      emptyHint: '需要多个步骤才能完成的事，就是一个项目。点上方「＋ 新建项目」。',
    },
    'no-next': {
      label: '无下一步',
      count: noNextCards.length,
      emptyTitle: '没有缺少下一步的项目',
      emptyHint: '所有进行中的项目都挂着明确的下一步行动。',
    },
    archived: {
      label: '已归档',
      count: archivedCards.length,
      emptyTitle: '还没有归档的项目',
      emptyHint: '完成、搁置或放弃的项目会出现在这里。',
    },
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ paddingTop: topPadding }}
      className="flex-1 w-full max-w-3xl mx-auto bg-canvas px-4 pb-4 dark:bg-canvas-dark"
    >
      {/* Header block (design §4.2) */}
      <Text className="font-display text-3xl font-bold tracking-tight text-ink dark:text-ink-dark">
        项目
      </Text>
      <View className="mt-1 flex-row items-end gap-2">
        <Text className="flex-1 font-sans text-sm leading-5 text-muted dark:text-muted-dark">
          需要多个行动才能完成的具体结果。每个进行中的项目都应有一个明确的下一步。
        </Text>
        <Tag label={`${activeCards.length} 进行中`} tone="accent" />
      </View>

      {/* Filter chips (counts derived live from the watch rows) */}
      <View className="mt-3.5 flex-row gap-2">
        {(['active', 'no-next', 'archived'] as const).map((kind) => (
          <FilterChip
            key={kind}
            label={filterMeta[kind].label}
            count={filterMeta[kind].count}
            active={filter === kind}
            onPress={() => setFilter(kind)}
          />
        ))}
      </View>

      {showForm ? (
        <View className="mt-3">
          <NewProjectForm onDone={() => setShowForm(false)} />
        </View>
      ) : (
        <View className="mt-3">
          <Button
            label="＋ 新建项目（明确具体成果）"
            variant="secondary"
            className="w-full"
            onPress={() => setShowForm(true)}
          />
        </View>
      )}

      <View className="mt-3 flex-1">
        {error !== null ? (
          <EmptyState title="加载项目失败" hint={errorMessage(error)} />
        ) : visible.length === 0 ? (
          <EmptyState title={filterMeta[filter].emptyTitle} hint={filterMeta[filter].emptyHint} />
        ) : (
          <FlatList
            data={visible}
            keyExtractor={(item) => item.id}
            contentContainerClassName="gap-2.5"
            renderItem={({ item }) => (
              <ProjectCardRow card={item} now={now} contextName={contextName} />
            )}
          />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
