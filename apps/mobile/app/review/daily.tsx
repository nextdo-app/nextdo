/**
 * The daily review route (design.md §4.5 — PRD R7): the read-only
 * snapshot (inbox / completed / uncovered projects / waiting follow-ups /
 * today+tomorrow schedule) + the decision area over `stillOpen` (per row:
 * 已完成 / 明日必做 / 跳过 / 排期到 <日期> 08:00) + the read-only
 * repeated-skips list (reclarify entry for next/calendar kinds).
 *
 * Submit order is fixed (design.md §8): the decision transactions land
 * FIRST (rescheduled → `snoozeAction(<date> 08:00 本地)`; completed →
 * `completeAction`; 明日必做 → `snoozeAction(明天 08:00)`), and only then
 * the append-only `addReviewRecord`. Any failed step stops the sequence
 * with a message and NO record is written — never "recorded but not
 * executed". Presses only collect answers; nothing mutates until submit.
 */
import { useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useAppInsets } from '@/lib/use-app-insets';
import { router } from 'expo-router';
import { Button, Card, Tag } from '@nextdo/ui';
import { errorMessage as errorCopy } from '@/lib/error-messages';
import { goBack } from '@/lib/go-back';
import { useDailyReviewData } from '@/hooks/use-daily-review-data';
import { useCompleteAction } from '@/hooks/use-complete-action';
import { useSnoozeAction } from '@/hooks/use-snooze-action';
import { useAddReviewRecord } from '@/hooks/use-add-review-record';
import { useAppClock } from '@/hooks/use-app-clock';
import { formatLocalDateTime } from '@/lib/format';
import { KIND_LABELS } from '@/lib/kind-labels';
import { localDayAt, tomorrowAt } from '@/lib/review-dates';
import type { DailyReviewAnswers } from '@nextdo/core';

const INPUT_CLASS =
  'flex-1 rounded-xl border border-border/80 bg-surface px-3.5 py-2 text-sm text-ink placeholder:text-muted shadow-2xs focus:border-accent dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

/** The per-row answer (single choice — pressing one clears the others). */
type RowChoice =
  | { type: 'none' }
  | { type: 'completed' }
  | { type: 'tomorrow' }
  | { type: 'skipped' }
  | { type: 'rescheduled'; toDate: string };

const NONE: RowChoice = { type: 'none' };

/** A repeated-skip row resolved to a displayable title + kind. */
interface SkipRow {
  id: string;
  title: string;
  kind: 'next' | 'calendar' | 'habit';
}

function resolveSkipRows(
  ids: string[],
  nextActionIds: Set<string>,
  calendarActionIds: Set<string>,
  titleById: Map<string, string>,
): SkipRow[] {
  return ids.map((id) => {
    const kind: SkipRow['kind'] = nextActionIds.has(id)
      ? 'next'
      : calendarActionIds.has(id)
        ? 'calendar'
        : 'habit';
    return { id, title: titleById.get(id) ?? '（未知行动）', kind };
  });
}

export default function DailyReviewScreen() {
  const { data, error, reload } = useDailyReviewData();
  const now = useAppClock();
  const { complete, error: completeError } = useCompleteAction();
  const { snooze, error: snoozeError } = useSnoozeAction();
  const { add, error: recordError } = useAddReviewRecord();
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);
  const [choices, setChoices] = useState<Record<string, RowChoice>>({});
  const [dateInputs, setDateInputs] = useState<Record<string, string>>({});
  const [dateHints, setDateHints] = useState<Record<string, string | null>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const stillOpen = useMemo(
    () =>
      (data?.snapshot.stillOpen ?? [])
        .map((id) => data?.actions.find((action) => action.id === id))
        .filter((action): action is NonNullable<typeof action> => action !== undefined),
    [data],
  );

  const skipRows = useMemo<SkipRow[]>(() => {
    if (data === null) return [];
    const nextIds = new Set(data.actions.map((action) => action.id));
    const calendarIds = new Set(data.calendar.map((entry) => entry.id));
    const titleById = new Map<string, string>();
    for (const action of data.actions) titleById.set(action.id, action.title);
    for (const entry of data.calendar) titleById.set(entry.id, entry.title);
    for (const day of data.habitDays) {
      const habit = data.habits.find((entry) => entry.id === day.habitId);
      titleById.set(day.id, habit?.title ?? '习惯');
    }
    return resolveSkipRows(data.snapshot.repeatedSkips, nextIds, calendarIds, titleById);
  }, [data]);

  if (error !== null) {
    return (
      <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
        <Text className="mb-4 text-xl font-semibold text-ink dark:text-ink-dark">今日回顾</Text>
        <Card>
          <Text className="text-danger">加载回顾数据失败：{errorCopy(error)}</Text>
        </Card>
      </View>
    );
  }

  if (data === null) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas p-4 dark:bg-canvas-dark">
        <Text className="text-base text-muted dark:text-muted-dark">加载中…</Text>
      </View>
    );
  }

  const { snapshot } = data;

  const setChoice = (actionId: string, choice: RowChoice) => {
    setChoices((prev) => ({ ...prev, [actionId]: choice }));
    setDateHints((prev) => ({ ...prev, [actionId]: null }));
  };

  const applyReschedule = (actionId: string) => {
    const key = (dateInputs[actionId] ?? '').trim();
    if (localDayAt(key) === null) {
      setDateHints((prev) => ({ ...prev, [actionId]: '日期格式应为 YYYY-MM-DD（例如 2026-09-24）' }));
      return;
    }
    setChoice(actionId, { type: 'rescheduled', toDate: key });
  };

  const buildAnswers = (): DailyReviewAnswers => {
    const answers: DailyReviewAnswers = {
      completedActionIds: [],
      rescheduled: [],
      skippedNoted: [],
      tomorrowMustDo: [],
    };
    for (const action of stillOpen) {
      const choice = choices[action.id] ?? NONE;
      if (choice.type === 'completed') answers.completedActionIds.push(action.id);
      else if (choice.type === 'tomorrow') answers.tomorrowMustDo.push(action.id);
      else if (choice.type === 'skipped') answers.skippedNoted.push(action.id);
      else if (choice.type === 'rescheduled') {
        // Already validated by applyReschedule (localDayAt !== null) — the
        // `?? now` fallback is unreachable unless that invariant breaks.
        answers.rescheduled.push({
          actionId: action.id,
          toDate: (localDayAt(choice.toDate) ?? now).toISOString(),
        });
      }
    }
    return answers;
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const answers = buildAnswers();
    try {
      // 1. Rescheduled → snooze to the picked local day at 08:00.
      for (const entry of answers.rescheduled) {
        const target = new Date(entry.toDate);
        const ok = await snooze({
          actionKind: 'next',
          actionId: entry.actionId,
          snoozedUntil: target,
        });
        if (!ok) throw new Error('snooze failed');
      }
      // 2. Completed → the complete transaction.
      for (const actionId of answers.completedActionIds) {
        const ok = await complete({ actionKind: 'next', actionId });
        if (!ok) throw new Error('complete failed');
      }
      // 3. Tomorrow must-do → snooze to tomorrow 08:00 (local).
      const tomorrowTarget = tomorrowAt(8, now);
      for (const actionId of answers.tomorrowMustDo) {
        const ok = await snooze({ actionKind: 'next', actionId, snoozedUntil: tomorrowTarget });
        if (!ok) throw new Error('snooze failed');
      }
      // 4. Last: the append-only record (all-or-nothing with step 1–3).
      const recorded = await add({ kind: 'daily', snapshot, answers });
      if (!recorded) throw new Error('record failed');
      reload();
      goBack('/(tabs)/review');
    } catch {
      // The decision-transaction errors are surfaced through their hooks
      // (below) — the record was NOT written (submit stopped before step 4).
      setSubmitError('提交在中途失败，回顾记录未写入。请检查提示后重新提交。');
    } finally {
      setSubmitting(false);
    }
  };

  const calendarRow = (ids: string[], label: string) => {
    const entries = ids
      .map((id) => data.calendar.find((entry) => entry.id === id))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
    if (entries.length === 0) return null;
    return (
      <View className="gap-1">
        <Text className="text-xs font-medium text-muted dark:text-muted-dark">{label}</Text>
        {entries.map((entry) => (
          <Text key={entry.id} className="text-sm text-ink dark:text-ink-dark">
            {entry.title}（{formatLocalDateTime(entry.startsAt)}）
          </Text>
        ))}
      </View>
    );
  };

  const uncoveredProjects = snapshot.projectsMissingActions
    .map((id) => data.projects.find((project) => project.id === id))
    .filter((project): project is NonNullable<typeof project> => project !== undefined);

  const waitingItems = snapshot.waitingFollowUps
    .map((id) => data.waiting.find((item) => item.id === id))
    .filter((item): item is NonNullable<typeof item> => item !== undefined);

  return (
    <View
      style={{ paddingTop: topPadding }}
      className="flex-1 bg-canvas px-4 pb-4 dark:bg-canvas-dark"
    >
      <ScrollView className="flex-1" contentContainerClassName="gap-4">
        <View className="flex-row items-center justify-between">
          <Button label="← 回顾" variant="ghost" onPress={() => goBack('/(tabs)/review')} />
          <Text className="text-xl font-semibold text-ink dark:text-ink-dark">今日回顾</Text>
          <View />
        </View>

        {/* 快照（只读） */}
        <Card className="gap-3">
          <View className="flex-row flex-wrap gap-2">
            <Tag label={`收件箱 ${snapshot.inboxCount} 条`} />
            <Tag label={`今日完成 ${snapshot.completedToday.length} 项`} tone="accent" />
          </View>
          {uncoveredProjects.length > 0 ? (
            <View className="gap-1">
              <Text className="text-xs font-medium text-muted dark:text-muted-dark">缺少行动的项目</Text>
              {uncoveredProjects.map((project) => (
                <Text key={project.id} className="text-sm text-ink dark:text-ink-dark">
                  {project.title}
                </Text>
              ))}
            </View>
          ) : null}
          {waitingItems.length > 0 ? (
            <View className="gap-1">
              <Text className="text-xs font-medium text-muted dark:text-muted-dark">待跟进（已过期）</Text>
              {waitingItems.map((item) => (
                <Text key={item.id} className="text-sm text-ink dark:text-ink-dark">
                  {item.title} — 等{item.waitingOn}
                </Text>
              ))}
            </View>
          ) : null}
          {calendarRow(snapshot.calendarToday, '今日日程')}
          {calendarRow(snapshot.calendarTomorrow, '明日日程')}
        </Card>

        {/* 未完成行动（决策区） */}
        <View className="gap-2">
          <Text className="text-base font-medium text-ink dark:text-ink-dark">
            未完成的行动（{stillOpen.length}）
          </Text>
          {stillOpen.length === 0 ? (
            <Card>
              <Text className="text-sm text-muted dark:text-muted-dark">没有未完成的行动 — 直接提交即可。</Text>
            </Card>
          ) : (
            stillOpen.map((action) => {
              const choice = choices[action.id] ?? NONE;
              const hint = dateHints[action.id];
              return (
                <Card key={action.id} className="gap-2">
                  <View className="flex-row items-center gap-2">
                    <Text className="flex-1 text-base text-ink dark:text-ink-dark">{action.title}</Text>
                    <Tag label={`${action.estMinutes} 分钟`} />
                  </View>
                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      label="已完成"
                      variant={choice.type === 'completed' ? 'primary' : 'secondary'}
                      onPress={() =>
                        setChoice(action.id, choice.type === 'completed' ? NONE : { type: 'completed' })
                      }
                    />
                    <Button
                      label="明日必做"
                      variant={choice.type === 'tomorrow' ? 'primary' : 'secondary'}
                      onPress={() =>
                        setChoice(action.id, choice.type === 'tomorrow' ? NONE : { type: 'tomorrow' })
                      }
                    />
                    <Button
                      label="跳过"
                      variant={choice.type === 'skipped' ? 'primary' : 'ghost'}
                      onPress={() => setChoice(action.id, choice.type === 'skipped' ? NONE : { type: 'skipped' })}
                    />
                  </View>
                  <View className="flex-row items-center gap-2">
                    <TextInput
                      className={INPUT_CLASS}
                      placeholder="排期到 YYYY-MM-DD（08:00）"
                      autoCapitalize="none"
                      value={dateInputs[action.id] ?? ''}
                      onChangeText={(value) =>
                        setDateInputs((prev) => ({ ...prev, [action.id]: value }))
                      }
                    />
                    <Button
                      label="排期"
                      variant={choice.type === 'rescheduled' ? 'primary' : 'secondary'}
                      onPress={() => applyReschedule(action.id)}
                    />
                  </View>
                  {hint !== undefined && hint !== null ? (
                    <Text className="text-sm text-danger">{hint}</Text>
                  ) : null}
                </Card>
              );
            })
          )}
        </View>

        {/* 反复跳过（只读） */}
        {skipRows.length > 0 ? (
          <View className="gap-2">
            <Text className="text-base font-medium text-ink dark:text-ink-dark">反复跳过（连续 ≥ 3 次）</Text>
            {skipRows.map((row) => (
              <Card key={row.id} className="gap-1">
                <View className="flex-row items-center gap-2">
                  <Text className="flex-1 text-sm text-ink dark:text-ink-dark">{row.title}</Text>
                  <Tag label={KIND_LABELS[row.kind]} />
                </View>
                {row.kind !== 'habit' ? (
                  <Button
                    label="重新明晰"
                    variant="secondary"
                    onPress={() => router.push(`/reclarify/${row.id}?kind=${row.kind}`)}
                  />
                ) : null}
              </Card>
            ))}
          </View>
        ) : null}

        {/* 提交 */}
        <View className="gap-2">
          {submitError !== null ? <Text className="text-sm text-danger">{submitError}</Text> : null}
          {completeError !== null ? <Text className="text-sm text-danger">{errorCopy(completeError)}</Text> : null}
          {snoozeError !== null ? <Text className="text-sm text-danger">{errorCopy(snoozeError)}</Text> : null}
          {recordError !== null ? <Text className="text-sm text-danger">{errorCopy(recordError)}</Text> : null}
          <Button label={submitting ? '提交中…' : '提交回顾'} onPress={() => void submit()} disabled={submitting} />
        </View>
      </ScrollView>
    </View>
  );
}
