import { NEXT_ACTION_DEFAULT_VALUE, classifyInboxItem, type ClarifyAnswers } from './clarify';
import { ValidationNextdoError } from '../lib/errors';

const base: ClarifyAnswers = {
  actionable: true,
  inProject: false,
  twoMinutes: false,
  myResponsibility: true,
  fixedTime: false,
};

describe('classifyInboxItem — Q1 non-actionable branches', () => {
  it('reference', () => {
    expect(classifyInboxItem({ ...base, actionable: false, nonActionableKind: 'reference' })).toEqual({
      kind: 'reference',
    });
  });

  it('someday', () => {
    expect(classifyInboxItem({ ...base, actionable: false, nonActionableKind: 'someday' })).toEqual({
      kind: 'someday',
    });
  });

  it('trash', () => {
    expect(classifyInboxItem({ ...base, actionable: false, nonActionableKind: 'trash' })).toEqual({
      kind: 'trash',
    });
  });

  it('no implicit branch: missing nonActionableKind throws', () => {
    expect(() => classifyInboxItem({ ...base, actionable: false })).toThrow(
      ValidationNextdoError,
    );
    let err: unknown;
    try {
      classifyInboxItem({ ...base, actionable: false });
    } catch (e) {
      err = e;
    }
    expect((err as ValidationNextdoError).code).toBe('clarify.incomplete');
  });
});

describe('classifyInboxItem — Q2 in-project / Q2b new vs existing', () => {
  it('new project with an outcome → project', () => {
    expect(
      classifyInboxItem({
        ...base,
        inProject: true,
        projectChoice: 'new',
        projectOutcome: '论文通过答辩',
      }),
    ).toEqual({ kind: 'project' });
  });

  it('new project without an outcome → project.needs-outcome', () => {
    expect(() =>
      classifyInboxItem({ ...base, inProject: true, projectChoice: 'new', projectOutcome: '   ' }),
    ).toThrow(ValidationNextdoError);
    expect(() =>
      classifyInboxItem({ ...base, inProject: true, projectChoice: 'new', projectOutcome: '   ' }),
    ).toThrow('A project requires an outcome');
    let err: unknown;
    try {
      classifyInboxItem({ ...base, inProject: true, projectChoice: 'new' });
    } catch (e) {
      err = e;
    }
    expect((err as ValidationNextdoError).code).toBe('project.needs-outcome');
  });

  it('existing project with an id → next-action (project-attach)', () => {
    expect(
      classifyInboxItem({
        ...base,
        inProject: true,
        projectChoice: 'existing',
        projectId: 'p-1',
      }),
    ).toEqual({ kind: 'next-action', source: 'project-attach' });
  });

  it('existing project without an id → clarify.project-required', () => {
    for (const projectId of [undefined, null, ''] as const) {
      let err: unknown;
      try {
        classifyInboxItem({ ...base, inProject: true, projectChoice: 'existing', projectId });
      } catch (e) {
        err = e;
      }
      expect((err as ValidationNextdoError).code).toBe('clarify.project-required');
    }
  });

  it('in-project without a choice → clarify.incomplete (no implicit branch)', () => {
    let err: unknown;
    try {
      classifyInboxItem({ ...base, inProject: true });
    } catch (e) {
      err = e;
    }
    expect((err as ValidationNextdoError).code).toBe('clarify.incomplete');
  });

  it('attach skips Q3–Q5: twoMinutes / myResponsibility / fixedTime do not matter', () => {
    expect(
      classifyInboxItem({
        ...base,
        inProject: true,
        projectChoice: 'existing',
        projectId: 'p-1',
        twoMinutes: true,
        completedOnTheSpot: false,
      }),
    ).toEqual({ kind: 'next-action', source: 'project-attach' });
    expect(
      classifyInboxItem({
        ...base,
        inProject: true,
        projectChoice: 'existing',
        projectId: 'p-1',
        myResponsibility: false,
      }),
    ).toEqual({ kind: 'next-action', source: 'project-attach' });
  });

  it('a new-project choice beats a stray projectId', () => {
    expect(
      classifyInboxItem({
        ...base,
        inProject: true,
        projectChoice: 'new',
        projectOutcome: '跑完 baseline',
        projectId: 'p-1',
      }),
    ).toEqual({ kind: 'project' });
  });
});

describe('classifyInboxItem — 不属于项目 falls through to the regular chain', () => {
  it('inProject false → next-action (clarified)', () => {
    expect(classifyInboxItem(base)).toEqual({ kind: 'next-action', source: 'clarified' });
  });

  it('a stray projectId alongside inProject false is ignored', () => {
    expect(classifyInboxItem({ ...base, projectId: 'p-1' })).toEqual({
      kind: 'next-action',
      source: 'clarified',
    });
    expect(classifyInboxItem({ ...base, projectId: null })).toEqual({
      kind: 'next-action',
      source: 'clarified',
    });
    expect(classifyInboxItem({ ...base, projectId: '' })).toEqual({
      kind: 'next-action',
      source: 'clarified',
    });
  });
});

describe('classifyInboxItem — Q3 two minutes (DO NOW)', () => {
  it('completed on the spot → do-now-completed', () => {
    expect(
      classifyInboxItem({ ...base, twoMinutes: true, completedOnTheSpot: true }),
    ).toEqual({ kind: 'do-now-completed' });
  });

  it('not completed on the spot → next-action (two-minute) with default value 3', () => {
    const outcome = classifyInboxItem({ ...base, twoMinutes: true, completedOnTheSpot: false });
    expect(outcome).toEqual({ kind: 'next-action', source: 'two-minute' });
    expect(NEXT_ACTION_DEFAULT_VALUE).toBe(3);
  });

  it('questions 4–5 do not apply on the two-minute path', () => {
    // myResponsibility / fixedTime values must not change the outcome
    const a = classifyInboxItem({ ...base, twoMinutes: true, myResponsibility: false });
    const b = classifyInboxItem({ ...base, twoMinutes: true, fixedTime: true });
    expect(a).toEqual({ kind: 'next-action', source: 'two-minute' });
    expect(b).toEqual({ kind: 'next-action', source: 'two-minute' });
  });
});

describe('classifyInboxItem — Q4 / Q5', () => {
  it('not my responsibility → waiting-for', () => {
    expect(classifyInboxItem({ ...base, myResponsibility: false })).toEqual({ kind: 'waiting-for' });
  });

  it('my responsibility, fixed time → calendar-action', () => {
    expect(classifyInboxItem({ ...base, fixedTime: true })).toEqual({ kind: 'calendar-action' });
  });

  it('my responsibility, no fixed time → next-action (clarified)', () => {
    expect(classifyInboxItem(base)).toEqual({ kind: 'next-action', source: 'clarified' });
  });
});
