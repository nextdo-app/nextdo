/**
 * Quick time presets (issue #105): usage ranking + day-part coverage +
 * tolerant parsing. The storage backend is the device-local key-value matrix,
 * so the persistence test resets the module registry to get a clean cache.
 */
import {
  buildQuickTimePresets,
  parseTimeUseCounts,
  timePeriodLabel,
  TIME_PRESETS_SETTINGS_KEY,
} from './time-presets';

describe('buildQuickTimePresets', () => {
  it('falls back to the defaults, covering 上午 / 下午 / 晚间', () => {
    const presets = buildQuickTimePresets({});
    const periods = new Set(presets.map((preset) => preset.period));
    expect(periods).toEqual(new Set(['上午', '下午', '晚间']));
    expect(presets.map((preset) => preset.label)).toEqual([
      '07:30',
      '09:00',
      '12:30',
      '14:00',
      '18:30',
      '19:30',
      '21:30',
      '22:30',
    ]);
  });

  it('ranks the most-used times first, without duplicating a default', () => {
    const presets = buildQuickTimePresets({ '14:00': 5, '09:30': 3, '21:15': 1 });
    expect(presets.slice(0, 3).map((preset) => preset.label)).toEqual([
      '14:00',
      '09:30',
      '21:15',
    ]);
    // 14:00 is also a default — it appears exactly once.
    expect(presets.filter((preset) => preset.label === '14:00')).toHaveLength(1);
    // The complete default set is still present (coverage is never trimmed).
    for (const label of ['07:30', '12:30', '18:30', '22:30']) {
      expect(presets.some((preset) => preset.label === label)).toBe(true);
    }
  });

  it('ignores malformed counters', () => {
    const presets = buildQuickTimePresets({
      '25:00': 9,
      '12:60': 4,
      '09:30': -1,
      '10:45': 2,
    });
    expect(presets[0]?.label).toBe('10:45');
    expect(presets.some((preset) => preset.label === '25:00')).toBe(false);
  });
});

describe('parseTimeUseCounts', () => {
  it('accepts a valid blob and drops junk', () => {
    expect(
      parseTimeUseCounts(
        JSON.stringify({ counts: { '09:30': 2, '24:00': 1, '10:00': 'x', '11:15': 0 } }),
      ),
    ).toEqual({ '09:30': 2 });
  });

  it('returns {} for null / invalid JSON / wrong shape', () => {
    expect(parseTimeUseCounts(null)).toEqual({});
    expect(parseTimeUseCounts('not json')).toEqual({});
    expect(parseTimeUseCounts(JSON.stringify({ counts: [] }))).toEqual({});
    expect(parseTimeUseCounts('null')).toEqual({});
  });
});

describe('timePeriodLabel', () => {
  it('maps hours to the coarse day parts', () => {
    expect(timePeriodLabel(5)).toBe('凌晨');
    expect(timePeriodLabel(6)).toBe('上午');
    expect(timePeriodLabel(11)).toBe('上午');
    expect(timePeriodLabel(12)).toBe('下午');
    expect(timePeriodLabel(17)).toBe('下午');
    expect(timePeriodLabel(18)).toBe('晚间');
  });
});

describe('time usage persistence', () => {
  function freshModule(): typeof import('./time-presets') {
    let mod!: typeof import('./time-presets');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('./time-presets') as typeof import('./time-presets');
    });
    return mod;
  }

  it('counts repeated selections and reads them back', async () => {
    const mod = freshModule();
    await mod.recordTimeUse(9, 30);
    await mod.recordTimeUse(9, 30);
    await mod.recordTimeUse(19, 30);

    expect(mod.getCachedTimeUseCounts()).toEqual({ '09:30': 2, '19:30': 1 });
    const presets = buildQuickTimePresets(await mod.readTimeUseCounts());
    expect(presets.slice(0, 2).map((preset) => preset.label)).toEqual(['09:30', '19:30']);
    // The fixed key name is the contract with the device store.
    expect(TIME_PRESETS_SETTINGS_KEY).toBe('nextdo.settings.time-presets');
  });

  it('ignores out-of-range values', async () => {
    const mod = freshModule();
    await mod.recordTimeUse(24, 0);
    await mod.recordTimeUse(-1, 10);
    expect(mod.getCachedTimeUseCounts()).toEqual({});
  });

  it('keeps every used time — two new times alternating both accumulate', async () => {
    const mod = freshModule();
    // 49 old times, each used twice: enough that the old top-50 storage cap
    // evicted any newly used time on every write.
    for (let minute = 0; minute < 49; minute += 1) {
      await mod.recordTimeUse(0, minute);
      await mod.recordTimeUse(0, minute);
    }

    // Two new times alternate — neither may evict the other; both must reach
    // count 2. With a storage cap, each write dropped the other.
    await mod.recordTimeUse(19, 15);
    await mod.recordTimeUse(19, 16);
    await mod.recordTimeUse(19, 15);
    await mod.recordTimeUse(19, 16);

    const counts = mod.getCachedTimeUseCounts();
    expect(counts['19:15']).toBe(2);
    expect(counts['19:16']).toBe(2);
    expect(Object.keys(counts)).toHaveLength(51);
  });
});
