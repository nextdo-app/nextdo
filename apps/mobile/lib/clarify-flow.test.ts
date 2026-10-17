/**
 * Unit tests — the Clarify / Re-clarify pure state machine (lib/clarify-flow).
 *
 * Covers every decision-table outcome (8, incl. the Q2b project attach),
 * every required-field interception (Chinese messages), the do-now
 * immediate path, the two-minute prefill, the re-clarify entry (Q2, no
 * Q1 field), and the projectId three-state in the action submission.
 * Plus design §3.1: depth/answered progression along the full chains,
 * the preview round-trip (form → preview → back → preview), and the
 * contextIds prefill + submission (three form branches × two modes).
 */
import {
  buildDoNowSubmission,
  buildFormSubmission,
  clarifyReducer,
  composeLocalDateTimeIso,
  createWizardState,
  endOfLocalDayIso,
  localDateTimeKey,
  localDateTimeToIso,
  outcomeLabel,
  validateForm,
  PREVIEW_FORMS,
  PROGRESS_MAX,
  type FormFields,
  type WizardState,
} from './clarify-flow';

const TITLE = '订下周去杭州的高铁票';

function formState(state: WizardState): Extract<WizardState, { step: 'form' }> {
  if (state.step !== 'form') throw new Error(`expected form step, got ${state.step}`);
  return state;
}

function walkTo(state: WizardState, ...actions: Parameters<typeof clarifyReducer>[1][]): WizardState {
  return actions.reduce<WizardState>((acc, action) => clarifyReducer(acc, action), state);
}

function fill(fields: FormFields, patch: Partial<FormFields>): FormFields {
  return { ...fields, ...patch };
}

const hm = (date: Date): string =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

/** The q2→…→q5 walk into the plain action form (shared by the
 *  depth/answered and the context-prefill suites). */
const TO_ACTION_FORM = [
  { type: 'answer-q2', multipleSteps: false },
  { type: 'answer-q2b', choice: 'none' },
  { type: 'answer-q3', twoMinutes: false },
  { type: 'answer-q4', myResponsibility: true },
  { type: 'answer-q5', fixedTime: false },
] as const;

describe('createWizardState', () => {
  it('clarify starts at q1', () => {
    expect(createWizardState('clarify', TITLE).step).toBe('q1');
  });

  it('reclarify re-enters at q2', () => {
    const state = createWizardState('reclarify', TITLE);
    expect(state.step).toBe('q2');
    expect(state.defaultTitle).toBe(TITLE);
  });
});

describe('outcome 1 — reference (q1 no → 资料)', () => {
  const state = walkTo(createWizardState('clarify', TITLE), { type: 'answer-q1', actionable: false }, {
    type: 'answer-q1b',
    kind: 'reference',
  });

  it('lands on the reference form with the inbox title prefilled', () => {
    const form = formState(state);
    expect(form.form).toBe('reference');
    expect(form.fields.title).toBe(TITLE);
  });

  it('intercepts a missing url (Chinese message)', () => {
    expect(validateForm('reference', formState(state).fields)).toBe('请填写链接（URL）');
  });

  it('submits core answers + target once the url is set', () => {
    const fields = fill(formState(state).fields, { url: 'https://example.com/ticket', note: '周五出发' });
    expect(validateForm('reference', fields)).toBeNull();
    const submission = buildFormSubmission('clarify', 'reference', fields, false);
    expect(submission).toEqual({
      mode: 'clarify',
      answers: {
        actionable: false,
        nonActionableKind: 'reference',
        multipleSteps: false,
        twoMinutes: false,
        myResponsibility: true,
        fixedTime: false,
      },
      target: { title: TITLE, url: 'https://example.com/ticket', note: '周五出发' },
    });
  });
});

describe('outcome 2 — someday (q1 no → 有空再说)', () => {
  const state = walkTo(createWizardState('clarify', TITLE), { type: 'answer-q1', actionable: false }, {
    type: 'answer-q1b',
    kind: 'someday',
  });

  it('passes validation with no note (note is optional)', () => {
    expect(validateForm('someday', formState(state).fields)).toBeNull();
  });

  it('submits the someday answers + optional note target', () => {
    const submission = buildFormSubmission('clarify', 'someday', formState(state).fields, false);
    expect(submission.answers).toMatchObject({ actionable: false, nonActionableKind: 'someday' });
    expect(submission.target).toEqual({ title: TITLE });
  });
});

describe('outcome 3 — trash (q1 no → 删除)', () => {
  const state = walkTo(createWizardState('clarify', TITLE), { type: 'answer-q1', actionable: false }, {
    type: 'answer-q1b',
    kind: 'trash',
  });

  it('submits with an empty target (soft-delete only)', () => {
    expect(validateForm('trash', formState(state).fields)).toBeNull();
    const submission = buildFormSubmission('clarify', 'trash', formState(state).fields, false);
    expect(submission.answers).toMatchObject({ actionable: false, nonActionableKind: 'trash' });
    expect(submission.target).toEqual({});
  });
});

describe('outcome 4 — project (q2 yes → 新建项目 → 项目 + 首个行动)', () => {
  const state = walkTo(
    createWizardState('clarify', TITLE),
    { type: 'answer-q1', actionable: true },
    { type: 'answer-q2', multipleSteps: true },
    { type: 'answer-q2b', choice: 'new-project' },
  );

  it('intercepts a missing project outcome', () => {
    expect(validateForm('project', formState(state).fields)).toBe('请填写项目结果（"完成"是什么样）');
  });

  it('intercepts a missing estMinutes (after the outcome is set)', () => {
    const fields = fill(formState(state).fields, { projectOutcome: '跑完 baseline' });
    expect(validateForm('project', fields)).toBe('请选择或填写预估时长（分钟）');
  });

  it('submits multipleSteps answers + project target fields', () => {
    const fields = fill(formState(state).fields, {
      projectOutcome: '跑完 baseline',
      projectValue: 4,
      estMinutes: 45,
    });
    expect(validateForm('project', fields)).toBeNull();
    const submission = buildFormSubmission('clarify', 'project', fields, false);
    expect(submission.answers).toMatchObject({ actionable: true, multipleSteps: true, projectOutcome: '跑完 baseline' });
    expect(submission.target).toEqual({
      projectTitle: TITLE,
      projectValue: 4,
      actionTitle: TITLE,
      estMinutes: 45,
      contextIds: [],
    });
  });
});

describe('outcome 8 — project attach (q2b → existing project)', () => {
  const atQ2 = walkTo(
    createWizardState('clarify', TITLE),
    { type: 'answer-q1', actionable: true },
    { type: 'answer-q2', multipleSteps: false },
  );

  it('q2 no → q2b (the project question, not q3 anymore)', () => {
    expect(atQ2.step).toBe('q2b');
    if (atQ2.step === 'q2b') expect(atQ2.multipleSteps).toBe(false);
  });

  it('q2 yes → q2b too (a multi-step item picks its project: attach / new)', () => {
    const atQ2b = clarifyReducer(
      clarifyReducer(createWizardState('clarify', TITLE), { type: 'answer-q1', actionable: true }),
      { type: 'answer-q2', multipleSteps: true },
    );
    expect(atQ2b.step).toBe('q2b');
    if (atQ2b.step === 'q2b') expect(atQ2b.multipleSteps).toBe(true);
  });

  it('q2 yes + new-project → the project form (the capture becomes the project)', () => {
    const atQ2b = clarifyReducer(
      clarifyReducer(createWizardState('clarify', TITLE), { type: 'answer-q1', actionable: true }),
      { type: 'answer-q2', multipleSteps: true },
    );
    const state = clarifyReducer(atQ2b, { type: 'answer-q2b', choice: 'new-project' });
    expect(formState(state).form).toBe('project');
  });

  it('q2 yes + attach → the action form carries the project (no new project created)', () => {
    const atQ2b = clarifyReducer(
      clarifyReducer(createWizardState('clarify', TITLE), { type: 'answer-q1', actionable: true }),
      { type: 'answer-q2', multipleSteps: true },
    );
    const state = clarifyReducer(atQ2b, {
      type: 'answer-q2b',
      choice: 'attach',
      projectId: 'p-2',
      projectValue: 5,
      projectTitle: '官网改版',
    });
    const form = formState(state);
    expect(form.form).toBe('action');
    expect(form.projectId).toBe('p-2');
    expect(form.projectTitle).toBe('官网改版');
    expect(form.fields.value).toBe(5);
    // The submission is the project-attach encoding: NO new project
    // (multipleSteps=false) + the existing project id — core classifies
    // this as next-action/project-attach.
    const submission = buildFormSubmission('clarify', 'action', form.fields, false, form.projectId);
    expect(submission.answers).toMatchObject({ multipleSteps: false, projectId: 'p-2' });
  });

  it('none → q3 (the regular chain)', () => {
    expect(clarifyReducer(atQ2, { type: 'answer-q2b', choice: 'none' }).step).toBe('q3');
  });

  it('new-project → the project form', () => {
    const state = clarifyReducer(atQ2, { type: 'answer-q2b', choice: 'new-project' });
    expect(formState(state).form).toBe('project');
  });

  it('attach → the action form with the project value prefilled and the attachment carried', () => {
    const state = clarifyReducer(atQ2, {
      type: 'answer-q2b',
      choice: 'attach',
      projectId: 'p-1',
      projectValue: 4,
      projectTitle: '毕业论文实验',
    });
    const form = formState(state);
    expect(form.form).toBe('action');
    expect(form.twoMinute).toBe(false);
    expect(form.fields.value).toBe(4);
    expect(form.projectId).toBe('p-1');
    expect(form.projectTitle).toBe('毕业论文实验');
  });

  it('re-clarify walks the same q2b (re-entry at q2)', () => {
    const state = clarifyReducer(createWizardState('reclarify', TITLE), {
      type: 'answer-q2',
      multipleSteps: false,
    });
    expect(state.step).toBe('q2b');
  });
});

describe('buildFormSubmission — the projectId three-state (action form)', () => {
  const fields = fill(
    {
      title: TITLE,
      url: '',
      note: '',
      waitingOn: '',
      expectedBy: '',
      projectTitle: TITLE,
      projectOutcome: '',
      projectValue: 3,
      actionTitle: TITLE,
      estMinutes: null,
      value: 3,
      deadline: '',
      startsAtDate: '',
      startsAtTime: '',
      contextIds: [],
    },
    { estMinutes: 20 },
  );

  it('clarify + attach → answers.projectId = the project id', () => {
    const submission = buildFormSubmission('clarify', 'action', fields, false, 'p-1');
    expect(submission.answers).toMatchObject({ projectId: 'p-1', twoMinutes: false });
  });

  it('clarify without attach → the field is ABSENT (Q3–Q5 semantics)', () => {
    const submission = buildFormSubmission('clarify', 'action', fields, false);
    expect('projectId' in submission.answers).toBe(false);
  });

  it('reclarify + attach → answers.projectId = the project id', () => {
    const submission = buildFormSubmission('reclarify', 'action', fields, false, 'p-1');
    expect(submission.answers).toMatchObject({ projectId: 'p-1' });
    expect('actionable' in submission.answers).toBe(false);
  });

  it('reclarify without attach → answers.projectId = null (explicit detach)', () => {
    const submission = buildFormSubmission('reclarify', 'action', fields, false);
    expect(submission.answers).toMatchObject({ projectId: null });
  });

  it('two-minute path is unaffected (attach never reaches q3)', () => {
    const submission = buildFormSubmission('reclarify', 'action', fields, true);
    expect(submission.answers).toMatchObject({ twoMinutes: true, completedOnTheSpot: false, projectId: null });
  });
});

describe('outcome 5 — waiting-for (q4 no → 等待他人)', () => {
  const state = walkTo(
    createWizardState('clarify', TITLE),
    { type: 'answer-q1', actionable: true },
    { type: 'answer-q2', multipleSteps: false },
    { type: 'answer-q2b', choice: 'none' },
    { type: 'answer-q3', twoMinutes: false },
    { type: 'answer-q4', myResponsibility: false },
  );

  it('intercepts a missing waitingOn', () => {
    expect(validateForm('waiting', formState(state).fields)).toBe('请填写在等谁 / 什么');
  });

  it('submits myResponsibility=false + the expectedBy date as end-of-day ISO', () => {
    const fields = fill(formState(state).fields, { waitingOn: '导师', expectedBy: '2026-09-25' });
    expect(validateForm('waiting', fields)).toBeNull();
    const submission = buildFormSubmission('clarify', 'waiting', fields, false);
    expect(submission.answers).toMatchObject({ myResponsibility: false, fixedTime: false });
    expect(submission.target.waitingOn).toBe('导师');
    const expectedBy = new Date(submission.target.expectedBy as string);
    expect(expectedBy.getFullYear()).toBe(2026);
    expect(expectedBy.getMonth()).toBe(8);
    expect(expectedBy.getDate()).toBe(25);
    expect(hm(expectedBy)).toBe('23:59');
  });

  it('intercepts a malformed expectedBy date', () => {
    const fields = fill(formState(state).fields, { waitingOn: '导师', expectedBy: '2026/09/25' });
    expect(validateForm('waiting', fields)).toBe('日期格式应为 YYYY-MM-DD');
  });
});

describe('outcome 6 — calendar-action (q5 yes → 固定时间行动)', () => {
  const state = walkTo(
    createWizardState('clarify', TITLE),
    { type: 'answer-q1', actionable: true },
    { type: 'answer-q2', multipleSteps: false },
    { type: 'answer-q2b', choice: 'none' },
    { type: 'answer-q3', twoMinutes: false },
    { type: 'answer-q4', myResponsibility: true },
    { type: 'answer-q5', fixedTime: true },
  );

  it('intercepts a missing startsAt', () => {
    expect(validateForm('calendar', formState(state).fields)).toBe('请选择开始日期和时间');
  });

  it('submits fixedTime answers + the composed local startsAt ISO', () => {
    const fields = fill(formState(state).fields, {
      startsAtDate: '2026-09-25',
      startsAtTime: '09:30',
      estMinutes: 30,
      value: 4,
    });
    expect(validateForm('calendar', fields)).toBeNull();
    const submission = buildFormSubmission('clarify', 'calendar', fields, false);
    expect(submission.answers).toMatchObject({ myResponsibility: true, fixedTime: true, twoMinutes: false });
    const startsAt = new Date(submission.target.startsAt as string);
    expect(startsAt.getFullYear()).toBe(2026);
    expect(startsAt.getMonth()).toBe(8);
    expect(startsAt.getDate()).toBe(25);
    expect(hm(startsAt)).toBe('09:30');
    expect(submission.target).toMatchObject({ estMinutes: 30, value: 4 });
  });
});

describe('outcome 7a — next-action clarified (q5 no)', () => {
  const state = walkTo(
    createWizardState('clarify', TITLE),
    { type: 'answer-q1', actionable: true },
    { type: 'answer-q2', multipleSteps: false },
    { type: 'answer-q2b', choice: 'none' },
    { type: 'answer-q3', twoMinutes: false },
    { type: 'answer-q4', myResponsibility: true },
    { type: 'answer-q5', fixedTime: false },
  );

  it('intercepts a missing estMinutes', () => {
    expect(validateForm('action', formState(state).fields)).toBe('请选择或填写预估时长（分钟）');
  });

  it('submits the user value + optional deadline', () => {
    const fields = fill(formState(state).fields, { estMinutes: 20, value: 5, deadline: '2026-09-30' });
    expect(validateForm('action', fields)).toBeNull();
    const submission = buildFormSubmission('clarify', 'action', fields, false);
    expect(submission.answers).toMatchObject({ twoMinutes: false, myResponsibility: true, fixedTime: false });
    expect('completedOnTheSpot' in submission.answers).toBe(false);
    expect(submission.target).toMatchObject({ estMinutes: 20, value: 5 });
    const deadline = new Date(submission.target.deadline as string);
    expect(deadline.getDate()).toBe(30);
    expect(hm(deadline)).toBe('23:59');
  });
});

describe('outcome 7b — two-minute path (q3 yes)', () => {
  it('do-now: buildDoNowSubmission carries completedOnTheSpot (both modes)', () => {
    const clarify = buildDoNowSubmission('clarify');
    expect(clarify.mode).toBe('clarify');
    expect(clarify.answers).toMatchObject({ actionable: true, twoMinutes: true, completedOnTheSpot: true });
    expect(clarify.target).toEqual({});
    const reclarify = buildDoNowSubmission('reclarify');
    expect(reclarify.mode).toBe('reclarify');
    expect(reclarify.answers).toMatchObject({ twoMinutes: true, completedOnTheSpot: true });
    expect('actionable' in reclarify.answers).toBe(false);
  });

  it('regression: the reducer accepts "done" from q3b (the do-now path submits without a form)', () => {
    const atQ3b = walkTo(
      createWizardState('clarify', TITLE),
      { type: 'answer-q1', actionable: true },
      { type: 'answer-q2', multipleSteps: false },
      { type: 'answer-q2b', choice: 'none' },
      { type: 'answer-q3', twoMinutes: true },
    );
    expect(atQ3b.step).toBe('q3b');
    const done = clarifyReducer(atQ3b, {
      type: 'done',
      result: { outcome: { kind: 'do-now-completed' }, createdIds: ['r1'] },
    });
    expect(done.step).toBe('done');
    if (done.step === 'done') {
      expect(done.result.outcome.kind).toBe('do-now-completed');
      // The terminal step absorbs any further actions.
      expect(clarifyReducer(done, { type: 'answer-q1', actionable: true }).step).toBe('done');
    }
  });

  it('not done on the spot: the action form prefills estMinutes = 2', () => {
    const state = walkTo(
      createWizardState('clarify', TITLE),
      { type: 'answer-q1', actionable: true },
      { type: 'answer-q2', multipleSteps: false },
      { type: 'answer-q2b', choice: 'none' },
      { type: 'answer-q3', twoMinutes: true },
      { type: 'answer-q3b', completedOnTheSpot: false },
    );
    const form = formState(state);
    expect(form.form).toBe('action');
    expect(form.twoMinute).toBe(true);
    expect(form.fields.estMinutes).toBe(2);
  });

  it('the two-minute submission omits value (fixed spec default) and sets completedOnTheSpot=false', () => {
    const state = walkTo(
      createWizardState('clarify', TITLE),
      { type: 'answer-q1', actionable: true },
      { type: 'answer-q2', multipleSteps: false },
      { type: 'answer-q2b', choice: 'none' },
      { type: 'answer-q3', twoMinutes: true },
      { type: 'answer-q3b', completedOnTheSpot: false },
    );
    const form = formState(state);
    expect(validateForm('action', form.fields)).toBeNull();
    const submission = buildFormSubmission('clarify', 'action', form.fields, true);
    expect(submission.answers).toMatchObject({ twoMinutes: true, completedOnTheSpot: false });
    expect('value' in (submission.target as Record<string, unknown>)).toBe(false);
    expect(submission.target).toMatchObject({ estMinutes: 2, title: TITLE });
  });
});

describe('reclarify mode (q2 起)', () => {
  it('walks q2 → q2b → 新建项目 and its answers carry NO actionable field', () => {
    const state = walkTo(
      createWizardState('reclarify', TITLE),
      { type: 'answer-q2', multipleSteps: true },
      { type: 'answer-q2b', choice: 'new-project' },
    );
    const form = formState(state);
    const fields = fill(form.fields, { projectOutcome: '新结果', estMinutes: 30 });
    const submission = buildFormSubmission('reclarify', 'project', fields, false);
    expect(submission.mode).toBe('reclarify');
    expect('actionable' in submission.answers).toBe(false);
    expect(submission.answers).toMatchObject({ multipleSteps: true, projectOutcome: '新结果' });
  });

  it('throws for the Q1-only forms (unreachable in reclarify)', () => {
    const fields = formState(
      walkTo(
        createWizardState('reclarify', TITLE),
        { type: 'answer-q2', multipleSteps: true },
        { type: 'answer-q2b', choice: 'new-project' },
      ),
    ).fields;
    expect(() => buildFormSubmission('reclarify', 'reference', fields, false)).toThrow();
    expect(() => buildFormSubmission('reclarify', 'someday', fields, false)).toThrow();
    expect(() => buildFormSubmission('reclarify', 'trash', fields, false)).toThrow();
  });
});

describe('reducer mechanics', () => {
  it('ignores actions that do not match the current step', () => {
    const state = createWizardState('clarify', TITLE);
    expect(clarifyReducer(state, { type: 'answer-q5', fixedTime: true })).toBe(state);
    expect(clarifyReducer(state, { type: 'field', field: 'url', value: 'x' })).toBe(state);
  });

  it('field updates replace the value and clear a previous error', () => {
    const form = formState(
      walkTo(createWizardState('clarify', TITLE), { type: 'answer-q1', actionable: false }, {
        type: 'answer-q1b',
        kind: 'reference',
      }),
    );
    const withError = clarifyReducer(form, { type: 'form-error', error: '请填写链接（URL）' });
    expect(withError.step === 'form' ? withError.error : null).toBe('请填写链接（URL）');
    const updated = clarifyReducer(withError, { type: 'field', field: 'url', value: 'https://x' });
    expect(updated.step === 'form' ? updated.fields.url : null).toBe('https://x');
    expect(updated.step === 'form' ? updated.error : null).toBeNull();
  });

  it('the done step is terminal (base fields — depth/answered — are carried over)', () => {
    const form = formState(
      walkTo(createWizardState('clarify', TITLE), { type: 'answer-q1', actionable: false }, {
        type: 'answer-q1b',
        kind: 'someday',
      }),
    );
    const result = { outcome: { kind: 'someday' } as const, createdIds: ['id-1'] };
    const done = clarifyReducer(form, { type: 'done', result });
    expect(done).toEqual({
      mode: 'clarify',
      defaultTitle: TITLE,
      initialContextIds: [],
      depth: 2,
      answered: [
        { id: 'q1', question: '可以变成下一步行动吗？', answer: '不行' },
        { id: 'q1b', question: '那它更接近哪一类？', answer: '有空再说' },
      ],
      history: form.history,
      step: 'done',
      result,
    });
    expect(clarifyReducer(done, { type: 'answer-q1', actionable: true })).toBe(done);
  });
});

describe('validateForm edge cases', () => {
  const base: FormFields = {
    title: TITLE,
    url: '',
    note: '',
    waitingOn: '',
    expectedBy: '',
    projectTitle: TITLE,
    projectOutcome: '',
    projectValue: 3,
    actionTitle: TITLE,
    estMinutes: null,
    value: 3,
    deadline: '',
    startsAtDate: '',
    startsAtTime: '',
    contextIds: [],
  };

  it('intercepts an empty title on every form', () => {
    const empty = fill(base, { title: '   ' });
    expect(validateForm('someday', empty)).toBe('标题不能为空');
  });

  it('rejects estMinutes of 0 / negative / fractional / > 1440', () => {
    for (const bad of [0, -5, 2.5, 1441]) {
      expect(validateForm('action', fill(base, { estMinutes: bad }))).toBe('请选择或填写预估时长（分钟）');
    }
    expect(validateForm('action', fill(base, { estMinutes: 1440 }))).toBeNull();
  });

  it('intercepts a malformed deadline on the action form', () => {
    expect(validateForm('action', fill(base, { estMinutes: 10, deadline: '30-09-2026' }))).toBe(
      '截止格式应为 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm',
    );
  });

  it('accepts a deadline that carries a time (task 10-17)', () => {
    expect(validateForm('action', fill(base, { estMinutes: 10, deadline: '2026-09-30' }))).toBeNull();
    expect(
      validateForm('action', fill(base, { estMinutes: 10, deadline: '2026-09-30T18:00' })),
    ).toBeNull();
    expect(validateForm('action', fill(base, { estMinutes: 10, deadline: '2026-09-30T25:00' }))).toBe(
      '截止格式应为 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm',
    );
  });
});

describe('date composition helpers', () => {
  it('endOfLocalDayIso maps a date to local 23:59:59', () => {
    const iso = endOfLocalDayIso('2026-09-25');
    expect(iso).not.toBeNull();
    const date = new Date(iso as string);
    expect(`${date.getMonth() + 1}-${date.getDate()}`).toBe('9-25');
    expect(`${hm(date)}:${String(date.getSeconds()).padStart(2, '0')}`).toBe('23:59:59');
  });

  it('endOfLocalDayIso rejects malformed values', () => {
    expect(endOfLocalDayIso('')).toBeNull();
    expect(endOfLocalDayIso('2026-13-01')).toBeNull();
    expect(endOfLocalDayIso('not-a-date')).toBeNull();
  });

  it('localDateTimeToIso keeps a picked time and falls back to end-of-day', () => {
    // Task 10-17 — the two picker shapes this one function has to accept.
    expect(localDateTimeToIso('2026-09-25')).toBe(endOfLocalDayIso('2026-09-25'));
    const withTime = localDateTimeToIso('2026-09-25T18:00');
    expect(withTime).not.toBeNull();
    expect(hm(new Date(withTime as string))).toBe('18:00');
    expect(localDateTimeToIso('')).toBeNull();
    expect(localDateTimeToIso('2026-13-01')).toBeNull();
    expect(localDateTimeToIso('2026-09-25T25:00')).toBeNull();
    expect(localDateTimeToIso('2026-09-25T18:00:30')).toBeNull();
  });

  it('localDateTimeKey collapses the end-of-day sentinel back to a date', () => {
    // Prefill direction: a legacy 23:59 row re-opens as "date only" so
    // saving it untouched cannot mint a 23:59 time the user never picked.
    expect(localDateTimeKey(new Date(2026, 8, 25, 18, 0, 0, 0).toISOString())).toBe(
      '2026-09-25T18:00',
    );
    expect(localDateTimeKey(new Date(2026, 8, 25, 23, 59, 30, 0).toISOString())).toBe('2026-09-25');
    expect(localDateTimeKey('garbage')).toBe('');
  });

  it('composeLocalDateTimeIso maps date+time to a local datetime ISO', () => {
    const iso = composeLocalDateTimeIso('2026-09-25', '09:30');
    expect(iso).not.toBeNull();
    const date = new Date(iso as string);
    expect(hm(date)).toBe('09:30');
  });

  it('composeLocalDateTimeIso rejects malformed times', () => {
    expect(composeLocalDateTimeIso('2026-09-25', '25:00')).toBeNull();
    expect(composeLocalDateTimeIso('2026-09-25', '9:5')).toBeNull();
    expect(composeLocalDateTimeIso('2026-09-25', '')).toBeNull();
  });
});

describe('depth + answered + preview (design §3.1)', () => {
  it('creates depth 0 / answered [] / initialContextIds [] (both modes)', () => {
    for (const mode of ['clarify', 'reclarify'] as const) {
      const state = createWizardState(mode, TITLE);
      expect(state.depth).toBe(0);
      expect(state.answered).toEqual([]);
      expect(state.initialContextIds).toEqual([]);
    }
  });

  it('increments depth and records each answer along q1→q2→q2b→q3→q4→q5→form', () => {
    let state = createWizardState('clarify', TITLE);

    state = clarifyReducer(state, { type: 'answer-q1', actionable: true });
    expect(state.step).toBe('q2');
    expect(state.depth).toBe(1);
    expect(state.answered).toEqual([
      { id: 'q1', question: '可以变成下一步行动吗？', answer: '可以，是行动' },
    ]);

    state = clarifyReducer(state, { type: 'answer-q2', multipleSteps: false });
    expect(state.step).toBe('q2b');
    expect(state.depth).toBe(2);
    expect(state.answered.at(1)).toEqual({
      id: 'q2',
      question: '需要多个步骤才能完成吗？',
      answer: '否，一步能完成',
    });

    state = clarifyReducer(state, { type: 'answer-q2b', choice: 'none' });
    expect(state.step).toBe('q3');
    expect(state.depth).toBe(3);
    expect(state.answered.at(2)).toEqual({
      id: 'q2b',
      question: '它属于哪个项目？',
      answer: '不属于项目',
    });

    state = clarifyReducer(state, { type: 'answer-q3', twoMinutes: false });
    expect(state.step).toBe('q4');
    state = clarifyReducer(state, { type: 'answer-q4', myResponsibility: true });
    expect(state.step).toBe('q5');
    state = clarifyReducer(state, { type: 'answer-q5', fixedTime: false });
    expect(state.step).toBe('form');
    expect(state.depth).toBe(6);
    // The form step is clarify's 7th step (n = depth + 1, PRD D5).
    expect(state.depth + 1).toBe(PROGRESS_MAX.clarify);
    expect(state.answered.map((entry) => entry.id)).toEqual(['q1', 'q2', 'q2b', 'q3', 'q4', 'q5']);
  });

  it('the reclarify chain reaches the form at depth 5 (n = 6 = PROGRESS_MAX.reclarify)', () => {
    const state = walkTo(createWizardState('reclarify', TITLE), ...TO_ACTION_FORM);
    expect(state.step).toBe('form');
    expect(state.depth).toBe(5);
    expect(state.depth + 1).toBe(PROGRESS_MAX.reclarify);
    expect(state.answered.map((entry) => entry.id)).toEqual(['q2', 'q2b', 'q3', 'q4', 'q5']);
  });

  it('records the q1b branch answers (the tapped button text)', () => {
    const s1 = clarifyReducer(createWizardState('clarify', TITLE), { type: 'answer-q1', actionable: false });
    expect(s1.step).toBe('q1b');
    expect(s1.answered).toEqual([{ id: 'q1', question: '可以变成下一步行动吗？', answer: '不行' }]);
    const s2 = clarifyReducer(s1, { type: 'answer-q1b', kind: 'reference' });
    expect(s2.step).toBe('form');
    expect(s2.depth).toBe(2);
    expect(s2.answered.at(1)).toEqual({
      id: 'q1b',
      question: '那它更接近哪一类？',
      answer: '资料（留个参考）',
    });
  });

  it('records the q2b attach answer as the project title', () => {
    const atQ2b = walkTo(
      createWizardState('clarify', TITLE),
      { type: 'answer-q1', actionable: true },
      { type: 'answer-q2', multipleSteps: false },
    );
    const state = clarifyReducer(atQ2b, {
      type: 'answer-q2b',
      choice: 'attach',
      projectId: 'p-1',
      projectValue: 4,
      projectTitle: '毕业论文实验',
    });
    expect(state.step).toBe('form');
    expect(state.depth).toBe(3);
    expect(state.answered.at(2)).toEqual({
      id: 'q2b',
      question: '它属于哪个项目？',
      answer: '毕业论文实验',
    });
  });

  it('do-now (q3b direct submit) records its answer at the done dispatch', () => {
    const atQ3b = walkTo(
      createWizardState('clarify', TITLE),
      { type: 'answer-q1', actionable: true },
      { type: 'answer-q2', multipleSteps: false },
      { type: 'answer-q2b', choice: 'none' },
      { type: 'answer-q3', twoMinutes: true },
    );
    expect(atQ3b.step).toBe('q3b');
    expect(atQ3b.depth).toBe(4);
    const done = clarifyReducer(atQ3b, {
      type: 'done',
      result: { outcome: { kind: 'do-now-completed' }, createdIds: ['r1'] },
    });
    expect(done.step).toBe('done');
    expect(done.depth).toBe(5);
    expect(done.answered.at(-1)).toEqual({
      id: 'q3b',
      question: '现在就做掉吗？',
      answer: '是，现在就做完',
    });
  });

  it('preview round-trip: form → preview → back → preview keeps fields; depth/answered unchanged', () => {
    const atForm = formState(
      walkTo(
        createWizardState('clarify', TITLE),
        { type: 'answer-q1', actionable: true },
        ...TO_ACTION_FORM,
      ),
    );
    const withEst = clarifyReducer(atForm, { type: 'field', field: 'estMinutes', value: 20 });
    const filled = formState(withEst);
    const submission = buildFormSubmission('clarify', 'action', filled.fields, false);

    const preview = clarifyReducer(filled, { type: 'preview', submission });
    expect(preview.step).toBe('preview');
    if (preview.step !== 'preview') throw new Error('unreachable');
    expect(preview.submission).toBe(submission);
    expect(preview.fields).toBe(filled.fields);
    expect(preview.depth).toBe(6);
    expect(preview.answered).toHaveLength(6);

    const back = clarifyReducer(preview, { type: 'back-to-form' });
    expect(back.step).toBe('form');
    if (back.step !== 'form') throw new Error('unreachable');
    expect(back.fields).toBe(filled.fields);
    expect(back.depth).toBe(6);
    expect(back.answered).toEqual(preview.answered);

    // A second round-trip is idempotent.
    const again = clarifyReducer(back, { type: 'preview', submission });
    expect(again.step).toBe('preview');
    if (again.step === 'preview') {
      expect(again.submission).toBe(submission);
      expect(again.fields).toBe(filled.fields);
    }
  });

  it('preview is ignored on non-form steps (state returned unchanged)', () => {
    const atQ2 = walkTo(createWizardState('clarify', TITLE), { type: 'answer-q1', actionable: true });
    expect(clarifyReducer(atQ2, { type: 'preview', submission: buildDoNowSubmission('clarify') })).toBe(atQ2);
  });

  it('PREVIEW_FORMS = action / project / calendar / waiting', () => {
    expect([...PREVIEW_FORMS]).toEqual(['action', 'project', 'calendar', 'waiting']);
  });
});

describe('contextIds in the submission (design §3.1)', () => {
  const base = (contextIds: string[]): FormFields => ({
    title: TITLE,
    url: '',
    note: '',
    waitingOn: '导师',
    expectedBy: '',
    projectTitle: TITLE,
    projectOutcome: '跑完 baseline',
    projectValue: 3,
    actionTitle: TITLE,
    estMinutes: 20,
    value: 3,
    deadline: '',
    startsAtDate: '2026-09-25',
    startsAtTime: '09:00',
    contextIds,
  });

  it('action form: contextIds into the target (clarify + reclarify, multi-select)', () => {
    expect(buildFormSubmission('clarify', 'action', base(['c1', 'c2']), false).target.contextIds).toEqual([
      'c1',
      'c2',
    ]);
    expect(buildFormSubmission('reclarify', 'action', base(['c1', 'c2']), false).target.contextIds).toEqual([
      'c1',
      'c2',
    ]);
  });

  it('action form: an empty array is written as-is (随处可执行)', () => {
    expect(buildFormSubmission('clarify', 'action', base([]), false).target.contextIds).toEqual([]);
    expect(buildFormSubmission('reclarify', 'action', base([]), false).target.contextIds).toEqual([]);
  });

  it('calendar form: contextIds into the target (clarify + reclarify)', () => {
    expect(buildFormSubmission('clarify', 'calendar', base(['c1']), false).target.contextIds).toEqual(['c1']);
    expect(buildFormSubmission('reclarify', 'calendar', base(['c1']), false).target.contextIds).toEqual(['c1']);
  });

  it('project form: contextIds into the first action (clarify + reclarify)', () => {
    expect(buildFormSubmission('clarify', 'project', base(['c1', 'c2']), false).target.contextIds).toEqual([
      'c1',
      'c2',
    ]);
    expect(buildFormSubmission('reclarify', 'project', base(['c1', 'c2']), false).target.contextIds).toEqual([
      'c1',
      'c2',
    ]);
  });

  it('reference / someday / trash targets stay context-free (branches unchanged)', () => {
    const reference = buildFormSubmission('clarify', 'reference', base(['c1']), false);
    expect('contextIds' in reference.target).toBe(false);
    const someday = buildFormSubmission('clarify', 'someday', base(['c1']), false);
    expect('contextIds' in someday.target).toBe(false);
    const trash = buildFormSubmission('clarify', 'trash', base(['c1']), false);
    expect('contextIds' in trash.target).toBe(false);
  });
});

describe('reclarify context prefill (createWizardState third argument)', () => {
  const toActionForm = (state: WizardState): WizardState => walkTo(state, ...TO_ACTION_FORM);

  it('prefills the existing action contextIds into the form fields', () => {
    const state = toActionForm(createWizardState('reclarify', TITLE, ['c-office', 'c-phone']));
    expect(formState(state).fields.contextIds).toEqual(['c-office', 'c-phone']);
  });

  it('does not alias the passed-in array', () => {
    const initial = ['c1'];
    const state = toActionForm(createWizardState('reclarify', TITLE, initial));
    initial.push('c2');
    expect(formState(state).fields.contextIds).toEqual(['c1']);
  });

  it('defaults to an empty array (clarify entry)', () => {
    // clarify starts at q1 — answer it first, then walk the q2→form chain
    // (the reclarify entry re-enters at q2, so it can use `toActionForm`
    // directly; clarify cannot).
    const state = walkTo(createWizardState('clarify', TITLE), { type: 'answer-q1', actionable: true }, ...TO_ACTION_FORM);
    expect(formState(state).fields.contextIds).toEqual([]);
  });

  it('the field action replaces the context selection and clears a previous error', () => {
    const atForm = formState(toActionForm(createWizardState('reclarify', TITLE, ['c1'])));
    const withError = clarifyReducer(atForm, { type: 'form-error', error: '请选择开始日期和时间' });
    const updated = clarifyReducer(withError, { type: 'field', field: 'contextIds', value: ['c2', 'c3'] });
    expect(formState(updated).fields.contextIds).toEqual(['c2', 'c3']);
    expect(formState(updated).error).toBeNull();
  });
});

describe('outcomeLabel (Chinese summary for the done step)', () => {
  it('labels every outcome kind', () => {
    expect(outcomeLabel({ kind: 'reference' })).toBe('资料');
    expect(outcomeLabel({ kind: 'someday' })).toBe('有空再说');
    expect(outcomeLabel({ kind: 'trash' })).toContain('删除');
    expect(outcomeLabel({ kind: 'do-now-completed' })).toBe('当场完成');
    expect(outcomeLabel({ kind: 'project' })).toBe('项目 + 首个行动');
    expect(outcomeLabel({ kind: 'waiting-for' })).toBe('等待他人');
    expect(outcomeLabel({ kind: 'calendar-action' })).toBe('固定时间行动');
    expect(outcomeLabel({ kind: 'next-action', source: 'clarified' })).toBe('下一步行动');
    expect(outcomeLabel({ kind: 'next-action', source: 'two-minute' })).toBe('下一步行动');
    expect(outcomeLabel({ kind: 'next-action', source: 'project-attach' })).toBe('项目行动（挂接已有项目）');
  });
});

describe('step-by-step back navigation (history stack)', () => {
  it('clarify mode: steps back from q2 to q1, resetting answered and depth', () => {
    const q1 = createWizardState('clarify', TITLE);
    const q2 = clarifyReducer(q1, { type: 'answer-q1', actionable: true });
    expect(q2.step).toBe('q2');
    expect(q2.depth).toBe(1);
    expect(q2.answered).toHaveLength(1);
    expect(q2.history).toHaveLength(1);

    const backToQ1 = clarifyReducer(q2, { type: 'back' });
    expect(backToQ1.step).toBe('q1');
    expect(backToQ1.depth).toBe(0);
    expect(backToQ1.answered).toEqual([]);
    expect(backToQ1.history).toEqual([]);
  });

  it('clarify mode: steps back along q1 -> q1b -> form -> back to q1b -> back to q1', () => {
    const q1 = createWizardState('clarify', TITLE);
    const q1b = clarifyReducer(q1, { type: 'answer-q1', actionable: false });
    expect(q1b.step).toBe('q1b');

    const form = clarifyReducer(q1b, { type: 'answer-q1b', kind: 'reference' });
    expect(form.step).toBe('form');
    expect(form.history).toHaveLength(2);

    const back1 = clarifyReducer(form, { type: 'back' });
    expect(back1.step).toBe('q1b');
    expect(back1.depth).toBe(1);
    expect(back1.answered).toEqual([{ id: 'q1', question: '可以变成下一步行动吗？', answer: '不行' }]);

    const back2 = clarifyReducer(back1, { type: 'back' });
    expect(back2.step).toBe('q1');
    expect(back2.depth).toBe(0);
    expect(back2.answered).toEqual([]);
    expect(back2.history).toEqual([]);
  });

  it('clarify mode: steps back along deep chain q5 -> q4 -> q3 -> q2b -> q2 -> q1', () => {
    let state = createWizardState('clarify', TITLE);
    state = clarifyReducer(state, { type: 'answer-q1', actionable: true });
    state = clarifyReducer(state, { type: 'answer-q2', multipleSteps: false });
    state = clarifyReducer(state, { type: 'answer-q2b', choice: 'none' });
    state = clarifyReducer(state, { type: 'answer-q3', twoMinutes: false });
    state = clarifyReducer(state, { type: 'answer-q4', myResponsibility: true });
    state = clarifyReducer(state, { type: 'answer-q5', fixedTime: false });
    expect(state.step).toBe('form');
    expect(state.depth).toBe(6);

    state = clarifyReducer(state, { type: 'back' });
    expect(state.step).toBe('q5');
    expect(state.depth).toBe(5);

    state = clarifyReducer(state, { type: 'back' });
    expect(state.step).toBe('q4');
    expect(state.depth).toBe(4);

    state = clarifyReducer(state, { type: 'back' });
    expect(state.step).toBe('q3');
    expect(state.depth).toBe(3);

    state = clarifyReducer(state, { type: 'back' });
    expect(state.step).toBe('q2b');
    expect(state.depth).toBe(2);

    state = clarifyReducer(state, { type: 'back' });
    expect(state.step).toBe('q2');
    expect(state.depth).toBe(1);

    state = clarifyReducer(state, { type: 'back' });
    expect(state.step).toBe('q1');
    expect(state.depth).toBe(0);
    expect(state.answered).toEqual([]);
  });

  it('reclarify mode: cannot back from initial q2 (history empty)', () => {
    const initial = createWizardState('reclarify', TITLE);
    expect(initial.step).toBe('q2');
    expect(initial.history).toEqual([]);
    const stayed = clarifyReducer(initial, { type: 'back' });
    expect(stayed).toBe(initial);
  });

  it('preview step: back action restores form with fields preserved', () => {
    const atForm = formState(
      walkTo(
        createWizardState('clarify', TITLE),
        { type: 'answer-q1', actionable: true },
        ...TO_ACTION_FORM,
      ),
    );
    const withNote = clarifyReducer(atForm, { type: 'field', field: 'note', value: '测试备注' });
    const submission = buildFormSubmission('clarify', 'action', formState(withNote).fields, false);
    const preview = clarifyReducer(withNote, { type: 'preview', submission });

    const restoredForm = clarifyReducer(preview, { type: 'back' });
    expect(restoredForm.step).toBe('form');
    if (restoredForm.step === 'form') {
      expect(restoredForm.fields.note).toBe('测试备注');
    }
  });
});
