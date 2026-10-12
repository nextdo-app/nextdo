import type { CandidateAction, EngineInput } from './types';
import { NOW, HOUR_MS, iso, makeCalendar, makeHabit, makeNext } from './fixtures';
import { hardFilter } from './filters';
import { scoreCandidate } from './rank';
import { recommend } from './recommend';
import { RECLARIFY_THRESHOLD, W } from './weights';

function input(
  actions: CandidateAction[],
  overrides: Partial<EngineInput> = {},
): EngineInput {
  return {
    actions,
    calendar: [],
    projects: [],
    context: { contextIds: ['computer'], availableMinutes: 60 },
    now: NOW,
    ...overrides,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Worked example (Proposal §6.2) — required named regression test
// ---------------------------------------------------------------------------

describe('worked example: 回复普通邮件 vs 运行论文实验 (availableMinutes = 60)', () => {
  const A = makeNext({
    id: 'a-reply-email',
    title: '回复普通邮件',
    estMinutes: 10,
    value: 2,
    createdAt: iso(-24 * HOUR_MS), // created 1 day ago → waiting-time = 1/14
  });
  const B = makeNext({
    id: 'b-run-experiment',
    title: '运行论文实验',
    contextIds: ['computer'],
    estMinutes: 40,
    value: 5,
    deadline: iso(72 * HOUR_MS), // 3 天后 → deadline-urgency 0.7
    projectId: 'p-thesis',
    createdAt: NOW.toISOString(),
  });

  it('scores A ≈ 0.50 and B ≈ 2.05 (exact, 2 decimals) and recommends B', () => {
    const out = recommend(input([A, B], { projects: [{ id: 'p-thesis', value: 4, status: 'active' }] }));
    const scoredA = out.eligible.find((s) => s.actionId === 'a-reply-email');
    const scoredB = out.eligible.find((s) => s.actionId === 'b-run-experiment');
    expect(scoredA?.score.toFixed(2)).toBe('0.50');
    expect(scoredB?.score.toFixed(2)).toBe('2.05');
    // B wins even though A is easier — easiness must never be a standing advantage
    expect(out.recommended?.actionId).toBe('b-run-experiment');
  });

  it('breaks down exactly per the spec table', () => {
    const projects = [{ id: 'p-thesis', value: 4, status: 'active' }];
    // Raw signals (score = Σ W × signal): A = 0.8×0.4 + 0.2×(1−10/60) + 0.2×(1/14) ≈ 0.50
    const a = scoreCandidate(A, input([A], { projects }));
    expect(a.signals['deadline-urgency']).toBe(0);
    expect(a.signals['goal-value']).toBeCloseTo(0.4, 10);
    expect(a.signals['project-importance']).toBe(0);
    expect(a.signals['time-fit']).toBeCloseTo(1 - 10 / 60, 10);
    expect(a.signals['waiting-time']).toBeCloseTo(1 / 14, 10);
    // B = 1.0×0.7 + 0.8×1.0 + 0.6×0.8 + 0.2×(1−40/60) ≈ 2.05
    const b = scoreCandidate(B, input([B], { projects }));
    expect(b.signals['deadline-urgency']).toBe(0.7);
    expect(b.signals['goal-value']).toBeCloseTo(1.0, 10);
    expect(b.signals['project-importance']).toBeCloseTo(0.8, 10);
    expect(b.signals['time-fit']).toBeCloseTo(1 - 40 / 60, 10);
    expect(b.signals['waiting-time']).toBe(0);
    expect(hardFilter(input([A, B], { projects })).ranked).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  const actions: CandidateAction[] = [
    makeNext({ id: 'x-1', value: 4, estMinutes: 20, deadline: iso(10 * HOUR_MS) }),
    makeNext({ id: 'x-2', value: 5, estMinutes: 45 }),
    makeHabit({ id: 'x-3', windowStart: '08:00', windowEnd: '11:00' }),
    makeCalendar({ id: 'x-4', startsAt: iso(30 * 60_000) }),
    makeNext({ id: 'x-5', estMinutes: 90 }),
  ];

  it('same input (including now) → identical output, including eligible order', () => {
    const first = recommend(input(actions));
    const second = recommend(input(actions.map((a) => ({ ...a }))));
    expect(second).toEqual(first);
  });

  it('is stable across repeated calls on the same input object', () => {
    const once = recommend(input(actions));
    for (let i = 0; i < 5; i++) {
      expect(recommend(input(actions))).toEqual(once);
    }
  });

  it('never mutates its input (Object.freeze)', () => {
    const frozen = deepFreeze(input(actions));
    expect(() => recommend(frozen)).not.toThrow();
    const out = recommend(frozen);
    expect(out.eligible.map((s) => s.actionId)).toEqual(['x-4', 'x-1', 'x-2', 'x-3']);
  });
});

// ---------------------------------------------------------------------------
// Tie-breaks
// ---------------------------------------------------------------------------

describe('tie-breaks: (score desc, deadline asc [nulls last], estMinutes asc, id asc)', () => {
  it('equal scores → earlier deadline first, even with a larger estimate', () => {
    // Since the Eisenhower quadrant became the PRIMARY sort key (issue #16),
    // this tie-break is only observable between two candidates that share a
    // quadrant — otherwise the quadrant decides first and the tie-break is
    // never reached. Both are value 3 with no deadline pressure (168 h is
    // past the 48 h "soon" window) ⇒ both 重要不紧急. The only remaining
    // difference that can make the floats tie is health-protection, which
    // offsets X's deadline signal exactly:
    //   X = 0.4 (deadline) + 0.48 (value) + 0.1 (time-fit)          = 0.98
    //   Y = 0.48 (value) + 0.1 (time-fit) + 0.4 (health)           = 0.98
    // With the scores tied, the deadline tie-break puts X (which HAS a
    // deadline) ahead of Y (nulls last).
    const x = makeNext({
      id: 'x',
      value: 3,
      estMinutes: 30,
      deadline: iso(168 * HOUR_MS),
    });
    const y = makeNext({ id: 'y', value: 3, estMinutes: 30, category: 'health' });
    const out = recommend(input([x, y]));
    expect(out.eligible.map((s) => s.actionId)).toEqual(['x', 'y']);
  });

  it('equal scores and deadlines → smaller estMinutes first', () => {
    // A: value 1, est 2 → 0.16 + 0.2×(1−2/60)
    // B: value 2, est 50 → 0.32 + 0.2×(1−50/60) — same score, floats exactly equal
    const a = makeNext({ id: 'a', value: 1, estMinutes: 2 });
    const b = makeNext({ id: 'b', value: 2, estMinutes: 50 });
    const out = recommend(input([a, b]));
    expect(out.eligible.map((s) => s.actionId)).toEqual(['a', 'b']);
  });

  it('equal scores, deadlines and estimates → id asc', () => {
    const a = makeNext({ id: 'a' });
    const b = makeNext({ id: 'b' });
    expect(recommend(input([b, a])).eligible.map((s) => s.actionId)).toEqual(['a', 'b']);
  });

  it('higher score always wins regardless of tie-break fields', () => {
    const low = makeNext({ id: 'z-low', value: 1, estMinutes: 1 });
    const high = makeNext({ id: 'a-high', value: 5, estMinutes: 60 });
    expect(recommend(input([low, high])).recommended?.actionId).toBe('a-high');
  });
});

// ---------------------------------------------------------------------------
// needsReclarify (skip & re-clarify semantics)
// ---------------------------------------------------------------------------

describe('needsReclarify', () => {
  it('fires at exactly 3 consecutive skips', () => {
    const out = recommend(input([makeNext({ id: 'r-3', consecutiveSkips: 3 })]));
    expect(out.needsReclarify).toEqual([{ actionId: 'r-3', consecutiveSkips: 3 }]);
    expect(RECLARIFY_THRESHOLD).toBe(3);
  });

  it('does not fire at 2', () => {
    const out = recommend(input([makeNext({ id: 'r-2', consecutiveSkips: 2 })]));
    expect(out.needsReclarify).toEqual([]);
  });

  it('fires above the threshold with the actual count', () => {
    const out = recommend(input([makeNext({ id: 'r-5', consecutiveSkips: 5 })]));
    expect(out.needsReclarify).toEqual([{ actionId: 'r-5', consecutiveSkips: 5 }]);
  });

  it('a reset (counter back to 0 after snooze/complete) is not flagged', () => {
    const out = recommend(
      input([
        makeNext({
          id: 'r-reset',
          consecutiveSkips: 0,
          lastSnoozedAt: iso(-HOUR_MS),
          lastSkippedAt: iso(-2 * HOUR_MS),
        }),
      ]),
    );
    expect(out.needsReclarify).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Reasons & preemption & edges
// ---------------------------------------------------------------------------

describe('reasons, preemption, edges', () => {
  it('every eligible action has at least one reason', () => {
    const out = recommend(
      input([
        makeNext({ id: 'q-1' }),
        makeHabit({ id: 'q-2', windowStart: '08:00', windowEnd: '11:00' }),
        makeCalendar({ id: 'q-3', startsAt: iso(2 * HOUR_MS) }),
        makeNext({ id: 'q-4', contextIds: ['computer'] }),
      ]),
    );
    expect(out.eligible).toHaveLength(4);
    for (const scored of out.eligible) {
      expect(scored.reasons.length).toBeGreaterThan(0);
    }
  });

  it('eligibility reasons mark why it can run now', () => {
    const windowed = makeNext({ id: 'w-1', windowStart: '08:00', windowEnd: '18:00' });
    const out = recommend(input([windowed, makeNext({ id: 'p-1', contextIds: ['computer'] })]));
    const windowedScored = out.eligible.find((s) => s.actionId === 'w-1');
    const plainScored = out.eligible.find((s) => s.actionId === 'p-1');
    expect(windowedScored?.reasons.some((r) => r.code === 'window-open')).toBe(true);
    expect(plainScored?.reasons.some((r) => r.code === 'window-open')).toBe(false);
    expect(plainScored?.reasons.find((r) => r.code === 'context-match')?.detail).toBe('computer');
  });

  it('calendar-preempt places a near calendar candidate first, before ranking', () => {
    const cal = makeCalendar({ id: 'c-1', startsAt: iso(30 * 60_000), value: 1, estMinutes: 60 });
    const urgent = makeNext({ id: 'u-1', value: 5, estMinutes: 10, deadline: iso(HOUR_MS) });
    const out = recommend(input([cal, urgent]));
    expect(out.eligible.map((s) => s.actionId)).toEqual(['c-1', 'u-1']);
    expect(out.recommended?.actionId).toBe('c-1');
    const calScored = out.eligible[0];
    expect(calScored?.reasons.some((r) => r.code === 'calendar-preempt')).toBe(true);
    // "换一个" still works: the preempted candidate stays in eligible
    expect(out.eligible).toHaveLength(2);
  });

  it('an empty pool yields an empty output', () => {
    const out = recommend(input([]));
    expect(out).toEqual({ recommended: null, eligible: [], filtered: [], needsReclarify: [] });
  });

  it('W weights are the pinned v1 constants', () => {
    expect(W).toEqual({
      'deadline-urgency': 1.0,
      'goal-value': 0.8,
      'project-importance': 0.6,
      'time-fit': 0.2,
      'waiting-time': 0.2,
      'habit-commitment': 0.5,
      'health-protection': 0.4,
    });
  });
});

// ---------------------------------------------------------------------------
// Eisenhower ordering (issue #16)
// ---------------------------------------------------------------------------

describe('Eisenhower quadrant ordering', () => {
  /**
   * A valuable, long-waiting action in a valuable project. On score alone it
   * is the strongest candidate in the pool — which is exactly what the
   * quadrant has to overrule.
   */
  const IMPORTANT_NO_DEADLINE = makeNext({
    id: 'important-no-deadline',
    title: '推进长期项目',
    value: 5,
    estMinutes: 60,
    projectId: 'p1',
    createdAt: iso(-24 * 14 * HOUR_MS), // waiting-time saturated at the 14-day cap
  });

  it('an urgent action outranks a higher-scoring important one', () => {
    const urgent = makeNext({
      id: 'urgent-trivial',
      title: '交水电费',
      value: 2,
      estMinutes: 60,
      deadline: iso(3 * HOUR_MS),
    });
    const out = recommend(
      input([IMPORTANT_NO_DEADLINE, urgent], {
        projects: [{ id: 'p1', value: 5, status: 'active' }],
      }),
    );
    // Without the quadrant this order would be reversed — assert that too,
    // so the test fails loudly if the sort ever silently reverts.
    const urgentScore = out.eligible.find((s) => s.actionId === urgent.id)?.score ?? 0;
    const importantScore =
      out.eligible.find((s) => s.actionId === IMPORTANT_NO_DEADLINE.id)?.score ?? 0;
    expect(importantScore).toBeGreaterThan(urgentScore);
    expect(out.eligible.map((s) => s.actionId)).toEqual([
      urgent.id,
      IMPORTANT_NO_DEADLINE.id,
    ]);
    expect(out.recommended?.actionId).toBe(urgent.id);
  });

  it('重要且紧急 sorts ahead of 不重要但紧急', () => {
    const importantUrgent = makeNext({
      id: 'iu',
      value: 5,
      deadline: iso(2 * HOUR_MS),
      createdAt: iso(-HOUR_MS),
    });
    const merelyUrgent = makeNext({
      id: 'u',
      value: 1,
      estMinutes: 10,
      deadline: iso(2 * HOUR_MS),
      createdAt: iso(-24 * HOUR_MS),
    });
    const out = recommend(input([merelyUrgent, importantUrgent]));
    expect(out.eligible.map((s) => s.actionId)).toEqual(['iu', 'u']);
  });

  it('重要但不紧急 sorts ahead of 不重要且不紧急', () => {
    const important = makeNext({ id: 'i', value: 4, estMinutes: 10 });
    const neither = makeNext({ id: 'n', value: 1, estMinutes: 10 });
    const out = recommend(input([neither, important]));
    expect(out.eligible.map((s) => s.actionId)).toEqual(['i', 'n']);
  });

  it('orders all four quadrants by the PRD priority', () => {
    const out = recommend(
      input([
        makeNext({ id: 'q4-neither', value: 1, estMinutes: 10 }), // 都不紧急不紧急
        makeNext({ id: 'q3-important', value: 4, estMinutes: 10 }), // 重要不紧急
        makeNext({ id: 'q2-urgent', value: 2, estMinutes: 10, deadline: iso(HOUR_MS) }),
        makeNext({ id: 'q1-important-urgent', value: 5, estMinutes: 10, deadline: iso(HOUR_MS) }),
      ]),
    );
    expect(out.eligible.map((s) => s.actionId)).toEqual([
      'q1-important-urgent',
      'q2-urgent',
      'q3-important',
      'q4-neither',
    ]);
  });

  it('still sorts by score WITHIN a quadrant', () => {
    // Both are 重要且紧急; the score decides which one leads.
    const strong = makeNext({ id: 'strong', value: 5, estMinutes: 5, deadline: iso(HOUR_MS) });
    const weak = makeNext({ id: 'weak', value: 3, estMinutes: 55, deadline: iso(HOUR_MS) });
    const out = recommend(input([weak, strong]));
    expect(out.eligible.map((s) => s.actionId)).toEqual(['strong', 'weak']);
  });

  it('an overdue action sorts above one that is merely upcoming', () => {
    const overdue = makeNext({ id: 'od', value: 3, estMinutes: 10, deadline: iso(-HOUR_MS) });
    const upcoming = makeNext({
      id: 'up',
      value: 3,
      estMinutes: 10,
      deadline: iso(10 * 24 * HOUR_MS),
    });
    const out = recommend(input([upcoming, overdue]));
    expect(out.eligible.map((s) => s.actionId)).toEqual(['od', 'up']);
  });
});
