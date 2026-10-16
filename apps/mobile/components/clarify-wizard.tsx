/**
 * The Clarify / Re-clarify wizard (design §3.2 — Paper Serenity rework) —
 * shared by `app/clarify/[inboxId].tsx` (Q1–Q5, full table) and
 * `app/reclarify/[id].tsx` (re-enters at Q2).
 *
 * Layout, top to bottom (no AI suggestion card — R4):
 * 1. header row: status Tag (正在澄清 / 重新明晰) + the back button;
 * 2. item title card: `defaultTitle` (display type) + the meta line
 *    (clarify: 收录于 {date} · 收集箱; reclarify: 已有行动);
 * 3. progress line: 步骤 n/m + ProgressBar + pct (n = min(depth+1,
 *    PROGRESS_MAX[mode]); the preview step shows 决策摘要预览 at 100% — it
 *    is the form's confirmation phase, not a step of its own);
 * 4. the current question card (question wording / button text / order
 *    untouched — R3);
 * 5. the persistent "GTD 决策摘要" card (below the question card): the
 *    mode's question chain, answered rows highlighted with the tapped
 *    answer, unanswered rows muted (branches not taken stay muted);
 * 6. the outcome form card (the context multi-select on action / calendar
 *    / project forms; 保存 goes through the preview step for PREVIEW_FORMS
 *    and submits directly for the rest — reference / someday / trash keep
 *    today's behavior);
 * 7. the preview step (决策摘要预览 · 归位就绪): 确认保存 submits the
 *    already-built submission (done step after), 上一步修改 restores the
 *    form with fields preserved.
 *
 * Layering:
 * - the step machine + validation + submission builders are PURE and live
 *   in `lib/clarify-flow.ts` (unit-tested there);
 * - `ClarifyWizard` loads the target's title (and, for re-clarify, the
 *   existing contexts) from the db and hands them to `WizardBody`;
 * - `WizardBody` owns the `useReducer` and the ONE db transaction per
 *   submission (`applyClarify` / `reclarifyAction`); errors surface
 *   through `lib/error-messages` (Chinese), never raw.
 *
 * Presentational otherwise: no engine logic, no stored engine output
 * (component-guidelines).
 */
import { useCallback, useMemo, useReducer, useState, type Dispatch, type ReactNode } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, Card, ContextChip, ProgressBar, SceneOption, Tag, cn } from '@nextdo/ui';
import { DateTimePicker } from '@/components/datetime-picker';
import { useAppInsets } from '@/lib/use-app-insets';
import { goBack } from '@/lib/go-back';
import {
  applyClarify,
  reclarifyAction,
  wrapDb,
  type ActionKind,
} from '@nextdo/db';
import { usePowerSync } from '@powersync/react';
import type { Context, Project, Value } from '@nextdo/core';
import { useAppClock } from '@/hooks/use-app-clock';
import { useOptionKeyboardNav } from '@/hooks/use-option-keyboard-nav';
import { useInboxItem } from '@/hooks/use-inbox-item';
import { useActionTitle } from '@/hooks/use-action-title';
import { useContexts } from '@/hooks/use-contexts';
import { useProjects } from '@/hooks/use-projects';
import { errorMessage } from '@/lib/error-messages';
import { maybeRequestNotificationPermission } from '@/lib/reminders/permission';
import { formatDueLabel, formatLocalDate, formatLocalDateTime } from '@/lib/format';
import {
  buildDoNowSubmission,
  buildFormSubmission,
  clarifyReducer,
  composeLocalDateTimeIso,
  createWizardState,
  endOfLocalDayIso,
  outcomeLabel,
  validateForm,
  PREVIEW_FORMS,
  PROGRESS_MAX,
  QUESTION_TITLES,
  type AnsweredQuestion,
  type FormKind,
  type FormFields,
  type QuestionId,
  type Submission,
  type WizardAction,
  type WizardMode,
  type WizardState,
} from '@/lib/clarify-flow';

const INPUT_CLASS =
  'rounded-md border border-border bg-surface p-3 text-base text-ink placeholder:text-muted dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark dark:placeholder:text-muted-dark';

const EST_CHIPS = [5, 10, 20, 30, 60, 120];
const VALUE_CHIPS: Value[] = [1, 2, 3, 4, 5];

/** The question chains of the "GTD 决策摘要" card (design §3.2): clarify
 *  shows all 8 rows; re-clarify re-enters at Q2 (q1/q1b never appear). */
const CLARIFY_CHAIN: readonly QuestionId[] = ['q1', 'q1b', 'q2', 'q2b', 'q3', 'q3b', 'q4', 'q5'];
const RECLARIFY_CHAIN: readonly QuestionId[] = ['q2', 'q2b', 'q3', 'q3b', 'q4', 'q5'];

/** The quick-pick minute estimates (design.md §4.3) + a custom box. */
function EstPicker({ value, onSelect }: { value: number | null; onSelect: (minutes: number) => void }) {
  const [custom, setCustom] = useState('');
  return (
    <View className="flex-row flex-wrap items-center gap-2">
      {EST_CHIPS.map((chip) => (
        <Chip key={chip} label={`${chip} 分钟`} active={value === chip} onPress={() => onSelect(chip)} />
      ))}
      <TextInput
        className={cn(INPUT_CLASS, 'h-11 w-24 flex-row items-center p-2')}
        placeholder="自定义"
        keyboardType="number-pad"
        value={custom}
        onChangeText={setCustom}
        onSubmitEditing={() => {
          const parsed = Number(custom);
          if (Number.isFinite(parsed) && parsed >= 1) onSelect(Math.round(parsed));
        }}
      />
    </View>
  );
}

/** A 1–5 value chip row. */
function ValuePicker({ value, onSelect }: { value: Value; onSelect: (value: Value) => void }) {
  return (
    <View className="flex-row gap-2">
      {VALUE_CHIPS.map((chip) => (
        <Chip key={chip} label={String(chip)} active={value === chip} onPress={() => onSelect(chip)} />
      ))}
    </View>
  );
}

/** A small tappable chip (44pt touch target kept via padding). */
function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={cn(
        'h-8 items-center justify-center rounded-full px-3',
        active
          ? 'bg-accent text-on-accent dark:bg-accent-dark'
          : 'border border-border bg-surface text-ink dark:border-border-dark dark:bg-surface-dark dark:text-ink-dark',
      )}
    >
      <Text
        className={cn(
          'font-sans text-sm',
          active
            ? 'text-on-accent dark:text-on-accent-dark'
            : 'text-ink dark:text-ink-dark',
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Field({
  label,
  optional,
  rightAction,
  children,
}: {
  label: string;
  optional?: boolean;
  rightAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View className="gap-1">
      <View className="flex-row items-center justify-between">
        <Text className="font-sans text-sm font-medium text-ink dark:text-ink-dark">
          {label}
          {optional ? <Text className="text-muted dark:text-muted-dark">（可选）</Text> : null}
        </Text>
        {rightAction}
      </View>
      {children}
    </View>
  );
}

/**
 * A date/time field (user feedback round 2 — design §15): the value is
 * picked with the DateTimePicker modal, NEVER hand-typed. The stored string
 * shapes stay 'YYYY-MM-DD' / 'HH:mm' (the clarify-flow contract is
 * untouched). `onClear` is offered only for optional fields.
 */
function DateTimeField({
  value,
  mode,
  label,
  placeholder,
  now,
  onClear,
  onChange,
}: {
  value: string;
  mode: 'date' | 'time';
  /** The field's name — the picker's modal title + the a11y labels. */
  label: string;
  placeholder: string;
  now: Date;
  onClear?: () => void;
  onChange: (value: string) => void;
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
          {value === '' ? placeholder : value}
        </Text>
        <Text className="font-sans text-xs text-muted dark:text-muted-dark">点击选择</Text>
      </Pressable>
      {onClear !== undefined && value !== '' ? (
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

// ---------------------------------------------------------------------------
// WizardBody — owns the reducer + the submission transaction
// ---------------------------------------------------------------------------

export interface WizardBodyProps {
  mode: WizardMode;
  /** InboxItem id (clarify) or the existing action id (reclarify). */
  id: string;
  /** Reclarify only: the action kind (habits are rejected before navigation). */
  actionKind: Extract<ActionKind, 'next' | 'calendar'> | null;
  /** The target's title — defaults for every editable title field. */
  defaultTitle: string;
  /** Reclarify only: the existing action's project (null = standalone) —
   *  marks the Q2b "current" project. */
  currentProjectId: string | null;
  /** Clarify only: the inbox item's capturedAt (the title card's meta
   *  line) — null renders "收集箱" without a date. */
  capturedAt: string | null;
  /** The initial context selection of every form — reclarify passes the
   *  existing action's contextIds; clarify passes []. */
  initialContextIds: string[];
}

export function WizardBody({
  mode,
  id,
  actionKind,
  defaultTitle,
  currentProjectId,
  capturedAt,
  initialContextIds,
}: WizardBodyProps) {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();

  // Q2b: the attachable projects (active only — on-hold/done/dropped are
  // not attachable; the db layer re-checks status at submit time).
  const { data: allProjects } = useProjects();
  const activeProjects = allProjects.filter((project) => project.status === 'active');

  // The context multi-select's data (seeded contexts + user-created).
  // Re-read on focus so returning from /contexts immediately reflects newly created scenes.
  const { data: contexts, reload: reloadContexts } = useContexts();
  useFocusEffect(
    useCallback(() => {
      reloadContexts();
    }, [reloadContexts]),
  );
  const contextNames = useMemo(
    () => new Map((contexts ?? []).map((context) => [context.id, context.name] as const)),
    [contexts],
  );

  const [state, dispatch] = useReducer(clarifyReducer, undefined, () =>
    createWizardState(mode, defaultTitle, initialContextIds),
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(submission: Submission) {
    setSubmitting(true);
    try {
      if (submission.mode === 'clarify') {
        const result = await applyClarify(db, {
          inboxId: id,
          answers: submission.answers,
          target: submission.target,
          now,
        });
        dispatch({ type: 'done', result: { outcome: result.outcome, createdIds: result.createdIds } });
      } else {
        if (actionKind === null) throw new Error('re-clarify requires an action kind');
        const result = await reclarifyAction(db, {
          actionKind,
          actionId: id,
          answers: submission.answers,
          target: submission.target,
          now,
        });
        dispatch({ type: 'done', result: { outcome: result.outcome, createdIds: result.createdIds } });
      }
      // Calendar targets may create a reminder row (startsAt within the
      // next 60 min — the db-layer rule) → the contextual permission ask
      // (D4 / R5), the same trigger as the snooze path. Fire-and-forget:
      // a denial never blocks the submission.
      if ('startsAt' in submission.target) {
        void maybeRequestNotificationPermission();
      }
      setSubmitError(null);
    } catch (err: unknown) {
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function handleDoNow() {
    void submit(buildDoNowSubmission(mode));
  }

  function handleFormSubmit(form: FormKind, fields: FormFields, twoMinute: boolean, projectId?: string) {
    const problem = validateForm(form, fields);
    if (problem !== null) {
      dispatch({ type: 'form-error', error: problem });
      return;
    }
    // D5: PREVIEW_FORMS confirm through the preview step (the submission is
    // built once and stored in state — NO db write yet); the remaining
    // forms (reference / someday / trash) submit directly, behavior
    // unchanged.
    const submission = buildFormSubmission(mode, form, fields, twoMinute, projectId);
    if (PREVIEW_FORMS.includes(form)) {
      dispatch({ type: 'preview', submission });
      return;
    }
    void submit(submission);
  }

  function setField(field: Exclude<keyof FormFields, 'contextIds'>, value: string | number | null) {
    dispatch({ type: 'field', field, value });
  }

  function setContextIds(value: string[]) {
    dispatch({ type: 'field', field: 'contextIds', value });
  }

  const isPreview = state.step === 'preview';
  const progressMax = PROGRESS_MAX[mode];
  const stepNumber = Math.min(state.depth + 1, progressMax);
  const progressPct = isPreview ? 100 : Math.round((stepNumber / progressMax) * 100);
  const metaLine =
    mode === 'reclarify'
      ? '已有行动'
      : capturedAt !== null
        ? `收录于 ${formatLocalDate(capturedAt)} · 收集箱`
        : '收集箱';
  const errorText = state.step === 'form' ? state.error : null;
  // Web deep-load fallback (no parent in the stack): clarify was pushed from
  // the inbox tab, reclarify from now / the daily review — now is the home
  // of the re-clarified action.
  const backFallback = mode === 'clarify' ? '/(tabs)/inbox' : '/(tabs)/now';
  const insets = useAppInsets();
  const topPadding = Math.max(insets.top, 16);

  const canGoBack = state.step === 'preview' || (state.history !== undefined && state.history.length > 0);
  function handleBack() {
    if (canGoBack) {
      dispatch({ type: 'back' });
    } else {
      goBack(backFallback);
    }
  }

  return (
    <View
      style={{ paddingTop: topPadding }}
      className="flex-1 w-full bg-canvas px-4 pb-4 dark:bg-canvas-dark"
    >
      {/* The form steps can exceed the viewport (project / calendar forms
       * on a 800px-tall desktop window, or the keyboard on phone) — the
       * whole body scrolls, same pattern as the review screens. */}
      <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
      <View className="w-full">
      {/* 1. header row: unified back button + step navigation on left, status tag on right */}
      <View className="mb-3.5 flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Button label="← 返回" variant="ghost" onPress={() => goBack(backFallback)} />
          {canGoBack ? (
            <Button
              label="← 上一步"
              variant="ghost"
              onPress={() => dispatch({ type: 'back' })}
            />
          ) : null}
        </View>
        <Tag label={mode === 'clarify' ? '正在澄清' : '重新明晰'} tone="accent" dot />
      </View>

      {state.step === 'done' ? (
        <Card className="items-center gap-3 py-8">
          <Text className="font-sans text-base font-medium text-ink dark:text-ink-dark">
            已整理为「{outcomeLabel(state.result.outcome)}」
          </Text>
          {/* Explicit exits (R1): loop back to capture, or return to the
           *  screen the wizard was pushed from. No auto-back timer. The
           *  recapture param is a one-shot (the inbox screen consumes it). */}
          <Button
            label="再记一条"
            onPress={() =>
              router.navigate({ pathname: '/(tabs)/inbox', params: { recapture: '1' } })
            }
          />
          <Button label="完成" variant="secondary" onPress={() => goBack(backFallback)} />
        </Card>
      ) : (
        <View className="gap-3.5">
          {/* 2. item title card */}
          <Card className="p-3.5">
            <Text
              className="font-display text-2xl font-bold tracking-tight text-ink dark:text-ink-dark"
              numberOfLines={2}
            >
              {state.defaultTitle}
            </Text>
            <Text className="mt-1 font-sans text-xs text-muted dark:text-muted-dark">{metaLine}</Text>
          </Card>

          {/* 3. progress line */}
          <Card className="gap-2 p-3.5">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans text-xs font-semibold text-accent dark:text-accent-dark">
                {isPreview ? '决策摘要预览' : `步骤 ${stepNumber}/${progressMax}`}
              </Text>
              <Text className="font-sans text-xs text-muted dark:text-muted-dark">{progressPct}%</Text>
            </View>
            <ProgressBar value={progressPct / 100} />
          </Card>

          {/* 4/6/7. the current question / form / preview card */}
          <Card>
            {(state.step === 'q1' ||
              state.step === 'q2' ||
              state.step === 'q2b' ||
              state.step === 'q3' ||
              state.step === 'q4' ||
              state.step === 'q5' ||
              state.step === 'q3b') && (
              <QuestionCard
                state={state}
                dispatch={dispatch}
                onDoNow={handleDoNow}
                disabled={submitting}
                canGoBack={canGoBack}
                onBack={handleBack}
                projects={activeProjects}
                currentProjectId={currentProjectId}
              />
            )}
            {state.step === 'q1b' && (
              <View className="gap-4">
                <Question title="那它更接近哪一类？" />
                <Choices
                  step="q1b"
                  disabled={submitting}
                  choices={[
                    { label: '资料（留个参考）', onPress: () => dispatch({ type: 'answer-q1b', kind: 'reference' }) },
                    { label: '有空再说', onPress: () => dispatch({ type: 'answer-q1b', kind: 'someday' }) },
                    { label: '删除', onPress: () => dispatch({ type: 'answer-q1b', kind: 'trash' }) },
                  ]}
                />
                {canGoBack ? (
                  <Button label="← 上一步" variant="ghost" onPress={handleBack} disabled={submitting} />
                ) : null}
              </View>
            )}
            {state.step === 'form' && (
              <FormCard
                state={state}
                contexts={contexts ?? []}
                now={now}
                onField={setField}
                onContextIds={setContextIds}
                canGoBack={canGoBack}
                onBack={handleBack}
                onSubmit={() => handleFormSubmit(state.form, state.fields, state.twoMinute, state.projectId)}
                disabled={submitting}
              />
            )}
            {state.step === 'preview' && (
              <PreviewCard
                state={state}
                contextNames={contextNames}
                now={now}
                disabled={submitting}
                onConfirm={() => void submit(state.submission)}
                onBack={() => dispatch({ type: 'back-to-form' })}
              />
            )}
            {errorText !== null ? (
              <Text className="mt-3 font-sans text-sm text-danger">{errorText}</Text>
            ) : null}
            {submitError !== null ? (
              <Text className="mt-3 font-sans text-sm text-danger">{submitError}</Text>
            ) : null}
          </Card>

          {/* 5. "GTD 决策摘要" — persistent, below the question card */}
          <DecisionSummaryCard mode={state.mode} answered={state.answered} />
        </View>
      )}
      </View>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// The "GTD 决策摘要" card (design §3.2.5) — collapsible by default to keep
// focus on the current question, expandable on tap to inspect the full chain.
// ---------------------------------------------------------------------------

function DecisionSummaryCard({
  mode,
  answered,
}: {
  mode: WizardMode;
  answered: AnsweredQuestion[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const chain = mode === 'clarify' ? CLARIFY_CHAIN : RECLARIFY_CHAIN;
  const answeredCount = answered.length;

  return (
    <Card variant="outlined" className="p-3.5">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isExpanded ? '收起GTD决策摘要' : '展开GTD决策摘要'}
        accessibilityState={{ expanded: isExpanded }}
        onPress={() => setIsExpanded((prev) => !prev)}
        className="flex-row items-center justify-between"
      >
        <View className="flex-row items-center gap-2">
          <Text className="font-sans text-sm font-semibold text-ink dark:text-ink-dark">
            GTD 决策摘要
          </Text>
          <View className="rounded-full bg-surface-container px-2 py-0.5 dark:bg-surface-container-dark">
            <Text className="font-sans text-[11px] text-muted dark:text-muted-dark">
              {answeredCount > 0 ? `已完成 ${answeredCount} 步` : '默认折叠'}
            </Text>
          </View>
        </View>

        <View className="flex-row items-center gap-1">
          <Text className="font-sans text-xs text-muted dark:text-muted-dark">
            {isExpanded ? '收起' : '展开'}
          </Text>
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color="#9b948a"
          />
        </View>
      </Pressable>

      {isExpanded ? (
        <View className="mt-3 gap-2 border-t border-border/40 pt-2.5 dark:border-border-dark/40">
          {chain.map((questionId, index) => {
            const entry = answered.find((candidate) => candidate.id === questionId);
            const answeredNow = entry !== undefined;
            return (
              <View key={questionId} className="flex-row items-center gap-2.5">
                <View
                  className={cn(
                    'h-6 w-6 items-center justify-center rounded-full',
                    answeredNow
                      ? 'bg-accent/15 dark:bg-accent-dark/20'
                      : 'bg-border/60 dark:bg-border-dark',
                  )}
                >
                  <Text
                    className={cn(
                      'font-sans text-xs font-semibold',
                      answeredNow ? 'text-accent dark:text-accent-dark' : 'text-muted dark:text-muted-dark',
                    )}
                  >
                    {index + 1}
                  </Text>
                </View>
                <Text
                  className={cn(
                    'flex-1 font-sans text-xs',
                    answeredNow
                      ? 'font-medium text-ink dark:text-ink-dark'
                      : 'text-muted dark:text-muted-dark',
                  )}
                >
                  {QUESTION_TITLES[questionId]}
                </Text>
                {answeredNow ? (
                  <Text
                    className="font-sans text-xs font-medium text-accent dark:text-accent-dark"
                    numberOfLines={1}
                  >
                    {entry.answer}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Question steps (one question per screen, big buttons — wording untouched,
// R3)
// ---------------------------------------------------------------------------

interface QuestionCardProps {
  state: Extract<WizardState, { step: 'q1' | 'q2' | 'q2b' | 'q3' | 'q3b' | 'q4' | 'q5' }>;
  dispatch: Dispatch<WizardAction>;
  onDoNow: () => void;
  disabled: boolean;
  canGoBack: boolean;
  onBack: () => void;
  /** Q2b only: the active (attachable) projects. */
  projects: Project[];
  /** Q2b only (reclarify): the action's current project — gets the
   *  "当前" marker. */
  currentProjectId: string | null;
}

function Question({ title, sub }: { title: string; sub?: string }) {
  return (
    <View className="mb-4 gap-1">
      <Text className="font-sans text-lg font-semibold tracking-tight text-ink dark:text-ink-dark">
        {title}
      </Text>
      {sub !== undefined ? (
        <Text className="font-sans text-sm text-muted dark:text-muted-dark">{sub}</Text>
      ) : null}
    </View>
  );
}

/**
 * One answer to a question. Plain answers render as a `Button`; answers that
 * carry a description (the project list in q2b) render as a described row.
 */
interface Choice {
  label: string;
  /** A longer second line; its presence selects the row layout. */
  detail?: string;
  /** Small marker on the right of a described row (q2b's 「当前」). */
  badge?: string;
  onPress: () => void;
}

/**
 * The keyboard-navigable option column (issue #17).
 *
 * Every question in the wizard renders through here, which is what makes the
 * arrow-key loop uniform: arrows move the ring, Enter presses the lit option,
 * and arriving at a new question resets the ring to its first answer and
 * pulls keyboard focus back (see `useOptionKeyboardNav`).
 *
 * The 「← 上一步」 button sits OUTSIDE this container on purpose — the back
 * control is not an answer, so it must not be reachable with ↓/Enter.
 */
function Choices({
  step,
  choices,
  disabled,
}: {
  /** The wizard step — changing it resets the selection (resetKey). */
  step: string;
  choices: readonly Choice[];
  disabled: boolean;
}) {
  const nav = useOptionKeyboardNav(choices.length, (index) => {
    choices[index]?.onPress();
  }, step);

  return (
    <View {...nav.containerProps} className="gap-4">
      {choices.map((choice, index) => {
        const ring = nav.ringClass(index);
        if (choice.detail !== undefined) {
          return (
            <Pressable
              key={choice.label}
              accessibilityRole="button"
              accessibilityLabel={`挂到项目：${choice.label}`}
              accessibilityState={{ disabled }}
              onPress={choice.onPress}
              disabled={disabled}
              className={cn(
                'rounded-lg border border-border bg-surface p-3.5 dark:border-border-dark dark:bg-surface-dark',
                ring,
              )}
            >
              <View className="flex-row items-center gap-2">
                <Text className="flex-1 font-sans text-base text-ink dark:text-ink-dark">
                  {choice.label}
                  {choice.detail !== undefined ? `（${choice.detail}）` : ''}
                </Text>
                {choice.badge !== undefined ? (
                  <Text className="rounded-full bg-accent/15 px-2 py-0.5 font-sans text-xs font-medium text-accent dark:bg-accent-dark/20 dark:text-accent-dark">
                    {choice.badge}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        }
        return (
          <Button
            key={choice.label}
            label={choice.label}
            size="lg"
            variant="secondary"
            onPress={choice.onPress}
            disabled={disabled}
            className={ring}
          />
        );
      })}
    </View>
  );
}

/** A question card: the prompt, its answers, and the back control. */
function QuestionCard({ state, dispatch, onDoNow, disabled, canGoBack, onBack, projects, currentProjectId }: QuestionCardProps) {
  const back = canGoBack ? (
    <Button label="← 上一步" variant="ghost" onPress={onBack} disabled={disabled} />
  ) : null;

  switch (state.step) {
    case 'q1':
      return (
        <View className="gap-4">
          <Question title="可以变成下一步行动吗？" sub="这件事能由你做成一件具体的事吗？" />
          <Choices
            step="q1"
            disabled={disabled}
            choices={[
              { label: '可以，是行动', onPress: () => dispatch({ type: 'answer-q1', actionable: true }) },
              { label: '不行', onPress: () => dispatch({ type: 'answer-q1', actionable: false }) },
            ]}
          />
          {back}
        </View>
      );
    case 'q2':
      return (
        <View className="gap-4">
          <Question title="需要多个步骤才能完成吗？" />
          <Choices
            step="q2"
            disabled={disabled}
            choices={[
              { label: '是，拆成项目', onPress: () => dispatch({ type: 'answer-q2', multipleSteps: true }) },
              { label: '否，一步能完成', onPress: () => dispatch({ type: 'answer-q2', multipleSteps: false }) },
            ]}
          />
          {back}
        </View>
      );
    case 'q2b':
      return (
        <View className="gap-4">
          <Question
            title="它属于哪个项目？"
            sub={
              state.multipleSteps
                ? '挂到已有项目下作为一个行动（价值默认跟随项目），或由这件事新建项目。'
                : '挂到已有项目下（价值默认跟随项目），或新建 / 不挂。'
            }
          />
          {/* The project rows and the two fall-through answers share one
              keyboard list, so ↓ walks straight from the last project into
              「新建项目」 (issue #17). */}
          <Choices
            step="q2b"
            disabled={disabled}
            choices={[
              ...projects.map((project) => ({
                label: project.title,
                detail: `价值 ${project.value}`,
                ...(currentProjectId === project.id ? { badge: '当前' } : {}),
                onPress: () =>
                  dispatch({
                    type: 'answer-q2b',
                    choice: 'attach',
                    projectId: project.id,
                    projectValue: project.value,
                    projectTitle: project.title,
                  }),
              })),
              { label: '新建项目', onPress: () => dispatch({ type: 'answer-q2b', choice: 'new-project' }) },
              ...(state.multipleSteps
                ? []
                : [{ label: '不属于项目', onPress: () => dispatch({ type: 'answer-q2b', choice: 'none' }) }]),
            ]}
          />
          {back}
        </View>
      );
    case 'q3':
      return (
        <View className="gap-4">
          <Question title="大约 2 分钟内能完成吗？" />
          <Choices
            step="q3"
            disabled={disabled}
            choices={[
              { label: '是，2 分钟内', onPress: () => dispatch({ type: 'answer-q3', twoMinutes: true }) },
              { label: '否', onPress: () => dispatch({ type: 'answer-q3', twoMinutes: false }) },
            ]}
          />
          {back}
        </View>
      );
    case 'q3b':
      return (
        <View className="gap-4">
          <Question title="现在就做掉吗？" sub="做完直接记为完成，不再排队。" />
          <Choices
            step="q3b"
            disabled={disabled}
            choices={[
              { label: '是，现在就做完', onPress: onDoNow },
              { label: '否，记成行动', onPress: () => dispatch({ type: 'answer-q3b', completedOnTheSpot: false }) },
            ]}
          />
          {back}
        </View>
      );
    case 'q4':
      return (
        <View className="gap-4">
          <Question title="应该由你完成吗？" />
          <Choices
            step="q4"
            disabled={disabled}
            choices={[
              { label: '是，我的事', onPress: () => dispatch({ type: 'answer-q4', myResponsibility: true }) },
              { label: '否，在等别人', onPress: () => dispatch({ type: 'answer-q4', myResponsibility: false }) },
            ]}
          />
          {back}
        </View>
      );
    case 'q5':
      return (
        <View className="gap-4">
          <Question title="必须在固定日期/时间执行吗？" />
          <Choices
            step="q5"
            disabled={disabled}
            choices={[
              { label: '是，固定时间', onPress: () => dispatch({ type: 'answer-q5', fixedTime: true }) },
              { label: '否，普通行动', onPress: () => dispatch({ type: 'answer-q5', fixedTime: false }) },
            ]}
          />
          {back}
        </View>
      );
  }
}

// ---------------------------------------------------------------------------
// The outcome forms (design.md §4.3 表单字段; the context multi-select per
// design §3.2.6)
// ---------------------------------------------------------------------------

interface FormCardProps {
  state: Extract<WizardState, { step: 'form' }>;
  /** The selectable contexts (seeded + user-created), by display name. */
  contexts: Context[];
  /** The single app clock (seeds the date/time pickers). */
  now: Date;
  /** Scalar fields only — the context multi-select dispatches its own
   *  `field: 'contextIds'` string[] action via `onContextIds`. */
  onField: (field: Exclude<keyof FormFields, 'contextIds'>, value: string | number | null) => void;
  onContextIds: (value: string[]) => void;
  canGoBack: boolean;
  onBack: () => void;
  onSubmit: () => void;
  disabled: boolean;
}

/** The forms that offer the context multi-select (design §3.2.6). */
const CONTEXT_FORMS: readonly FormKind[] = ['action', 'calendar', 'project'];

function FormCard({
  state,
  contexts,
  now,
  onField,
  onContextIds,
  canGoBack,
  onBack,
  onSubmit,
  disabled,
}: FormCardProps) {
  const { form, fields } = state;

  function toggleContext(contextId: string) {
    const next = fields.contextIds.includes(contextId)
      ? fields.contextIds.filter((entry) => entry !== contextId)
      : [...fields.contextIds, contextId];
    onContextIds(next);
  }

  const body = (() => {
    switch (form) {
      case 'trash':
        return (
          <View className="gap-4">
            <Question title="删除这条捕获？" sub="删除后进回收站（软删除），可找回。" />
          </View>
        );
      case 'reference':
        return (
          <View className="gap-4">
            <Field label="标题">
              <TextInput className={INPUT_CLASS} value={fields.title} onChangeText={(v) => onField('title', v)} />
            </Field>
            <Field label="链接（URL）">
              <TextInput
                className={INPUT_CLASS}
                value={fields.url}
                onChangeText={(v) => onField('url', v)}
                placeholder="https://…"
                autoCapitalize="none"
              />
            </Field>
            <Field label="备注" optional>
              <TextInput className={INPUT_CLASS} value={fields.note} onChangeText={(v) => onField('note', v)} />
            </Field>
          </View>
        );
      case 'someday':
        return (
          <View className="gap-4">
            <Question title="有空再说" sub="放进 Someday/Maybe，周回顾时再看。" />
            <Field label="标题">
              <TextInput className={INPUT_CLASS} value={fields.title} onChangeText={(v) => onField('title', v)} />
            </Field>
            <Field label="备注" optional>
              <TextInput className={INPUT_CLASS} value={fields.note} onChangeText={(v) => onField('note', v)} />
            </Field>
          </View>
        );
      case 'project':
        return (
          <View className="gap-4">
            <Question title="新建项目" sub="项目会带上它的第一个行动（原子创建）。" />
            <Field label="项目名">
              <TextInput className={INPUT_CLASS} value={fields.projectTitle} onChangeText={(v) => onField('projectTitle', v)} />
            </Field>
            <Field label='项目结果（"完成"是什么样）'>
              <TextInput
                className={INPUT_CLASS}
                value={fields.projectOutcome}
                onChangeText={(v) => onField('projectOutcome', v)}
                placeholder="用一句话描述完成的样貌"
              />
            </Field>
            <Field label="项目价值（1–5）">
              <ValuePicker value={fields.projectValue} onSelect={(v) => onField('projectValue', v)} />
            </Field>
            <Field label="第一个行动的标题">
              <TextInput className={INPUT_CLASS} value={fields.actionTitle} onChangeText={(v) => onField('actionTitle', v)} />
            </Field>
            <Field label="行动预估时长（分钟）">
              <EstPicker value={fields.estMinutes} onSelect={(v) => onField('estMinutes', v)} />
            </Field>
          </View>
        );
      case 'waiting':
        return (
          <View className="gap-4">
            <Question title="等待他人" sub="记为 Waiting For，设了期望日期会进回顾。" />
            <Field label="标题">
              <TextInput className={INPUT_CLASS} value={fields.title} onChangeText={(v) => onField('title', v)} />
            </Field>
            <Field label="在等谁 / 什么">
              <TextInput
                className={INPUT_CLASS}
                value={fields.waitingOn}
                onChangeText={(v) => onField('waitingOn', v)}
                placeholder="例：等设计同学反馈"
              />
            </Field>
            <Field label="期望日期" optional>
              <DateTimeField
                value={fields.expectedBy}
                mode="date"
                label="期望日期"
                placeholder="YYYY-MM-DD"
                now={now}
                onClear={() => onField('expectedBy', '')}
                onChange={(v) => onField('expectedBy', v)}
              />
            </Field>
          </View>
        );
      case 'calendar':
        return (
          <View className="gap-4">
            <Question title="固定时间行动" sub="放进日程，按开始时间进入执行池。" />
            <Field label="标题">
              <TextInput className={INPUT_CLASS} value={fields.title} onChangeText={(v) => onField('title', v)} />
            </Field>
            <Field label="开始日期">
              <DateTimeField
                value={fields.startsAtDate}
                mode="date"
                label="开始日期"
                placeholder="YYYY-MM-DD"
                now={now}
                onChange={(v) => onField('startsAtDate', v)}
              />
            </Field>
            <Field label="开始时间">
              <DateTimeField
                value={fields.startsAtTime}
                mode="time"
                label="开始时间"
                placeholder="HH:mm"
                now={now}
                onChange={(v) => onField('startsAtTime', v)}
              />
            </Field>
            <Field label="预估时长（分钟）">
              <EstPicker value={fields.estMinutes} onSelect={(v) => onField('estMinutes', v)} />
            </Field>
            <Field label="价值（1–5）">
              <ValuePicker value={fields.value} onSelect={(v) => onField('value', v)} />
            </Field>
            <Field label="截止" optional>
              <DateTimeField
                value={fields.deadline}
                mode="date"
                label="截止"
                placeholder="YYYY-MM-DD"
                now={now}
                onClear={() => onField('deadline', '')}
                onChange={(v) => onField('deadline', v)}
              />
            </Field>
          </View>
        );
      case 'action':
        return (
          <View className="gap-4">
            {state.projectId !== undefined ? (
              // Q2b attach: the project is fixed for this submission —
              // changing it means going back to Q2b (not in-form).
              <Text className="rounded-md bg-canvas p-2.5 font-sans text-sm text-muted dark:bg-canvas-dark dark:text-muted-dark">
                所属项目：{state.projectTitle ?? ''}
              </Text>
            ) : null}
            <Question
              title={state.twoMinute ? '记成一个行动（约 2 分钟）' : '记成一个行动'}
              sub="进入 Now 执行池，可以被推荐。"
            />
            <Field label="行动标题">
              <TextInput className={INPUT_CLASS} value={fields.actionTitle} onChangeText={(v) => onField('actionTitle', v)} />
            </Field>
            <Field label="预估时长（分钟）">
              <EstPicker value={fields.estMinutes} onSelect={(v) => onField('estMinutes', v)} />
            </Field>
            {!state.twoMinute ? (
              <Field label="价值（1–5）">
                <ValuePicker value={fields.value} onSelect={(v) => onField('value', v)} />
              </Field>
            ) : null}
            <Field label="截止" optional>
              <DateTimeField
                value={fields.deadline}
                mode="date"
                label="截止"
                placeholder="YYYY-MM-DD"
                now={now}
                onClear={() => onField('deadline', '')}
                onChange={(v) => onField('deadline', v)}
              />
            </Field>
          </View>
        );
    }
  })();

  return (
    <View className="gap-4">
      {body}
      {CONTEXT_FORMS.includes(form) ? (
        <Field
          label="在哪里做？（可多选，不选 = 随处可执行）"
          rightAction={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="管理场景"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => router.push('/contexts')}
              className="flex-row items-center gap-1 py-0.5 active:opacity-75"
            >
              <Text className="font-sans text-[11px] font-medium text-muted dark:text-muted-dark">
                管理场景
              </Text>
              <Ionicons name="chevron-forward" size={12} color="#9b948a" />
            </Pressable>
          }
        >
          {contexts.length === 0 ? (
            <Text className="font-sans text-xs text-muted dark:text-muted-dark">
              还没有场景 —— 不选即随处可执行。
            </Text>
          ) : (
            <View className="flex-row flex-wrap items-center gap-2">
              {contexts.map((context) => (
                <SceneOption
                  key={context.id}
                  label={context.name}
                  selected={fields.contextIds.includes(context.id)}
                  onPress={() => toggleContext(context.id)}
                  accessibilityLabel={`选择情境：${context.name}`}
                />
              ))}
            </View>
          )}
        </Field>
      ) : null}
      <View className="flex-row gap-2.5">
        {canGoBack ? (
          <View className="flex-1">
            <Button
              label="上一步"
              variant="secondary"
              onPress={onBack}
              disabled={disabled}
            />
          </View>
        ) : null}
        <View className="flex-1">
          <Button
            label={form === 'trash' ? '确认删除' : '保存'}
            onPress={onSubmit}
            disabled={disabled}
          />
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// The preview step (design §3.2.7) — the confirmation phase of the
// PREVIEW_FORMS: the submission was built at the form step (no db write);
// 确认保存 submits it, 上一步修改 restores the form (fields preserved).
// ---------------------------------------------------------------------------

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-2">
      <Text className="w-16 shrink-0 font-sans text-xs text-muted dark:text-muted-dark">{label}</Text>
      <Text className="flex-1 text-right font-sans text-xs font-medium text-ink dark:text-ink-dark">
        {value}
      </Text>
    </View>
  );
}

interface PreviewCardProps {
  state: Extract<WizardState, { step: 'preview' }>;
  /** context id → display name (for the read-only chips). */
  contextNames: Map<string, string>;
  now: Date;
  disabled: boolean;
  onConfirm: () => void;
  onBack: () => void;
}

function PreviewCard({ state, contextNames, now, disabled, onConfirm, onBack }: PreviewCardProps) {
  const { form, fields, twoMinute } = state;
  const deadlineIso = fields.deadline !== '' ? endOfLocalDayIso(fields.deadline) : null;
  const startsAtIso =
    form === 'calendar' ? composeLocalDateTimeIso(fields.startsAtDate, fields.startsAtTime) : null;
  const contextNamesSelected = fields.contextIds
    .map((contextId) => contextNames.get(contextId))
    .filter((name): name is string => name !== undefined);
  const projectTitle = state.projectTitle ?? (form === 'project' ? fields.projectTitle : null);
  const value = form === 'project' ? fields.projectValue : fields.value;

  return (
    <View className="gap-4">
      <Question title="决策摘要预览 · 归位就绪" />
      <View className="gap-2.5 rounded-xl bg-canvas p-3 dark:bg-canvas-dark">
        {projectTitle !== null ? <PreviewRow label="所属项目" value={projectTitle} /> : null}
        <PreviewRow label="标题" value={form === 'action' || form === 'project' ? fields.actionTitle : fields.title} />
        <View className="flex-row items-center justify-between gap-2">
          <Text className="w-16 shrink-0 font-sans text-xs text-muted dark:text-muted-dark">执行情境</Text>
          {contextNamesSelected.length === 0 ? (
            <Text className="flex-1 text-right font-sans text-xs font-medium text-ink dark:text-ink-dark">
              随处可执行
            </Text>
          ) : (
            <View className="flex-1 flex-row flex-wrap justify-end gap-1.5">
              {contextNamesSelected.map((name) => (
                <ContextChip key={name} name={name} />
              ))}
            </View>
          )}
        </View>
        {fields.estMinutes !== null ? (
          <PreviewRow label="预计耗时" value={`${fields.estMinutes} 分钟`} />
        ) : null}
        {form === 'calendar' ||
        form === 'project' ||
        (form === 'action' && !twoMinute) ? (
          <PreviewRow label="价值" value={String(value)} />
        ) : null}
        {startsAtIso !== null ? (
          <PreviewRow label="开始" value={formatLocalDateTime(startsAtIso)} />
        ) : null}
        {deadlineIso !== null ? (
          <PreviewRow label="截止" value={formatDueLabel(deadlineIso, now)} />
        ) : null}
      </View>
      <View className="gap-2.5">
        <Button label="确认保存" onPress={onConfirm} disabled={disabled} />
        <Button label="上一步修改" variant="secondary" onPress={onBack} disabled={disabled} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ClarifyWizard — title loader + WizardBody
// ---------------------------------------------------------------------------

export interface ClarifyWizardProps {
  mode: WizardMode;
  /** InboxItem id (clarify) or the existing action id (reclarify). */
  id: string | null;
  /** Reclarify only: the action kind (next | calendar). */
  actionKind?: Extract<ActionKind, 'next' | 'calendar'> | null;
}

export function ClarifyWizard({ mode, id, actionKind = null }: ClarifyWizardProps) {
  const isReclarify = mode === 'reclarify';
  const inbox = useInboxItem(isReclarify ? null : id);
  const action = useActionTitle(isReclarify ? actionKind : null, isReclarify ? id : null);
  // Web deep-load fallback (no parent in the stack) — see WizardBody.
  const backFallback = isReclarify ? '/(tabs)/now' : '/(tabs)/inbox';

  if (id === null) {
    return (
      <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
        <Card className="items-center gap-3 py-8">
          <Text className="font-sans text-base text-ink dark:text-ink-dark">缺少参数，无法打开</Text>
          <Button label="返回" variant="secondary" onPress={() => goBack(backFallback)} />
        </Card>
      </View>
    );
  }

  // Re-clarify without a resolvable action kind (habit, or a bad/missing
  // `?kind=` param): the title hooks settle nothing, so without this branch
  // the screen would sit on "加载中…" forever. Say so instead (the db layer
  // enforces the same rule: reclarify.unsupported-kind).
  if (isReclarify && actionKind === null) {
    return (
      <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
        <Card className="items-center gap-3 py-8">
          <Text className="font-sans text-base text-ink dark:text-ink-dark">
            这个行动不能重新明晰（习惯请编辑习惯本身）
          </Text>
          <Button label="返回" variant="secondary" onPress={() => goBack(backFallback)} />
        </Card>
      </View>
    );
  }

  const error = inbox.error ?? action.error;
  const loaded = isReclarify ? action.loaded : inbox.loaded;
  const title = isReclarify ? action.title : inbox.item?.title ?? null;

  if (error !== null) {
    return (
      <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
        <Card className="items-center gap-3 py-8">
          <Text className="font-sans text-base text-ink dark:text-ink-dark">{errorMessage(error)}</Text>
          <Button label="返回" variant="secondary" onPress={() => goBack(backFallback)} />
        </Card>
      </View>
    );
  }

  if (!loaded) {
    return (
      <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
        <Card className="items-center py-8">
          <Text className="font-sans text-base text-ink dark:text-ink-dark">加载中…</Text>
        </Card>
      </View>
    );
  }

  if (title === null) {
    return (
      <View className="flex-1 bg-canvas p-4 dark:bg-canvas-dark">
        <Card className="items-center gap-3 py-8">
          <Text className="font-sans text-base text-ink dark:text-ink-dark">
            {isReclarify ? '这个行动不存在了' : '这条收件箱记录不存在了'}
          </Text>
          <Button label="返回" variant="secondary" onPress={() => goBack(backFallback)} />
        </Card>
      </View>
    );
  }

  return (
    <WizardBody
      key={`${mode}-${id}`}
      mode={mode}
      id={id}
      actionKind={actionKind}
      defaultTitle={title}
      currentProjectId={isReclarify ? action.projectId : null}
      capturedAt={isReclarify ? null : (inbox.item?.capturedAt ?? null)}
      initialContextIds={isReclarify ? action.contextIds : []}
    />
  );
}
