import { commonSnoozeOption } from '../snooze-options';
import {
  INLINE_SNOOZE_LABEL,
  INLINE_SNOOZE_MINUTES,
  REMINDER_ACTION_IDS,
  REMINDER_CATEGORY_ID,
  inlineSnoozeTarget,
  parseInlineAction,
} from './inline-actions';

describe('inline notification actions (issue #99)', () => {
  it('uses a category id without the characters iOS rejects', () => {
    expect(REMINDER_CATEGORY_ID).not.toMatch(/[:.-]/);
  });

  it('parses each of the three action identifiers', () => {
    for (const kind of ['complete', 'snooze', 'skip'] as const) {
      expect(
        parseInlineAction(REMINDER_ACTION_IDS[kind], {
          actionKind: 'next',
          actionId: 'action-1',
        }),
      ).toEqual({ kind, actionKind: 'next', actionId: 'action-1' });
    }
  });

  it('parses every action kind carried by the reminder payload', () => {
    for (const actionKind of ['next', 'calendar', 'habit'] as const) {
      expect(
        parseInlineAction(REMINDER_ACTION_IDS.complete, { actionKind, actionId: 'a' }),
      ).toEqual({ kind: 'complete', actionKind, actionId: 'a' });
    }
  });

  it('returns null for a plain tap (the OS default identifier)', () => {
    expect(
      parseInlineAction('expo.modules.notifications.actions.DEFAULT', {
        actionKind: 'next',
        actionId: 'a',
      }),
    ).toBeNull();
  });

  it('returns null for an unknown action identifier', () => {
    expect(
      parseInlineAction('some.other.action', { actionKind: 'next', actionId: 'a' }),
    ).toBeNull();
  });

  it('returns null when the payload is missing or drifted', () => {
    expect(parseInlineAction(REMINDER_ACTION_IDS.skip, null)).toBeNull();
    expect(parseInlineAction(REMINDER_ACTION_IDS.skip, 'next')).toBeNull();
    expect(
      parseInlineAction(REMINDER_ACTION_IDS.skip, { actionKind: 'project', actionId: 'a' }),
    ).toBeNull();
    expect(
      parseInlineAction(REMINDER_ACTION_IDS.skip, { actionKind: 'next' }),
    ).toBeNull();
    expect(
      parseInlineAction(REMINDER_ACTION_IDS.skip, { actionKind: 'next', actionId: '' }),
    ).toBeNull();
    expect(
      parseInlineAction(REMINDER_ACTION_IDS.skip, { actionKind: 'next', actionId: 42 }),
    ).toBeNull();
  });

  it('snoozes with the app common shortcut (10 minutes), not a second default', () => {
    const now = new Date('2026-11-21T10:00:00.000Z');
    expect(INLINE_SNOOZE_MINUTES).toBe(10);
    expect(INLINE_SNOOZE_LABEL).toBe('推迟 10 分钟');
    expect(inlineSnoozeTarget(now).getTime()).toBe(commonSnoozeOption(now).target.getTime());
    expect(inlineSnoozeTarget(now).toISOString()).toBe('2026-11-21T10:10:00.000Z');
  });
});
