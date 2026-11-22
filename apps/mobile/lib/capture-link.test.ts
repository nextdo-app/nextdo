/**
 * Unit tests — clarifyHrefWithSchedule (issue #101).
 *
 * The capture preview hands its date/time suggestion to the Clarify wizard
 * through route params; the inbox item itself keeps only the raw title.
 * Only ISO values are emitted, and a null schedule leaves the route bare.
 */
import type { CaptureSchedule } from '@nextdo/core';
import { clarifyHrefWithSchedule } from './capture-link';

const CALENDAR: CaptureSchedule = {
  kind: 'calendar',
  date: '2026-11-22',
  time: '15:00',
  startsAt: '2026-11-22T15:00:00.000Z',
  estMinutes: 30,
  matchedText: '明天下午3点开会',
};

const DEADLINE: CaptureSchedule = {
  kind: 'deadline',
  date: '2026-11-21',
  time: '23:59',
  deadline: '2026-11-21T23:59:00.000Z',
  matchedText: '明天',
};

function paramsOf(href: string): URLSearchParams {
  const query = href.split('?')[1] ?? '';
  return new URLSearchParams(query);
}

describe('clarifyHrefWithSchedule', () => {
  it('returns the bare clarify route without a schedule', () => {
    expect(clarifyHrefWithSchedule('inbox-1', null)).toBe('/clarify/inbox-1');
  });

  it('encodes a calendar suggestion as startsAt + estMinutes', () => {
    const href = clarifyHrefWithSchedule('inbox-1', CALENDAR);
    expect(href.startsWith('/clarify/inbox-1?')).toBe(true);
    const params = paramsOf(href);
    expect(params.get('startsAt')).toBe('2026-11-22T15:00:00.000Z');
    expect(params.get('estMinutes')).toBe('30');
    expect(params.get('deadline')).toBeNull();
  });

  it('encodes a deadline suggestion as deadline only', () => {
    const href = clarifyHrefWithSchedule('inbox-1', DEADLINE);
    const params = paramsOf(href);
    expect(params.get('deadline')).toBe('2026-11-21T23:59:00.000Z');
    expect(params.get('startsAt')).toBeNull();
    expect(params.get('estMinutes')).toBeNull();
  });

  it('falls back to a 30-minute estimate when estMinutes is missing', () => {
    const href = clarifyHrefWithSchedule('inbox-1', {
      ...CALENDAR,
      estMinutes: undefined,
    });
    expect(paramsOf(href).get('estMinutes')).toBe('30');
  });

  it('omits the query entirely when the schedule carries no usable value', () => {
    expect(
      clarifyHrefWithSchedule('inbox-1', {
        kind: 'deadline',
        date: '2026-11-21',
        time: null,
        matchedText: '明天',
      }),
    ).toBe('/clarify/inbox-1');
  });
});
