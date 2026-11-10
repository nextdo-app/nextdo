import { act, renderHook } from '@testing-library/react-native';
import { getOwnerToken, getStoredBackendConfig } from '@nextdo/db';
import { useSyncStatus } from '@/hooks/use-sync-status';

const mockStatus = {
  connected: true,
  connecting: false,
  downloading: false,
  uploading: false,
  downloadError: undefined as Error | undefined,
  uploadError: undefined as Error | undefined,
  lastSyncedAt: undefined,
};
const mockPowerSync = {
  getUploadQueueStats: jest.fn(async () => ({ count: 0 })),
  connect: jest.fn<Promise<void>, []>(async () => undefined),
  waitForStatus: jest.fn<Promise<void>, [(status: typeof mockStatus) => boolean, AbortSignal?]>(
    async () => undefined,
  ),
  currentStatus: mockStatus,
};

jest.mock('@powersync/react', () => ({
  usePowerSync: () => mockPowerSync,
  useStatus: () => mockStatus,
}));
jest.mock('@nextdo/db', () => ({
  createPowerSyncConnector: jest.fn(() => ({})),
  getOwnerToken: jest.fn(),
  getStoredBackendConfig: jest.fn(),
}));

const mockGetOwnerToken = jest.mocked(getOwnerToken);
const mockGetConfig = jest.mocked(getStoredBackendConfig);
const config = { backendUrl: 'https://backend.invalid', endpoint: 'https://sync.invalid' };
const timeoutState = { kind: 'failed', reason: '同步超时，请检查网络后重试' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('useSyncStatus manual deadline', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
    jest.clearAllMocks();
    mockGetOwnerToken.mockResolvedValue('synthetic-token');
    mockGetConfig.mockResolvedValue(config);
    mockPowerSync.connect.mockResolvedValue(undefined);
    mockPowerSync.waitForStatus.mockResolvedValue(undefined);
    mockStatus.downloadError = undefined;
    mockStatus.uploadError = undefined;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(['token', 'config'] as const)(
    'bounds a stalled %s read and ignores its late result',
    async (stage) => {
      const token = deferred<string | null>();
      const backend = deferred<typeof config | null>();
      if (stage === 'token') mockGetOwnerToken.mockReturnValueOnce(token.promise);
      else mockGetConfig.mockReturnValueOnce(backend.promise);
      const { result } = renderHook(() => useSyncStatus(true));
      let attempt: Promise<void> | undefined;
      await act(async () => {
        attempt = result.current.syncNow();
      });

      await act(async () => {
        jest.advanceTimersByTime(8000);
      });
      expect(result.current.manual).toEqual(timeoutState);
      await attempt;
      await act(async () => {
        token.resolve('late-token');
        backend.resolve(config);
      });
      expect(mockPowerSync.connect).not.toHaveBeenCalled();
      expect(mockPowerSync.waitForStatus).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('bounds a stalled connection, allows retry, and ignores the old connection result', async () => {
    const connection = deferred<void>();
    mockPowerSync.connect.mockReturnValueOnce(connection.promise);
    const { result } = renderHook(() => useSyncStatus(true));
    let attempt: Promise<void> | undefined;
    await act(async () => {
      attempt = result.current.syncNow();
    });
    await act(async () => {
      jest.advanceTimersByTime(7999);
    });
    expect(result.current.manual).toEqual({ kind: 'running' });
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.manual).toEqual(timeoutState);
    await attempt;

    await act(async () => {
      await result.current.syncNow();
    });
    expect(result.current.manual).toEqual({ kind: 'ok' });
    expect(mockPowerSync.waitForStatus).toHaveBeenCalledTimes(1);
    await act(async () => {
      connection.resolve();
    });
    expect(mockPowerSync.waitForStatus).toHaveBeenCalledTimes(1);
    expect(result.current.manual).toEqual({ kind: 'ok' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['timeout', 'unmount'] as const)('cancels the SDK status wait on %s', async (end) => {
    let waiting = 0;
    mockPowerSync.waitForStatus.mockImplementationOnce((_predicate, signal) => {
      waiting++;
      return new Promise((resolve) => {
        signal?.addEventListener(
          'abort',
          () => {
            waiting--;
            resolve();
          },
          { once: true },
        );
      });
    });
    const { result, unmount } = renderHook(() => useSyncStatus(true));
    let attempt: Promise<void> | undefined;
    await act(async () => {
      attempt = result.current.syncNow();
    });
    expect(waiting).toBe(1);

    await act(async () => {
      if (end === 'unmount') unmount();
      else jest.advanceTimersByTime(8000);
    });
    expect(waiting).toBe(0);
    await attempt;
    if (end === 'timeout') expect(result.current.manual).toEqual(timeoutState);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not start another connection on a same-tick repeat', async () => {
    const connection = deferred<void>();
    mockPowerSync.connect.mockReturnValueOnce(connection.promise);
    const { result } = renderHook(() => useSyncStatus(true));
    let attempt: Promise<void> | undefined;
    await act(async () => {
      attempt = result.current.syncNow();
      void result.current.syncNow();
    });
    expect(mockPowerSync.connect).toHaveBeenCalledTimes(1);
    await act(async () => {
      connection.resolve();
      await attempt;
    });
    expect(result.current.manual).toEqual({ kind: 'ok' });
  });

  it('keeps a connection rejection visible and clears the deadline', async () => {
    mockPowerSync.connect.mockRejectedValueOnce(new Error('Connection refused'));
    const { result } = renderHook(() => useSyncStatus(true));
    await act(async () => {
      await result.current.syncNow();
    });
    expect(result.current.manual).toEqual({ kind: 'failed', reason: 'Connection refused' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps an SDK failure visible even when connected and idle', async () => {
    mockStatus.uploadError = new Error('Upload rejected');
    const { result } = renderHook(() => useSyncStatus(true));
    await act(async () => {
      await result.current.syncNow();
    });
    expect(result.current.manual).toEqual({ kind: 'failed', reason: 'Upload rejected' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps the missing-token message and does not connect', async () => {
    mockGetOwnerToken.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useSyncStatus(true));
    await act(async () => {
      await result.current.syncNow();
    });
    expect(result.current.manual).toEqual({ kind: 'failed', reason: '尚未连接同步服务器' });
    expect(mockPowerSync.connect).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
