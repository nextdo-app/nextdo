/** Weekly checklist with live defaults, legal status choices, and atomic submission. */
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useAppInsets } from '@/lib/use-app-insets';
import { router, useFocusEffect } from 'expo-router';
import { Button, Card, Tag } from '@nextdo/ui';
import {
  PROJECT_TRANSITIONS,
  type ProjectStatus,
  type SomedayDecision,
  type WeeklyReviewAnswers,
} from '@nextdo/core';
import { errorMessage as errorCopy } from '@/lib/error-messages';
import { goBack } from '@/lib/go-back';
import { PROJECT_STATUS_LABELS } from '@/lib/status-labels';
import { useWeeklyReviewData } from '@/hooks/use-weekly-review-data';
import { useSubmitReview } from '@/hooks/use-submit-review';
import { formatLocalDate, formatLocalDateTime } from '@/lib/format';


type SomedayChoice = 'keep' | 'trash';

export default function WeeklyReviewScreen() {
  const { data, error, reload } = useWeeklyReviewData();
  const { submit: submitReview, error: recordError, submitting } = useSubmitReview();
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);
  const [inboxChoice, setInboxChoice] = useState<boolean | undefined>();
  const [calendarReasonable, setCalendarReasonable] = useState(true);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [projectStatuses, setProjectStatuses] = useState<Record<string, ProjectStatus>>({});
  const [somedayChoices, setSomedayChoices] = useState<Record<string, SomedayChoice>>({});
  const waitingItems = useMemo(
    () =>
      (data?.snapshot.waitingFollowUps ?? [])
        .map((id) => data?.waiting.find((item) => item.id === id))
        .filter((item): item is NonNullable<typeof item> => item !== undefined),
    [data],
  );

  if (error !== null) {
    return (
      <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
        <Text className="mb-4 text-xl font-semibold text-ink dark:text-ink-dark">本周回顾</Text>
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
  const inboxCleared = inboxChoice ?? snapshot.inboxCount === 0;
  const projectChoice = (id: string, persisted: ProjectStatus): ProjectStatus => {
    const chosen = projectStatuses[id];
    return chosen !== undefined && (chosen === persisted || PROJECT_TRANSITIONS[persisted].includes(chosen)) ? chosen : persisted;
  };

  const toggleFollowUp = (id: string) => {
    setFollowUps((prev) => (prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]));
  };

  const buildAnswers = (): WeeklyReviewAnswers => {
    const somedayDecisions: SomedayDecision[] = data.somedays.map((item) => ({
      id: item.id,
      to: (somedayChoices[item.id] ?? 'keep') as SomedayDecision['to'],
    }));
    const projectDecisions = data.projects.map((project) => ({
      id: project.id,
      to: projectChoice(project.id, project.status),
    }));
    return {
      inboxCleared,
      followUpsRaised: followUps.filter((id) => snapshot.waitingFollowUps.includes(id)),
      calendarReasonable,
      somedayDecisions,
      projectDecisions,
    };
  };

  const submit = async () => {
    if (submitting) return;
    const recorded = await submitReview({ kind: 'weekly', snapshot, answers: buildAnswers() });
    if (recorded) goBack('/(tabs)/review');
  };

  const calendarEntries = snapshot.calendarNext7
    .map((id) => data.calendar.find((entry) => entry.id === id))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);

  const stalledIds = new Set(snapshot.stalledProjects);

  return (
    <View
      style={{ paddingTop: topPadding }}
      className="flex-1 bg-canvas px-4 pb-4 dark:bg-canvas-dark"
    >
      <ScrollView className="flex-1" contentContainerClassName="gap-4">
        <View className="flex-row items-center justify-between">
          <Button label="← 回顾" variant="ghost" onPress={() => goBack('/(tabs)/review')} />
          <Text className="text-xl font-semibold text-ink dark:text-ink-dark">本周回顾</Text>
          <View />
        </View>

        {/* 快照（只读） */}
        <Card className="gap-3">
          <View className="flex-row flex-wrap gap-2">
            <Tag label={`收件箱 ${snapshot.inboxCount} 条`} />
            <Tag label={`Someday ${snapshot.somedayCount} 条`} />
          </View>
          <View className="flex-row flex-wrap gap-2">
            <Button label="整理收件箱" variant="secondary" onPress={() => router.push('/(tabs)/inbox')} />
            <Button label="查看等待事项" variant="secondary" onPress={() => router.push('/waiting')} />
            <Button label="查看习惯记录" variant="secondary" onPress={() => router.push('/habits')} />
          </View>
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
          {calendarEntries.length > 0 ? (
            <View className="gap-1">
              <Text className="text-xs font-medium text-muted dark:text-muted-dark">未来 7 天日程</Text>
              {calendarEntries.map((entry) => (
                <Text key={entry.id} className="text-sm text-ink dark:text-ink-dark">
                  {entry.title}（{formatLocalDateTime(entry.startsAt)}）
                </Text>
              ))}
            </View>
          ) : null}
        </Card>

        {/* 项目（状态决策区） */}
        <View className="gap-2">
          <Text className="text-base font-medium text-ink dark:text-ink-dark">项目（{snapshot.projects.length}）</Text>
          {snapshot.projects.length === 0 ? (
            <Card>
              <Text className="text-sm text-muted dark:text-muted-dark">还没有项目。</Text>
            </Card>
          ) : (
            snapshot.projects.map((project) => {
              const persisted = data.projects.find((entry) => entry.id === project.id)?.status;
              if (persisted === undefined) return null;
              const current = projectChoice(project.id, persisted);
              const options = PROJECT_TRANSITIONS[persisted];
              return (
                <Card key={project.id} className="gap-2">
                  <View className="flex-row items-center gap-2">
                    <Text className="flex-1 text-base text-ink dark:text-ink-dark">{project.title}</Text>
                    <Tag
                      label={project.hasOpenAction ? '有进行中的行动' : '缺少行动'}
                      tone={project.hasOpenAction ? 'accent' : 'danger'}
                    />
                    {stalledIds.has(project.id) ? <Tag label="停滞 ≥ 14 天" tone="warning" /> : null}
                  </View>
                  <Text className="text-xs text-muted dark:text-muted-dark">
                    最近进展：{project.lastProgressAt !== null ? formatLocalDate(project.lastProgressAt) : '暂无'}
                  </Text>
                  <Button label={`打开项目：${project.title}`} variant="ghost" onPress={() => router.push(`/projects/${project.id}`)} />
                  {options.length === 0 ? <Text className="text-sm text-muted dark:text-muted-dark">{PROJECT_STATUS_LABELS[persisted]}（状态不可更改）</Text> : <View className="flex-row flex-wrap gap-2">
                    {[persisted, ...options].map((status) => (
                      <Pressable
                        key={status}
                        accessibilityRole="button"
                        accessibilityLabel={`项目 ${project.title} 状态：${PROJECT_STATUS_LABELS[status]}`}
                        accessibilityState={{ selected: current === status }}
                        onPress={() =>
                          setProjectStatuses((prev) => ({ ...prev, [project.id]: status }))
                        }
                        className={
                          current === status
                            ? 'min-h-11 justify-center rounded-full bg-accent px-3 py-2 dark:bg-accent-dark'
                            : 'min-h-11 justify-center rounded-full border border-border px-3 py-2 dark:border-border-dark'
                        }
                      >
                        <Text
                          className={
                            current === status
                              ? 'text-sm text-on-accent'
                              : 'text-sm text-ink dark:text-ink-dark'
                          }
                        >
                          {PROJECT_STATUS_LABELS[status]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>}
                </Card>
              );
            })
          )}
        </View>

        {/* 待跟进（勾选 = 已跟进，仅记录） */}
        {waitingItems.length > 0 ? (
          <View className="gap-2">
            <Text className="text-base font-medium text-ink dark:text-ink-dark">跟进勾选</Text>
            <Text className="text-sm text-muted dark:text-muted-dark">勾选仅记录本次跟进，不修改等待事项，也不设置提醒。</Text>
            {waitingItems.map((item) => (
              <Card key={item.id} className="gap-1">
                <View className="flex-row items-center justify-between gap-2">
                  <Text className="flex-1 text-sm text-ink dark:text-ink-dark">{item.title}</Text>
                  <Button
                    label={followUps.includes(item.id) ? '已跟进 ✓' : '已跟进'}
                    variant={followUps.includes(item.id) ? 'primary' : 'secondary'}
                    onPress={() => toggleFollowUp(item.id)}
                  />
                </View>
              </Card>
            ))}
          </View>
        ) : null}

        {/* Someday（保留/删除） */}
        <View className="gap-2">
          <Text className="text-base font-medium text-ink dark:text-ink-dark">Someday（{data.somedays.length}）</Text>
          {data.somedays.length === 0 ? (
            <Card>
              <Text className="text-sm text-muted dark:text-muted-dark">没有"有空再说"的条目。</Text>
            </Card>
          ) : (
            data.somedays.map((item) => {
              const choice = somedayChoices[item.id] ?? 'keep';
              return (
                <Card key={item.id} className="gap-2">
                  <Text className="text-sm text-ink dark:text-ink-dark">{item.title}</Text>
                  <View className="flex-row gap-2">
                    <Button
                      label="保留"
                      variant={choice === 'keep' ? 'primary' : 'secondary'}
                      onPress={() => setSomedayChoices((prev) => ({ ...prev, [item.id]: 'keep' }))}
                    />
                    <Button
                      label="删除"
                      variant={choice === 'trash' ? 'primary' : 'ghost'}
                      onPress={() => setSomedayChoices((prev) => ({ ...prev, [item.id]: 'trash' }))}
                    />
                  </View>
                </Card>
              );
            })
          )}
        </View>

        {/* 确认开关 */}
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm text-ink dark:text-ink-dark">收件箱已清空</Text>
            <Button
              label={inboxCleared ? '是 ✓' : '否'}
              variant={inboxCleared ? 'primary' : 'secondary'}
              onPress={() => setInboxChoice(!inboxCleared)}
            />
          </View>
          <View className="flex-row items-center justify-between">
            <Text className="text-sm text-ink dark:text-ink-dark">日程安排合理</Text>
            <Button
              label={calendarReasonable ? '是 ✓' : '否'}
              variant={calendarReasonable ? 'primary' : 'secondary'}
              onPress={() => setCalendarReasonable((value) => !value)}
            />
          </View>
        </Card>

        {/* 提交 */}
        <View className="gap-2">
          {recordError !== null ? <Text className="text-sm text-danger">提交失败，本次变更均未保存。选择已保留，可重试。{recordError}</Text> : null}
          <Button label="刷新回顾数据" variant="ghost" onPress={reload} disabled={submitting} />
          <Button label={submitting ? '提交中…' : '提交回顾'} onPress={() => void submit()} disabled={submitting} />
        </View>
      </ScrollView>
    </View>
  );
}
