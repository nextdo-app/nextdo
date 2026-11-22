/**
 * The connection-string deep-link route (`app/sync.tsx`,
 * 10-02-simplify-sync-setup design D6): `nextdo://sync?s=<base>&t=<token>`
 * → the SAME `useCloudSync().connect()` the Settings tab uses → Now on
 * success, the Settings tab (carrying the error) on failure.
 *
 * What this file pins, and why each matters:
 *  - the route calls connect() with the DERIVED-from-one-address shape, not
 *    a private second validation path (design D6: two paths = two sets of
 *    copy that drift);
 *  - success → `/sync` REPLACES to `/(tabs)/now`;
 *  - failure → `/sync` REPLACES to `/(tabs)/settings` WITH the error in the
 *    query — a deep link must never fail silently;
 *  - a half-filled link (missing `s` or `t`) does not call connect() at all;
 *  - the attempt fires ONCE (a shared secret must not be re-posted on a
 *    re-render).
 *
 * The route is rendered standalone (not through `renderRouter`) because it
 * navigates AWAY on every path — there is no stable "current screen" to
 * assert against; the navigation target IS the assertion. The mocked
 * `@nextdo/db` boundary is the same shape settings-screen.test.tsx uses, so
 * the REAL hook runs and the REAL storage mock records what was written.
 */
type MockValidateResult =
  | { ok: true; token: string; endpoint?: string }
  | { ok: false; kind: 'rejected'; status: number }
  | { ok: false; kind: 'invalid' }
  | { ok: false; kind: 'network'; detail?: string };

const mockAuth: {
  storedToken: string | null;
  storedConfig: { backendUrl: string; endpoint: string } | null;
  validate: (config: unknown, token: string) => MockValidateResult;
} = {
  storedToken: null,
  storedConfig: null,
  validate: () => ({ ok: true, token: 'ps-jwt' }),
};

const mockTokenListeners = new Set<() => void>();
let mockFetchCalls = 0;

function mockNotifyTokenChange(): void {
  for (const listener of [...mockTokenListeners]) {
    listener();
  }
}

jest.mock('@nextdo/db', () => {
  const { deriveSyncConfig } = jest.requireActual('@nextdo/db') as {
    deriveSyncConfig: (address: string) => { backendUrl: string; endpoint: string };
  };
  return {
    deriveSyncConfig,
    getOwnerToken: async () => mockAuth.storedToken,
    getStoredBackendConfig: async () => mockAuth.storedConfig,
    fetchCredentialsOnce: async (config: unknown, token: string): Promise<MockValidateResult> => {
      mockFetchCalls += 1;
      return mockAuth.validate(config, token);
    },
    setOwnerToken: async (token: string) => {
      mockAuth.storedToken = token;
      mockNotifyTokenChange();
    },
    clearOwnerToken: async () => {
      mockAuth.storedToken = null;
      mockNotifyTokenChange();
    },
    setStoredBackendConfig: async (config: { backendUrl: string; endpoint: string }) => {
      mockAuth.storedConfig = {
        backendUrl: config.backendUrl.trim(),
        endpoint: config.endpoint.trim(),
      };
    },
    clearStoredBackendConfig: async () => {
      mockAuth.storedConfig = null;
    },
    subscribeToOwnerTokenChange: (listener: () => void) => {
      mockTokenListeners.add(listener);
      return () => {
        mockTokenListeners.delete(listener);
      };
    },
    // Not reached by this route (the root layout is not mounted here), but
    // the module boundary must be complete for the import to resolve.
    createPowerSyncDatabase: () => ({
      init: async () => undefined,
      connect: () => Promise.resolve(undefined),
      disconnect: async () => undefined,
      close: async () => undefined,
    }),
    createPowerSyncConnector: () => ({
      fetchCredentials: async () => null,
      uploadData: async () => undefined,
    }),
    subscribeAppStream: async () => undefined,
    wrapDb: () => ({}),
    settingsWatchQuery: () => ({
      compile: () => ({ sql: 'SELECT 1', parameters: [] }),
      execute: async () => [],
    }),
    setAppSetting: async () => undefined,
  };
});

// The navigation target IS the assertion, so the router is mocked: the real
// one would need a mounted stack with a parent route to replace into.
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (href: unknown) => mockReplace(href) },
  useLocalSearchParams: () => mockParams,
}));

const mockParams: { s?: string; t?: string } = {};

import { act, render } from '@testing-library/react-native';
import SyncLinkScreen from '../app/sync';

beforeEach(() => {
  mockAuth.storedToken = null;
  mockAuth.storedConfig = null;
  mockAuth.validate = () => ({ ok: true, token: 'ps-jwt' });
  mockTokenListeners.clear();
  mockFetchCalls = 0;
  mockReplace.mockClear();
  delete mockParams.s;
  delete mockParams.t;
});

/** Mount the route with the given query params and flush the async chain. */
async function mountWith(params: { s?: string; t?: string }): Promise<void> {
  Object.assign(mockParams, params);
  render(<SyncLinkScreen />);
  let chain: Promise<unknown> = Promise.resolve();
  for (let i = 0; i < 10; i++) {
    chain = chain.then(() => act(async () => {}));
  }
  await chain;
}

describe('sync deep link — a valid connection string', () => {
  it('connects with the address + token, stores the DERIVED config and lands on Now', async () => {
    await mountWith({ s: 'https://nextdo.example.com', t: 'good-token' });

    expect(mockFetchCalls).toBe(1); // exactly one /credentials round-trip
    expect(mockAuth.storedToken).toBe('good-token');
    // The ONE address was completed into both URLs — the same derivation
    // the Settings screen uses, not a private one.
    expect(mockAuth.storedConfig).toEqual({
      backendUrl: 'https://nextdo.example.com/api',
      endpoint: 'https://nextdo.example.com/sync',
    });
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/now');
  });

  it('the URL-DECODED address expo-router delivers is what gets connected', async () => {
    // A QR code carries `s=https%3A%2F%2Fnextdo.example.com`; expo-router
    // hands the route the DECODED value, which is what the route reads —
    // no decode step lives in the route itself (one less thing to get
    // wrong, and the parser in lib/sync-connection is the single place
    // that handles encoding, for the pasted-string path).
    await mountWith({ s: 'https://nextdo.example.com', t: 'abc123' });

    expect(mockAuth.storedToken).toBe('abc123');
    expect(mockAuth.storedConfig).toEqual({
      backendUrl: 'https://nextdo.example.com/api',
      endpoint: 'https://nextdo.example.com/sync',
    });
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/now');
  });

  it('the server-supplied endpoint wins (the deployment owns the path)', async () => {
    mockAuth.validate = () => ({
      ok: true,
      token: 'ps-jwt',
      endpoint: 'https://custom.example.com/stream',
    });
    await mountWith({ s: 'https://nextdo.example.com', t: 'tok' });

    expect(mockAuth.storedConfig).toEqual({
      backendUrl: 'https://nextdo.example.com/api',
      endpoint: 'https://custom.example.com/stream',
    });
  });

  it('fires the attempt exactly ONCE (a re-render must not re-post the token)', async () => {
    Object.assign(mockParams, { s: 'https://nextdo.example.com', t: 'tok' });
    const view = render(<SyncLinkScreen />);
    await act(async () => {});
    view.rerender(<SyncLinkScreen />);
    await act(async () => {});

    expect(mockFetchCalls).toBe(1);
  });

  it('a SECOND, different link is honored (the guard is keyed per link, not a one-shot latch)', async () => {
    // The regression this pins: a bare boolean latch froze the route after
    // the first link, so a user tapping a corrected QR while the app was
    // already open got a screen that silently did nothing.
    Object.assign(mockParams, { s: 'https://nextdo.example.com', t: 'tok' });
    const view = render(<SyncLinkScreen />);
    await act(async () => {});
    expect(mockFetchCalls).toBe(1);

    Object.assign(mockParams, { s: 'https://other.example.com', t: 'tok2' });
    view.rerender(<SyncLinkScreen />);
    await act(async () => {});

    expect(mockFetchCalls).toBe(2);
    expect(mockAuth.storedToken).toBe('tok2');
    expect(mockAuth.storedConfig).toEqual({
      backendUrl: 'https://other.example.com/api',
      endpoint: 'https://other.example.com/sync',
    });
  });

  it('re-rendering the SAME link still fires exactly once', async () => {
    Object.assign(mockParams, { s: 'https://nextdo.example.com', t: 'tok' });
    const view = render(<SyncLinkScreen />);
    await act(async () => {});
    for (let i = 0; i < 3; i++) {
      view.rerender(<SyncLinkScreen />);
      await act(async () => {});
    }

    expect(mockFetchCalls).toBe(1);
  });
});

describe('sync deep link — failures are never silent', () => {
  it('401 → the Settings tab WITH the shared 「token 不正确」 copy', async () => {
    mockAuth.validate = () => ({ ok: false, kind: 'rejected', status: 401 });
    await mountWith({ s: 'https://nextdo.example.com', t: 'wrong-token' });

    expect(mockAuth.storedToken).toBeNull();
    expect(mockAuth.storedConfig).toBeNull();
    // The SAME three-state message the Settings screen shows — one connect(),
    // one message vocabulary.
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/(tabs)/settings',
      params: { syncError: 'token 不正确' },
    });
  });

  it('network failure → the Settings tab with 「连不上服务器，请稍后重试」', async () => {
    mockAuth.validate = () => ({ ok: false, kind: 'network', detail: 'ECONNREFUSED' });
    await mountWith({ s: 'https://nextdo.example.com', t: 'tok' });

    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/(tabs)/settings',
      params: { syncError: '连不上服务器，请稍后重试' },
    });
  });

  it('an invalid address in the link → 「地址无效…」 (the shared client-side check)', async () => {
    await mountWith({ s: 'nextdo.example.com', t: 'tok' });

    // The client-side validation runs BEFORE any network — a malformed link
    // never reaches the server.
    expect(mockFetchCalls).toBe(0);
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/(tabs)/settings',
      params: { syncError: '地址无效，应以 http:// 或 https:// 开头' },
    });
  });

  it.each([
    ['no params at all', {}],
    ['only the address', { s: 'https://nextdo.example.com' }],
    ['only the token', { t: 'tok' }],
    ['both empty', { s: '', t: '' }],
    ['whitespace only', { s: '   ', t: '   ' }],
  ])('a half-filled link (%s) → Settings with an explanation, ZERO network', async (
    _label,
    params,
  ) => {
    await mountWith(params);

    expect(mockFetchCalls).toBe(0);
    expect(mockAuth.storedToken).toBeNull();
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/(tabs)/settings',
      params: { syncError: '连接串不完整，请在设置页重新填写' },
    });
  });
});