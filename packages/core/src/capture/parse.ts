/**
 * Issue #101 — local natural-language capture parsing (pure, zero deps).
 *
 * Turns the date/time words people actually type into a structured
 * suggestion for the capture preview: a deadline, or a fixed-time event
 * (the Clarify wizard's CalendarAction). Nothing is stored here; the raw
 * title is always preserved, and the user can edit or discard the
 * suggestion before saving.
 *
 * Supported (device-local clock, same convention as the engine's windows):
 *   - relative days: 今天/今日、明天/明日、后天、大后天
 *   - relative offsets: N天后、N周后 (Arabic or Chinese numerals)
 *   - weekdays: 周一/星期一/礼拜一，本周/这周、下周、下下周
 *   - absolute dates: M月D日/号，可带年份 YYYY年M月D日
 *   - clock times: 15:30、15点、15点半、15点30分，带 凌晨/早上/上午/中午/
 *     下午/傍晚/晚上/夜里 时段；中文数字一点～十二点
 *   - evening/morning shorthand: 今晚、明早、明晚
 *
 * Deliberate rules (documented because the input is ambiguous):
 *   - A date without a clock time becomes a date-only DEADLINE at local
 *     23:59 — the same sentinel Clarify and the reminder rules already use.
 *   - A clock time with an event word (开会/面试/聚餐…) becomes a CALENDAR
 *     suggestion (30 minutes); otherwise it is a deadline.
 *   - A time without a date is today when still in the future, else tomorrow.
 *   - A bare hour 1–6 means afternoon (3点 → 15:00); 7–12 stay literal.
 *   - A month/day already in the past rolls to next year.
 *   - Repeat rules, projects, tags and durations in text are NOT parsed yet.
 */
import { daysBetweenDateKeys, localDateKey, toIso } from '../lib/time';

export type CaptureScheduleKind = 'deadline' | 'calendar';

/** A parsed capture suggestion — pure data, never persisted here. */
export interface CaptureSchedule {
  kind: CaptureScheduleKind;
  /** Device-local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Device-local `HH:mm`; null = a date-only suggestion. */
  time: string | null;
  /** ISO deadline for kind 'deadline' (date-only → local 23:59). */
  deadline?: string;
  /** ISO start for kind 'calendar' (time is always present there). */
  startsAt?: string;
  /** Calendar suggestion length in minutes (absent for deadlines). */
  estMinutes?: number;
  /** The text fragment that produced the suggestion (preview copy). */
  matchedText: string;
}

/** A calendar suggestion is an appointment-shaped 30-minute block. */
export const CAPTURE_CALENDAR_MINUTES = 30;

/** If a clock time appears with one of these words, suggest a CalendarAction. */
const CALENDAR_WORDS = [
  '开会',
  '会议',
  '见面',
  '碰头',
  '碰面',
  '约见',
  '面试',
  '通话',
  '电话',
  '讨论',
  '聚餐',
  '吃饭',
  '看病',
  '看医生',
  '就诊',
  '上课',
  '培训',
  '演讲',
  '汇报',
  '评审',
  '采访',
  '出差',
  '航班',
  '飞机',
  '火车',
  '高铁',
  '预约',
];

/** A clock-shaped fragment — used to distinguish "no time given" from
 *  "an impossible time was given" (the latter must not become 23:59). */
const CLOCK_LIKE = /(?:\d{1,2}|[一二三四五六七八九十两]{1,3})\s*[点时]|\d{1,2}:\d{2}/;

/** Deadline wording beats an event word: 「3点前提交会议纪要」 is a deadline.
 *  Bare 前 only counts immediately after the clock time, and not when it
 *  starts an ordinary word (前往 / 前端 / 前台 / 前面). 面试 is NOT 前面:
 *  「3点前面试结束」 asks for the interview to end by 3. */
const DEADLINE_WORDS = /(?:之前|以前|截至|截止)/;
const TRAILING_DEADLINE = /^\s*前(?!往|端|台|方|面(?!试))/;

const CN_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const WEEKDAY_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
};

interface LocalDateParts {
  year: number;
  month: number; // 1-12
  day: number;
}

interface DateHit extends LocalDateParts {
  start: number;
  end: number;
  /** Plus-one day for 今晚12点 / 夜里12点 (midnight of the next day). */
  dayOffset: number;
}

interface TimeHit {
  hour: number;
  minute: number;
  start: number;
  end: number;
  dayOffset: number;
}

/** Full-width digits/colon → ASCII; every replacement is one char, so the
 *  match offsets still index the original string. */
function normalize(text: string): string {
  return text
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ':');
}

function chineseNumber(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === '十') return 10;
  // Zero-prefixed minutes: 零五 = 5, 零十 = 10.
  if (raw.startsWith('零')) {
    const rest = raw.slice(1);
    return rest === '' ? 0 : chineseNumber(rest);
  }
  if (raw.includes('十')) {
    const [tensRaw = '', onesRaw = ''] = raw.split('十');
    const tens = tensRaw === '' ? 1 : CN_DIGITS[tensRaw];
    const ones = onesRaw === '' ? 0 : CN_DIGITS[onesRaw];
    if (tens === undefined || ones === undefined) return null;
    return tens * 10 + ones;
  }
  if (raw.length === 1) return CN_DIGITS[raw] ?? null;
  return null;
}

function two(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function dateKey(parts: LocalDateParts): string {
  return `${parts.year}-${two(parts.month)}-${two(parts.day)}`;
}

function parseDateKey(value: string): LocalDateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  return isRealDate(parts) ? parts : null;
}

function isRealDate(parts: LocalDateParts): boolean {
  const date = new Date(parts.year, parts.month - 1, parts.day);
  return (
    date.getFullYear() === parts.year &&
    date.getMonth() === parts.month - 1 &&
    date.getDate() === parts.day
  );
}

function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(now: Date, days: number): LocalDateParts {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

/** ISO weekday: Monday 1 … Sunday 7 (the device-local calendar week). */
function isoWeekday(parts: LocalDateParts): number {
  return ((new Date(parts.year, parts.month - 1, parts.day).getDay() + 6) % 7) + 1;
}

const SPECIAL_DAYS: Array<{ word: string; days: number }> = [
  { word: '大后天', days: 3 },
  { word: '后天', days: 2 },
  { word: '明天', days: 1 },
  { word: '明日', days: 1 },
  { word: '今天', days: 0 },
  { word: '今日', days: 0 },
  { word: '今晚', days: 0 },
  { word: '明晚', days: 1 },
  { word: '明早', days: 1 },
];

function dateHit(parts: LocalDateParts, start: number, end: number, dayOffset = 0): DateHit {
  return { ...parts, start, end, dayOffset };
}

/** Resolve an explicit month/day (optionally with a year). Without a year, a
 *  month/day already behind us is next year's appointment. Invalid calendar
 *  dates return null — the caller must NOT fall back to today. */
function resolveAbsoluteParts(
  year: number | null,
  month: number,
  day: number,
  now: Date,
): LocalDateParts | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const today = startOfLocalDay(now);
  let resolvedYear = year ?? today.getFullYear();
  let parts = { year: resolvedYear, month, day };
  if (!isRealDate(parts)) return null;
  if (year === null && new Date(resolvedYear, month - 1, day) < today) {
    resolvedYear += 1;
    parts = { year: resolvedYear, month, day };
    if (!isRealDate(parts)) return null;
  }
  return parts;
}

/** Explicit date shapes: the parser must fail loudly (return no suggestion)
 *  on an impossible one instead of quietly using today. */
const ISO_DATE = /(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/;
const SLASH_DATE = /(\d{1,2})\/(\d{1,2})(?!\d)/;
const CN_ABSOLUTE_DATE = /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日号]/;

function hasExplicitDate(text: string): boolean {
  return ISO_DATE.test(text) || SLASH_DATE.test(text) || CN_ABSOLUTE_DATE.test(text);
}

function matchDate(text: string, now: Date): DateHit | null {
  // Absolute date wins when present: the user gave a full calendar day.
  // 2026-12-02 / 12/02 are accepted next to the Chinese 12月2日 form.
  const iso = ISO_DATE.exec(text);
  if (iso !== null) {
    const parts = resolveAbsoluteParts(Number(iso[1]), Number(iso[2]), Number(iso[3]), now);
    if (parts === null) return null;
    return dateHit(parts, iso.index, iso.index + iso[0].length);
  }
  const slash = SLASH_DATE.exec(text);
  if (slash !== null) {
    const parts = resolveAbsoluteParts(null, Number(slash[1]), Number(slash[2]), now);
    if (parts === null) return null;
    return dateHit(parts, slash.index, slash.index + slash[0].length);
  }
  const absolute = CN_ABSOLUTE_DATE.exec(text);
  if (absolute !== null) {
    const parts = resolveAbsoluteParts(
      absolute[1] === undefined ? null : Number(absolute[1]),
      Number(absolute[2]),
      Number(absolute[3]),
      now,
    );
    if (parts === null) return null;
    return dateHit(parts, absolute.index, absolute.index + absolute[0].length);
  }

  for (const special of SPECIAL_DAYS) {
    const index = text.indexOf(special.word);
    if (index >= 0) {
      return dateHit(addDays(now, special.days), index, index + special.word.length);
    }
  }

  const weekday = /(下下|下|本|这)?(?:周|星期|礼拜)([一二三四五六日天1-7])/.exec(text);
  if (weekday !== null) {
    const raw = weekday[2] ?? '';
    const target = WEEKDAY_DIGITS[raw] ?? Number(raw);
    const today = {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
    };
    const current = isoWeekday(today);
    const prefix = weekday[1] ?? '';
    let days: number;
    if (prefix === '本' || prefix === '这') {
      // The named weekday of THIS Monday–Sunday week; it may already be past.
      days = target - current;
    } else if (prefix === '下' || prefix === '下下') {
      // The weekday of NEXT (or the one after) Monday–Sunday week.
      const toNextMonday = ((8 - current) % 7) || 7;
      days = toNextMonday + (target - 1) + (prefix === '下下' ? 7 : 0);
    } else {
      // Bare weekday = its coming occurrence, today included.
      days = (target - current + 7) % 7;
    }
    return dateHit(addDays(now, days), weekday.index, weekday.index + weekday[0].length);
  }

  const offset = /(\d+|[一二三四五六七八九十两]+)\s*(天|日|周|个星期)后/.exec(text);
  if (offset !== null) {
    const amount = chineseNumber(offset[1] ?? '');
    if (amount === null || amount < 0) return null;
    const days = offset[2] === '周' || offset[2] === '个星期' ? amount * 7 : amount;
    return dateHit(addDays(now, days), offset.index, offset.index + offset[0].length);
  }

  return null;
}

function periodFor(word: string): string {
  if (word === '早晨') return '早上';
  if (word === '夜里' || word === '夜间') return '晚上';
  return word;
}

function applyPeriod(hour: number, period: string | null): { hour: number; dayOffset: number } {
  if (period === null) {
    // Bare hour: 1–6 is almost always afternoon in capture text.
    return { hour: hour >= 1 && hour <= 6 ? hour + 12 : hour, dayOffset: 0 };
  }
  switch (period) {
    case '凌晨':
      return { hour: hour === 12 ? 0 : hour, dayOffset: 0 };
    case '早上':
    case '上午':
      return { hour, dayOffset: 0 };
    case '中午':
      return { hour: hour < 12 ? hour + 12 : hour, dayOffset: 0 };
    case '下午':
    case '傍晚':
      // 下午三点 → 15:00, but an explicit 下午15:00 / 下午20:00 stays as given.
      return { hour: hour < 12 ? hour + 12 : hour, dayOffset: 0 };
    case '晚上':
      // 晚上12点 is midnight of the NEXT day; 1–11 become 13–23;
      // an explicit 20:00 already says it is evening.
      return hour === 12
        ? { hour: 0, dayOffset: 1 }
        : hour > 12
          ? { hour, dayOffset: 0 }
          : { hour: hour + 12, dayOffset: 0 };
    default:
      return { hour, dayOffset: 0 };
  }
}

const TIME_PERIODS = '凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里';
const TIME_WORD = '[一二三四五六七八九十两]{1,3}';
const MINUTE_WORD = '[零一二三四五六七八九十两\\d]{1,3}';

function matchTime(text: string): TimeHit | null {
  const colon = new RegExp(`(${TIME_PERIODS})?\\s*(\\d{1,2}):(\\d{2})`).exec(text);
  if (colon !== null) {
    const hour = Number(colon[2]);
    const minute = Number(colon[3]);
    if (hour > 23 || minute > 59) return null;
    // An explicit 24-hour clock with no period is literal (03:00 is 3 a.m.);
    // the bare-hour → afternoon heuristic only applies to 3点-style input.
    const period = colon[1] === undefined ? null : periodFor(colon[1]);
    const mapped =
      period === null ? { hour, dayOffset: 0 } : applyPeriod(hour, period);
    if (mapped.hour < 0 || mapped.hour > 23) return null;
    return {
      hour: mapped.hour,
      minute,
      start: colon.index,
      end: colon.index + colon[0].length,
      dayOffset: mapped.dayOffset,
    };
  }
  const dian = new RegExp(
    `(${TIME_PERIODS})?\\s*(\\d{1,2}|${TIME_WORD})\\s*[点时]\\s*(半|(${MINUTE_WORD})\\s*分?)?`,
  ).exec(text);
  if (dian === null) return null;
  const rawHour = chineseNumber(dian[2] ?? '');
  if (rawHour === null || rawHour > 23) return null;
  const minute =
    dian[3] === '半'
      ? 30
      : dian[4] === undefined
        ? 0
        : chineseNumber(dian[4]);
  if (minute === null || minute > 59) return null;
  const mapped = applyPeriod(rawHour, dian[1] === undefined ? null : periodFor(dian[1]));
  if (mapped.hour < 0 || mapped.hour > 23) return null;
  return {
    hour: mapped.hour,
    minute,
    start: dian.index,
    end: dian.index + dian[0].length,
    dayOffset: mapped.dayOffset,
  };
}

/** 今晚 / 明早 / 明晚 carry a period without naming it next to the hour. */
function shorthandPeriod(text: string, date: DateHit | null): string | null {
  if (date === null) return null;
  const fragment = text.slice(date.start, date.end);
  if (fragment === '今晚' || fragment === '明晚') return '晚上';
  if (fragment === '明早') return '早上';
  return null;
}

function mergePeriod(date: DateHit | null, time: TimeHit | null, text: string): TimeHit | null {
  if (time === null) return null;
  const implicit = shorthandPeriod(text, date);
  if (implicit === null) return time;
  // Re-map the literal hour with the shorthand's period. Both 9:30 and 九点半
  // shapes appear in shorthand text (今晚9:30开会).
  const fragment = text.slice(time.start, time.end);
  const rawMatch = new RegExp(
    `(\\d{1,2}|${TIME_WORD})(?::(\\d{2})|[点时]\\s*(半|(${MINUTE_WORD})\\s*分?)?)`,
  ).exec(fragment);
  if (rawMatch === null) return time;
  const rawHour = chineseNumber(rawMatch[1] ?? '');
  if (rawHour === null || rawHour > 23) return time;
  const minute =
    rawMatch[2] !== undefined
      ? Number(rawMatch[2])
      : rawMatch[3] === '半'
        ? 30
        : rawMatch[4] === undefined
          ? 0
          : chineseNumber(rawMatch[4]);
  if (minute === null || minute > 59) return time;
  const mapped = applyPeriod(rawHour, implicit);
  if (mapped.hour < 0 || mapped.hour > 23) return time;
  return { hour: mapped.hour, minute, start: time.start, end: time.end, dayOffset: mapped.dayOffset };
}

function hasCalendarWord(text: string): boolean {
  return CALENDAR_WORDS.some((word) => text.includes(word));
}

function hasDeadlineWording(text: string, time: TimeHit | null): boolean {
  if (DEADLINE_WORDS.test(text)) return true;
  if (time === null) return false;
  return TRAILING_DEADLINE.test(text.slice(time.end));
}

function timeLabel(hour: number, minute: number): string {
  return `${two(hour)}:${two(minute)}`;
}

function buildIso(parts: LocalDateParts, hour: number, minute: number): string {
  return toIso(new Date(parts.year, parts.month - 1, parts.day, hour, minute));
}

/** Build a schedule from edited parts — the preview's picker and the kind
 *  toggle use this so the ISO construction lives in one place. */
export function captureScheduleFromParts(
  kind: CaptureScheduleKind,
  date: string,
  time: string | null,
  matchedText = '',
): CaptureSchedule | null {
  const parts = parseDateKey(date);
  if (parts === null) return null;
  const clock = time === null ? null : /^(\d{1,2}):(\d{2})$/.exec(time);
  if (time !== null && clock === null) return null;
  const hour = clock === null ? 0 : Number(clock[1]);
  const minute = clock === null ? 0 : Number(clock[2]);
  if (clock !== null && (hour > 23 || minute > 59)) return null;
  const hasTime = clock !== null;
  const resolvedTime = hasTime ? timeLabel(hour, minute) : null;
  if (kind === 'calendar') {
    const startHour = hasTime ? hour : 9;
    const startMinute = hasTime ? minute : 0;
    return {
      kind,
      date,
      time: timeLabel(startHour, startMinute),
      startsAt: buildIso(parts, startHour, startMinute),
      estMinutes: CAPTURE_CALENDAR_MINUTES,
      matchedText,
    };
  }
  return {
    kind,
    date,
    time: resolvedTime,
    deadline: buildIso(parts, hasTime ? hour : 23, hasTime ? minute : 59),
    matchedText,
  };
}

/** Chinese-friendly label for the preview: 今天/明天/后天 or M月D日, plus
 *  HH:mm when a clock time was recognised. */
export function describeCaptureSchedule(schedule: CaptureSchedule, now: Date): string {
  const parts = parseDateKey(schedule.date);
  if (parts === null) {
    return schedule.time === null ? schedule.date : `${schedule.date} ${schedule.time}`;
  }
  const days = daysBetweenDateKeys(
    localDateKey(startOfLocalDay(now)),
    localDateKey(new Date(parts.year, parts.month - 1, parts.day)),
  );
  let label: string;
  if (days === 0) label = '今天';
  else if (days === 1) label = '明天';
  else if (days === 2) label = '后天';
  else label = `${parts.month}月${parts.day}日`;
  return schedule.time === null ? label : `${label} ${schedule.time}`;
}

/** Parse one capture text; null = no usable date/time (keep the raw title). */
export function parseCaptureSchedule(text: string, now: Date): CaptureSchedule | null {
  const normalized = normalize(text);
  const date = matchDate(normalized, now);
  // An explicit but impossible date must fail, not quietly become today.
  if (date === null && hasExplicitDate(normalized)) return null;
  const time = mergePeriod(date, matchTime(normalized), normalized);
  // Same for a clock-shaped fragment that does not resolve to a real time.
  if (time === null && CLOCK_LIKE.test(normalized)) return null;
  if (date === null && time === null) return null;

  const totalDayOffset = (date?.dayOffset ?? 0) + (time?.dayOffset ?? 0);
  let parts: LocalDateParts;
  if (date !== null) {
    parts = { year: date.year, month: date.month, day: date.day };
  } else if (time !== null) {
    // Time only: today while still ahead, otherwise tomorrow.
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), time.hour, time.minute);
    parts =
      candidate.getTime() > now.getTime()
        ? { year: candidate.getFullYear(), month: candidate.getMonth() + 1, day: candidate.getDate() }
        : addDays(now, 1);
  } else {
    return null;
  }
  if (totalDayOffset > 0) {
    parts = addDays(new Date(parts.year, parts.month - 1, parts.day), totalDayOffset);
  }

  const kind: CaptureScheduleKind =
    time !== null && hasCalendarWord(normalized) && !hasDeadlineWording(normalized, time)
      ? 'calendar'
      : 'deadline';
  const start = Math.min(date?.start ?? Number.POSITIVE_INFINITY, time?.start ?? Number.POSITIVE_INFINITY);
  const end = Math.max(date?.end ?? Number.NEGATIVE_INFINITY, time?.end ?? Number.NEGATIVE_INFINITY);
  const matchedText =
    Number.isFinite(start) && Number.isFinite(end) ? text.slice(start, end).trim() : '';

  return captureScheduleFromParts(
    kind,
    dateKey(parts),
    time === null ? null : timeLabel(time.hour, time.minute),
    matchedText,
  );
}
