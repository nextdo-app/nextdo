/**
 * Issue #101 — Chinese capture date/time parsing.
 *
 * The tests run with TZ=UTC (the package's script pins it), so the ISO
 * strings below are also the device-local wall clock — no hidden offset.
 * The fixed `now` is Saturday 2026-11-21 10:00 local.
 */
import {
  captureScheduleFromParts,
  describeCaptureSchedule,
  parseCaptureSchedule,
} from './parse';

const NOW = new Date('2026-11-21T10:00:00.000Z');
/** Monday 2026-11-23 10:00 local — the review's fixed clock. */
const MONDAY = new Date('2026-11-23T10:00:00.000Z');

function deadlineOf(text: string, now = NOW): string | undefined {
  return parseCaptureSchedule(text, now)?.deadline;
}

describe('parseCaptureSchedule — dates', () => {
  it('resolve relative days to a date-only end-of-day deadline', () => {
    expect(deadlineOf('今天交报告')).toBe('2026-11-21T23:59:00.000Z');
    expect(deadlineOf('明天交报告')).toBe('2026-11-22T23:59:00.000Z');
    expect(deadlineOf('后天交报告')).toBe('2026-11-23T23:59:00.000Z');
    expect(deadlineOf('大后天交报告')).toBe('2026-11-24T23:59:00.000Z');
  });

  it('resolve a plain weekday to its coming occurrence (today included)', () => {
    // Saturday 2026-11-21 → Friday is 2026-11-27.
    expect(deadlineOf('周五交报告')).toBe('2026-11-27T23:59:00.000Z');
    expect(deadlineOf('星期六交报告')).toBe('2026-11-21T23:59:00.000Z');
  });

  it('resolve 下周 / 下下周 against the calendar week', () => {
    expect(deadlineOf('下周一交报告')).toBe('2026-11-23T23:59:00.000Z');
    expect(deadlineOf('下下周一交报告')).toBe('2026-11-30T23:59:00.000Z');
  });

  it('resolves 下周三 to next calendar week even mid-week (issue #101 review)', () => {
    // Monday 2026-11-23: this Wednesday is 11/25, next week's is 12/02.
    expect(deadlineOf('下周三交报告', MONDAY)).toBe('2026-12-02T23:59:00.000Z');
    expect(deadlineOf('下下周三交报告', MONDAY)).toBe('2026-12-09T23:59:00.000Z');
    // Thursday 2026-11-26: next week's Wednesday is still 12/02 (6 days).
    expect(deadlineOf('下周三交报告', new Date('2026-11-26T10:00:00.000Z'))).toBe(
      '2026-12-02T23:59:00.000Z',
    );
    // Wednesday itself: next week = +7 days.
    expect(deadlineOf('下周三交报告', new Date('2026-11-25T10:00:00.000Z'))).toBe(
      '2026-12-02T23:59:00.000Z',
    );
  });

  it('resolves 本周三 to this calendar week, even when it already passed', () => {
    expect(deadlineOf('本周三交报告', NOW)).toBe('2026-11-18T23:59:00.000Z');
    expect(deadlineOf('本周三交报告', MONDAY)).toBe('2026-11-25T23:59:00.000Z');
  });

  it('accepts ISO and slash absolute dates', () => {
    expect(deadlineOf('2026-12-02 交报告', NOW)).toBe('2026-12-02T23:59:00.000Z');
    expect(deadlineOf('12/02 交报告', NOW)).toBe('2026-12-02T23:59:00.000Z');
    expect(parseCaptureSchedule('2026-12-02 15:00开会', NOW)).toMatchObject({
      kind: 'calendar',
      date: '2026-12-02',
      time: '15:00',
    });
    expect(parseCaptureSchedule('12/02 15:00开会', NOW)).toMatchObject({
      kind: 'calendar',
      date: '2026-12-02',
      time: '15:00',
    });
  });

  it('resolve day and week offsets in Arabic and Chinese numerals', () => {
    expect(deadlineOf('3天后交报告')).toBe('2026-11-24T23:59:00.000Z');
    expect(deadlineOf('三天后交报告')).toBe('2026-11-24T23:59:00.000Z');
    expect(deadlineOf('两周后交报告')).toBe('2026-12-05T23:59:00.000Z');
  });

  it('resolve month/day with and without a year', () => {
    expect(deadlineOf('11月30日交报告')).toBe('2026-11-30T23:59:00.000Z');
    expect(deadlineOf('3月1日交报告')).toBe('2027-03-01T23:59:00.000Z');
    expect(deadlineOf('2027年3月1日交报告')).toBe('2027-03-01T23:59:00.000Z');
  });

  it('rejects an impossible calendar date', () => {
    expect(parseCaptureSchedule('2月30日交报告', NOW)).toBeNull();
    // A valid clock must not rescue the impossible date with today.
    expect(parseCaptureSchedule('2月30日下午3点开会', NOW)).toBeNull();
    expect(parseCaptureSchedule('2026-02-30 15:00 开会', NOW)).toBeNull();
  });

  it('rejects an impossible clock instead of falling back to end of day', () => {
    expect(parseCaptureSchedule('明天25点开会', NOW)).toBeNull();
  });

  it('keeps an explicit evening 24-hour clock (issue #101 review)', () => {
    expect(parseCaptureSchedule('明天晚上20:00开会', NOW)).toMatchObject({
      kind: 'calendar',
      time: '20:00',
      startsAt: '2026-11-22T20:00:00.000Z',
    });
    expect(deadlineOf('明天下午15:00交报告')).toBe('2026-11-22T15:00:00.000Z');
  });

  it('returns null when the text has no date or time', () => {
    expect(parseCaptureSchedule('给张三回电话', NOW)).toBeNull();
  });
});

describe('parseCaptureSchedule — clock times', () => {
  it('combines a date and a period hour', () => {
    const schedule = parseCaptureSchedule('明天下午三点交报告', NOW);
    expect(schedule).toMatchObject({
      kind: 'deadline',
      date: '2026-11-22',
      time: '15:00',
      deadline: '2026-11-22T15:00:00.000Z',
      matchedText: '明天下午三点',
    });
  });

  it('supports 半 / minutes / colon and full-width input', () => {
    expect(deadlineOf('明天下午三点半交报告')).toBe('2026-11-22T15:30:00.000Z');
    expect(deadlineOf('明天15点30分交报告')).toBe('2026-11-22T15:30:00.000Z');
    expect(parseCaptureSchedule('明天下午三点二十分开会', NOW)).toMatchObject({
      kind: 'calendar',
      time: '15:20',
      startsAt: '2026-11-22T15:20:00.000Z',
    });
    expect(parseCaptureSchedule('明天下午三点零五分开会', NOW)).toMatchObject({
      kind: 'calendar',
      time: '15:05',
      startsAt: '2026-11-22T15:05:00.000Z',
    });
    expect(deadlineOf('今晚九点零五分交报告')).toBe('2026-11-21T21:05:00.000Z');
    expect(deadlineOf('明天15：30交报告')).toBe('2026-11-22T15:30:00.000Z');
    expect(deadlineOf('明天１５：３０交报告')).toBe('2026-11-22T15:30:00.000Z');
  });

  it('maps every period onto the 24-hour clock', () => {
    expect(deadlineOf('明天凌晨一点交报告')).toBe('2026-11-22T01:00:00.000Z');
    expect(deadlineOf('明天上午十点交报告')).toBe('2026-11-22T10:00:00.000Z');
    expect(deadlineOf('明天中午十二点交报告')).toBe('2026-11-22T12:00:00.000Z');
    expect(deadlineOf('明天中午一点交报告')).toBe('2026-11-22T13:00:00.000Z');
    expect(deadlineOf('明天晚上八点交报告')).toBe('2026-11-22T20:00:00.000Z');
  });

  it('treats a bare hour 1–6 as afternoon and 7–12 literally', () => {
    expect(deadlineOf('明天三点交报告')).toBe('2026-11-22T15:00:00.000Z');
    expect(deadlineOf('明天十点交报告')).toBe('2026-11-22T10:00:00.000Z');
  });

  it('uses today for a future time and tomorrow for a past time', () => {
    expect(deadlineOf('下午三点交报告')).toBe('2026-11-21T15:00:00.000Z');
    expect(deadlineOf('下午三点交报告', new Date('2026-11-21T16:00:00.000Z'))).toBe(
      '2026-11-22T15:00:00.000Z',
    );
  });

  it('understands 今晚 / 明早 / 明晚 shorthand', () => {
    expect(deadlineOf('今晚八点交报告')).toBe('2026-11-21T20:00:00.000Z');
    expect(deadlineOf('明早八点交报告')).toBe('2026-11-22T08:00:00.000Z');
    expect(deadlineOf('明晚八点交报告')).toBe('2026-11-22T20:00:00.000Z');
    // The shorthand also maps a colon clock (issue #101 review).
    expect(deadlineOf('今晚9:30交报告')).toBe('2026-11-21T21:30:00.000Z');
  });

  it('keeps a 24-hour colon clock literal without a period', () => {
    const schedule = parseCaptureSchedule('明天03:00开会', NOW);
    expect(schedule).toMatchObject({ kind: 'calendar', date: '2026-11-22', time: '03:00' });
    expect(deadlineOf('明天03:00交报告')).toBe('2026-11-22T03:00:00.000Z');
  });

  it('rolls 晚上12点 / 今晚12点 to midnight of the next day', () => {
    expect(deadlineOf('明天晚上12点交报告')).toBe('2026-11-23T00:00:00.000Z');
    expect(deadlineOf('今晚12点交报告')).toBe('2026-11-22T00:00:00.000Z');
  });
});

describe('parseCaptureSchedule — deadline vs calendar', () => {
  it('suggests a calendar action for a clock time with an event word', () => {
    const schedule = parseCaptureSchedule('明天下午三点跟张三开会', NOW);
    expect(schedule).toMatchObject({
      kind: 'calendar',
      date: '2026-11-22',
      time: '15:00',
      startsAt: '2026-11-22T15:00:00.000Z',
      estMinutes: 30,
    });
    expect(schedule?.deadline).toBeUndefined();
  });

  it('keeps a non-event clock time as a deadline', () => {
    expect(parseCaptureSchedule('明天下午三点交报告', NOW)?.kind).toBe('deadline');
  });

  it('lets deadline wording beat an event word (issue #101 review)', () => {
    // 会议纪要 is a document, not a meeting; 前 makes it a deadline.
    expect(parseCaptureSchedule('明天下午3点前提交会议纪要', NOW)).toMatchObject({
      kind: 'deadline',
      time: '15:00',
      deadline: '2026-11-22T15:00:00.000Z',
    });
  });

  it('does not treat 前端 / 前往 / 目前 as deadline wording (issue #101 review)', () => {
    expect(parseCaptureSchedule('明天下午3点开前端会议', NOW)).toMatchObject({
      kind: 'calendar',
      time: '15:00',
    });
    expect(parseCaptureSchedule('明天下午3点前往医院就诊', NOW)).toMatchObject({
      kind: 'calendar',
      time: '15:00',
    });
    expect(parseCaptureSchedule('目前3点开会', NOW)).toMatchObject({ kind: 'calendar' });
  });

  it('keeps 前＋面试 as a deadline, not the ordinary word 前面 (issue #101 review)', () => {
    expect(parseCaptureSchedule('明天下午3点前面试结束', NOW)).toMatchObject({
      kind: 'deadline',
      time: '15:00',
      deadline: '2026-11-22T15:00:00.000Z',
    });
  });

  it('keeps a date-only appointment-shaped capture as a deadline', () => {
    // No clock time: a fixed CalendarAction needs one, so end-of-day wins.
    expect(parseCaptureSchedule('明天开会', NOW)).toMatchObject({
      kind: 'deadline',
      time: null,
      deadline: '2026-11-22T23:59:00.000Z',
    });
  });
});

describe('captureScheduleFromParts / describeCaptureSchedule', () => {
  it('rebuilds a deadline and a calendar suggestion from edited parts', () => {
    expect(captureScheduleFromParts('deadline', '2026-11-22', null, '明天')).toMatchObject({
      deadline: '2026-11-22T23:59:00.000Z',
      time: null,
    });
    expect(captureScheduleFromParts('calendar', '2026-11-22', null, '明天')).toMatchObject({
      startsAt: '2026-11-22T09:00:00.000Z',
      time: '09:00',
      estMinutes: 30,
    });
    expect(captureScheduleFromParts('deadline', '2026-11-22', '15:30', '明天')).toMatchObject({
      deadline: '2026-11-22T15:30:00.000Z',
      time: '15:30',
    });
  });

  it('rejects malformed edited parts', () => {
    expect(captureScheduleFromParts('deadline', '2026-02-30', null)).toBeNull();
    expect(captureScheduleFromParts('deadline', '2026-11-22', '25:00')).toBeNull();
  });

  it('describes today / tomorrow / the day after / other dates', () => {
    const base = captureScheduleFromParts('deadline', '2026-11-21', '15:00')!;
    expect(describeCaptureSchedule(base, NOW)).toBe('今天 15:00');
    const tomorrow = captureScheduleFromParts('deadline', '2026-11-22', null)!;
    expect(describeCaptureSchedule(tomorrow, NOW)).toBe('明天');
    const later = captureScheduleFromParts('deadline', '2026-11-27', '09:00')!;
    expect(describeCaptureSchedule(later, NOW)).toBe('11月27日 09:00');
  });
});
