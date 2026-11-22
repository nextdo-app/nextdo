/**
 * Focus-history aggregation (issue #96). All timestamps are built with local
 * Date constructors, so the expectations hold in any host timezone — the
 * whole point is device-local bucketing.
 */
import type { FocusHistoryRow } from '@nextdo/db';
import {
  buildFocusStats,
  focusDurationSec,
  type FocusHeatmapDay,
} from '@/lib/focus-stats';

function localIso(
  year: number,
  monthIndex: number,
  day: number,
  hour = 9,
  minute = 0,
): string {
  return new Date(year, monthIndex, day, hour, minute, 0, 0).toISOString();
}

function row(overrides: Partial<FocusHistoryRow> & { startedAt: string; endedAt: string }): FocusHistoryRow {
  return {
    id: overrides.id ?? overrides.startedAt,
    actionKind: 'next',
    actionId: 'action-1',
    title: '测试行动',
    status: 'completed',
    mode: 'preset',
    plannedMinutes: 25,
    pausedSec: 0,
    ...overrides,
  };
}

function session(
  day: number,
  minutes: number,
  overrides: Partial<FocusHistoryRow> = {},
): FocusHistoryRow {
  const start = new Date(2026, 8, day, 9, 0, 0, 0);
  const end = new Date(start.getTime() + minutes * 60_000);
  return row({
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
    ...overrides,
  });
}

/** The local 2026-09-21 (Monday) 10:00 from the app clock. */
const NOW = new Date(2026, 8, 21, 10, 0, 0, 0);

function heatCell(stats: ReturnType<typeof buildFocusStats>, key: string): FocusHeatmapDay {
  const cell = stats.heatmap.flatMap((week) => week.days).find((day) => day.localDate === key);
  if (cell === undefined) throw new Error(`no heatmap cell for ${key}`);
  return cell;
}

describe('focusDurationSec', () => {
  it('subtracts paused time and clamps negatives', () => {
    const base = {
      startedAt: localIso(2026, 8, 21, 10, 0),
      endedAt: localIso(2026, 8, 21, 10, 25),
      pausedSec: 120,
    };
    expect(focusDurationSec(base)).toBe(25 * 60 - 120);
    expect(focusDurationSec({ ...base, pausedSec: 0 })).toBe(25 * 60);
    expect(focusDurationSec({ ...base, pausedSec: 99_999 })).toBe(0);
    expect(focusDurationSec({ ...base, endedAt: 'not-a-date' })).toBe(0);
  });
});

describe('buildFocusStats', () => {
  it('buckets by the device-local start day and Monday-start week', () => {
    const rows = [
      session(21, 25),
      session(21, 10, {
        id: 'abandoned',
        startedAt: localIso(2026, 8, 21, 11, 0),
        endedAt: localIso(2026, 8, 21, 11, 10),
        pausedSec: 60,
        status: 'abandoned',
        mode: 'free',
        plannedMinutes: null,
      }),
      session(20, 30),
      session(13, 30),
    ];
    const stats = buildFocusStats(rows, NOW);

    // 25 + (10 min − 1 min paused) + 30 + 30
    expect(stats.totalMinutes).toBe(94);
    expect(stats.totalSessions).toBe(4);
    expect(stats.completedSessions).toBe(3);
    expect(stats.abandonedSessions).toBe(1);
    expect(stats.todayMinutes).toBe(34);
    // Sunday 9/20 belongs to the previous week; Monday 9/21 starts a new one.
    expect(stats.currentWeekMinutes).toBe(34);

    expect(stats.days).toHaveLength(7);
    expect(stats.days[0]!.localDate).toBe('20260915');
    expect(stats.days.at(-1)!.localDate).toBe('20260921');
    expect(stats.days.at(-1)!.minutes).toBe(34);
    expect(stats.days.at(-2)!.minutes).toBe(30);

    expect(stats.weeks).toHaveLength(8);
    expect(stats.weeks.at(-1)!.localDate).toBe('20260921');
    expect(stats.weeks.at(-1)!.minutes).toBe(34);
    expect(stats.weeks.at(-2)!.localDate).toBe('20260914');
    expect(stats.weeks.at(-2)!.minutes).toBe(30);
    expect(stats.weeks.at(-3)!.localDate).toBe('20260907');
    expect(stats.weeks.at(-3)!.minutes).toBe(30);

    expect(stats.heatmap).toHaveLength(12);
    expect(stats.heatmap.flatMap((week) => week.days)).toHaveLength(84);
    expect(heatCell(stats, '20260921').minutes).toBe(34);
    expect(heatCell(stats, '20260920').minutes).toBe(30);
    expect(heatCell(stats, '20260913').minutes).toBe(30);
    expect(heatCell(stats, '20260921').level).toBe(3); // 30–59
  });

  it('uses fixed minute bands for the heatmap', () => {
    const stats = buildFocusStats(
      [
        session(15, 14),
        session(16, 15),
        session(17, 29),
        session(18, 30),
        session(19, 59),
        session(20, 60),
      ],
      NOW,
    );
    expect(heatCell(stats, '20260915').level).toBe(1);
    expect(heatCell(stats, '20260916').level).toBe(2);
    expect(heatCell(stats, '20260917').level).toBe(2);
    expect(heatCell(stats, '20260918').level).toBe(3);
    expect(heatCell(stats, '20260919').level).toBe(3);
    expect(heatCell(stats, '20260920').level).toBe(4);
  });

  it('counts a session that crosses local midnight on its start day', () => {
    const start = new Date(2026, 8, 20, 23, 50, 0, 0);
    const end = new Date(2026, 8, 21, 0, 10, 0, 0);
    const stats = buildFocusStats(
      [row({ startedAt: start.toISOString(), endedAt: end.toISOString() })],
      NOW,
    );
    expect(stats.todayMinutes).toBe(0);
    expect(stats.currentWeekMinutes).toBe(0);
    expect(stats.days.at(-2)!.localDate).toBe('20260920');
    expect(stats.days.at(-2)!.minutes).toBe(20);
  });

  it('marks the rest of the current week as future and zero-fills empty windows', () => {
    const stats = buildFocusStats([], NOW);
    expect(stats.totalMinutes).toBe(0);
    expect(stats.totalSessions).toBe(0);
    expect(stats.days.map((day) => day.minutes)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(stats.weeks).toHaveLength(8);
    const currentWeek = stats.heatmap.at(-1)!;
    expect(currentWeek.start).toBe('20260921');
    expect(currentWeek.days[0]!.isFuture).toBe(false); // today
    expect(currentWeek.days.slice(1).every((day) => day.isFuture)).toBe(true);
    expect(heatCell(stats, '20260921').level).toBe(0);
  });

  it('includes sessions outside the short windows in the total; only 12 weeks reach the heatmap', () => {
    const threeWeeksAgo = session(1, 45); // 2026-09-01 — inside the heatmap window
    const ancient = row({
      startedAt: localIso(2025, 0, 1, 9, 0),
      endedAt: localIso(2025, 0, 1, 9, 45),
    });
    const stats = buildFocusStats([threeWeeksAgo, ancient], NOW);
    expect(stats.totalMinutes).toBe(90);
    expect(stats.days.every((day) => day.minutes === 0)).toBe(true);
    expect(heatCell(stats, '20260901').minutes).toBe(45);
    // 2025-01-01 is not a heatmap cell at all.
    expect(
      stats.heatmap.flatMap((week) => week.days).some((day) => day.localDate === '20250101'),
    ).toBe(false);
  });
});
