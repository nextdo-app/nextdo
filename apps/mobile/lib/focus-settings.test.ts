/**
 * Unit tests — the focus-duration preference (lib/focus-settings, issue #59).
 */
import {
  FOCUS_SETTINGS_KEY,
  __setFocusSettingsStoreForTests,
  loadFocusSettings,
  normalizeFocusMinutes,
  parseFocusSettings,
  saveFocusSettings,
} from './focus-settings';

function memoryStore(): {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  raw: Map<string, string>;
} {
  const raw = new Map<string, string>();
  return {
    raw,
    async getItem(key) {
      return raw.has(key) ? (raw.get(key) as string) : null;
    },
    async setItem(key, value) {
      raw.set(key, value);
    },
  };
}

afterEach(() => {
  __setFocusSettingsStoreForTests(null);
});

describe('normalizeFocusMinutes', () => {
  it('accepts whole minutes inside 1–180', () => {
    expect(normalizeFocusMinutes(1)).toBe(1);
    expect(normalizeFocusMinutes(30)).toBe(30);
    expect(normalizeFocusMinutes(180)).toBe(180);
  });

  it('rejects out-of-range, fractional and non-number values', () => {
    expect(normalizeFocusMinutes(0)).toBeNull();
    expect(normalizeFocusMinutes(181)).toBeNull();
    expect(normalizeFocusMinutes(2.5)).toBeNull();
    expect(normalizeFocusMinutes('25')).toBeNull();
    expect(normalizeFocusMinutes(null)).toBeNull();
  });
});

describe('parseFocusSettings', () => {
  it('returns no preference for null / corrupt JSON', () => {
    expect(parseFocusSettings(null)).toEqual({ lastMinutes: null });
    expect(parseFocusSettings('{nope')).toEqual({ lastMinutes: null });
  });

  it('drops a stored value that is no longer valid', () => {
    expect(parseFocusSettings(JSON.stringify({ lastMinutes: 300 }))).toEqual({ lastMinutes: null });
  });

  it('round-trips a valid preference', () => {
    expect(parseFocusSettings(JSON.stringify({ lastMinutes: 30 }))).toEqual({ lastMinutes: 30 });
  });
});

describe('saveFocusSettings / loadFocusSettings', () => {
  it('persists the chosen duration and reads it back', async () => {
    const store = memoryStore();
    __setFocusSettingsStoreForTests(store);

    await saveFocusSettings({ lastMinutes: 30 });
    expect(JSON.parse(store.raw.get(FOCUS_SETTINGS_KEY) as string)).toEqual({ lastMinutes: 30 });

    __setFocusSettingsStoreForTests(store);
    await expect(loadFocusSettings()).resolves.toEqual({ lastMinutes: 30 });
  });

  it('an invalid patch falls back to no preference', async () => {
    const store = memoryStore();
    __setFocusSettingsStoreForTests(store);
    await saveFocusSettings({ lastMinutes: 0 });
    await expect(loadFocusSettings()).resolves.toEqual({ lastMinutes: null });
  });
});
