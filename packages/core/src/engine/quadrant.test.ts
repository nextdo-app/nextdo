/**
 * Eisenhower quadrant tests (issue #16).
 *
 * Each cell gets a positive case, and the two axes are pinned separately so
 * a regression that swapped "important" for "urgent" cannot pass.
 */
import { HOUR_MS, NOW, iso, makeNext } from './fixtures';
import { IMPORTANT_VALUE_THRESHOLD, QUADRANT_ORDER, quadrantOf } from './quadrant';
import type { CandidateAction, EngineInput } from './types';

function input(actions: CandidateAction[] = []): EngineInput {
  return {
    actions,
    calendar: [],
    projects: [],
    context: { contextIds: ['computer'], availableMinutes: 60 },
    now: NOW,
  };
}

describe('quadrantOf', () => {
  it('重要且紧急: valuable AND due within the soon window', () => {
    const a = makeNext({ value: 5, deadline: iso(6 * HOUR_MS) });
    expect(quadrantOf(a, input())).toBe('important-urgent');
  });

  it('重要且紧急: an OVERDUE valuable action is still urgent', () => {
    const a = makeNext({ value: 4, deadline: iso(-2 * HOUR_MS) });
    expect(quadrantOf(a, input())).toBe('important-urgent');
  });

  it('不重要但紧急: trivial but due today', () => {
    const a = makeNext({ value: 2, deadline: iso(3 * HOUR_MS) });
    expect(quadrantOf(a, input())).toBe('urgent');
  });

  it('重要但不紧急: valuable with no deadline at all', () => {
    const a = makeNext({ value: 4 });
    expect(quadrantOf(a, input())).toBe('important');
  });

  it('重要但不紧急: valuable but the deadline is beyond the soon window', () => {
    const a = makeNext({ value: 4, deadline: iso(72 * HOUR_MS) });
    expect(quadrantOf(a, input())).toBe('important');
  });

  it('不重要且不紧急: trivial with nothing pending', () => {
    const a = makeNext({ value: 1 });
    expect(quadrantOf(a, input())).toBe('neither');
  });

  it('treats the soft dueDate as a deadline when no hard deadline is set', () => {
    const a = makeNext({ value: 2, dueDate: iso(4 * HOUR_MS) });
    expect(quadrantOf(a, input())).toBe('urgent');
  });

  it('prefers the hard deadline over the soft dueDate when both are set', () => {
    // dueDate says "now", deadline says "next month" — the hard one wins,
    // matching the precedence rank.ts gives them.
    const a = makeNext({ value: 5, dueDate: iso(1 * HOUR_MS), deadline: iso(240 * HOUR_MS) });
    expect(quadrantOf(a, input())).toBe('important');
  });

  it('ignores an unparseable deadline rather than calling everything urgent', () => {
    const a = makeNext({ value: 2, deadline: 'not-a-date' });
    expect(quadrantOf(a, input())).toBe('neither');
  });

  it('uses value 3 as the importance cut — one below is NOT important', () => {
    const atThreshold = makeNext({
      value: IMPORTANT_VALUE_THRESHOLD as 1 | 2 | 3 | 4 | 5,
      deadline: iso(2 * HOUR_MS),
    });
    const belowThreshold = makeNext({
      value: (IMPORTANT_VALUE_THRESHOLD - 1) as 1 | 2 | 3 | 4 | 5,
      deadline: iso(2 * HOUR_MS),
    });
    expect(quadrantOf(atThreshold, input())).toBe('important-urgent');
    expect(quadrantOf(belowThreshold, input())).toBe('urgent');
  });

  it('applies to habit candidates too — a habit with no deadline is "important"', () => {
    const h = { ...makeNext({ value: 4 }), kind: 'habit' as const, habitId: 'h1', cycleDay: 3, cycleDays: 21 };
    expect(quadrantOf(h, input())).toBe('important');
  });
});

describe('QUADRANT_ORDER', () => {
  it('is the PRD priority order, most pressing first', () => {
    expect(QUADRANT_ORDER).toEqual(['important-urgent', 'urgent', 'important', 'neither']);
  });

  it('ranks strictly increasing so index order IS the sort weight', () => {
    const indexes = QUADRANT_ORDER.map((_, i) => i);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });
});