/**
 * `deriveSyncDisplay` + `formatLastSyncedAt` (issue #22).
 *
 * The card's four states each get a case, plus the two that only exist at the
 * edges: a failed manual attempt and a sync that never completed.
 */
import {
  deriveSyncDisplay,
  describeSyncFailure,
  formatLastSyncedAt,
  SYNC_FAILURE_MAX_LENGTH,
  truncateForDisplay,
  type SyncDisplayInput,
} from './sync-status';

const NOW = new Date('2026-10-16T15:00:00.000Z');

function input(overrides: Partial<SyncDisplayInput> = {}): SyncDisplayInput {
  return {
    configured: true,
    connected: true,
    connecting: false,
    downloading: false,
    uploading: false,
    downloadError: null,
    uploadError: null,
    pendingUploads: 0,
    manual: null,
    ...overrides,
  };
}

describe('deriveSyncDisplay', () => {
  it('reports 已同步 when connected with an empty queue and no failure', () => {
    expect(deriveSyncDisplay(input())).toEqual({
      kind: 'synced',
      pendingUploads: 0,
      error: null,
    });
  });

  it('reports 同步中 while the SDK is connecting / downloading / uploading', () => {
    for (const flag of ['connecting', 'downloading', 'uploading'] as const) {
      expect(deriveSyncDisplay(input({ [flag]: true })).kind).toBe('syncing');
    }
  });

  it('reports 有未同步改动 when local operations are still queued', () => {
    expect(deriveSyncDisplay(input({ pendingUploads: 3 }))).toEqual({
      kind: 'pending',
      pendingUploads: 3,
      error: null,
    });
  });

  it('reports 同步失败 with the SDK reason', () => {
    expect(deriveSyncDisplay(input({ downloadError: 'Connection refused' }))).toEqual({
      kind: 'failed',
      pendingUploads: 0,
      error: 'Connection refused',
    });
  });

  it('reports 未连接 when sync was never configured, even if the SDK is idle', () => {
    expect(deriveSyncDisplay(input({ configured: false, connected: false })).kind).toBe('offline');
  });

  it('reports 未连接 when configured but the stream is down', () => {
    expect(deriveSyncDisplay(input({ connected: false })).kind).toBe('offline');
  });

  it('prefers the failure over a concurrent sync-in-progress (the retry must not hide it)', () => {
    const display = deriveSyncDisplay(
      input({ downloading: true, uploadError: 'Upload rejected' }),
    );
    expect(display).toEqual({
      kind: 'failed',
      pendingUploads: 0,
      error: 'Upload rejected',
    });
  });

  it('surfaces a failed manual attempt when the SDK itself reports nothing', () => {
    const display = deriveSyncDisplay(
      input({ manual: { kind: 'failed', reason: '同步超时，请检查网络后重试' } }),
    );
    expect(display).toEqual({
      kind: 'failed',
      pendingUploads: 0,
      error: '同步超时，请检查网络后重试',
    });
  });

  it('shows 同步中 while a manual attempt is in flight', () => {
    expect(deriveSyncDisplay(input({ manual: { kind: 'running' } })).kind).toBe('syncing');
  });

  it('lets a successful manual attempt fall back to the steady state', () => {
    expect(deriveSyncDisplay(input({ manual: { kind: 'ok' } })).kind).toBe('synced');
  });

  it('never quotes a negative queue depth', () => {
    expect(deriveSyncDisplay(input({ pendingUploads: -2 })).pendingUploads).toBe(0);
  });
});

describe('formatLastSyncedAt', () => {
  it('formats a same-year sync as 月日 时:分 in local time', () => {
    const synced = new Date(2026, 9, 16, 14, 5);
    expect(formatLastSyncedAt(new Date(2026, 9, 16, 15, 0), synced)).toBe('10月16日 14:05');
  });

  it('prefixes the year for a sync from a previous year', () => {
    const synced = new Date(2025, 4, 3, 9, 12);
    expect(formatLastSyncedAt(new Date(2026, 9, 16, 15, 0), synced)).toBe('2025年5月3日 09:12');
  });

  it('returns null when no sync has ever completed (never a fabricated time)', () => {
    expect(formatLastSyncedAt(NOW, undefined)).toBeNull();
  });

  it('returns null for a corrupt timestamp', () => {
    expect(formatLastSyncedAt(NOW, new Date('not-a-date'))).toBeNull();
  });
});

describe('describeSyncFailure', () => {
  /** The exact shape the PowerSync SDK produces for a service rejection. */
  const s2101 =
    'HTTP : {"error":{"code":"PSYNC_S2101","status":401,"description":"Could not find an appropriate key in the keystore. The key is missing or no key matched the token KID","name":"AuthorizationError"}}';

  it('reads PSYNC_S2101 as an auth rejection and extracts code + description', () => {
    expect(describeSyncFailure(s2101)).toEqual({
      kind: 'auth',
      code: 'PSYNC_S2101',
      detail:
        'Could not find an appropriate key in the keystore. The key is missing or no key matched the token KID',
      raw: s2101,
    });
  });

  it('reads every credential-rejection code as auth (S2102 signature, S2103 expired)', () => {
    for (const code of ['PSYNC_S2102', 'PSYNC_S2103']) {
      const raw = `HTTP 401: {"error":{"code":"${code}","status":401,"name":"AuthorizationError"}}`;
      expect(describeSyncFailure(raw)?.kind).toBe('auth');
    }
  });

  it('treats an UNKNOWN code as auth when status and name both say authorization failed', () => {
    const raw =
      'HTTP 403: {"error":{"code":"PSYNC_S9999","status":403,"name":"AuthorizationError"}}';
    expect(describeSyncFailure(raw)?.kind).toBe('auth');
  });

  it('keeps a plain message as an other-kind failure', () => {
    expect(describeSyncFailure('Connection refused')).toEqual({
      kind: 'other',
      code: null,
      detail: null,
      raw: 'Connection refused',
    });
  });

  it('keeps a non-auth service error as other (a 500 is not a credential problem)', () => {
    const raw = 'HTTP 500: {"error":{"code":"PSYNC_S1001","status":500,"name":"InternalError"}}';
    expect(describeSyncFailure(raw)).toMatchObject({ kind: 'other', code: 'PSYNC_S1001' });
  });

  it('survives a JSON-looking message that does not parse', () => {
    expect(describeSyncFailure('HTTP 502: {not json')).toMatchObject({
      kind: 'other',
      code: null,
      detail: null,
    });
  });

  it('returns null when there is no failure at all', () => {
    expect(describeSyncFailure(null)).toBeNull();
    expect(describeSyncFailure('   ')).toBeNull();
  });
});

describe('truncateForDisplay', () => {
  it('leaves a short message untouched', () => {
    expect(truncateForDisplay('Connection refused')).toBe('Connection refused');
  });

  it('elides a long body so it can never become the whole card', () => {
    const long = 'x'.repeat(SYNC_FAILURE_MAX_LENGTH + 50);
    const out = truncateForDisplay(long);
    expect(out).toHaveLength(SYNC_FAILURE_MAX_LENGTH + 1);
    expect(out.endsWith('…')).toBe(true);
  });
});
