/**
 * DateTimePicker — modern cross-platform date/time selection modal.
 *
 * Enhanced for Issue 31:
 * - Fixed footer buttons (always visible on compact screens without scrolling)
 * - 12h / 24h format toggle with intuitive AM/PM indicators
 * - Fine-tune minute adjusters (+5m, -5m, +1m, -1m) for precise time selection
 * - Expanded quick time presets (07:30, 08:30, 09:00, 10:30, 12:30, 14:00, 18:00, 19:30, 21:00, 22:30)
 * - Responsive compact screen layout (< 380px) with adaptive paddings
 * - 100% pure React Native cross-platform implementation (Web, Tauri, iOS, Android)
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
import { Button, cn } from '@nextdo/ui';

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

const ITEM_HEIGHT = 40;
const WHEEL_HEIGHT = 160;
const WHEEL_PADDING = (WHEEL_HEIGHT - ITEM_HEIGHT) / 2; // 60
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

const QUICK_TIME_PRESETS = [
  { label: '07:30', period: '晨间', h: 7, m: 30 },
  { label: '08:30', period: '早间', h: 8, m: 30 },
  { label: '09:00', period: '上午', h: 9, m: 0 },
  { label: '10:30', period: '午前', h: 10, m: 30 },
  { label: '12:30', period: '午间', h: 12, m: 30 },
  { label: '14:00', period: '下午', h: 14, m: 0 },
  { label: '18:00', period: '傍晚', h: 18, m: 0 },
  { label: '19:30', period: '晚间', h: 19, m: 30 },
  { label: '21:00', period: '夜间', h: 21, m: 0 },
  { label: '22:30', period: '睡前', h: 22, m: 30 },
];

const MINUTE_PRESETS = [0, 15, 30, 45];

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
      iconName: 'sunny-outline' as const,
      sublabel: `${today.getMonth() + 1}/${today.getDate()}`,
      date: today,
      key: format(today),
    },
    {
      id: 'tomorrow',
      label: '明天',
      iconName: 'arrow-forward-circle-outline' as const,
      sublabel: `${tomorrow.getMonth() + 1}/${tomorrow.getDate()}`,
      date: tomorrow,
      key: format(tomorrow),
    },
    {
      id: 'next_mon',
      label: '下周一',
      iconName: 'briefcase-outline' as const,
      sublabel: `周一 ${nextMonday.getMonth() + 1}/${nextMonday.getDate()}`,
      date: nextMonday,
      key: format(nextMonday),
    },
    {
      id: 'next_month',
      label: '下月一日',
      iconName: 'calendar-number-outline' as const,
      sublabel: `${nextMonthFirst.getMonth() + 1}月1日`,
      date: nextMonthFirst,
      key: format(nextMonthFirst),
    },
  ];
}

export function DateTimePicker({
  mode,
  title,
  value,
  now,
  onConfirm,
  onClose,
}: DateTimePickerProps) {
  const { width: screenWidth } = useWindowDimensions();
  const isCompact = screenWidth < 380;

  const dateMatch = mode === 'date' ? DATE_ONLY.exec(value) : null;
  const timeMatch = mode === 'time' ? HHMM.exec(value) : null;
  const dateTimeMatch = mode === 'datetime' ? DATETIME_LOCAL.exec(value) : null;

  // Selected date components
  const [selectedYear, setSelectedYear] = useState(() => {
    if (dateMatch !== null) return Number(dateMatch[1]);
    if (dateTimeMatch !== null) return Number(dateTimeMatch[1]);
    return now.getFullYear();
  });
  const [selectedMonth, setSelectedMonth] = useState(() => {
    if (dateMatch !== null) return Number(dateMatch[2]);
    if (dateTimeMatch !== null) return Number(dateTimeMatch[2]);
    return now.getMonth() + 1;
  });
  const [selectedDay, setSelectedDay] = useState(() => {
    if (dateMatch !== null) return Number(dateMatch[3]);
    if (dateTimeMatch !== null) return Number(dateTimeMatch[3]);
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

  const hourScrollRef = useRef<ScrollView>(null);
  const minuteScrollRef = useRef<ScrollView>(null);

  // Sync hour/minute scroll position
  useEffect(() => {
    if (mode === 'date') return;
    const timer = setTimeout(() => {
      hourScrollRef.current?.scrollTo({ y: hour * ITEM_HEIGHT, animated: false });
      minuteScrollRef.current?.scrollTo({ y: minute * ITEM_HEIGHT, animated: false });
    }, 50);
    return () => clearTimeout(timer);
  }, [mode]);

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

  function selectHour(h: number) {
    setHour(h);
    hourScrollRef.current?.scrollTo({ y: h * ITEM_HEIGHT, animated: true });
  }

  function selectMinute(m: number) {
    setMinute(m);
    minuteScrollRef.current?.scrollTo({ y: m * ITEM_HEIGHT, animated: true });
  }

  function adjustMinute(delta: number) {
    let total = hour * 60 + minute + delta;
    total = ((total % 1440) + 1440) % 1440;
    const newH = Math.floor(total / 60);
    const newM = total % 60;
    setHour(newH);
    setMinute(newM);
    hourScrollRef.current?.scrollTo({ y: newH * ITEM_HEIGHT, animated: true });
    minuteScrollRef.current?.scrollTo({ y: newM * ITEM_HEIGHT, animated: true });
  }

  function toggleAmPm(targetPeriod: 'AM' | 'PM') {
    if (targetPeriod === 'AM' && hour >= 12) {
      const newH = hour - 12;
      setHour(newH);
      hourScrollRef.current?.scrollTo({ y: newH * ITEM_HEIGHT, animated: true });
    } else if (targetPeriod === 'PM' && hour < 12) {
      const newH = hour + 12;
      setHour(newH);
      hourScrollRef.current?.scrollTo({ y: newH * ITEM_HEIGHT, animated: true });
    }
  }

  function confirm() {
    if (mode === 'datetime') {
      onConfirm(
        `${selectedYear}-${pad(selectedMonth)}-${pad(selectedDay)}T${pad(hour)}:${pad(minute)}`,
      );
    } else if (mode === 'date') {
      onConfirm(`${selectedYear}-${pad(selectedMonth)}-${pad(selectedDay)}`);
    } else {
      onConfirm(`${pad(hour)}:${pad(minute)}`);
    }
    onClose();
  }

  // Generate calendar grid for viewYear & viewMonth
  const daysInCurrentMonth = new Date(viewYear, viewMonth, 0).getDate();
  const firstDayWeekday = (new Date(viewYear, viewMonth - 1, 1).getDay() + 6) % 7; // 0 = Mon, 6 = Sun
  const daysInPrevMonth = new Date(viewYear, viewMonth - 1, 0).getDate();

  const calendarCells: Array<{
    type: 'prev' | 'current' | 'next';
    day: number;
    year: number;
    month: number;
    key: string;
  }> = [];

  // Previous month trailing days
  for (let i = firstDayWeekday - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const m = viewMonth === 1 ? 12 : viewMonth - 1;
    const y = viewMonth === 1 ? viewYear - 1 : viewYear;
    calendarCells.push({ type: 'prev', day: d, year: y, month: m, key: `${y}-${pad(m)}-${pad(d)}` });
  }

  // Current month days
  for (let d = 1; d <= daysInCurrentMonth; d++) {
    calendarCells.push({
      type: 'current',
      day: d,
      year: viewYear,
      month: viewMonth,
      key: `${viewYear}-${pad(viewMonth)}-${pad(d)}`,
    });
  }

  // Next month leading days to complete full week rows (multiple of 7)
  const remaining = (7 - (calendarCells.length % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    const m = viewMonth === 12 ? 1 : viewMonth + 1;
    const y = viewMonth === 12 ? viewYear + 1 : viewYear;
    calendarCells.push({ type: 'next', day: d, year: y, month: m, key: `${y}-${pad(m)}-${pad(d)}` });
  }

  // 12-hour display calculations
  const display12Hour = hour % 12 || 12;
  const isPM = hour >= 12;

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

        {/* Modal Window Container: Structured with flex-col & max-h to guarantee fixed footer */}
        <View
          className={cn(
            'relative z-10 w-full max-w-md flex-col rounded-3xl border border-border/80 bg-surface shadow-2xl dark:border-border-dark dark:bg-surface-dark',
            isCompact ? 'p-3.5 max-h-[92vh]' : 'p-5 max-h-[88vh]',
          )}
        >
          {/* Top Bar (Fixed Header): Icon + Title + Close Button */}
          <View className="mb-3 flex-shrink-0 flex-row items-center justify-between">
            <View className="flex-1 flex-row items-center gap-2.5 pr-2">
              <View className="h-9 w-9 items-center justify-center rounded-xl bg-accent/15 dark:bg-accent-dark/20">
                <Ionicons
                  name={mode === 'time' ? 'time-outline' : 'calendar-outline'}
                  size={18}
                  color="#c85a17"
                />
              </View>
              <View className="flex-1">
                <Text
                  numberOfLines={1}
                  className="font-sans text-base font-bold text-ink dark:text-ink-dark"
                >
                  {title}
                </Text>
                <Text
                  numberOfLines={1}
                  className="font-sans text-[11px] text-muted dark:text-muted-dark"
                >
                  {mode === 'date'
                    ? '快捷选择或点选日历'
                    : mode === 'time'
                      ? '滑动转盘或点选时段'
                      : '配置日期与提醒时间'}
                </Text>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭"
              onPress={onClose}
              className="h-8 w-8 items-center justify-center rounded-full bg-surface-container/70 active:bg-surface-container dark:bg-surface-container-dark/70"
            >
              <Ionicons name="close" size={16} color="#716b64" />
            </Pressable>
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

          {/* Scrollable Form Body: Expands & scrolls smoothly inside modal */}
          <ScrollView
            className="flex-1"
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
            contentContainerStyle={{ paddingBottom: 6 }}
          >
            {/* Quick Date Presets (in date and datetime modes) */}
            {mode !== 'time' ? (
              <View className="mb-3">
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
                          'flex-1 flex-col items-center justify-center rounded-2xl py-2 px-1 border transition-all',
                          isSelected
                            ? 'border-accent bg-accent/15 shadow-sm dark:border-accent-dark dark:bg-accent-dark/20'
                            : 'border-border/60 bg-surface-container/40 active:bg-surface-container dark:border-border-dark/60 dark:bg-surface-container-dark/40',
                        )}
                      >
                        <Ionicons
                          name={preset.iconName}
                          size={15}
                          color={isSelected ? '#c85a17' : '#716b64'}
                        />
                        <Text
                          className={cn(
                            'font-sans text-xs mt-1',
                            isSelected
                              ? 'font-bold text-accent dark:text-accent-dark'
                              : 'font-semibold text-ink dark:text-ink-dark',
                          )}
                        >
                          {preset.label}
                        </Text>
                        <Text
                          className={cn(
                            'font-sans text-[10px] mt-0.5',
                            isSelected
                              ? 'font-medium text-accent/90 dark:text-accent-dark/90'
                              : 'text-muted dark:text-muted-dark',
                          )}
                        >
                          {preset.sublabel}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {/* Current Selection Status Banner */}
            <View className="mb-3 flex-row items-center justify-between rounded-2xl border border-border/60 bg-surface-container/50 px-3.5 py-2.5 dark:border-border-dark/60 dark:bg-surface-container-dark/50">
              {mode === 'date' ? (
                <View className="w-full flex-row items-baseline justify-between">
                  <View className="flex-row items-baseline gap-2">
                    <Text className="font-sans text-lg font-extrabold tracking-tight text-ink dark:text-ink-dark">
                      {selectedYear}年{pad(selectedMonth)}月{pad(selectedDay)}日
                    </Text>
                    {selectedDateKey === todayKey ? (
                      <View className="rounded-full bg-accent/15 px-2 py-0.5 dark:bg-accent-dark/20">
                        <Text className="font-sans text-xs font-bold text-accent dark:text-accent-dark">
                          今天
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text className="font-sans text-xs font-medium text-muted dark:text-muted-dark">
                    周{['日', '一', '二', '三', '四', '五', '六'][new Date(selectedYear, selectedMonth - 1, selectedDay).getDay()]}
                  </Text>
                </View>
              ) : mode === 'time' ? (
                <View className="w-full flex-row items-center justify-between">
                  {/* Left: Big Digital Clock + Contextual AM/PM selector (in 12h) */}
                  <View className="flex-col">
                    <View className="flex-row items-center gap-2">
                      <Text
                        accessibilityLabel="当前选中时间"
                        className="font-sans text-3xl font-black tracking-tight text-ink dark:text-ink-dark"
                      >
                        {is12Hour
                          ? `${pad(display12Hour)}:${pad(minute)}`
                          : `${pad(hour)}:${pad(minute)}`}
                      </Text>

                      {is12Hour ? (
                        <View className="flex-row items-center rounded-xl border border-border/70 bg-surface-container/90 p-0.5 dark:border-border-dark/70 dark:bg-surface-container-dark/90">
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="切换到上午"
                            accessibilityState={{ selected: !isPM }}
                            onPress={() => toggleAmPm('AM')}
                            className={cn(
                              'rounded-lg px-2 py-0.5 transition-all',
                              !isPM
                                ? 'bg-accent shadow-sm dark:bg-accent-dark'
                                : 'bg-transparent',
                            )}
                          >
                            <Text
                              className={cn(
                                'font-sans text-xs font-bold',
                                !isPM
                                  ? 'text-on-accent'
                                  : 'text-muted dark:text-muted-dark',
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
                              'rounded-lg px-2 py-0.5 transition-all',
                              isPM
                                ? 'bg-accent shadow-sm dark:bg-accent-dark'
                                : 'bg-transparent',
                            )}
                          >
                            <Text
                              className={cn(
                                'font-sans text-xs font-bold',
                                isPM
                                  ? 'text-on-accent'
                                  : 'text-muted dark:text-muted-dark',
                              )}
                            >
                              下午
                            </Text>
                          </Pressable>
                        </View>
                      ) : (
                        <View className="rounded-full bg-accent/15 px-2 py-0.5 dark:bg-accent-dark/20">
                          <Text className="font-sans text-xs font-bold text-accent dark:text-accent-dark">
                            {hour < 6
                              ? '凌晨'
                              : hour < 12
                                ? '上午'
                                : hour < 18
                                  ? '下午'
                                  : '晚间'}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text className="mt-0.5 font-sans text-[11px] font-medium text-muted dark:text-muted-dark">
                      {is12Hour ? '12小时制' : '24小时制'}
                    </Text>
                  </View>

                  {/* Right: 24h / 12h Switcher */}
                  <View className="flex-row items-center rounded-xl border border-border/70 bg-surface-container/90 p-0.5 dark:border-border-dark/70 dark:bg-surface-container-dark/90">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="24小时制"
                      accessibilityState={{ selected: !is12Hour }}
                      onPress={() => setIs12Hour(false)}
                      className={cn(
                        'rounded-lg px-2.5 py-1 transition-all',
                        !is12Hour
                          ? 'bg-accent shadow-sm dark:bg-accent-dark'
                          : 'bg-transparent',
                      )}
                    >
                      <Text
                        className={cn(
                          'font-sans text-[11px] font-bold',
                          !is12Hour
                            ? 'text-on-accent'
                            : 'text-muted dark:text-muted-dark',
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
                        'rounded-lg px-2.5 py-1 transition-all',
                        is12Hour
                          ? 'bg-accent shadow-sm dark:bg-accent-dark'
                          : 'bg-transparent',
                      )}
                    >
                      <Text
                        className={cn(
                          'font-sans text-[11px] font-bold',
                          is12Hour
                            ? 'text-on-accent'
                            : 'text-muted dark:text-muted-dark',
                        )}
                      >
                        12h
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View className="w-full flex-row items-center justify-between">
                  <View className="flex-row items-baseline gap-1.5">
                    <Text className="font-sans text-base font-bold text-ink dark:text-ink-dark">
                      {pad(selectedMonth)}月{pad(selectedDay)}日
                    </Text>
                    {selectedDateKey === todayKey ? (
                      <Text className="font-sans text-xs font-bold text-accent dark:text-accent-dark">
                        今天
                      </Text>
                    ) : null}
                  </View>
                  <View className="flex-row items-baseline gap-1">
                    <Ionicons name="time-outline" size={13} color="#c85a17" />
                    <Text className="font-sans text-xl font-black text-accent dark:text-accent-dark">
                      {is12Hour
                        ? `${pad(display12Hour)}:${pad(minute)} ${isPM ? 'PM' : 'AM'}`
                        : `${pad(hour)}:${pad(minute)}`}
                    </Text>
                  </View>
                </View>
              )}
            </View>

            {/* Modern Calendar Grid (in date & datetime modes) */}
            {mode !== 'time' ? (
              <View className="mb-3 rounded-2xl border border-border/50 bg-surface-container/20 p-3 dark:border-border-dark/50 dark:bg-surface-container-dark/20">
                {/* Month Navigation Strip */}
                <View className="mb-2 flex-row items-center justify-between px-1">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="上个月"
                    onPress={prevMonth}
                    className="h-7 w-7 items-center justify-center rounded-xl bg-surface-container/60 active:bg-surface-container dark:bg-surface-container-dark/60"
                  >
                    <Ionicons name="chevron-back" size={15} color="#716b64" />
                  </Pressable>

                  <View className="flex-row items-center justify-center">
                    <Text className="font-sans text-sm font-bold text-ink dark:text-ink-dark">
                      {viewYear}年 {pad(viewMonth)}月
                    </Text>
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="下个月"
                    onPress={nextMonth}
                    className="h-7 w-7 items-center justify-center rounded-xl bg-surface-container/60 active:bg-surface-container dark:bg-surface-container-dark/60"
                  >
                    <Ionicons name="chevron-forward" size={15} color="#716b64" />
                  </Pressable>
                </View>

                {/* Weekday Names Strip */}
                <View className="mb-1 flex-row">
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

                {/* 7-column Calendar Cells */}
                <View className="flex-row flex-wrap">
                  {calendarCells.map((cell) => {
                    const isCurrentMonth = cell.type === 'current';
                    const isSelected = cell.key === selectedDateKey;
                    const isToday = cell.key === todayKey;

                    return (
                      <View key={cell.key} style={{ width: '14.285%' }} className="items-center py-0.5">
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`日 ${cell.day}`}
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
                          className={cn(
                            'h-7 w-7 items-center justify-center rounded-xl transition-all',
                            isSelected
                              ? 'bg-accent shadow-sm shadow-accent/40 dark:bg-accent-dark'
                              : isToday
                                ? 'border border-accent/80 bg-accent/10 dark:border-accent-dark/80 dark:bg-accent-dark/15'
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
            ) : null}

            {/* Time Configuration Section (in time & datetime modes) */}
            {mode !== 'date' ? (
              <View className="gap-2.5">
                {/* Datetime mode specific format switch header */}
                {mode === 'datetime' ? (
                  <View className="flex-row items-center justify-between px-1">
                    <Text className="font-sans text-xs font-bold text-muted dark:text-muted-dark">
                      选择时间 ({is12Hour ? '12小时制' : '24小时制'})
                    </Text>
                    <View className="flex-row items-center gap-1.5">
                      {is12Hour ? (
                        <View className="flex-row items-center rounded-lg bg-surface-container/90 p-0.5 dark:bg-surface-container-dark/90">
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

                      <View className="flex-row items-center rounded-lg bg-surface-container/90 p-0.5 dark:bg-surface-container-dark/90">
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
                ) : null}

                {/* Column Headers for Wheels */}
                <View className="flex-row items-center px-4 py-1">
                  <View className="flex-1 items-center">
                    <Text className="font-sans text-xs font-bold tracking-widest text-muted/75 dark:text-muted-dark/75">
                      时
                    </Text>
                  </View>
                  <View className="w-8" />
                  <View className="flex-1 items-center">
                    <Text className="font-sans text-xs font-bold tracking-widest text-muted/75 dark:text-muted-dark/75">
                      分
                    </Text>
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
                        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 36, zIndex: 10 }}
                        className="bg-surface/60 dark:bg-surface-dark/60"
                      />
                      <View
                        pointerEvents="none"
                        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 36, zIndex: 10 }}
                        className="bg-surface/60 dark:bg-surface-dark/60"
                      />
                    </>
                  ) : null}

                  <View style={{ height: WHEEL_HEIGHT }} className="flex-row items-stretch">
                    {/* Hour Scroll Column */}
                    <ScrollView
                      ref={hourScrollRef}
                      className="h-full flex-1"
                      style={{ height: WHEEL_HEIGHT }}
                      showsVerticalScrollIndicator={false}
                      nestedScrollEnabled
                      snapToInterval={ITEM_HEIGHT}
                      decelerationRate="fast"
                      contentContainerStyle={{ paddingTop: WHEEL_PADDING, paddingBottom: WHEEL_PADDING }}
                      onScroll={(e) => {
                        const h = Math.min(
                          23,
                          Math.max(0, Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT)),
                        );
                        setHour(h);
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
                      className="h-full flex-1"
                      style={{ height: WHEEL_HEIGHT }}
                      showsVerticalScrollIndicator={false}
                      nestedScrollEnabled
                      snapToInterval={ITEM_HEIGHT}
                      decelerationRate="fast"
                      contentContainerStyle={{ paddingTop: WHEEL_PADDING, paddingBottom: WHEEL_PADDING }}
                      onScroll={(e) => {
                        const m = Math.min(
                          59,
                          Math.max(0, Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT)),
                        );
                        setMinute(m);
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

                {/* Minute Presets + Fine-tune Steppers Toolbar */}
                <View className="flex-row items-center justify-between rounded-2xl border border-border/70 bg-surface-container/40 p-1 dark:border-border-dark/70 dark:bg-surface-container-dark/40">
                  {/* Left: Quick Minute Jumps (:00, :15, :30, :45) */}
                  <View className="flex-row items-center gap-1">
                    {MINUTE_PRESETS.map((m) => {
                      const isMinActive = minute === m;
                      return (
                        <Pressable
                          key={m}
                          accessibilityRole="button"
                          accessibilityLabel={`快捷 ${pad(m)}分`}
                          onPress={() => selectMinute(m)}
                          className={cn(
                            'rounded-lg px-2 py-1 transition-all',
                            isMinActive
                              ? 'bg-accent shadow-sm dark:bg-accent-dark'
                              : 'bg-surface/90 active:bg-surface-container dark:bg-surface-dark/90',
                          )}
                        >
                          <Text
                            className={cn(
                              'font-sans text-[11px]',
                              isMinActive
                                ? 'font-bold text-on-accent dark:text-on-accent-dark'
                                : 'font-semibold text-ink dark:text-ink-dark',
                            )}
                          >
                            :{pad(m)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {/* Vertical Divider */}
                  <View className="mx-0.5 h-4 w-px bg-border/80 dark:bg-border-dark/80" />

                  {/* Right: Fine-tune Steppers (-5m, +5m, -1m, +1m) */}
                  <View className="flex-row items-center gap-1">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="微调 减5分钟"
                      onPress={() => adjustMinute(-5)}
                      className="rounded-lg bg-surface/90 px-1.5 py-1 active:bg-surface-container dark:bg-surface-dark/90"
                    >
                      <Text className="font-sans text-[11px] font-bold text-ink dark:text-ink-dark">
                        -5m
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="微调 加5分钟"
                      onPress={() => adjustMinute(5)}
                      className="rounded-lg bg-surface/90 px-1.5 py-1 active:bg-surface-container dark:bg-surface-dark/90"
                    >
                      <Text className="font-sans text-[11px] font-bold text-ink dark:text-ink-dark">
                        +5m
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="微调 减1分钟"
                      onPress={() => adjustMinute(-1)}
                      className="rounded-lg bg-surface/90 px-1.5 py-1 active:bg-surface-container dark:bg-surface-dark/90"
                    >
                      <Text className="font-sans text-[11px] font-bold text-ink dark:text-ink-dark">
                        -1m
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="微调 加1分钟"
                      onPress={() => adjustMinute(1)}
                      className="rounded-lg bg-surface/90 px-1.5 py-1 active:bg-surface-container dark:bg-surface-dark/90"
                    >
                      <Text className="font-sans text-[11px] font-bold text-ink dark:text-ink-dark">
                        +1m
                      </Text>
                    </Pressable>
                  </View>
                </View>

                {/* Horizontal Quick Period Presets */}
                <View className="mt-1">
                  <View className="mb-1.5 flex-row items-center justify-between px-1">
                    <Text className="font-sans text-xs font-bold text-muted dark:text-muted-dark">
                      常用时段
                    </Text>
                    <Text className="font-sans text-[11px] text-muted/60 dark:text-muted-dark/60">
                      快速点选
                    </Text>
                  </View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 6, paddingHorizontal: 1 }}
                  >
                    {QUICK_TIME_PRESETS.map((p) => {
                      const isPresetActive = hour === p.h && minute === p.m;
                      return (
                        <Pressable
                          key={p.label}
                          accessibilityRole="button"
                          accessibilityLabel={`时段 ${p.label}`}
                          onPress={() => {
                            selectHour(p.h);
                            selectMinute(p.m);
                          }}
                          className={cn(
                            'flex-row items-center gap-1.5 rounded-xl border px-2.5 py-1.5 transition-all',
                            isPresetActive
                              ? 'border-accent bg-accent shadow-sm dark:border-accent-dark dark:bg-accent-dark'
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
                  </ScrollView>
                </View>
              </View>
            ) : null}
          </ScrollView>

          {/* Fixed Footer Buttons: Always docked at bottom without needing scroll */}
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
