import { ValidationNextdoError } from '../lib/errors';
import type {
  CalendarAction,
  CompletionRecord,
  DailyReviewRecord,
  FocusSession,
  Habit,
  HabitDay,
  InboxItem,
  NextAction,
  Project,
  Reminder,
  WeeklyReviewRecord,
} from './types';
import {
  MIN_FOCUS_MINUTES,
  MAX_FOCUS_MINUTES,  assertReviewRecord,
  assertValidCalendarAction,
  assertValidCompletionRecord,
  assertValidFocusSession,
  assertValidHabit,
  assertValidHabitDay,
  assertValidInboxItem,
  assertValidNextAction,
  assertValidProject,
  assertValidReminder,
  calendarActionReminderSpec,
  deadlineReminderSpec,
  deadlineReminderSpecs,
  habitWindowReminderSpec,
  snoozeReminderSpec,
} from './invariants';

const NOW = '2026-09-21T09:00:00.000Z';
const NOW_DATE = new Date(NOW);

function entity(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> & {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: null;
} {
  return {
    id: 'id-1',
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

/** Run `fn`, capture the ValidationNextdoError, and return it (fails if nothing/something else throws). */
function thrown(fn: () => void): ValidationNextdoError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ValidationNextdoError) return e;
    throw e;
  }
  throw new Error('expected fn to throw ValidationNextdoError');
}

describe('assertValidInboxItem', () => {
  it('accepts a raw capture', () => {
    assertValidInboxItem(entity({ title: '买牛奶', capturedAt: NOW }) as InboxItem);
  });
  it('rejects an empty title', () => {
    expect(() => assertValidInboxItem(entity({ title: '  ', capturedAt: NOW }) as InboxItem)).toThrow(
      ValidationNextdoError,
    );
  });
});

describe('assertValidProject', () => {
  const project = entity({ title: '论文', outcome: '通过答辩', value: 4, status: 'active' }) as Project;

  it('accepts a valid project', () => {
    assertValidProject(project);
  });
  it('rejects a missing/empty outcome with project.needs-outcome', () => {
    expect(thrown(() => assertValidProject({ ...project, outcome: '' })).code).toBe(
      'project.needs-outcome',
    );
  });
  it('rejects value outside 1..5', () => {
    expect(() => assertValidProject({ ...project, value: 6 as never })).toThrow(ValidationNextdoError);
  });
});

describe('assertValidNextAction', () => {
  const action = entity({
    title: '运行 baseline A',
    contextIds: ['computer'],
    estMinutes: 30,
    value: 4,
    consecutiveSkips: 0,
    status: 'open',
  }) as NextAction;

  it('accepts a minimal valid action', () => {
    assertValidNextAction(action);
  });
  it('rejects estMinutes <= 0', () => {
    expect(() => assertValidNextAction({ ...action, estMinutes: 0 })).toThrow(ValidationNextdoError);
  });
  it('rejects malformed window values', () => {
    expect(() => assertValidNextAction({ ...action, windowStart: '9am' })).toThrow(ValidationNextdoError);
    expect(() => assertValidNextAction({ ...action, windowDays: [7] })).toThrow(ValidationNextdoError);
    expect(() => assertValidNextAction({ ...action, deadline: 'tomorrow' })).toThrow(ValidationNextdoError);
  });
});

describe('assertValidCalendarAction', () => {
  const action = entity({
    title: '周五组会',
    startsAt: '2026-09-25T09:00:00.000Z',
    contextIds: ['office'],
    estMinutes: 60,
    value: 3,
    consecutiveSkips: 0,
    status: 'open',
  }) as CalendarAction;

  it('accepts a valid calendar action', () => {
    assertValidCalendarAction(action);
  });
  it('rejects a missing startsAt', () => {
    expect(() => assertValidCalendarAction({ ...action, startsAt: undefined as never })).toThrow(
      ValidationNextdoError,
    );
  });
});

describe('assertValidHabit', () => {
  const habit = entity({
    title: '阅读习惯',
    actionTitle: '阅读 30 min',
    estMinutes: 30,
    value: 3,
    cycleDays: 21,
    startedAt: NOW,
    status: 'active',
  }) as Habit;

  it('accepts a valid habit', () => {
    assertValidHabit(habit);
  });
  it('rejects cycleDays < 1', () => {
    expect(() => assertValidHabit({ ...habit, cycleDays: 0 })).toThrow(ValidationNextdoError);
  });
});

describe('assertValidHabitDay', () => {
  const day = entity({
    id: 'hd-habit-1-20260921',
    habitId: 'habit-1',
    localDate: '20260921',
    status: 'open',
    consecutiveSkips: 0,
  }) as HabitDay;

  it('accepts the deterministic id', () => {
    assertValidHabitDay(day);
  });
  it('rejects a non-deterministic id', () => {
    expect(thrown(() => assertValidHabitDay({ ...day, id: '01JXYZ' })).code).toBe(
      'validation.habitDay.id',
    );
  });
  it('rejects a malformed localDate', () => {
    expect(thrown(() => assertValidHabitDay({ ...day, localDate: '2026-09-21' })).code).toBe(
      'validation.habitDay.localDate',
    );
  });
});

describe('assertValidReminder', () => {
  const reminder = entity({
    id: 'r-1',
    actionKind: 'next',
    actionId: 'a-1',
    firesAt: '2026-09-21T10:00:00.000Z',
    intensity: 'normal',
    state: 'scheduled',
  }) as Reminder;

  it('accepts a valid reminder', () => {
    assertValidReminder(reminder);
  });
  it('rejects an unknown intensity', () => {
    expect(() =>
      assertValidReminder({ ...reminder, intensity: 'loud' as never }),
    ).toThrow(ValidationNextdoError);
  });
});

describe('assertValidFocusSession', () => {
  const session = entity({
    id: 'f-1',
    actionId: 'a-1',
    actionKind: 'next',
    mode: 'preset',
    plannedMinutes: 25,
    startedAt: NOW,
    pausedSec: 0,
    status: 'active',
  }) as FocusSession;

  it('accepts a valid preset session', () => {
    assertValidFocusSession(session);
  });
  it('accepts any whole minute inside 1–180 (issue #59)', () => {
    assertValidFocusSession({ ...session, plannedMinutes: 30 });
    assertValidFocusSession({ ...session, plannedMinutes: 15 });
    assertValidFocusSession({ ...session, plannedMinutes: MIN_FOCUS_MINUTES });
    assertValidFocusSession({ ...session, plannedMinutes: MAX_FOCUS_MINUTES });
  });
  it('rejects out-of-range, fractional and missing preset minutes', () => {
    for (const plannedMinutes of [null, 0, -5, 181, 30.5]) {
      expect(thrown(() => assertValidFocusSession({ ...session, plannedMinutes })).code).toBe(
        'validation.focusSession.plannedMinutes',
      );
    }
  });
  it('free sessions require plannedMinutes = null', () => {
    expect(() => assertValidFocusSession({ ...session, mode: 'free', plannedMinutes: 25 })).toThrow(
      ValidationNextdoError,
    );
    assertValidFocusSession({ ...session, mode: 'free', plannedMinutes: null });
  });
  it('endedAt is set exactly when the session left active', () => {
    expect(thrown(() => assertValidFocusSession({ ...session, endedAt: '2026-09-21T09:30:00.000Z' })).code).toBe(
      'validation.focusSession.endedAt',
    );
    expect(thrown(() => assertValidFocusSession({ ...session, status: 'completed', endedAt: undefined })).code).toBe(
      'validation.focusSession.endedAt',
    );
    assertValidFocusSession({
      ...session,
      status: 'abandoned',
      endedAt: '2026-09-21T09:30:00.000Z',
    });
  });
});

describe('assertValidCompletionRecord', () => {
  const record = entity({
    id: 'c-1',
    actionKind: 'next',
    actionId: 'a-1',
    completedAt: NOW,
    estMinutes: 30,
  }) as CompletionRecord;

  it('accepts an action completion with the copied estimate', () => {
    assertValidCompletionRecord(record);
  });
  it('do_now requires estMinutes = null', () => {
    assertValidCompletionRecord({ ...record, actionKind: 'do_now', estMinutes: null });
    expect(thrown(() => assertValidCompletionRecord({ ...record, actionKind: 'do_now', estMinutes: 10 })).code).toBe(
      'validation.completionRecord.estMinutes',
    );
  });
  it('action kinds require a numeric estMinutes', () => {
    expect(thrown(() => assertValidCompletionRecord({ ...record, estMinutes: null })).code).toBe(
      'validation.completionRecord.estMinutes',
    );
  });
});

describe('assertReviewRecord', () => {
  const daily: DailyReviewRecord = {
    ...entity({ id: 'rev-1' }),
    kind: 'daily',
    at: NOW,
    snapshot: {
      inboxCount: 0,
      completedToday: ['a-1'],
      stillOpen: [],
      projectsMissingActions: [],
      waitingFollowUps: [],
      calendarToday: [],
      calendarTomorrow: [],
      repeatedSkips: [],
    },
    answers: {
      completedActionIds: ['a-1'],
      rescheduled: [{ actionId: 'a-2', toDate: '2026-09-22' }],
      skippedNoted: [],
      tomorrowMustDo: [],
    },
  };

  it('accepts a valid daily record', () => {
    assertReviewRecord(daily);
  });

  it('rejects a corrupt snapshot shape', () => {
    expect(
      thrown(() =>
        assertReviewRecord({
          ...daily,
          snapshot: { ...daily.snapshot, completedToday: 5 } as never,
        }),
      ).code,
    ).toBe('validation.dailyReview.snapshot.completedToday');
  });

  const weekly: WeeklyReviewRecord = {
    ...entity({ id: 'rev-2' }),
    kind: 'weekly',
    at: NOW,
    snapshot: {
      inboxCount: 1,
      projects: [{ id: 'p-1', title: '论文', hasOpenAction: true, lastProgressAt: NOW }],
      waitingFollowUps: [],
      somedayCount: 2,
      stalledProjects: [],
      calendarNext7: [],
    },
    answers: {
      inboxCleared: false,
      followUpsRaised: [],
      calendarReasonable: true,
      somedayDecisions: [{ id: 's-1', to: 'keep' }],
      projectDecisions: [{ id: 'p-1', to: 'on-hold' }],
    },
  };

  it('accepts a valid weekly record', () => {
    assertReviewRecord(weekly);
  });

  it('rejects an invalid someday decision target', () => {
    expect(
      thrown(() =>
        assertReviewRecord({
          ...weekly,
          answers: { ...weekly.answers, somedayDecisions: [{ id: 's-1', to: 'archive' as never }] },
        }),
      ).code,
    ).toBe('validation.weeklyReview.somedayDecisions');
  });
});

describe('reminder creation rules', () => {
  it('snooze → fires at the target, normal intensity', () => {
    const target = new Date('2026-09-21T21:00:00.000Z');
    expect(snoozeReminderSpec(target)).toEqual({
      firesAt: '2026-09-21T21:00:00.000Z',
      intensity: 'normal',
    });
  });

  it('calendar action within 60 min → 15 min before startsAt, important', () => {
    const startsAt = new Date('2026-09-21T09:30:00.000Z'); // +30 min
    expect(calendarActionReminderSpec(startsAt, NOW_DATE)).toEqual({
      firesAt: '2026-09-21T09:15:00.000Z',
      intensity: 'important',
    });
    // boundary: exactly 60 min is still in range
    expect(calendarActionReminderSpec(new Date('2026-09-21T10:00:00.000Z'), NOW_DATE)).not.toBeNull();
  });

  it('calendar action outside 60 min (or in the past) → no reminder', () => {
    expect(calendarActionReminderSpec(new Date('2026-09-21T10:00:01.000Z'), NOW_DATE)).toBeNull();
    expect(calendarActionReminderSpec(new Date('2026-09-21T08:59:00.000Z'), NOW_DATE)).toBeNull();
  });

  it('habit window → 30 min before the next window end, normal', () => {
    expect(habitWindowReminderSpec(NOW_DATE, '10:00')).toEqual({
      firesAt: '2026-09-21T09:30:00.000Z',
      intensity: 'normal',
    });
  });

  it('habit window closing within 30 min → no reminder (due on Now instead)', () => {
    expect(habitWindowReminderSpec(NOW_DATE, '09:15')).toBeNull();
  });

  it('habit window already passed today → uses tomorrow', () => {
    expect(habitWindowReminderSpec(NOW_DATE, '08:00')).toEqual({
      firesAt: '2026-09-22T07:30:00.000Z',
      intensity: 'normal',
    });
  });

  it('deadline reminder → fires at the picked moment, normal intensity', () => {
    expect(deadlineReminderSpec(new Date('2026-09-21T10:00:00.000Z'), NOW_DATE)).toEqual({
      firesAt: '2026-09-21T10:00:00.000Z',
      intensity: 'normal',
    });
  });

  it('deadline reminder in the past (or right now) → no reminder', () => {
    expect(deadlineReminderSpec(new Date('2026-09-21T08:59:59.000Z'), NOW_DATE)).toBeNull();
    expect(deadlineReminderSpec(NOW_DATE, NOW_DATE)).toBeNull();
  });

  it('multi-select reminders → one spec per future moment, chronological', () => {
    expect(
      deadlineReminderSpecs(
        [
          new Date('2026-09-21T12:00:00.000Z'),
          new Date('2026-09-21T10:00:00.000Z'),
        ],
        NOW_DATE,
      ),
    ).toEqual([
      { firesAt: '2026-09-21T10:00:00.000Z', intensity: 'normal' },
      { firesAt: '2026-09-21T12:00:00.000Z', intensity: 'normal' },
    ]);
  });

  it('multi-select reminders drop past moments and same-minute duplicates', () => {
    expect(
      deadlineReminderSpecs(
        [
          new Date('2026-09-21T08:00:00.000Z'),
          new Date('2026-09-21T10:00:00.000Z'),
          // Same minute, different seconds — the picker has minute resolution.
          new Date('2026-09-21T10:00:40.000Z'),
        ],
        NOW_DATE,
      ),
    ).toEqual([{ firesAt: '2026-09-21T10:00:00.000Z', intensity: 'normal' }]);
  });

  it('multi-select reminders with nothing in the future → empty', () => {
    expect(deadlineReminderSpecs([], NOW_DATE)).toEqual([]);
    expect(deadlineReminderSpecs([NOW_DATE], NOW_DATE)).toEqual([]);
  });
});
