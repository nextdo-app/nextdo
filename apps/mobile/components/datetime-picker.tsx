/**
 * DateTimePicker — modern cross-platform date/time selection modal.
 *
 * Issue #110 (精简框架):
 * - the dialog is a flat two-section layout (日期 / 时间) instead of a stack
 *   of nested cards — the modal itself is the only card;
 * - the old status banner is folded into the header as ONE line of
 *   current-selection summary;
 * - the minute chips (:00/:15/:30/:45) and the ±1m/±5m steppers are gone:
 *   the wheels alone own the minute, and the usage-ranked quick presets stay;
 * - the 24h/12h and AM/PM switches sit in the time section's label row;
 * - wide windows (>= 720 px) still put date and time side by side; compact
 *   windows keep one column with the time section FIRST (#105) so the wheels
 *   never fall below the fold.
 *
 * Preserved contracts:
 * - three modes (date / time / datetime);
 * - `datetime` emits 'YYYY-MM-DDTHH:mm', and emits a plain 'YYYY-MM-DD' when
 *   the user picked a day and never touched a time control on a value that
 *   carried no time (#94/#105 — the deadline date-only convention);
 * - usage-ranked quick time presets (#105);
 * - quick date presets and month browsing;
 * - `mode="time"` / `mode="date"` keep their own single-section layouts.
 *
 * The header summary spells the date-only choice as 「… · 只记日期」, which
 * replaces the old standalone hint under the wheels.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, cn, colors } from '@nextdo/ui';
import { useAppTheme } from '@/lib/theme';
import { useQuickTimePresets } from '@/hooks/use-quick-time-presets';

const pad = (n: number): string => String(n).padStart(2, '0');

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATETIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

const WEEKDAY_NAMES = [
  { label: '一', isWeekend: false },
  { label: '二', isWeekend: false },
  { label: '三', isWeekend: false },
  { label: '四', isWeekend: false },
  { label: '五', isWeekend: false },
  { label: '六', isWeekend: true },
  { label: '日', isWeekend: true },
];
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

const ITEM_HEIGHT = 40;
// 3 visible rows (previous / selected / next) keep the wheel readable while
// leaving enough height for the whole dialog to fit one phone screen (#110).
const WHEEL_HEIGHT = 120;
const WHEEL_PADDING = (WHEEL_HEIGHT - ITEM_HEIGHT) / 2; // 40
const WHEEL_FADE = 28;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

export interface DateTimePickerProps {
  mode: 'date' | 'time' | 'datetime';
  title: string;
  value: string;
  now: Date;
  onConfirm: (value: string) => void;
  onClose: () => void;
}

/** Compute date presets relative to now with rich contextual labels */
function getQuickDatePresets(now: Date) {
  const format = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // 1. 今天
  const today = new Date(now);

  // 2. 明天
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // 3. 下周一
  const dayOfWeek = now.getDay();
  const daysToNextMonday = (8 - dayOfWeek) % 7 || 7;
  const nextMonday = new Date(now);
  nextMonday.setDate(nextMonday.getDate() + daysToNextMonday);

  // 4. 下月一日 (下个月 1 号)
  const nextMonthFirst = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return [
    {
      id: 'today',
      label: '今天',
      sublabel: `${today.getMonth() + 1}/${today.getDate()}`,
      date: today,
      key: format(today),
    },
    {
      id: 'tomorrow',
      label: '明天',
      sublabel: `${tomorrow.getMonth() + 1}/${tomorrow.getDate()}`,
      date: tomorrow,
      key: format(tomorrow),
    },
    {
      id: 'next_mon',
      label: '下周一',
      sublabel: `周一 ${nextMonday.getMonth() + 1}/${nextMonday.getDate()}`,
      date: nextMonday,
      key: format(nextMonday),
    },
    {
      id: 'next_month',
      label: '下月一日',
      sublabel: `${nextMonthFirst.getMonth() + 1}/${nextMonthFirst.getDate()}`,
      date: nextMonthFirst,
      key: format(nextMonthFirst),
    },
  ];
}

interface CalendarCell {
  type: 'prev' | 'current' | 'next';
  day: number;
  year: number;
  month: number;
  key: string;
}

/** Calendar grid for the browsed month, padded to whole weeks. */
function buildCalendarCells(viewYear: number, viewMonth: number): CalendarCell[] {
  const daysInCurrentMonth = new Date(viewYear, viewMonth, 0).getDate();
  const firstDayWeekday = (new Date(viewYear, viewMonth - 1, 1).getDay() + 6) % 7; // 0 = Mon
  const daysInPrevMonth = new Date(viewYear, viewMonth - 1, 0).getDate();

  const cells: CalendarCell[] = [];

  // Previous month trailing days
  for (let i = firstDayWeekday - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const m = viewMonth === 1 ? 12 : viewMonth - 1;
    const y = viewMonth === 1 ? viewYear - 1 : viewYear;
    cells.push({ type: 'prev', day: d, year: y, month: m, key: `${y}-${pad(m)}-${pad(d)}` });
  }

  // Current month days
  for (let d = 1; d <= daysInCurrentMonth; d++) {
    cells.push({
      type: 'current',
      day: d,
      year: viewYear,
      month: viewMonth,
      key: `${viewYear}-${pad(viewMonth)}-${pad(d)}`,
    });
  }

  // Next month leading days to complete full week rows (multiple of 7)
  const remaining = (7 - (cells.length % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    const m = viewMonth === 12 ? 1 : viewMonth + 1;
    const y = viewMonth === 12 ? viewYear + 1 : viewYear;
    cells.push({ type: 'next', day: d, year: y, month: m, key: `${y}-${pad(m)}-${pad(d)}` });
  }

  return cells;
}

export function DateTimePicker({
  mode,
  title,
  value,
  now,
  onConfirm,
  onClose,
}: DateTimePickerProps) {
  const { isDark } = useAppTheme();
  const { width: screenWidth } = useWindowDimensions();
  const isCompact = screenWidth < 380;
  // Desktop / tablet windows are wide enough to show the calendar and the
  // time wheels AT THE SAME TIME. The dialog must use that space instead of
  // staying phone-sized and forcing a scroll inside a large window.
  const isWide = screenWidth >= 720;
  const { presets: quickTimePresets, record: recordTimeUse } = useQuickTimePresets();

  const dateMatch = mode === 'date' ? DATE_ONLY.exec(value) : null;
  // A date-only value is a legitimate seed in datetime mode too: callers that
  // store "date-only = that day's end" (deadlines, follow-up) prefill with
  // 'YYYY-MM-DD'. Without this, the wheels fall back to `now` and confirming
  // silently moves the date to today (issue #94 review R1).
  const dateOnlyDatetimeMatch = mode === 'datetime' ? DATE_ONLY.exec(value) : null;
  const timeMatch = mode === 'time' ? HHMM.exec(value) : null;
  const dateTimeMatch = mode === 'datetime' ? DATETIME_LOCAL.exec(value) : null;
  const seedDateMatch = dateMatch ?? dateOnlyDatetimeMatch ?? dateTimeMatch;

  // Selected date components
  const [selectedYear, setSelectedYear] = useState(() => {
    if (seedDateMatch !== null) return Number(seedDateMatch[1]);
    return now.getFullYear();
  });
  const [selectedMonth, setSelectedMonth] = useState(() => {
    if (seedDateMatch !== null) return Number(seedDateMatch[2]);
    return now.getMonth() + 1;
  });
  const [selectedDay, setSelectedDay] = useState(() => {
    if (seedDateMatch !== null) return Number(seedDateMatch[3]);
    return now.getDate();
  });

  // Calendar browsing month (can be navigated independently of selection)
  const [viewYear, setViewYear] = useState(selectedYear);
  const [viewMonth, setViewMonth] = useState(selectedMonth);

  // Time components
  const [hour, setHour] = useState(() => {
    if (timeMatch !== null) return Number(timeMatch[1]);
    if (dateTimeMatch !== null) return Number(dateTimeMatch[4]);
    return now.getHours();
  });
  const [minute, setMinute] = useState(() => {
    if (timeMatch !== null) return Number(timeMatch[2]);
    if (dateTimeMatch !== null) return Number(dateTimeMatch[5]);
    return now.getMinutes();
  });

  // 12h vs 24h format state
  const [is12Hour, setIs12Hour] = useState(false);

  /**
   * Task 10-17: in `datetime` mode the wheels start at the incoming time (or
   * the clock), so a user who only cares about the DAY must be able to say
   * exactly that. "No time control touched AND the incoming value carried no
   * time" → confirm emits 'YYYY-MM-DD' (the date-only convention the
   * deadline field reads back as that day's end). Touching any time control —
   * or opening a value that already has a time — emits the full moment.
   */
  const [timeTouched, setTimeTouched] = useState(false);

  /**
   * Issue #109 (second pass): on Android a wheel drag that re-renders the
   * ScrollView aborts the process, and the fling/snap scroller also survives
   * detach. So a drag must cause ZERO React updates:
   * - the settled/pending flags are refs, not state;
   * - onScroll only records the offset;
   * - the value is committed (one setState) after the gesture stops.
   * The 300 ms fallback covers a drag that ends without momentum: Android
   * never emits onMomentumScrollEnd for it.
   */
  const wheelsSettledRef = useRef(true);
  const pendingConfirmRef = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * The body is a vertical ScrollView and the wheels are nested vertical
   * ScrollViews. On Android the outer one wins the gesture unless it cannot
   * scroll at all — the wheel then looks frozen while its sliver still
   * updates. Disable the outer scroll whenever the content fits the dialog
   * (the #110 one-screen layout); small screens keep it scrollable.
   */
  const [bodyScrollable, setBodyScrollable] = useState(true);
  const bodyLayoutHeight = useRef(0);
  const bodyContentHeight = useRef(0);

  function updateBodyScrollable() {
    // A few px of rounding/sub-pixel overflow must NOT keep the outer
    // ScrollView active: it would still steal the wheel drag. Only a real
    // overflow (a genuinely short screen) keeps the body scrollable.
    setBodyScrollable(bodyContentHeight.current > bodyLayoutHeight.current + 8);
  }

  const hourScrollRef = useRef<ScrollView>(null);
  const minuteScrollRef = useRef<ScrollView>(null);
  // Issue #105: wheel scrolling must count as a time choice in `datetime`
  // mode too (it used to leave `timeTouched` false, so confirming emitted a
  // silent date-only value). Compare against the CURRENT value: the mount
  // sync scroll lands on the seed value and therefore does not mark a touch.
  const hourRef = useRef(hour);
  hourRef.current = hour;
  const minuteRef = useRef(minute);
  minuteRef.current = minute;
  // Live wheel offsets: written by onScroll and by explicit selection, never
  // rewritten by a render — otherwise a re-render during the drag would make
  // the commit read a stale offset.
  const hourOffsetRef = useRef(hour * ITEM_HEIGHT);
  const minuteOffsetRef = useRef(minute * ITEM_HEIGHT);

  // Sync hour/minute scroll position.
  //
  // `isWide` is part of the dependency list on purpose: crossing the 720px
  // threshold swaps the two-column and single-column branches, which remounts
  // the wheel ScrollViews. Without a re-sync here the new nodes start at
  // scrollTop 0 while `hour` / `minute` still hold the selected time, so the
  // visible wheel and the confirmed value disagree. Read through the refs so
  // the timer always uses the latest selection.
  useEffect(() => {
    if (mode === 'date') return;
    const timer = setTimeout(() => {
      hourOffsetRef.current = hourRef.current * ITEM_HEIGHT;
      minuteOffsetRef.current = minuteRef.current * ITEM_HEIGHT;
      hourScrollRef.current?.scrollTo({ y: hourRef.current * ITEM_HEIGHT, animated: false });
      minuteScrollRef.current?.scrollTo({ y: minuteRef.current * ITEM_HEIGHT, animated: false });
    }, 50);
    return () => clearTimeout(timer);
  }, [mode, isWide]);

  function clearSettleTimer() {
    if (settleTimer.current !== null) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
  }

  function beginWheelDrag() {
    clearSettleTimer();
    wheelsSettledRef.current = false;
  }

  function markWheelsSettled() {
    wheelsSettledRef.current = true;
    if (pendingConfirmRef.current) {
      pendingConfirmRef.current = false;
      finishRef.current();
    }
  }

  // Android is the platform that aborts under a mid-gesture re-render, so
  // there the value commits only when the gesture stops. iOS/web keep the
  // live sliver (their momentum/scroll events behave differently anyway).
  const commitLive = Platform.OS !== 'android';

  function commitWheel(kind: 'hour' | 'minute') {
    const offset = kind === 'hour' ? hourOffsetRef.current : minuteOffsetRef.current;
    const max = kind === 'hour' ? 23 : 59;
    const value = Math.min(max, Math.max(0, Math.round(offset / ITEM_HEIGHT)));
    const current = kind === 'hour' ? hourRef.current : minuteRef.current;
    if (value === current) return;
    setTimeTouched(true);
    if (kind === 'hour') setHour(value);
    else setMinute(value);
  }

  function endWheelDrag(kind: 'hour' | 'minute') {
    // Commit once the finger is up; a fling may still follow and its
    // onMomentumScrollEnd commits the final value again.
    commitWheel(kind);
    // No momentum -> settle on the fallback timer. onMomentumScrollBegin
    // cancels it when a fling actually starts.
    clearSettleTimer();
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      markWheelsSettled();
    }, 300);
  }

  function endWheelMomentum(kind: 'hour' | 'minute') {
    clearSettleTimer();
    commitWheel(kind);
    markWheelsSettled();
  }

  useEffect(() => {
    return () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    };
  }, []);

  const quickPresets = getQuickDatePresets(now);
  const selectedDateKey = `${selectedYear}-${pad(selectedMonth)}-${pad(selectedDay)}`;
  const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  function pickYear(y: number) {
    setSelectedYear(y);
    setViewYear(y);
  }

  function pickMonth(m: number) {
    setSelectedMonth(m);
    setViewMonth(m);
  }

  function applyDate(target: Date) {
    setSelectedYear(target.getFullYear());
    setSelectedMonth(target.getMonth() + 1);
    setSelectedDay(target.getDate());
    setViewYear(target.getFullYear());
    setViewMonth(target.getMonth() + 1);
  }

  function prevMonth() {
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  // Every explicit selection jumps its wheel INSTANTLY (`animated: false`).
  // A smooth scroll emits `onScroll` events with the OLD offset while it
  // travels, and those events write their intermediate value back into
  // `hour`/`minute` — on web the animation can start late, so a quick
  // 确定 right after a preset tap silently saved the pre-click time.
  // An instant jump lands on the chosen offset before any stale event.
  function selectHour(h: number) {
    setTimeTouched(true);
    setHour(h);
    hourOffsetRef.current = h * ITEM_HEIGHT;
    hourScrollRef.current?.scrollTo({ y: h * ITEM_HEIGHT, animated: false });
  }

  function selectMinute(m: number) {
    setTimeTouched(true);
    setMinute(m);
    minuteOffsetRef.current = m * ITEM_HEIGHT;
    minuteScrollRef.current?.scrollTo({ y: m * ITEM_HEIGHT, animated: false });
  }

  function toggleAmPm(targetPeriod: 'AM' | 'PM') {
    setTimeTouched(true);
    if (targetPeriod === 'AM' && hour >= 12) {
      const newH = hour - 12;
      setHour(newH);
      hourOffsetRef.current = newH * ITEM_HEIGHT;
      hourScrollRef.current?.scrollTo({ y: newH * ITEM_HEIGHT, animated: false });
    } else if (targetPeriod === 'PM' && hour < 12) {
      const newH = hour + 12;
      setHour(newH);
      hourOffsetRef.current = newH * ITEM_HEIGHT;
      hourScrollRef.current?.scrollTo({ y: newH * ITEM_HEIGHT, animated: false });
    }
  }

  const carriesTime = timeTouched || DATETIME_LOCAL.test(value);

  function finishConfirm() {
    if (mode === 'datetime') {
      const date = `${selectedYear}-${pad(selectedMonth)}-${pad(selectedDay)}`;
      // Issue #105: only a time the user actually TOUCHED feeds the
      // usage-ranked presets — confirming a day on a stored deadline must
      // not upvote the clock time it happened to carry.
      if (timeTouched) recordTimeUse(hour, minute);
      onConfirm(carriesTime ? `${date}T${pad(hour)}:${pad(minute)}` : date);
    } else if (mode === 'date') {
      onConfirm(`${selectedYear}-${pad(selectedMonth)}-${pad(selectedDay)}`);
    } else {
      recordTimeUse(hour, minute);
      onConfirm(`${pad(hour)}:${pad(minute)}`);
    }
    onClose();
  }

  // Read the newest finishConfirm from the wheel settle handlers above.
  const finishRef = useRef<() => void>(() => undefined);
  finishRef.current = finishConfirm;

  function confirm() {
    // #109: never unmount the dialog while a wheel is still flinging.
    if (!wheelsSettledRef.current) {
      pendingConfirmRef.current = true;
      return;
    }
    finishConfirm();
  }

  const calendarCells = buildCalendarCells(viewYear, viewMonth);

  // 12-hour display calculations
  const display12Hour = hour % 12 || 12;
  const isPM = hour >= 12;

  // Header summary (issue #110): the old status banner collapses into this
  // one line, so the dialog does not spend a card on repeating itself.
  const weekday = WEEKDAY_LABELS[new Date(selectedYear, selectedMonth - 1, selectedDay).getDay()];
  const dateSummary = `${selectedMonth}月${selectedDay}日 周${weekday}`;
  const timeSummary = is12Hour
    ? `${pad(display12Hour)}:${pad(minute)}`
    : `${pad(hour)}:${pad(minute)}`;
  const summary =
    mode === 'date'
      ? dateSummary
      : mode === 'time'
        ? timeSummary
        : carriesTime
          ? `${dateSummary} ${timeSummary}`
          : `${dateSummary} · 只记日期`;

  const closeButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="关闭"
      onPress={onClose}
      className="h-8 w-8 items-center justify-center rounded-full bg-surface-container/70 active:bg-surface-container dark:bg-surface-container-dark/70"
    >
      <Ionicons name="close" size={16} color={isDark ? colors.mutedDark : colors.muted} />
    </Pressable>
  );

  const dateSection = mode !== 'time' ? (
    <View className="gap-2">
      {/* Quick date chips */}
      <View className="flex-row gap-1.5">
        {quickPresets.map((preset) => {
          const isSelected = selectedDateKey === preset.key;
          return (
            <Pressable
              key={preset.id}
              accessibilityRole="button"
              accessibilityLabel={`快捷 ${preset.label}`}
              accessibilityState={{ selected: isSelected }}
              onPress={() => applyDate(preset.date)}
              className={cn(
                'flex-1 items-center justify-center rounded-xl border px-1 py-1',
                isSelected
                  ? 'border-accent bg-accent/10 dark:border-accent-dark dark:bg-accent-dark/15'
                  : 'border-border/70 bg-transparent active:bg-surface-container/60 dark:border-border-dark/70 dark:active:bg-surface-container-dark/60',
              )}
            >
              <Text
                className={cn(
                  'font-sans text-xs',
                  isSelected
                    ? 'font-bold text-accent dark:text-accent-dark'
                    : 'font-semibold text-ink dark:text-ink-dark',
                )}
              >
                {preset.label}
              </Text>
              <Text
                className={cn(
                  'font-sans text-[10px]',
                  isSelected
                    ? 'font-medium text-accent/80 dark:text-accent-dark/80'
                    : 'text-muted dark:text-muted-dark',
                )}
              >
                {preset.sublabel}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Compact calendar — no card wrapper, just a hairline under the
          month strip (issue #110: the dialog itself is the only card). */}
      <View testID="datetime-picker-calendar">
        <View className="flex-row items-center justify-between border-b border-border/40 pb-1 dark:border-border-dark/40">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="上个月"
            onPress={prevMonth}
            hitSlop={4}
            className="h-7 w-7 items-center justify-center rounded-lg active:bg-surface-container/60 dark:active:bg-surface-container-dark/60"
          >
            <Ionicons name="chevron-back" size={15} color={isDark ? colors.mutedDark : colors.muted} />
          </Pressable>

          <Text className="font-sans text-sm font-bold text-ink dark:text-ink-dark">
            {viewYear}年 {pad(viewMonth)}月
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="下个月"
            onPress={nextMonth}
            hitSlop={4}
            className="h-7 w-7 items-center justify-center rounded-lg active:bg-surface-container/60 dark:active:bg-surface-container-dark/60"
          >
            <Ionicons name="chevron-forward" size={15} color={isDark ? colors.mutedDark : colors.muted} />
          </Pressable>
        </View>

        <View className="mt-1 flex-row">
          {WEEKDAY_NAMES.map((col) => (
            <View key={col.label} className="flex-1 items-center py-0.5">
              <Text
                className={cn(
                  'font-sans text-[11px] font-bold',
                  col.isWeekend
                    ? 'text-accent/70 dark:text-accent-dark/70'
                    : 'text-muted dark:text-muted-dark',
                )}
              >
                {col.label}
              </Text>
            </View>
          ))}
        </View>

        <View className="flex-row flex-wrap">
          {calendarCells.map((cell) => {
            const isCurrentMonth = cell.type === 'current';
            const isSelected = cell.key === selectedDateKey;
            const isToday = cell.key === todayKey;

            return (
              <View key={cell.key} style={{ width: '14.285%' }} className="items-center py-0.5">
                <Pressable
                  accessibilityRole="button"
                  // Adjacent-month days repeat day numbers (the grid fills whole
                  // weeks), so their label carries the month — two buttons with the
                  // same accessible name are indistinguishable.
                  accessibilityLabel={
                    isCurrentMonth ? `日 ${cell.day}` : `${cell.month}月${cell.day}日`
                  }
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => {
                    setSelectedYear(cell.year);
                    setSelectedMonth(cell.month);
                    setSelectedDay(cell.day);
                    if (!isCurrentMonth) {
                      setViewYear(cell.year);
                      setViewMonth(cell.month);
                    }
                  }}
                  hitSlop={2}
                  className={cn(
                    'h-7 w-7 items-center justify-center rounded-lg',
                    isSelected
                      ? 'bg-accent dark:bg-accent-dark'
                      : isToday
                        ? 'border border-accent/80 dark:border-accent-dark/80'
                        : 'active:bg-surface-container dark:active:bg-surface-container-dark',
                  )}
                >
                  <Text
                    className={cn(
                      'font-sans text-xs',
                      isSelected
                        ? 'font-black text-on-accent dark:text-on-accent-dark'
                        : isCurrentMonth
                          ? isToday
                            ? 'font-black text-accent dark:text-accent-dark'
                            : 'font-semibold text-ink dark:text-ink-dark'
                          : 'text-muted/30 dark:text-muted-dark/30',
                    )}
                  >
                    {cell.day}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  ) : null;

  const timeSection = mode !== 'date' ? (
    <View className="gap-2">
      {/* Section label + compact format switches (issue #110: 24h/12h and
          AM/PM live on the label row instead of a separate header block). */}
      <View className="flex-row items-center justify-between">
        <Text className="font-sans text-xs font-bold text-muted dark:text-muted-dark">时间</Text>
        <View className="flex-row items-center gap-1.5">
          {is12Hour ? (
            <View className="flex-row items-center rounded-lg border border-border/70 p-0.5 dark:border-border-dark/70">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="切换到上午"
                accessibilityState={{ selected: !isPM }}
                onPress={() => toggleAmPm('AM')}
                className={cn(
                  'rounded-md px-1.5 py-0.5',
                  !isPM ? 'bg-accent dark:bg-accent-dark' : 'bg-transparent',
                )}
              >
                <Text
                  className={cn(
                    'font-sans text-[10px] font-bold',
                    !isPM ? 'text-on-accent' : 'text-muted dark:text-muted-dark',
                  )}
                >
                  上午
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="切换到下午"
                accessibilityState={{ selected: isPM }}
                onPress={() => toggleAmPm('PM')}
                className={cn(
                  'rounded-md px-1.5 py-0.5',
                  isPM ? 'bg-accent dark:bg-accent-dark' : 'bg-transparent',
                )}
              >
                <Text
                  className={cn(
                    'font-sans text-[10px] font-bold',
                    isPM ? 'text-on-accent' : 'text-muted dark:text-muted-dark',
                  )}
                >
                  下午
                </Text>
              </Pressable>
            </View>
          ) : null}

          <View className="flex-row items-center rounded-lg border border-border/70 p-0.5 dark:border-border-dark/70">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="24小时制"
              accessibilityState={{ selected: !is12Hour }}
              onPress={() => setIs12Hour(false)}
              className={cn(
                'rounded-md px-2 py-0.5',
                !is12Hour ? 'bg-accent dark:bg-accent-dark' : 'bg-transparent',
              )}
            >
              <Text
                className={cn(
                  'font-sans text-[10px] font-bold',
                  !is12Hour ? 'text-on-accent' : 'text-muted dark:text-muted-dark',
                )}
              >
                24h
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="12小时制"
              accessibilityState={{ selected: is12Hour }}
              onPress={() => setIs12Hour(true)}
              className={cn(
                'rounded-md px-2 py-0.5',
                is12Hour ? 'bg-accent dark:bg-accent-dark' : 'bg-transparent',
              )}
            >
              <Text
                className={cn(
                  'font-sans text-[10px] font-bold',
                  is12Hour ? 'text-on-accent' : 'text-muted dark:text-muted-dark',
                )}
              >
                12h
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Tactile Time Wheel Picker with Selection Lens & Fade Masks */}
      <View
        style={{
          height: WHEEL_HEIGHT,
          ...(Platform.OS === 'web'
            ? {
                WebkitMaskImage:
                  'linear-gradient(to bottom, transparent 0%, black 24%, black 76%, transparent 100%)',
                maskImage:
                  'linear-gradient(to bottom, transparent 0%, black 24%, black 76%, transparent 100%)',
              }
            : {}),
        }}
        className="relative overflow-hidden rounded-2xl border border-border/80 bg-surface-container/35 dark:border-border-dark/80 dark:bg-surface-container-dark/35"
      >
        {/* Selection Lens (highlight centered row) */}
        <View
          pointerEvents="none"
          style={{ top: WHEEL_PADDING, height: ITEM_HEIGHT }}
          className="absolute left-2.5 right-2.5 rounded-xl border border-accent/35 bg-accent/12 shadow-sm dark:border-accent-dark/40 dark:bg-accent-dark/20"
        />

        {/* Fallback gradient overlay for non-web platforms */}
        {Platform.OS !== 'web' ? (
          <>
            <View
              pointerEvents="none"
              style={{ position: 'absolute', top: 0, left: 0, right: 0, height: WHEEL_FADE, zIndex: 10 }}
              className="bg-surface/60 dark:bg-surface-dark/60"
            />
            <View
              pointerEvents="none"
              style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: WHEEL_FADE, zIndex: 10 }}
              className="bg-surface/60 dark:bg-surface-dark/60"
            />
          </>
        ) : null}

        <View style={{ height: WHEEL_HEIGHT }} className="flex-row items-stretch">
          {/* Hour Scroll Column */}
          <ScrollView
            ref={hourScrollRef}
            testID="hour-wheel"
            className="h-full flex-1"
            style={{ height: WHEEL_HEIGHT }}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
            snapToInterval={ITEM_HEIGHT}
            decelerationRate="fast"
            contentContainerStyle={{ paddingTop: WHEEL_PADDING, paddingBottom: WHEEL_PADDING }}
            onScrollBeginDrag={beginWheelDrag}
            onScrollEndDrag={() => endWheelDrag('hour')}
            onMomentumScrollBegin={clearSettleTimer}
            onMomentumScrollEnd={() => endWheelMomentum('hour')}
            onScroll={(e) => {
              // On Android: record only — a setState here re-renders the
              // ScrollView mid-gesture, which aborts the process (#109).
              hourOffsetRef.current = e.nativeEvent.contentOffset.y;
              if (commitLive) commitWheel('hour');
            }}
          >
            {HOURS.map((h) => {
              const active = hour === h;
              const labelNumber = is12Hour ? h % 12 || 12 : h;
              return (
                <Pressable
                  key={h}
                  accessibilityRole="button"
                  accessibilityLabel={`小时 ${pad(h)}`}
                  accessibilityState={{ selected: active }}
                  onPress={() => selectHour(h)}
                  style={{ height: ITEM_HEIGHT }}
                  className="items-center justify-center"
                >
                  <Text
                    className={cn(
                      'font-sans transition-all',
                      active
                        ? 'text-2xl font-black text-accent dark:text-accent-dark scale-105'
                        : 'text-sm font-semibold text-ink/35 dark:text-ink-dark/35',
                    )}
                  >
                    {pad(labelNumber)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Centered Colon Separator */}
          <View className="w-8 items-center justify-center">
            <Text className="font-sans text-2xl font-black text-accent/50 dark:text-accent-dark/50">
              :
            </Text>
          </View>

          {/* Minute Scroll Column */}
          <ScrollView
            ref={minuteScrollRef}
            testID="minute-wheel"
            className="h-full flex-1"
            style={{ height: WHEEL_HEIGHT }}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
            snapToInterval={ITEM_HEIGHT}
            decelerationRate="fast"
            contentContainerStyle={{ paddingTop: WHEEL_PADDING, paddingBottom: WHEEL_PADDING }}
            onScrollBeginDrag={beginWheelDrag}
            onScrollEndDrag={() => endWheelDrag('minute')}
            onMomentumScrollBegin={clearSettleTimer}
            onMomentumScrollEnd={() => endWheelMomentum('minute')}
            onScroll={(e) => {
              minuteOffsetRef.current = e.nativeEvent.contentOffset.y;
              if (commitLive) commitWheel('minute');
            }}
          >
            {MINUTES.map((m) => {
              const active = minute === m;
              return (
                <Pressable
                  key={m}
                  accessibilityRole="button"
                  accessibilityLabel={`分钟 ${pad(m)}`}
                  accessibilityState={{ selected: active }}
                  onPress={() => selectMinute(m)}
                  style={{ height: ITEM_HEIGHT }}
                  className="items-center justify-center"
                >
                  <Text
                    className={cn(
                      'font-sans transition-all',
                      active
                        ? 'text-2xl font-black text-accent dark:text-accent-dark scale-105'
                        : 'text-sm font-semibold text-ink/35 dark:text-ink-dark/35',
                    )}
                  >
                    {pad(m)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>

      {/* Quick time presets (issue #105) sit AFTER the wheels so the growing
          chip block cannot push the selected wheel row out of the modal's
          clipped viewport. Usage-ranked first, defaults keep
          morning/afternoon/evening coverage. Chips WRAP instead of
          horizontal-scrolling — otherwise the afternoon/evening times sit
          off-screen and the row reads as "morning only". The old section
          heading is gone (#109): it cost a row, and the chips are readable
          on their own; the height is what lets the outer scroll stay off. */}
      <View>
        <View className="flex-row flex-wrap gap-1.5">
          {quickTimePresets.map((p) => {
            const isPresetActive = hour === p.h && minute === p.m;
            return (
              <Pressable
                key={p.label}
                accessibilityRole="button"
                accessibilityLabel={`时段 ${p.label}`}
                onPress={() => {
                  setTimeTouched(true);
                  selectHour(p.h);
                  selectMinute(p.m);
                }}
                className={cn(
                  'flex-row items-center gap-1.5 rounded-xl border px-2.5 py-1.5',
                  isPresetActive
                    ? 'border-accent bg-accent dark:border-accent-dark dark:bg-accent-dark'
                    : 'border-border/60 bg-surface-container/60 active:bg-surface-container dark:border-border-dark/60 dark:bg-surface-container-dark/60',
                )}
              >
                <Text
                  className={cn(
                    'font-sans text-xs',
                    isPresetActive
                      ? 'font-bold text-on-accent dark:text-on-accent-dark'
                      : 'font-medium text-ink/80 dark:text-ink-dark/80',
                  )}
                >
                  {p.label}
                </Text>
                <Text
                  className={cn(
                    'font-sans text-[10px]',
                    isPresetActive
                      ? 'text-on-accent/80'
                      : 'text-muted dark:text-muted-dark',
                  )}
                >
                  {p.period}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  ) : null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View
        className={cn(
          'flex-1 items-center justify-center bg-black/60',
          isCompact ? 'px-2 py-3' : 'px-3 py-6',
        )}
      >
        {/* Backdrop */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭选择器"
          className="absolute inset-0"
          onPress={onClose}
        />

        {/* Modal Window Container: the dialog is the ONLY card (issue #110) */}
        <View
          testID="datetime-picker-dialog"
          className={cn(
            'relative z-10 w-full flex-col rounded-3xl border border-border/80 bg-surface shadow-2xl dark:border-border-dark dark:bg-surface-dark',
            isWide
              ? mode === 'datetime'
                ? 'max-w-4xl'
                : 'max-w-2xl'
              : 'max-w-md',
            isCompact ? 'p-3.5 max-h-[94vh]' : 'p-5 max-h-[92vh]',
          )}
        >
          {/* Top Bar (Fixed Header): title + one-line current-selection summary */}
          <View className="mb-2 flex-shrink-0 flex-row items-start justify-between">
            <View className="min-w-0 flex-1 pr-2">
              <Text
                numberOfLines={1}
                className="font-sans text-sm font-bold text-ink dark:text-ink-dark"
              >
                {title}
              </Text>
              <Text
                testID="datetime-picker-summary"
                accessibilityLabel={mode === 'time' ? '当前选中时间' : '当前选择'}
                numberOfLines={1}
                className="mt-0.5 font-sans text-xl font-extrabold tracking-tight text-accent dark:text-accent-dark"
              >
                {summary}
              </Text>
            </View>

            {closeButton}
          </View>

          {/* Accessibility & test helper selectors for year/month */}
          <View style={{ height: 0, width: 0, overflow: 'hidden', opacity: 0 }}>
            {Array.from({ length: 8 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
              <Pressable
                key={y}
                accessibilityRole="button"
                accessibilityLabel={`年 ${y}`}
                onPress={() => pickYear(y)}
              />
            ))}
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <Pressable
                key={m}
                accessibilityRole="button"
                accessibilityLabel={`月 ${m}`}
                onPress={() => pickMonth(m)}
              />
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="日 明天"
              onPress={() => {
                const tomorrow = new Date(now);
                tomorrow.setDate(tomorrow.getDate() + 1);
                applyDate(tomorrow);
              }}
            />
          </View>

          {/* Scrollable body: expands and scrolls inside the modal without
              flex-basis collapse (Issue 50). */}
          <ScrollView
            className="shrink"
            style={{ flexGrow: 0, flexShrink: 1 }}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
            scrollEnabled={bodyScrollable}
            onLayout={(event) => {
              bodyLayoutHeight.current = event.nativeEvent.layout.height;
              updateBodyScrollable();
            }}
            onContentSizeChange={(_width, height) => {
              bodyContentHeight.current = height;
              updateBodyScrollable();
            }}
            contentContainerStyle={{ paddingBottom: 2 }}
          >
            {mode === 'datetime' ? (
              isWide ? (
                <View
                  testID="datetime-picker-two-column"
                  className="flex-row items-start gap-5"
                >
                  <View className="min-w-0 flex-1">{dateSection}</View>
                  <View className="min-w-0 flex-1">{timeSection}</View>
                </View>
              ) : (
                <View className="gap-2">
                  {timeSection}
                  {dateSection}
                </View>
              )
            ) : (
              <View className={isWide ? 'mx-auto w-full max-w-xl' : ''}>
                {mode === 'date' ? dateSection : timeSection}
              </View>
            )}
          </ScrollView>

          {/* Fixed Footer Buttons: always docked at the bottom */}
          <View className="mt-3 flex-shrink-0 flex-row gap-2.5 border-t border-border/40 pt-2.5 dark:border-border-dark/40">
            <View className="flex-1">
              <Button label="取消" variant="secondary" onPress={onClose} />
            </View>
            <View className="flex-1">
              <Button label="确定" onPress={confirm} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
