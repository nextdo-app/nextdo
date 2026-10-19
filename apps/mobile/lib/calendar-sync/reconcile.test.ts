/**
 * `buildCalendarSyncPlan` — the pure create / update / delete decision
 * (issue #54). The device layer (expo-calendar) is a thin wrapper and is
 * covered by manual acceptance; this suite is the unit-test subject.
 *
 * Cases (PRD AC: 日历同步的创建 / 更新 / 清理纯逻辑):
 *   - create: a future open action with no mapping becomes one event spec;
 *   - update: a changed title/time turns the mapping into an update and the
 *     OLD mapping is retained (a failed update retries on the next pass);
 *   - skip: an unchanged signature stays retained and is neither created
 *     nor updated (idempotency);
 *   - delete: a mapping whose action is gone / done / ended is deleted;
 *   - disabled: every mapping is deleted and nothing is created;
 *   - boundary: an action whose event already ended is not created;
 *   - min duration: `estMinutes: 0` still yields a valid 1-minute range.
 */
import type { CalendarAction } from '@nextdo/core';
import {
  buildCalendarSyncPlan,
  calendarEventSignature,
  type CalendarSyncMappings,
} from './reconcile';

const NOW = new Date('2026-10-18T12:00:00.000Z');
const MIN = 60 * 1000;

function action(overrides: Partial<CalendarAction> & { id: string }): CalendarAction {
  return {
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    deletedAt: null,
    title: '默认日程',
    startsAt: new Date(NOW.getTime() + 60 * MIN).toISOString(),
    contextIds: [],
    estMinutes: 30,
    value: 3,
    status: 'open',
    consecutiveSkips: 0,
    ...overrides,
  };
}

function spec(overrides: Partial<CalendarAction> & { id: string }) {
  const source = action(overrides);
  const startsAtMs = new Date(source.startsAt).getTime();
  return {
    actionId: source.id,
    title: source.title,
    startsAt: new Date(startsAtMs).toISOString(),
    endsAt: new Date(startsAtMs + Math.max(source.estMinutes, 1) * MIN).toISOString(),
  };
}

describe('buildCalendarSyncPlan', () => {
  it('creates one event for a future open action with no mapping', () => {
    const rows = [action({ id: 'ca-1' })];
    const plan = buildCalendarSyncPlan({ enabled: true, actions: rows, mappings: {}, now: NOW });

    expect(plan.toCreate).toEqual([spec({ id: 'ca-1' })]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toDelete).toEqual([]);
    expect(plan.retained).toEqual({});
  });

  it('updates a mapping whose signature changed and retains the OLD one for retry', () => {
    const previous = { eventId: 'evt-1', signature: calendarEventSignature(spec({ id: 'ca-1', title: '旧标题' })) };
    const mappings: CalendarSyncMappings = { 'ca-1': previous };
    const rows = [action({ id: 'ca-1', title: '新标题' })];

    const plan = buildCalendarSyncPlan({ enabled: true, actions: rows, mappings, now: NOW });

    expect(plan.toCreate).toEqual([]);
    expect(plan.toUpdate).toEqual([{ ...spec({ id: 'ca-1', title: '新标题' }), eventId: 'evt-1' }]);
    expect(plan.retained).toEqual({ 'ca-1': previous });
    expect(plan.toDelete).toEqual([]);
  });

  it('is idempotent: an unchanged action stays retained, nothing to write', () => {
    const unchanged = spec({ id: 'ca-1' });
    const mappings: CalendarSyncMappings = {
      'ca-1': { eventId: 'evt-1', signature: calendarEventSignature(unchanged) },
    };

    const plan = buildCalendarSyncPlan({
      enabled: true,
      actions: [action({ id: 'ca-1' })],
      mappings,
      now: NOW,
    });

    expect(plan.toCreate).toEqual([]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toDelete).toEqual([]);
    expect(plan.retained).toEqual(mappings);
  });

  it('deletes mappings whose action is done, deleted, or already ended', () => {
    const mappings: CalendarSyncMappings = {
      'ca-done': { eventId: 'evt-done', signature: 'x' },
      'ca-gone': { eventId: 'evt-gone', signature: 'y' },
      'ca-past': { eventId: 'evt-past', signature: 'z' },
    };
    const rows = [
      action({ id: 'ca-done', status: 'done' }),
      action({ id: 'ca-gone', deletedAt: NOW.toISOString() }),
      action({
        id: 'ca-past',
        startsAt: new Date(NOW.getTime() - 120 * MIN).toISOString(),
        estMinutes: 30,
      }),
    ];

    const plan = buildCalendarSyncPlan({ enabled: true, actions: rows, mappings, now: NOW });

    expect(plan.toCreate).toEqual([]);
    expect(plan.retained).toEqual({});
    expect(plan.toDelete).toEqual([
      { actionId: 'ca-done', eventId: 'evt-done' },
      { actionId: 'ca-gone', eventId: 'evt-gone' },
      { actionId: 'ca-past', eventId: 'evt-past' },
    ]);
  });

  it('turning the switch off deletes every mapping and creates nothing', () => {
    const mappings: CalendarSyncMappings = {
      'ca-1': { eventId: 'evt-1', signature: 'sig' },
    };

    const plan = buildCalendarSyncPlan({
      enabled: false,
      actions: [action({ id: 'ca-1' })],
      mappings,
      now: NOW,
    });

    expect(plan.toCreate).toEqual([]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.retained).toEqual({});
    expect(plan.toDelete).toEqual([{ actionId: 'ca-1', eventId: 'evt-1' }]);
  });

  it('does not create an event for an action whose end already passed', () => {
    const rows = [
      action({
        id: 'ca-past',
        startsAt: new Date(NOW.getTime() - 60 * MIN).toISOString(),
        estMinutes: 15,
      }),
    ];

    const plan = buildCalendarSyncPlan({ enabled: true, actions: rows, mappings: {}, now: NOW });

    expect(plan.toCreate).toEqual([]);
  });

  it('gives an action with estMinutes 0 a valid one-minute range', () => {
    const rows = [action({ id: 'ca-zero', estMinutes: 0 })];

    const plan = buildCalendarSyncPlan({ enabled: true, actions: rows, mappings: {}, now: NOW });

    expect(plan.toCreate).toHaveLength(1);
    const created = plan.toCreate[0];
    expect(created).toBeDefined();
    if (created === undefined) return;
    expect(new Date(created.endsAt).getTime() - new Date(created.startsAt).getTime()).toBe(MIN);
  });

  it('ignores an action with an unparseable startsAt', () => {
    const rows = [action({ id: 'ca-bad', startsAt: 'not-a-date' })];

    const plan = buildCalendarSyncPlan({ enabled: true, actions: rows, mappings: {}, now: NOW });

    expect(plan.toCreate).toEqual([]);
  });
});
