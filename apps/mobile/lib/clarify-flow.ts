/**
 * The Clarify / Re-clarify wizard — a PURE state machine (design.md §4.3).
 *
 * The wizard walks core's Clarify decision table one question at a time
 * (Q1 actionable? → Q1b kind / Q2 in a project? → Q2b new vs existing →
 * Q2c which project? → Q3 ~2 min? → Q3b completed on the spot? /
 * Q4 my responsibility? → Q5 fixed time?). This module holds:
 *
 * - the reducer (`clarifyReducer`) — forwards only; the system back button
 *   walks the stack, the reducer never moves backwards;
 * - form-field collection + pre-submit validation (Chinese messages — the
 *   db layer re-validates with typed NextdoError codes);
 * - the submission builders (`buildFormSubmission` / `buildDoNowSubmission`)
 *   that turn a finished form into core's `ClarifyAnswers` /
 *   `ReclarifyAnswers` + the db layer's `ClarifyTarget`.
 *
 * No React, no DB here: the screen owns `useReducer` and calls the
 * packages/db transaction once, then dispatches `{ type: 'done' }`.
 *
 * Re-clarify mode re-enters the table at Q2 (core `ReclarifyAnswers` has no
 * Q1 field) — `createWizardState('reclarify', …)` starts at Q2.
 */
import { DATE_ONLY_DEADLINE_HHMM, type ClarifyAnswers, type ClarifyOutcome, type Value } from '@nextdo/core';
import type { ClarifyTarget, ReclarifyAnswers } from '@nextdo/db';

export type WizardMode = 'clarify' | 'reclarify';

export type FormKind = 'reference' | 'someday' | 'trash' | 'project' | 'waiting' | 'calendar' | 'action';

/** The question ids of the Clarify decision table (the answered-history
 *  and the "GTD 决策摘要" card key off these). */
export type QuestionId = 'q1' | 'q1b' | 'q2' | 'q2b' | 'q2c' | 'q3' | 'q3b' | 'q4' | 'q5';

/** One answered question (design §3.1) — the "GTD 决策摘要" card's data:
 *  the question title + the button text the user actually tapped. */
export interface AnsweredQuestion {
  id: QuestionId;
  question: string;
  answer: string;
}

/**
 * Every form field the wizard may collect (design.md §4.3 "表单字段").
 * `''` = unset for optional text/date fields; `estMinutes: null` = not
 * chosen yet. Dates are device-local `YYYY-MM-DD`, the calendar time is
 * `HH:mm` (composed into an ISO datetime at submission — see
 *  Composed into an ISO datetime at submission (see
 *  `composeLocalDateTimeIso`). The 场景 multi-select was removed in issue #46
 *  — submissions no longer carry `contextIds` (the db layer defaults to []).
 */
export interface FormFields {
  title: string;
  url: string;
  note: string;
  waitingOn: string;
  expectedBy: string;
  projectTitle: string;
  projectOutcome: string;
  projectValue: Value;
  actionTitle: string;
  estMinutes: number | null;
  value: Value;
  deadline: string;
  startsAtDate: string;
  startsAtTime: string;
}

export interface WizardResult {
  outcome: ClarifyOutcome;
  createdIds: string[];
}

interface WizardBase {
  mode: WizardMode;
  /** The InboxItem title (re-clarify: the existing action's title) — the
   *  default for every editable title field. */
  defaultTitle: string;
  /** Forward steps taken — the progress line's numerator source
   *  (n = min(depth + 1, PROGRESS_MAX[mode])). */
  depth: number;
  /** The answers given so far, in order (the decision-summary card). */
  answered: AnsweredQuestion[];
  /** History stack of previous states to support step-by-step back navigation. */
  history: WizardSnapshot[];
}

export type WizardSnapshot = Omit<WizardState, 'history'>;

export type WizardState = WizardBase &
  (
    | { step: 'q1' }
    | { step: 'q1b' }
    | { step: 'q2' }
    /** Q2b (only reached after 「属于项目」): the item becomes a NEW project
     *  or attaches to an EXISTING one. */
    | { step: 'q2b' }
    /** Q2c: which existing project — one tap on a project row. */
    | { step: 'q2c' }
    | { step: 'q3' }
    | { step: 'q3b' }
    | { step: 'q4' }
    | { step: 'q5' }
    | {
        step: 'form';
        form: FormKind;
        fields: FormFields;
        error: string | null;
        /** True when the 'action' form was reached via Q3 (~2 min) —
         *  selects the two-minute answers branch at submission. */
        twoMinute: boolean;
        /** Q2b attach: the 'action' form was reached via an EXISTING
         *  project — the attachment is fixed for this submission (changing
         *  it means going back to Q2b). Only the attach path carries these. */
        projectId?: string;
        projectTitle?: string;
      }
    | {
        step: 'preview';
        form: FormKind;
        fields: FormFields;
        twoMinute: boolean;
        projectId?: string;
        projectTitle?: string;
        /** The validated submission being confirmed (design §3.1 D5) —
         *  built ONCE at the form step; the screen submits THIS object on
         *  "确认保存" (never re-builds). Pure data (core/db plain
         *  interfaces) — no side effects in state. */
        submission: Submission;
      }
    | { step: 'done'; result: WizardResult }
  );

export type WizardAction =
  | { type: 'answer-q1'; actionable: boolean }
  | { type: 'answer-q1b'; kind: 'reference' | 'someday' | 'trash' }
  /** Q2: 这件事属于某个项目吗？ — false → Q3 (the regular chain). */
  | { type: 'answer-q2'; inProject: boolean }
  /** Q2b (in-project only): new → the project form; existing → Q2c. */
  | { type: 'answer-q2b'; choice: 'new' | 'existing' }
  /** Q2c: the tapped project row — attach → the action form. The attach
   *  data travels in the action payload — the reducer stays pure. */
  | {
      type: 'answer-q2c';
      projectId: string;
      projectValue: Value;
      projectTitle: string;
    }
  | { type: 'answer-q3'; twoMinutes: boolean }
  /** Only the "not completed on the spot" branch — Q3b-YES is an immediate
   *  submission (`buildDoNowSubmission`), it never parks in a form. */
  | { type: 'answer-q3b'; completedOnTheSpot: false }
  | { type: 'answer-q4'; myResponsibility: boolean }
  | { type: 'answer-q5'; fixedTime: boolean }
  | { type: 'field'; field: keyof FormFields; value: string | number | null }
  /** Enter the preview step (design §3.1 D5) — ONLY the form step accepts
   *  it (every other step returns the state unchanged). The submission
   *  travels in the payload (the screen builds it after `validateForm`
   *  passes); the preview step does NOT write the DB. */
  | { type: 'preview'; submission: Submission }
  /** Leave the preview step back to the form step (fields preserved;
   *  depth/answered unchanged — the preview is the form's confirmation
   *  phase, not a step of its own). */
  | { type: 'back-to-form' }
  /** Step back to the previous question/step or form phase. */
  | { type: 'back' }
  | { type: 'form-error'; error: string | null }
  | { type: 'done'; result: WizardResult };

// ---------------------------------------------------------------------------
// Progress + the preview path (design §3.1 / PRD D5)
// ---------------------------------------------------------------------------

/** The longest question path per mode, INCLUDING the form step (the
 *  preview step does not count). Display: n = min(depth + 1, m).
 *  clarify: q1 → q2(不属于项目) → q3 → q4 → q5 + form = 6;
 *  reclarify: q2 → q3 → q4 → q5 + form = 5. The in-project chain
 *  (q2b/q2c) is shorter than the regular one in both modes. */
export const PROGRESS_MAX: Record<WizardMode, number> = { clarify: 6, reclarify: 5 };

/** The forms whose "保存" goes through the preview step (design §3.2) —
 *  the screen dispatches `{ type: 'preview' }` for these and submits
 *  directly for the rest (reference / someday / trash keep today's
 *  behavior). */
export const PREVIEW_FORMS: readonly FormKind[] = ['action', 'project', 'calendar', 'waiting'];

/** The question titles — the same wording the wizard's QuestionCard
 *  renders (components/clarify-wizard.tsx); the answered history and the
 *  "GTD 决策摘要" card reuse them (design §3.1). */
export const QUESTION_TITLES: Record<QuestionId, string> = {
  q1: '可以变成下一步行动吗？',
  q1b: '那它更接近哪一类？',
  q2: '这件事属于某个项目吗？',
  q2b: '新建项目，还是加到已有项目？',
  q2c: '加到哪个项目？',
  q3: '大约 2 分钟内能完成吗？',
  q3b: '现在就做掉吗？',
  q4: '应该由你完成吗？',
  q5: '必须在固定日期/时间执行吗？',
};

/** The do-now answer (q3b "是，现在就做完") — recorded when `done` is
 *  dispatched straight from the q3b step (the YES button never parks in a
 *  form, so its answer lands with the terminal dispatch). */
const DO_NOW_ANSWER: AnsweredQuestion = {
  id: 'q3b',
  question: QUESTION_TITLES.q3b,
  answer: '是，现在就做完',
};

function emptyFields(defaultTitle: string): FormFields {
  return {
    title: defaultTitle,
    url: '',
    note: '',
    waitingOn: '',
    expectedBy: '',
    projectTitle: defaultTitle,
    projectOutcome: '',
    projectValue: 3,
    actionTitle: defaultTitle,
    estMinutes: null,
    value: 3,
    deadline: '',
    startsAtDate: '',
    startsAtTime: '',
  };
}

function toSnapshot(state: WizardState): WizardSnapshot {
  const snapshot = { ...state };
  delete (snapshot as { history?: unknown }).history;
  return snapshot;
}

/** Entry state: clarify starts at Q1, re-clarify re-enters at Q2.
 *  Entry state: clarify starts at Q1, re-clarify re-enters at Q2. */
export function createWizardState(mode: WizardMode, defaultTitle: string): WizardState {
  const base: WizardBase = {
    mode,
    defaultTitle,
    depth: 0,
    answered: [],
    history: [],
  };
  return mode === 'clarify' ? { ...base, step: 'q1' } : { ...base, step: 'q2' };
}

function toForm(
  state: WizardBase,
  form: FormKind,
  twoMinute: boolean,
  estDefault: number | null,
  attach?: { projectId: string; projectValue: Value; projectTitle: string },
): WizardState {
  const fields = emptyFields(state.defaultTitle);
  if (estDefault !== null) fields.estMinutes = estDefault;
  // Q2b attach: the value defaults to the project's value (still editable).
  if (attach !== undefined) fields.value = attach.projectValue;
  if (attach === undefined) {
    return { ...state, step: 'form', form, fields, error: null, twoMinute };
  }
  return {
    ...state,
    step: 'form',
    form,
    fields,
    error: null,
    twoMinute,
    projectId: attach.projectId,
    projectTitle: attach.projectTitle,
  };
}

/** The base fields after a forward move (design §3.1): depth + 1 and the
 *  user's answer recorded (the question title + the button text they
 *  tapped). The caller supplies the destination step. */
function advanced(state: WizardState, id: QuestionId, answer: string): WizardBase {
  return {
    mode: state.mode,
    defaultTitle: state.defaultTitle,
    depth: state.depth + 1,
    answered: [...state.answered, { id, question: QUESTION_TITLES[id], answer }],
    history: [...state.history, toSnapshot(state)],
  };
}

export function clarifyReducer(state: WizardState, action: WizardAction): WizardState {
  // Terminal — no further navigation within the wizard.
  if (state.step === 'done') return state;

  // Back step: restores previous state from history stack, or exits preview back to form.
  if (action.type === 'back') {
    if (state.step === 'preview') {
      return {
        mode: state.mode,
        defaultTitle: state.defaultTitle,
        depth: state.depth,
        answered: state.answered,
        history: state.history,
        step: 'form',
        form: state.form,
        fields: state.fields,
        error: null,
        twoMinute: state.twoMinute,
        ...(state.projectId !== undefined
          ? { projectId: state.projectId, projectTitle: state.projectTitle }
          : {}),
      };
    }
    if (state.history.length > 0) {
      const previous = state.history[state.history.length - 1];
      const nextHistory = state.history.slice(0, -1);
      return {
        ...previous,
        history: nextHistory,
      } as WizardState;
    }
    return state;
  }

  // 'done' can be dispatched from ANY step (the form steps, the preview
  // step, and the do-now path straight from q3b) — the screen submits the
  // db transaction first.
  if (action.type === 'done') {
    const isDoNow = state.step === 'q3b';
    return {
      mode: state.mode,
      defaultTitle: state.defaultTitle,
      depth: state.depth + (isDoNow ? 1 : 0),
      // The do-now YES button never parks in a form — its answer lands
      // here (design §3.1).
      answered: isDoNow ? [...state.answered, DO_NOW_ANSWER] : state.answered,
      history: state.history,
      step: 'done',
      result: action.result,
    };
  }
  switch (state.step) {
    case 'q1':
      if (action.type === 'answer-q1') {
        const next = advanced(state, 'q1', action.actionable ? '可以，是行动' : '不行');
        return action.actionable ? { ...next, step: 'q2' } : { ...next, step: 'q1b' };
      }
      return state;
    case 'q1b':
      if (action.type === 'answer-q1b') {
        const answer =
          action.kind === 'reference' ? '资料（留个参考）' : action.kind === 'someday' ? '有空再说' : '删除';
        return toForm(advanced(state, 'q1b', answer), action.kind, false, null);
      }
      return state;
    case 'q2':
      if (action.type === 'answer-q2') {
        // 属于项目 walks Q2b (新建 / 已有); 不属于项目 goes straight to
        // the regular chain — Q2c is never shown.
        const next = advanced(state, 'q2', action.inProject ? '属于某个项目' : '不属于项目');
        return action.inProject ? { ...next, step: 'q2b' } : { ...next, step: 'q3' };
      }
      return state;
    case 'q2b':
      if (action.type === 'answer-q2b') {
        if (action.choice === 'new') {
          return toForm(advanced(state, 'q2b', '新建项目'), 'project', false, null);
        }
        return { ...advanced(state, 'q2b', '添加到已有项目'), step: 'q2c' };
      }
      return state;
    case 'q2c':
      if (action.type === 'answer-q2c') {
        // The answer is the tapped project's title (the row text is
        // "{title}（价值 n）").
        return toForm(advanced(state, 'q2c', action.projectTitle), 'action', false, null, {
          projectId: action.projectId,
          projectValue: action.projectValue,
          projectTitle: action.projectTitle,
        });
      }
      return state;
    case 'q3':
      if (action.type === 'answer-q3') {
        const next = advanced(state, 'q3', action.twoMinutes ? '是，2 分钟内' : '否');
        return action.twoMinutes ? { ...next, step: 'q3b' } : { ...next, step: 'q4' };
      }
      return state;
    case 'q3b':
      if (action.type === 'answer-q3b') {
        // Two-minute, not done on the spot → an action form, est prefilled
        // with the spec default (2 min); value stays the fixed default (the
        // submission omits it — core keeps 3 / the re-clarify old value).
        return toForm(advanced(state, 'q3b', '否，记成行动'), 'action', true, 2);
      }
      return state;
    case 'q4':
      if (action.type === 'answer-q4') {
        const next = advanced(state, 'q4', action.myResponsibility ? '是，我的事' : '否，在等别人');
        return action.myResponsibility ? { ...next, step: 'q5' } : toForm(next, 'waiting', false, null);
      }
      return state;
    case 'q5':
      if (action.type === 'answer-q5') {
        const next = advanced(state, 'q5', action.fixedTime ? '是，固定时间' : '否，普通行动');
        return action.fixedTime ? toForm(next, 'calendar', false, null) : toForm(next, 'action', false, null);
      }
      return state;
    case 'form':
      switch (action.type) {
        case 'field': {
          const fields = { ...state.fields };
          (fields as Record<keyof FormFields, string | number | null>)[action.field] = action.value;
          return { ...state, fields, error: null };
        }
        case 'preview':
          // The preview is the form's confirmation phase (design §3.1):
          // carry the form data + the payload's submission. depth/answered
          // unchanged — the preview does not advance the step counter.
          return {
            mode: state.mode,
            defaultTitle: state.defaultTitle,
            depth: state.depth,
            answered: state.answered,
            history: state.history,
            step: 'preview',
            form: state.form,
            fields: state.fields,
            twoMinute: state.twoMinute,
            ...(state.projectId !== undefined
              ? { projectId: state.projectId, projectTitle: state.projectTitle }
              : {}),
            submission: action.submission,
          };
        case 'form-error':
          return { ...state, error: action.error };
        default:
          return state;
      }
    case 'preview':
      if (action.type === 'back-to-form') {
        // Restore the form step — fields preserved, depth/answered
        // unchanged (the preview is not a step of its own).
        return {
          mode: state.mode,
          defaultTitle: state.defaultTitle,
          depth: state.depth,
          answered: state.answered,
          history: state.history,
          step: 'form',
          form: state.form,
          fields: state.fields,
          error: null,
          twoMinute: state.twoMinute,
          ...(state.projectId !== undefined
            ? { projectId: state.projectId, projectTitle: state.projectTitle }
            : {}),
        };
      }
      return state;
  }
}

// ---------------------------------------------------------------------------
// Pre-submit validation (Chinese; the db layer re-checks with typed codes)
// ---------------------------------------------------------------------------

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** 'YYYY-MM-DD' → ISO datetime at 23:59:59 device-local (end of that day). */
export function endOfLocalDayIso(dateOnly: string): string | null {
  const parts = parseDateOnly(dateOnly);
  if (parts === null) return null;
  const date = new Date(parts.year, parts.month - 1, parts.day, 23, 59, 59);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** 'YYYY-MM-DD' + 'HH:mm' → ISO datetime, device-local. */
export function composeLocalDateTimeIso(dateOnly: string, hhmm: string): string | null {
  const parts = parseDateOnly(dateOnly);
  const tm = HHMM.exec(hhmm);
  if (parts === null || tm === null) return null;
  const date = new Date(parts.year, parts.month - 1, parts.day, Number(tm[1]), Number(tm[2]));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const DATETIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * A picker value — 'YYYY-MM-DD' (date only) or 'YYYY-MM-DDTHH:mm' (a real
 * moment, task 10-17) — to the stored ISO datetime. The date-only branch IS
 * the legacy end-of-day convention, so a form that never touches the time
 * keeps writing exactly what it wrote before.
 */
export function localDateTimeToIso(value: string): string | null {
  const match = DATETIME_LOCAL.exec(value);
  if (match === null) return endOfLocalDayIso(value);
  return composeLocalDateTimeIso(`${match[1]}-${match[2]}-${match[3]}`, `${match[4]}:${match[5]}`);
}

/**
 * Reverse of `localDateTimeToIso`, for prefills: an ISO datetime → the
 * picker value. A moment sitting on the date-only sentinel collapses to
 * 'YYYY-MM-DD', so opening a legacy row and saving it changes nothing (and
 * its chip keeps the plain-date wording).
 */
export function localDateTimeKey(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return time === DATE_ONLY_DEADLINE_HHMM ? date : `${date}T${time}`;
}

/**
 * Strict 'YYYY-MM-DD' parse: the regex gates the shape, then a Date
 * round-trip rejects impossible dates (month 13, Feb 30, … — the JS
 * Date constructor silently rolls those over, which must never happen).
 */
function parseDateOnly(dateOnly: string): { year: number; month: number; day: number } | null {
  const match = DATE_ONLY.exec(dateOnly);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return { year, month, day };
}

function validEstMinutes(estMinutes: number | null): boolean {
  return (
    typeof estMinutes === 'number' &&
    Number.isFinite(estMinutes) &&
    Number.isInteger(estMinutes) &&
    estMinutes >= 1 &&
    estMinutes <= 1440
  );
}

/**
 * Validate a finished form BEFORE the submit call (design.md §4.3: the
 * wizard intercepts required fields first, with Chinese copy). Returns the
 * first problem, or null when the form is submittable.
 */
export function validateForm(form: FormKind, fields: FormFields): string | null {
  if (fields.title.trim() === '') return '标题不能为空';
  if (fields.expectedBy !== '' && DATE_ONLY.exec(fields.expectedBy) === null) {
    return '日期格式应为 YYYY-MM-DD';
  }
  if (fields.deadline !== '' && localDateTimeToIso(fields.deadline) === null) {
    return '截止格式应为 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm';
  }
  switch (form) {
    case 'reference':
      return fields.url.trim() === '' ? '请填写链接（URL）' : null;
    case 'someday':
      return null;
    case 'trash':
      return null;
    case 'project':
      if (fields.projectTitle.trim() === '') return '项目名不能为空';
      if (fields.projectOutcome.trim() === '') return '请填写项目结果（"完成"是什么样）';
      return validEstMinutes(fields.estMinutes) ? null : '请选择或填写预估时长（分钟）';
    case 'waiting':
      return fields.waitingOn.trim() === '' ? '请填写在等谁 / 什么' : null;
    case 'calendar':
      if (composeLocalDateTimeIso(fields.startsAtDate, fields.startsAtTime) === null) {
        return '请选择开始日期和时间';
      }
      return validEstMinutes(fields.estMinutes) ? null : '请选择或填写预估时长（分钟）';
    case 'action':
      return validEstMinutes(fields.estMinutes) ? null : '请选择或填写预估时长（分钟）';
  }
}

// ---------------------------------------------------------------------------
// Submission builders (form → core answers + db target)
// ---------------------------------------------------------------------------

export type Submission =
  | { mode: 'clarify'; answers: ClarifyAnswers; target: ClarifyTarget }
  | { mode: 'reclarify'; answers: ReclarifyAnswers; target: ClarifyTarget };

const NON_ACTIONABLE_ANSWERS = { inProject: false, twoMinutes: false, myResponsibility: true, fixedTime: false };

/**
 * The Q3b-YES "completed on the spot" submission (do-now path): no form is
 * involved — the screen submits it immediately and dispatches `done` with
 * the result.
 */
export function buildDoNowSubmission(mode: WizardMode): Submission {
  const target: ClarifyTarget = {};
  if (mode === 'clarify') {
    return {
      mode,
      answers: {
        actionable: true,
        inProject: false,
        twoMinutes: true,
        completedOnTheSpot: true,
        myResponsibility: true,
        fixedTime: false,
      },
      target,
    };
  }
  return {
    mode,
    answers: {
      inProject: false,
      twoMinutes: true,
      completedOnTheSpot: true,
      myResponsibility: true,
      fixedTime: false,
    },
    target,
  };
}

/**
 * Build the submission for a validated form state. `validateForm` must have
 * returned null first — this function assumes the required fields are set.
 * `projectId` is the form's Q2c attachment (the 'action' form reached via
 * an existing project); it is absent for every other form.
 */
export function buildFormSubmission(
  mode: WizardMode,
  form: FormKind,
  fields: FormFields,
  twoMinute: boolean,
  projectId?: string,
): Submission {
  const optional = (text: string): string | undefined => (text.trim() === '' ? undefined : text.trim());

  switch (form) {
    case 'reference': {
      const target: ClarifyTarget = { title: fields.title.trim(), url: fields.url.trim(), note: optional(fields.note) };
      if (mode === 'clarify') {
        return { mode, answers: { actionable: false, nonActionableKind: 'reference', ...NON_ACTIONABLE_ANSWERS }, target };
      }
      throw new Error('unreachable: re-clarify re-enters at Q2 (no reference branch)');
    }
    case 'someday': {
      const target: ClarifyTarget = { title: fields.title.trim(), note: optional(fields.note) };
      if (mode === 'clarify') {
        return { mode, answers: { actionable: false, nonActionableKind: 'someday', ...NON_ACTIONABLE_ANSWERS }, target };
      }
      throw new Error('unreachable: re-clarify re-enters at Q2 (no someday branch)');
    }
    case 'trash': {
      if (mode === 'clarify') {
        return { mode, answers: { actionable: false, nonActionableKind: 'trash', ...NON_ACTIONABLE_ANSWERS }, target: {} };
      }
      throw new Error('unreachable: re-clarify re-enters at Q2 (no trash branch)');
    }
    case 'project': {
      const target: ClarifyTarget = {
        projectTitle: fields.projectTitle.trim(),
        projectValue: fields.projectValue,
        actionTitle: fields.actionTitle.trim(),
        estMinutes: fields.estMinutes as number,
      };
      const projectOutcome = fields.projectOutcome.trim();
      if (mode === 'clarify') {
        return {
          mode,
          answers: { actionable: true, inProject: true, projectChoice: 'new', projectOutcome, twoMinutes: false, myResponsibility: true, fixedTime: false },
          target,
        };
      }
      return {
        mode,
        answers: { inProject: true, projectChoice: 'new', projectOutcome, twoMinutes: false, myResponsibility: true, fixedTime: false },
        target,
      };
    }
    case 'waiting': {
      const target: ClarifyTarget = {
        title: fields.title.trim(),
        waitingOn: fields.waitingOn.trim(),
        expectedBy: fields.expectedBy !== '' ? (endOfLocalDayIso(fields.expectedBy) ?? undefined) : undefined,
      };
      if (mode === 'clarify') {
        return {
          mode,
          answers: { actionable: true, inProject: false, twoMinutes: false, myResponsibility: false, fixedTime: false },
          target,
        };
      }
      return {
        mode,
        answers: { inProject: false, twoMinutes: false, myResponsibility: false, fixedTime: false },
        target,
      };
    }
    case 'calendar': {
      const startsAt = composeLocalDateTimeIso(fields.startsAtDate, fields.startsAtTime);
      if (startsAt === null) throw new Error('calendar form submitted without a valid startsAt');
      const target: ClarifyTarget = {
        title: fields.title.trim(),
        startsAt,
        estMinutes: fields.estMinutes as number,
        value: fields.value,
        deadline: fields.deadline !== '' ? (localDateTimeToIso(fields.deadline) ?? undefined) : undefined,
      };
      if (mode === 'clarify') {
        return {
          mode,
          answers: { actionable: true, inProject: false, twoMinutes: false, myResponsibility: true, fixedTime: true },
          target,
        };
      }
      return {
        mode,
        answers: { inProject: false, twoMinutes: false, myResponsibility: true, fixedTime: true },
        target,
      };
    }
    case 'action': {
      const target: ClarifyTarget = {
        title: fields.actionTitle.trim(),
        estMinutes: fields.estMinutes as number,
        // Two-minute path: value is the fixed spec default — omit it and
        // let the db layer apply the default (3) / keep the re-clarify old
        // value. Clarified path: the user-set value.
        ...(twoMinute ? {} : { value: fields.value }),
        deadline: fields.deadline !== '' ? (localDateTimeToIso(fields.deadline) ?? undefined) : undefined,
      };
      if (mode === 'clarify') {
        return {
          mode,
          answers: {
            actionable: true,
            twoMinutes: twoMinute,
            ...(twoMinute ? { completedOnTheSpot: false } : {}),
            myResponsibility: true,
            fixedTime: false,
            // Q2c attach: carry the chosen project (the project-attach
            // outcome). Without it the item is 「不属于项目」 — the
            // regular-chain semantics.
            ...(projectId !== undefined
              ? { inProject: true, projectChoice: 'existing' as const, projectId }
              : { inProject: false }),
          },
          target,
        };
      }
      return {
        mode,
        answers: {
          twoMinutes: twoMinute,
          ...(twoMinute ? { completedOnTheSpot: false } : {}),
          myResponsibility: true,
          fixedTime: false,
          // Attach → the project id; no attachment → null (explicit
          // detach — re-clarify always walks q2/q2b, so "不属于项目"
          // must be said out loud to drop an old attachment).
          ...(projectId !== undefined
            ? { inProject: true, projectChoice: 'existing' as const, projectId }
            : { inProject: false, projectId: null }),
        },
        target,
      };
    }
  }
}

/** Human-facing (Chinese) outcome summary for the wizard's done step. */
export function outcomeLabel(outcome: ClarifyOutcome): string {
  switch (outcome.kind) {
    case 'reference':
      return '资料';
    case 'someday':
      return '有空再说';
    case 'trash':
      return '已删除（可进回收站找回）';
    case 'do-now-completed':
      return '当场完成';
    case 'project':
      return '项目 + 首个行动';
    case 'waiting-for':
      return '等待他人';
    case 'calendar-action':
      return '固定时间行动';
    case 'next-action':
      return outcome.source === 'project-attach' ? '项目行动（挂接已有项目）' : '下一步行动';
  }
}
