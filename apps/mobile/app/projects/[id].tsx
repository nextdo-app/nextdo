/**
 * The project detail route (design.md §4.4 — PRD R6): the project header
 * (title / status / value / outcome) + its OPEN next actions (complete /
 * snooze / trash per row) + the inline add-action form (`addNextAction`
 * carrying the projectId).
 *
 * Data: the project row comes from the `useProjects` watched query (the
 * coverage tag re-derives itself when an action lands or completes); the
 * action list is query-style via `useProjectActions` (client-side
 * projectId filter, design.md §8). Project STATUS: active ↔ on-hold can be
 * switched right here (归档 / 恢复 quick actions — task 09-28 R2/R3,
 * revising the old app-ui decision); done/dropped (terminal) are still
 * decided by the weekly review only. Project fields (title/outcome/value,
 * R1) and the project's actions (title/est/value/deadline, R4) are edited
 * via inline forms. Action rows carry the read-only context chips
 * (design §4.2 — the PRD acceptance "项目详情行内 chips").
 */
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppInsets } from '@/lib/use-app-insets';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Card, ContextChip, EmptyState, Tag, ValueChips, cn, type TagTone } from '@nextdo/ui';
import { DateTimePicker } from '@/components/datetime-picker';
import { PickerField } from '@/components/picker-field';
import { DeadlineChip } from '@/components/deadline-chip';
import { localDateKey, type NextAction, type Project, type ProjectStatus, type Value } from '@nextdo/core';
import { useProjects } from '@/hooks/use-projects';
import { useProjectActions } from '@/hooks/use-project-actions';
import { useProjectHabits, type ProjectHabitEntry } from '@/hooks/use-project-habits';
import { useAddNextAction } from '@/hooks/use-add-next-action';
import { useStartHabit } from '@/hooks/use-start-habit';
import { useUpdateProject } from '@/hooks/use-update-project';
import { useUpdateNextAction } from '@/hooks/use-update-next-action';
import { useCompleteAction } from '@/hooks/use-complete-action';
import { useSnoozeAction } from '@/hooks/use-snooze-action';
import { useTrashAction } from '@/hooks/use-trash-action';
import { useTrashProject } from '@/hooks/use-trash-project';
import { useTrashHabit } from '@/hooks/use-trash-habit';
import { useAppClock } from '@/hooks/use-app-clock';
import { useContexts } from '@/hooks/use-contexts';
import { errorMessage } from '@/lib/error-messages';
import { PROJECT_STATUS_LABELS } from '@/lib/status-labels';
import { endOfLocalDayIso } from '@/lib/clarify-flow';
import { goBack } from '@/lib/go-back';
import { SnoozeSheet } from '@/components/snooze-sheet';
import { EditHabitForm } from '@/components/edit-habit-form';

const STATUS_TONES: Record<ProjectStatus, TagTone> = {
  active: 'accent',
  'on-hold': 'warning',
  done: 'neutral',
  dropped: 'neutral',
};

const EST_CHIPS = [5, 10, 20, 30, 60, 120];

const INPUT_CLASS =
  'rounded-md border border-border bg-surface p-3 text-base text-ink placeholder:text-muted dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={
        active
          ? 'h-8 w-8 items-center justify-center rounded-full bg-accent dark:bg-accent-dark'
          : 'h-8 w-8 items-center justify-center rounded-full border border-border dark:border-border-dark'
      }
    >
      <Text className={active ? 'text-sm text-on-accent' : 'text-sm text-ink dark:text-ink-dark'}>{label}</Text>
    </Pressable>
  );
}

/** The inline add-action form (title + est + value + optional deadline). */
function AddActionForm({ projectId, now, onDone, onAdded }: { projectId: string; now: Date; onDone: () => void; onAdded: () => void }) {
  const { add, error } = useAddNextAction();
  const [title, setTitle] = useState('');
  const [estMinutes, setEstMinutes] = useState<number | null>(null);
  const [value, setValue] = useState<Value>(3);
  const [deadline, setDeadline] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [customEst, setCustomEst] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim() !== '' && estMinutes !== null && !submitting;

  const applyCustomEst = () => {
    const parsed = Number(customEst);
    if (Number.isFinite(parsed) && parsed >= 1) setEstMinutes(Math.round(parsed));
    setCustomEst('');
  };

  const addAction = () => {
    if (!canSubmit || estMinutes === null) return;
    // The domain deadline is an ISO *datetime*; the picker hands back a local
    // date — compose that local day's 23:59:59 (the same convention as the
    // Clarify wizard). The picker only ever emits a real `YYYY-MM-DD`, so
    // there is nothing left to reject here.
    const deadlineIso = deadline === '' ? undefined : (endOfLocalDayIso(deadline) ?? undefined);
    setSubmitting(true);
    void add({ title, estMinutes, value, projectId, deadline: deadlineIso }).then(() => {
      setSubmitting(false);
      setTitle('');
      setEstMinutes(null);
      setValue(3);
      setDeadline('');
      onAdded();
      onDone();
    });
  };

  return (
    <Card className="gap-3">
      <Text className="text-sm font-medium text-muted dark:text-muted-dark">添加行动</Text>
      <TextInput
        className={INPUT_CLASS}
        placeholder="下一步行动（具体的、单步的）"
        value={title}
        onChangeText={setTitle}
      />
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="text-sm font-medium text-ink dark:text-ink-dark">预估时长（分钟）</Text>
      </View>
      <View className="flex-row flex-wrap items-center gap-2">
        {EST_CHIPS.map((chip) => (
          <Chip key={chip} label={String(chip)} active={estMinutes === chip} onPress={() => setEstMinutes(chip)} />
        ))}
        <TextInput
          className={`${INPUT_CLASS} h-8 min-w-[84px] px-2 py-0`}
          style={{ minWidth: 84, paddingVertical: 0, paddingHorizontal: 8, textAlignVertical: 'center', fontSize: 12 }}
          placeholder="自定义"
          keyboardType="number-pad"
          value={customEst}
          onChangeText={setCustomEst}
          onSubmitEditing={applyCustomEst}
        />
      </View>
      <ValueChips value={value} onChange={setValue} />
      <PickerField
        label="截止"
        value={deadline}
        placeholder="截止日期（可选）"
        onPress={() => setShowPicker(true)}
        onClear={() => setDeadline('')}
      />
      {showPicker ? (
        <DateTimePicker
          mode="date"
          title="选择截止日期"
          value={deadline}
          now={now}
          onConfirm={(val) => {
            setDeadline(val);
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
        />
      ) : null}
      {error !== null ? <Text className="text-sm text-danger">{errorMessage(error)}</Text> : null}
      <View className="flex-row gap-2">
        <Button label="添加" onPress={addAction} disabled={!canSubmit} />
        <Button label="取消" variant="secondary" onPress={onDone} />
      </View>
    </Card>
  );
}

/** The inline edit-project form (R1) — same Card + chips pattern as the
 *  Projects tab's NewProjectForm, pre-filled from the current row. Status
 *  is NOT an editable field (归档/恢复 are the header's quick actions).
 *  Empty title or empty outcome cannot submit. */
function EditProjectForm({ project, now, onDone, onSaved }: { project: Project; now: Date; onDone: () => void; onSaved: () => void }) {
  const { update, error } = useUpdateProject();
  const [title, setTitle] = useState(project.title);
  const [outcome, setOutcome] = useState(project.outcome);
  const [value, setValue] = useState<Value>(project.value);
  /** `YYYY-MM-DD` as picked; the row stores it as an ISO datetime. */
  const [deadline, setDeadline] = useState(
    project.deadline === undefined ? '' : localDateKey(new Date(project.deadline)),
  );
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim() !== '' && outcome.trim() !== '' && !submitting;

  const save = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    // `deadline: undefined` CLEARS the column (`projectToRow` maps a missing
    // deadline to NULL) — that is how 「清除」 removes an existing one.
    const deadlineIso = deadline === '' ? undefined : (endOfLocalDayIso(deadline) ?? undefined);
    const ok = await update({ project, patch: { title: title.trim(), outcome: outcome.trim(), value, deadline: deadlineIso } });
    setSubmitting(false);
    if (ok) onSaved();
  };

  return (
    <Card className="gap-3">
      <Text className="text-sm font-medium text-muted dark:text-muted-dark">编辑项目</Text>
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
      {error !== null ? <Text className="text-sm text-danger">{errorMessage(error)}</Text> : null}
      <View className="flex-row gap-2">
        <Button label="保存" onPress={() => void save()} disabled={!canSubmit} />
        <Button label="取消" variant="secondary" onPress={onDone} />
      </View>
    </Card>
  );
}

/** The inline edit-action form (R4) — the same field set and Card + chips
 *  pattern as `AddActionForm`, pre-filled from the current row. The
 *  deadline input keeps the `endOfLocalDayIso` convention (YYYY-MM-DD →
 *  that local day's 23:59:59; empty clears the deadline). */
function EditActionForm({ action, now, onDone, onSaved }: { action: NextAction; now: Date; onDone: () => void; onSaved: () => void }) {
  const { update, error } = useUpdateNextAction();
  const { data: contexts } = useContexts();
  const [title, setTitle] = useState(action.title);
  const [estMinutes, setEstMinutes] = useState<number | null>(action.estMinutes);
  const [value, setValue] = useState<Value>(action.value);
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>(action.contextIds ?? []);
  const [deadline, setDeadline] = useState(
    action.deadline === undefined || action.deadline === null
      ? ''
      : localDateKey(new Date(action.deadline)),
  );
  const [showPicker, setShowPicker] = useState(false);
  const [customEst, setCustomEst] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const toggleContext = (ctxId: string) => {
    setSelectedContextIds((prev) =>
      prev.includes(ctxId) ? prev.filter((id) => id !== ctxId) : [...prev, ctxId],
    );
  };

  const canSubmit = title.trim() !== '' && estMinutes !== null && !submitting;

  const applyCustomEst = () => {
    const parsed = Number(customEst);
    if (Number.isFinite(parsed) && parsed >= 1) setEstMinutes(Math.round(parsed));
    setCustomEst('');
  };

  const save = async () => {
    if (!canSubmit || estMinutes === null) return;
    // Same convention as AddActionForm: the domain deadline is an ISO
    // *datetime*; the picker hands back a local date — compose that local
    // day's 23:59:59. `undefined` CLEARS an existing deadline.
    const deadlineIso = deadline === '' ? undefined : (endOfLocalDayIso(deadline) ?? undefined);
    setSubmitting(true);
    const ok = await update({
      action,
      patch: {
        title: title.trim(),
        estMinutes,
        value,
        deadline: deadlineIso,
        contextIds: selectedContextIds,
      },
    });
    setSubmitting(false);
    if (ok) onSaved();
  };

  return (
    <Card className="gap-3">
      <Text className="text-sm font-medium text-muted dark:text-muted-dark">编辑行动</Text>
      <TextInput
        className={INPUT_CLASS}
        placeholder="下一步行动（具体的、单步的）"
        value={title}
        onChangeText={setTitle}
      />
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="text-sm font-medium text-ink dark:text-ink-dark">预估时长（分钟）</Text>
      </View>
      <View className="flex-row flex-wrap items-center gap-2">
        {EST_CHIPS.map((chip) => (
          <Chip key={chip} label={String(chip)} active={estMinutes === chip} onPress={() => setEstMinutes(chip)} />
        ))}
        <TextInput
          className={`${INPUT_CLASS} h-8 min-w-[84px] px-2 py-0`}
          style={{ minWidth: 84, paddingVertical: 0, paddingHorizontal: 8, textAlignVertical: 'center', fontSize: 12 }}
          placeholder="自定义"
          keyboardType="number-pad"
          value={customEst}
          onChangeText={setCustomEst}
          onSubmitEditing={applyCustomEst}
        />
      </View>
      <ValueChips value={value} onChange={setValue} />
      {contexts && contexts.length > 0 ? (
        <View className="gap-1.5">
          <Text className="text-sm font-medium text-ink dark:text-ink-dark">场景（可选）</Text>
          <View className="flex-row flex-wrap gap-1.5">
            {contexts.map((ctx) => {
              const active = selectedContextIds.includes(ctx.id);
              return (
                <Pressable
                  key={ctx.id}
                  accessibilityRole="button"
                  accessibilityLabel={ctx.name}
                  accessibilityState={{ selected: active }}
                  onPress={() => toggleContext(ctx.id)}
                  className={cn(
                    'rounded-full border px-3 py-1',
                    active
                      ? 'border-accent bg-accent/15 dark:border-accent-dark dark:bg-accent-dark/25'
                      : 'border-border bg-surface dark:border-border-dark dark:bg-surface-dark',
                  )}
                >
                  <Text
                    className={cn(
                      'text-xs font-medium',
                      active
                        ? 'font-semibold text-accent dark:text-accent-dark'
                        : 'text-ink dark:text-ink-dark',
                    )}
                  >
                    {ctx.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      <PickerField
        label="截止"
        value={deadline}
        placeholder="截止日期（可选）"
        onPress={() => setShowPicker(true)}
        onClear={() => setDeadline('')}
      />
      {showPicker ? (
        <DateTimePicker
          mode="date"
          title="选择截止日期"
          value={deadline}
          now={now}
          onConfirm={(val) => {
            setDeadline(val);
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
        />
      ) : null}
      {error !== null ? <Text className="text-sm text-danger">{errorMessage(error)}</Text> : null}
      <View className="flex-row gap-2">
        <Button label="保存" onPress={() => void save()} disabled={!canSubmit} />
        <Button label="取消" variant="secondary" onPress={onDone} />
      </View>
    </Card>
  );
}

/** The inline add-habit form for a project (compact version, 21-day fixed challenge). */
function AddProjectHabitForm({
  projectId,
  onDone,
  onAdded,
}: {
  projectId: string;
  onDone: () => void;
  onAdded: () => void;
}) {
  const { start, error } = useStartHabit();
  const [title, setTitle] = useState('');
  const [actionTitle, setActionTitle] = useState('');
  const [estMinutes, setEstMinutes] = useState<number | null>(30);
  const [customEst, setCustomEst] = useState('');
  const [value, setValue] = useState<Value>(3);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim() !== '' && estMinutes !== null && !submitting;

  const applyCustomEst = () => {
    const parsed = Number(customEst);
    if (Number.isFinite(parsed) && parsed >= 1) setEstMinutes(Math.round(parsed));
    setCustomEst('');
  };

  const submit = () => {
    if (!canSubmit || estMinutes === null) return;
    setSubmitting(true);
    void start({
      title: title.trim(),
      actionTitle: actionTitle.trim(),
      estMinutes,
      value,
      projectId,
    }).then((ok) => {
      setSubmitting(false);
      if (ok) {
        setTitle('');
        setActionTitle('');
        setEstMinutes(30);
        setValue(3);
        onAdded();
        onDone();
      }
    });
  };

  return (
    <Card className="gap-3">
      <Text className="text-sm font-medium text-muted dark:text-muted-dark">
        新建项目习惯 · 21 天挑战
      </Text>
      <TextInput
        className={INPUT_CLASS}
        placeholder="习惯名（如 每日晨读文献）"
        value={title}
        onChangeText={setTitle}
      />
      <TextInput
        className={INPUT_CLASS}
        placeholder="每日行动（如 读一章论文，留空同习惯名）"
        value={actionTitle}
        onChangeText={setActionTitle}
      />
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="text-sm font-medium text-ink dark:text-ink-dark">预估时长（分钟）</Text>
      </View>
      <View className="flex-row flex-wrap items-center gap-2">
        {EST_CHIPS.map((chip) => (
          <Chip key={chip} label={String(chip)} active={estMinutes === chip} onPress={() => setEstMinutes(chip)} />
        ))}
        <TextInput
          className={`${INPUT_CLASS} h-8 min-w-[84px] px-2 py-0`}
          style={{ minWidth: 84, paddingVertical: 0, paddingHorizontal: 8, textAlignVertical: 'center', fontSize: 12 }}
          placeholder="自定义"
          keyboardType="number-pad"
          value={customEst}
          onChangeText={setCustomEst}
          onSubmitEditing={applyCustomEst}
        />
      </View>
      <ValueChips value={value} onChange={setValue} />
      {error !== null ? <Text className="text-sm text-danger">{errorMessage(error)}</Text> : null}
      <View className="flex-row gap-2">
        <Button label="开始挑战" onPress={submit} disabled={!canSubmit} />
        <Button label="取消" variant="secondary" onPress={onDone} />
      </View>
    </Card>
  );
}

/** One project habit row: title, 第 N/21 天, 21-cell grid, today's check-in button + 编辑 + 删除. */
function ProjectHabitRow({
  entry,
  onComplete,
  onTrash,
  onReload,
}: {
  entry: ProjectHabitEntry;
  onComplete: (dayId: string) => void;
  onTrash?: (habitId: string) => void;
  onReload?: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const { habit, cycleDay, doneCount, startsInDays, todayDay, grid } = entry;
  const cycleDays = habit.cycleDays ?? 21;
  const [armedTrash, setArmedTrash] = useState(false);

  if (isEditing) {
    return (
      <EditHabitForm
        habit={habit}
        onDone={() => setIsEditing(false)}
        onSaved={() => {
          setIsEditing(false);
          onReload?.();
        }}
      />
    );
  }

  return (
    <Card className="gap-2.5">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-base font-semibold text-ink dark:text-ink-dark">
          {habit.title}
        </Text>
        <Tag
          label={
            cycleDay !== null
              ? `第 ${cycleDay}/${cycleDays} 天`
              : startsInDays !== null
                ? `${startsInDays} 天后开始`
                : `本期 ${cycleDays} 天`
          }
          tone="accent"
        />
      </View>
      <Text className="text-sm text-muted dark:text-muted-dark">
        每日行动：{habit.actionTitle}
      </Text>
      <View className="flex-row flex-wrap items-center gap-2">
        <Tag label={`${habit.estMinutes} 分钟`} />
        <Tag label={`价值 ${habit.value}`} />
        <Tag label={`已打卡 ${doneCount} 天`} />
      </View>

      {/* 21-cell grid strip */}
      <View className="flex-row flex-wrap items-center gap-1.5 pt-1">
        {grid.map((cell) => {
          const isDone = cell.status === 'done';
          const isToday = cell.isToday;
          const isActionable = isToday && cell.status === 'today' && todayDay !== null;

          if (isActionable) {
            return (
              <Pressable
                key={cell.dayNumber}
                accessibilityRole="button"
                accessibilityLabel={`第 ${cell.dayNumber} 天 今日打卡`}
                onPress={() => onComplete(todayDay.id)}
                className="h-6 w-6 items-center justify-center rounded border-2 border-accent bg-accent/20 dark:border-accent-dark dark:bg-accent-dark/20"
              >
                <Text className="text-xs font-bold text-accent dark:text-accent-dark">
                  {cell.dayNumber}
                </Text>
              </Pressable>
            );
          }

          return (
            <View
              key={cell.dayNumber}
              accessibilityLabel={`第 ${cell.dayNumber} 天 ${isDone ? '已完成' : isToday ? '今日' : cell.status === 'missed' ? '未打卡' : '未到'}`}
              className={cn(
                'h-6 w-6 items-center justify-center rounded',
                isDone
                  ? 'bg-accent dark:bg-accent-dark'
                  : isToday
                    ? 'border border-accent dark:border-accent-dark'
                    : cell.status === 'missed'
                      ? 'border border-border bg-muted/10 dark:border-border-dark dark:bg-muted-dark/10'
                      : 'border border-dashed border-border/60 dark:border-border-dark/60',
              )}
            >
              <Text
                className={cn(
                  'text-[10px]',
                  isDone
                    ? 'font-bold text-on-accent'
                    : isToday
                      ? 'font-bold text-accent dark:text-accent-dark'
                      : 'text-muted dark:text-muted-dark',
                )}
              >
                {cell.dayNumber}
              </Text>
            </View>
          );
        })}
      </View>

      <View className="mt-1 flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Button
            size="sm"
            label="编辑"
            variant="ghost"
            onPress={() => setIsEditing(true)}
          />
          {onTrash !== undefined ? (
            armedTrash ? (
              <Button
                size="sm"
                label="确认删除习惯？"
                variant="secondary"
                onPress={() => {
                  setArmedTrash(false);
                  onTrash(habit.id);
                }}
              />
            ) : (
              <Button
                size="sm"
                label="删除习惯"
                variant="ghost"
                onPress={() => setArmedTrash(true)}
              />
            )
          ) : null}
        </View>
        {todayDay !== null ? (
          <Button
            size="sm"
            label="今日打卡"
            variant="secondary"
            onPress={() => onComplete(todayDay.id)}
          />
        ) : null}
      </View>
    </Card>
  );
}

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projectId = typeof id === 'string' ? id : null;

  const { data: projects, error: projectsError } = useProjects();
  const { data: actions, error: actionsError, reload } = useProjectActions(projectId);
  const now = useAppClock();
  const { data: habits, error: habitsError, reload: reloadHabits } = useProjectHabits(projectId, now);
  const { data: contexts } = useContexts();
  const { error: addError } = useAddNextAction();
  const { complete, error: completeError } = useCompleteAction();
  const { snooze, error: snoozeError } = useSnoozeAction();
  const { trash, error: trashError } = useTrashAction();
  const { trash: trashProject, error: trashProjectError } = useTrashProject();
  const { trash: trashHabit, error: trashHabitError } = useTrashHabit();

  const [showForm, setShowForm] = useState(false);
  const [showHabitForm, setShowHabitForm] = useState(false);
  const [showEditProject, setShowEditProject] = useState(false);
  const [armedProjectTrash, setArmedProjectTrash] = useState(false);
  const [snoozeTarget, setSnoozeTarget] = useState<string | null>(null);
  // One open action edit at a time (R4).
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const { update: updateProject, error: updateProjectError } = useUpdateProject();
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);

  if (projectId === null) {
    return (
      <View
        style={{ paddingTop: topPadding }}
        className="flex-1 bg-canvas px-4 pb-4 dark:bg-canvas-dark"
      >
        <EmptyState title="缺少参数，无法打开" hint="返回项目列表重试。">
          <View className="mt-4">
            <Button label="返回" variant="secondary" onPress={() => goBack('/(tabs)/projects')} />
          </View>
        </EmptyState>
      </View>
    );
  }

  const project = projects.find((entry) => entry.id === projectId);
  // 归档 / 恢复 (screen-level useUpdateProject) failures surface with the
  // other mutation errors — the edit forms show their own hook's error.
  const mutationError =
    addError ??
    completeError ??
    snoozeError ??
    trashError ??
    updateProjectError ??
    trashProjectError ??
    trashHabitError;
  // Action-row context ids → display names (unknown ids fall back to the id).
  const contextName = (id: string) =>
    contexts?.find((entry) => entry.id === id)?.name ?? id;

  const scrollViewRef = useRef<ScrollView>(null);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-canvas dark:bg-canvas-dark relative"
    >
      <ScrollView
        ref={scrollViewRef}
        className="flex-1"
        contentContainerStyle={{ paddingTop: topPadding, paddingHorizontal: 16, paddingBottom: 80 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="w-full max-w-3xl mx-auto">
        <View className="mb-4 flex-row items-center justify-between">
          <Button label="← 项目" variant="ghost" onPress={() => goBack('/(tabs)/projects')} />
        </View>

      {projectsError !== null ? (
        <EmptyState title="加载项目失败" hint={errorMessage(projectsError)} />
      ) : project === undefined ? (
        <EmptyState title="项目不存在" hint="它可能已被删除，或数据还在同步。" />
      ) : (
        <>
          <Card className="gap-2">
            <View className="flex-row items-center gap-2">
              <Text className="flex-1 text-lg font-semibold text-ink dark:text-ink-dark">{project.title}</Text>
              <Tag label={PROJECT_STATUS_LABELS[project.status]} tone={STATUS_TONES[project.status]} />
            </View>
            <Text className="text-sm text-muted dark:text-muted-dark">完成是什么样：{project.outcome}</Text>
            <View className="flex-row items-center gap-2">
              <Tag
                label={project.hasOpenAction ? '有进行中的行动' : '缺少行动'}
                tone={project.hasOpenAction ? 'accent' : 'danger'}
              />
              <Tag label={`价值 ${project.value}`} />
              {/* The project's OWN deadline, spoken in the same words an
                  action's is (issue #16) — 逾期 / 今天截止 / 还剩 N 天. */}
              <DeadlineChip deadline={project.deadline} now={now} />
            </View>
            {/* 归档 / 恢复 = a `status` single-field update (no confirm —
                reversible); done/dropped (terminal) show no status/edit
                buttons here — the weekly review decides them. */}
            {project.status === 'active' || project.status === 'on-hold' ? (
              <View className="flex-row flex-wrap gap-2">
                <Button
                  label="编辑"
                  variant="secondary"
                  onPress={() => {
                    setEditingActionId(null);
                    setShowEditProject(true);
                  }}
                />
                {project.status === 'active' ? (
                  <Button
                    label="归档"
                    variant="ghost"
                    onPress={() => void updateProject({ project, patch: { status: 'on-hold' } }).then(reload)}
                  />
                ) : (
                  <Button
                    label="恢复"
                    variant="ghost"
                    onPress={() => void updateProject({ project, patch: { status: 'active' } }).then(reload)}
                  />
                )}
                {armedProjectTrash ? (
                  <Button
                    label="确认删除项目？"
                    variant="secondary"
                    onPress={() => {
                      setArmedProjectTrash(false);
                      void trashProject(project.id).then((ok) => {
                        if (ok) router.replace('/(tabs)/projects');
                      });
                    }}
                  />
                ) : (
                  <Button
                    label="删除项目"
                    variant="ghost"
                    onPress={() => setArmedProjectTrash(true)}
                  />
                )}
              </View>
            ) : null}
          </Card>

          {showEditProject ? (
            <View className="mt-2">
              <EditProjectForm
                project={project}
                now={now}
                onDone={() => setShowEditProject(false)}
                onSaved={() => setShowEditProject(false)}
              />
            </View>
          ) : null}

          {mutationError !== null ? (
            <Text className="mt-2 text-sm text-danger">{errorMessage(mutationError)}</Text>
          ) : null}

          <View className="mt-3 flex-row items-center justify-between">
            <Text className="text-base font-medium text-ink dark:text-ink-dark">进行中的行动</Text>
            <Button label="＋ 添加行动" variant="secondary" onPress={() => setShowForm((value) => !value)} />
          </View>

          {showForm ? (
            <View className="mt-2">
              <AddActionForm projectId={projectId} now={now} onDone={() => setShowForm(false)} onAdded={reload} />
            </View>
          ) : null}

          <View className="mt-2 gap-2">
            {actionsError !== null ? (
              <EmptyState title="加载行动失败" hint={errorMessage(actionsError)} />
            ) : actions === null ? (
              <EmptyState title="加载中…" />
            ) : actions.length === 0 ? (
              <EmptyState
                title="这个项目还没有进行中的行动"
                hint="没有下一步行动的项目是回顾时的红灯 — 点「＋ 添加行动」。"
              />
            ) : (
              actions.map((action) => (
                <Card key={action.id} className="gap-2">
                  {editingActionId === action.id ? (
                    <EditActionForm
                      action={action}
                      now={now}
                      onDone={() => setEditingActionId(null)}
                      onSaved={() => {
                        setEditingActionId(null);
                        reload();
                      }}
                    />
                  ) : (
                    <>
                      <Text className="text-base text-ink dark:text-ink-dark">{action.title}</Text>
                      <View className="flex-row flex-wrap items-center gap-2">
                        <Tag label={`${action.estMinutes} 分钟`} />
                        <Tag label={`价值 ${action.value}`} />
                        <DeadlineChip deadline={action.deadline} now={now} />
                      </View>
                      {action.contextIds.length > 0 ? (
                        <View className="flex-row flex-wrap gap-1.5">
                          {action.contextIds.map((id) => (
                            <ContextChip key={id} name={contextName(id)} />
                          ))}
                        </View>
                      ) : null}
                      <View className="flex-row gap-2">
                        <Button
                          label="完成"
                          variant="secondary"
                          onPress={() => void complete({ actionKind: 'next', actionId: action.id }).then(reload)}
                        />
                        <Button label="稍后" variant="secondary" onPress={() => setSnoozeTarget(action.id)} />
                        <Button label="编辑" variant="ghost" onPress={() => setEditingActionId(action.id)} />
                        <Button
                          label="删除"
                          variant="ghost"
                          onPress={() => void trash({ actionKind: 'next', actionId: action.id }).then(reload)}
                        />
                      </View>
                    </>
                  )}
                </Card>
              ))
            )}
          </View>

          {/* Project Habits section */}
          <View className="mt-6 flex-row items-center justify-between">
            <Text className="text-base font-medium text-ink dark:text-ink-dark">项目习惯</Text>
            <Button
              label="＋ 添加习惯"
              variant="secondary"
              onPress={() => setShowHabitForm((value) => !value)}
            />
          </View>

          {showHabitForm ? (
            <View className="mt-2">
              <AddProjectHabitForm
                projectId={projectId}
                onDone={() => setShowHabitForm(false)}
                onAdded={reloadHabits}
              />
            </View>
          ) : null}

          <View className="mt-2 gap-2">
            {habitsError !== null ? (
              <EmptyState title="加载习惯失败" hint={errorMessage(habitsError)} />
            ) : habits === null ? (
              <EmptyState title="加载中…" />
            ) : habits.length === 0 ? (
              <EmptyState
                title="暂无项目习惯"
                hint="这个项目还没有习惯 —— 点「＋ 添加习惯」建立 21 天挑战。"
              />
            ) : (
              habits.map((entry) => (
                <ProjectHabitRow
                  key={entry.habit.id}
                  entry={entry}
                  onReload={reloadHabits}
                  onTrash={(habitId) => {
                    void trashHabit(habitId).then((ok) => {
                      if (ok) reloadHabits();
                    });
                  }}
                  onComplete={(dayId) => {
                    void complete({ actionKind: 'habit', actionId: dayId }).then((ok) => {
                      // 理由同 Now 屏的习惯块：`useProjectHabits` 是查询式 hook
                      // （没有 watch query），不重读就一直显示写入前的计数。
                      // 只在成功时重读 —— 失败后重读拿到的是同一批行，是一次
                      // 浪费的查询，还会顺手清掉 `useProjectHabits` 自己的错误状态。
                      // 写入错误不受影响，`completeError` 由 `useCompleteAction` 持有。
                      if (ok) reloadHabits();
                    });
                  }}
                />
              ))
            )}
          </View>
        </>
      )}
        </View>
      </ScrollView>

      {/* Mobile Ergonomic Floating Add Action Button (Thumb Zone) */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="添加行动"
        onPress={() => {
          setShowForm(true);
          scrollViewRef.current?.scrollTo({ y: 180, animated: true });
        }}
        className="absolute bottom-6 right-5 h-13 w-13 items-center justify-center rounded-full bg-accent shadow-xl active:scale-95 dark:bg-accent-dark md:hidden z-10"
        style={{
          width: 52,
          height: 52,
          borderRadius: 26,
          elevation: 6,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.25,
          shadowRadius: 6,
        }}
      >
        <Ionicons name="add" size={28} color="#ffffff" />
      </Pressable>

      <SnoozeSheet
        open={snoozeTarget !== null}
        now={now}
        onClose={() => setSnoozeTarget(null)}
        onSelect={(target) => {
          if (snoozeTarget !== null) {
            void snooze({ actionKind: 'next', actionId: snoozeTarget, snoozedUntil: target }).then(reload);
          }
        }}
      />
    </KeyboardAvoidingView>
  );
}
