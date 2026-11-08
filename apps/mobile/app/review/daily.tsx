/** Daily snapshot and decisions; submission commits all changes and the record together. */
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useAppInsets } from '@/lib/use-app-insets';
import { router, useFocusEffect } from 'expo-router';
import { Button, Card, Tag } from '@nextdo/ui';
import { errorMessage as errorCopy } from '@/lib/error-messages';
import { goBack } from '@/lib/go-back';
import { useDailyReviewData } from '@/hooks/use-daily-review-data';
import { useSubmitReview } from '@/hooks/use-submit-review';
import { DateTimePicker } from '@/components/datetime-picker';
import { useAppClock } from '@/hooks/use-app-clock';
import { formatLocalDateTime } from '@/lib/format';
import { KIND_LABELS } from '@/lib/kind-labels';
import { localDayAt, tomorrowAt } from '@/lib/review-dates';
import type { DailyReviewAnswers } from '@nextdo/core';

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
  const { submit: submitReview, error: recordError, submitting } = useSubmitReview();
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);
  const [choices, setChoices] = useState<Record<string, RowChoice>>({});
  const [datePickerId, setDatePickerId] = useState<string | null>(null);
  const [dateHints, setDateHints] = useState<Record<string, string | null>>({});

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
          <Button label="重试加载" onPress={reload} />
          <Button label="← 回顾" variant="ghost" onPress={() => goBack('/(tabs)/review')} />
        </Card>
      </View>
    );
  }

  if (data === null) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas p-4 dark:bg-canvas-dark">
        <Text className="text-base text-muted dark:text-muted-dark">加载中…</Text>
        <Button label="← 回顾" variant="ghost" onPress={() => goBack('/(tabs)/review')} />
      </View>
    );
  }

  const { snapshot } = data;

  const setChoice = (actionId: string, choice: RowChoice) => {
    setChoices((prev) => ({ ...prev, [actionId]: choice }));
    setDateHints((prev) => ({ ...prev, [actionId]: null }));
  };

  const applyReschedule = (actionId: string, key: string) => {
    const target = localDayAt(key);
    if (target === null || target.getTime() <= now.getTime()) {
      setDateHints((prev) => ({ ...prev, [actionId]: '请选择尚未到达的日期（当地 08:00）' }));
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
    const recorded = await submitReview({ kind: 'daily', snapshot, answers: buildAnswers() });
    if (recorded) goBack('/(tabs)/review');
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
          <View className="flex-row flex-wrap gap-2">
            <Button label="整理收件箱" variant="secondary" onPress={() => router.push('/(tabs)/inbox')} />
            <Button label="查看等待事项" variant="secondary" onPress={() => router.push('/waiting')} />
            <Button label="查看习惯记录" variant="secondary" onPress={() => router.push('/habits')} />
          </View>
          <Text className="text-sm font-medium text-ink dark:text-ink-dark">今日完成的事项</Text>
          {data.completed.length === 0 ? <Text className="text-sm text-muted dark:text-muted-dark">今天还没有完成记录。</Text> : data.completed.map((entry) => (
            <Text key={entry.id} className="text-sm text-ink dark:text-ink-dark">
              {entry.title} · {entry.kind === 'do_now' ? '即时完成' : KIND_LABELS[entry.kind]}
            </Text>
          ))}
          {uncoveredProjects.length > 0 ? (
            <View className="gap-1">
              <Text className="text-xs font-medium text-muted dark:text-muted-dark">缺少行动的项目</Text>
              {uncoveredProjects.map((project) => (
                <Button key={project.id} label={`打开项目：${project.title}`} variant="ghost" onPress={() => router.push(`/projects/${project.id}`)} />
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
          <Text className="text-sm text-muted dark:text-muted-dark">安排到明日：明天 08:00 恢复推荐并提醒。暂不处理：仅保存本次选择，不改变行动状态。</Text>
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
                      label="安排到明日"
                      variant={choice.type === 'tomorrow' ? 'primary' : 'secondary'}
                      onPress={() =>
                        setChoice(action.id, choice.type === 'tomorrow' ? NONE : { type: 'tomorrow' })
                      }
                    />
                    <Button
                      label="暂不处理"
                      variant={choice.type === 'skipped' ? 'primary' : 'ghost'}
                      onPress={() => setChoice(action.id, choice.type === 'skipped' ? NONE : { type: 'skipped' })}
                    />
                  </View>
                  <Text className="text-xs text-muted dark:text-muted-dark">排期日期（当地 08:00）</Text>
                  <Button
                    label={choice.type === 'rescheduled' ? `排期到 ${choice.toDate} 08:00` : '选择排期日期'}
                    variant={choice.type === 'rescheduled' ? 'primary' : 'secondary'}
                    onPress={() => setDatePickerId(action.id)}
                  />
                  {choice.type === 'tomorrow' ? <Text className="text-sm text-ink dark:text-ink-dark">已选：{formatLocalDateTime(tomorrowAt(8, now).toISOString())}</Text> : null}
                  {choice.type === 'skipped' ? <Text className="text-sm text-muted dark:text-muted-dark">已选：暂不处理（仅记录）</Text> : null}
                  {choice.type === 'completed' ? <Text className="text-sm text-ink dark:text-ink-dark">已选：完成行动</Text> : null}
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
          {recordError !== null ? <Text className="text-sm text-danger">提交失败，本次变更均未保存。选择已保留，可重试。{recordError}</Text> : null}
          <Button label="刷新回顾数据" variant="ghost" onPress={reload} disabled={submitting} />
          <Button label={submitting ? '提交中…' : '提交回顾'} onPress={() => void submit()} disabled={submitting} />
        </View>
      </ScrollView>
      {datePickerId !== null ? <DateTimePicker mode="date" title="选择排期日期" now={now}
        value={choices[datePickerId]?.type === 'rescheduled' ? choices[datePickerId].toDate : ''}
        onClose={() => setDatePickerId(null)}
        onConfirm={(key) => { applyReschedule(datePickerId, key); setDatePickerId(null); }} /> : null}
    </View>
  );
}
