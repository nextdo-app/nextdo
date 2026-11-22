/**
 * Unit tests — the optional reference-library preference (issue #90).
 *
 * Defaults ON (Clarify already wrote ReferenceItems before the library had a
 * screen). OFF hides the Now entry and the Clarify 「资料」 choice; it must
 * never delete stored references, and a failed write must not leave the
 * cache claiming a preference the device never stored.
 */
import {
  REFERENCE_LIBRARY_SETTINGS_KEY,
  __setReferenceLibrarySettingsStoreForTests,
  loadReferenceLibrarySettings,
  parseReferenceLibrarySettings,
  saveReferenceLibrarySettings,
  subscribeToReferenceLibrarySettings,
} from './reference-library-settings';

function memoryStore(): {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  raw: Map<string, string>;
  writes: number;
} {
  const raw = new Map<string, string>();
  const store = {
    raw,
    writes: 0,
    async getItem(key: string) {
      return raw.has(key) ? (raw.get(key) as string) : null;
    },
    async setItem(key: string, value: string) {
      store.writes += 1;
      raw.set(key, value);
    },
  };
  return store;
}

afterEach(() => {
  __setReferenceLibrarySettingsStoreForTests(null);
});

describe('parseReferenceLibrarySettings', () => {
  it('defaults to enabled when nothing is stored', () => {
    expect(parseReferenceLibrarySettings(null)).toEqual({ enabled: true });
  });

  it('keeps a stored boolean', () => {
    expect(parseReferenceLibrarySettings('{"enabled":false}')).toEqual({ enabled: false });
  });

  it('falls back to the default for malformed or mistyped values', () => {
    expect(parseReferenceLibrarySettings('not json')).toEqual({ enabled: true });
    expect(parseReferenceLibrarySettings('null')).toEqual({ enabled: true });
    expect(parseReferenceLibrarySettings('[]')).toEqual({ enabled: true });
    expect(parseReferenceLibrarySettings('{"enabled":"no"}')).toEqual({ enabled: true });
  });
});

describe('load / save', () => {
  it('writes the preference and notifies subscribers', async () => {
    const store = memoryStore();
    __setReferenceLibrarySettingsStoreForTests(store);
    const seen: boolean[] = [];
    subscribeToReferenceLibrarySettings((settings) => seen.push(settings.enabled));

    await saveReferenceLibrarySettings({ enabled: false });

    expect(JSON.parse(store.raw.get(REFERENCE_LIBRARY_SETTINGS_KEY) ?? '')).toEqual({
      enabled: false,
    });
    expect(seen).toEqual([false]);
    expect(await loadReferenceLibrarySettings()).toEqual({ enabled: false });
  });

  it('adopts a stored value on load', async () => {
    const store = memoryStore();
    store.raw.set(REFERENCE_LIBRARY_SETTINGS_KEY, '{"enabled":false}');
    __setReferenceLibrarySettingsStoreForTests(store);

    expect(await loadReferenceLibrarySettings()).toEqual({ enabled: false });
  });

  it('a failed write rejects and keeps the last persisted value', async () => {
    const store = memoryStore();
    __setReferenceLibrarySettingsStoreForTests(store);
    await saveReferenceLibrarySettings({ enabled: true });

    __setReferenceLibrarySettingsStoreForTests({
      getItem: (key) => store.getItem(key),
      setItem: async () => {
        throw new Error('storage full');
      },
    });

    await expect(saveReferenceLibrarySettings({ enabled: false })).rejects.toThrow('storage full');
    // The cache still reports the value the device actually stored.
    expect(await loadReferenceLibrarySettings()).toEqual({ enabled: true });
  });

  it('propagates a real Web localStorage write failure (no silent success)', async () => {
    const raw = new Map([[REFERENCE_LIBRARY_SETTINGS_KEY, '{"enabled":true}']]);
    const g = globalThis as {
      window?: { localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void } };
    };
    const previousWindow = g.window;
    g.window = {
      ...g.window,
      localStorage: {
        getItem: (key) => raw.get(key) ?? null,
        setItem: () => {
          throw new Error('quota exceeded');
        },
      },
    };
    // No injected KeyValue: force the real Web adapter to be selected.
    __setReferenceLibrarySettingsStoreForTests(null);

    try {
      await expect(saveReferenceLibrarySettings({ enabled: false })).rejects.toThrow(
        'quota exceeded',
      );
      // The write landed nowhere, so the cache must not claim OFF.
      expect(await loadReferenceLibrarySettings()).toEqual({ enabled: true });
    } finally {
      g.window = previousWindow;
    }
  });

  it('caches a loaded value until reset', async () => {
    let reads = 0;
    const store = memoryStore();
    const counting = {
      getItem: async (key: string) => {
        reads += 1;
        return store.getItem(key);
      },
      setItem: store.setItem,
    };
    __setReferenceLibrarySettingsStoreForTests(counting);

    await loadReferenceLibrarySettings();
    await loadReferenceLibrarySettings();

    expect(reads).toBe(1);
  });
});
