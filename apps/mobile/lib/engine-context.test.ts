/**
 * Unit tests — engine-context persistence (lib/engine-context).
 *
 * `parseEngineContext` is pure; the load/save round-trip runs against an
 * injected in-memory store (`__setEngineContextStoreForTests`) so the test
 * never touches a real backend.
 */
import {
  __setEngineContextStoreForTests,
  DEFAULT_ENGINE_CONTEXT,
  loadEngineContext,
  parseEngineContext,
  saveEngineContext,
  type EngineContextSettings,
} from './engine-context';

afterEach(() => {
  __setEngineContextStoreForTests(null);
});

function memoryStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    async getItem(key: string) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    async setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

describe('parseEngineContext', () => {
  it('returns the defaults for null / corrupt / non-object blobs', () => {
    expect(parseEngineContext(null)).toEqual(DEFAULT_ENGINE_CONTEXT);
    expect(parseEngineContext('not-json')).toEqual(DEFAULT_ENGINE_CONTEXT);
    expect(parseEngineContext('42')).toEqual(DEFAULT_ENGINE_CONTEXT);
    expect(parseEngineContext('"a string"')).toEqual(DEFAULT_ENGINE_CONTEXT);
  });

  it('parses a valid blob', () => {
    const parsed = parseEngineContext(JSON.stringify({ availableMinutes: 30 }));
    expect(parsed).toEqual({ availableMinutes: 30 });
  });

  it('ignores the retired contextIds key (#46) and clamps availableMinutes', () => {
    const parsed = parseEngineContext(
      JSON.stringify({ contextIds: ['ok', 7, null], availableMinutes: 999999 }),
    );
    expect(parsed).toEqual({ availableMinutes: 1440 });
  });

  it('falls back per-field (missing / invalid fields never crash)', () => {
    expect(parseEngineContext(JSON.stringify({ contextIds: 'nope' }))).toEqual(DEFAULT_ENGINE_CONTEXT);
    expect(parseEngineContext(JSON.stringify({ availableMinutes: -5 }))).toEqual(DEFAULT_ENGINE_CONTEXT);
    expect(parseEngineContext(JSON.stringify({ contextIds: ['a'] })).availableMinutes).toBe(60);
  });
});

describe('load/save round-trip', () => {
  it('returns the defaults when nothing is stored', async () => {
    __setEngineContextStoreForTests(memoryStore());
    await expect(loadEngineContext()).resolves.toEqual(DEFAULT_ENGINE_CONTEXT);
  });

  it('persists and re-reads the settings', async () => {
    const store = memoryStore();
    __setEngineContextStoreForTests(store);
    const settings: EngineContextSettings = { availableMinutes: 15 };
    await saveEngineContext(settings);
    await expect(loadEngineContext()).resolves.toEqual(settings);
    expect(store.map.size).toBe(1);
  });

  it('a corrupt stored blob loads as the defaults (never throws)', async () => {
    const store = memoryStore({ 'nextdo.settings.engine-context': '{broken' });
    __setEngineContextStoreForTests(store);
    await expect(loadEngineContext()).resolves.toEqual(DEFAULT_ENGINE_CONTEXT);
  });

  it('persists through web localStorage when available', async () => {
    const storageMap = new Map<string, string>();
    const fakeLocalStorage = {
      getItem: (key: string) => storageMap.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storageMap.set(key, value);
      },
      removeItem: (key: string) => {
        storageMap.delete(key);
      },
    };
    Object.defineProperty(globalThis, 'window', {
      value: { localStorage: fakeLocalStorage },
      writable: true,
      configurable: true,
    });

    try {
      // Clear any cached test backend
      __setEngineContextStoreForTests(null);
      const settings: EngineContextSettings = { availableMinutes: 45 };
      await saveEngineContext(settings);

      // Reset cache to simulate app restart/re-mount
      __setEngineContextStoreForTests(null);
      const reloaded = await loadEngineContext();
      expect(reloaded).toEqual(settings);
      expect(storageMap.has('nextdo.settings.engine-context')).toBe(true);
    } finally {
      // @ts-expect-error cleanup global window
      delete globalThis.window;
      __setEngineContextStoreForTests(null);
    }
  });
});
