/**
 * Sync display derivation (issue #22) — PURE, platform-free.
 *
 * The Settings tab's cloud-sync card renders four states the PowerSync SDK's
 * own `connected` boolean cannot express on its own (issue #22 期望方案 3):
 * 同步中 / 已同步 / 有未同步改动 / 同步失败. Deriving them here keeps the
 * screen a renderer and makes every transition unit-testable.
 *
 * Copy stays in the screen (the `UPDATE_FAILURE_COPY` precedent) — this module
 * returns the STATE plus the numbers the sentence needs, never the sentence.
 */

export type SyncDisplayKind = 'offline' | 'syncing' | 'pending' | 'synced' | 'failed';

/** The last manual 「立即同步」 attempt (null = none this session). */
export type ManualSyncState =
  | { kind: 'running' }
  | { kind: 'ok' }
  | { kind: 'failed'; reason: string }
  | null;

export interface SyncDisplayInput {
  /** Owner token AND stored server config are both present — the app is set
   *  up to sync. Without them PowerSync stays disconnected by design. */
  configured: boolean;
  connected: boolean;
  connecting: boolean;
  downloading: boolean;
  uploading: boolean;
  /** The SDK's own failure, if any (cleared on the next successful pass). */
  downloadError: string | null;
  uploadError: string | null;
  /** Local operations still queued for upload. */
  pendingUploads: number;
  manual: ManualSyncState;
}

export interface SyncDisplay {
  kind: SyncDisplayKind;
  /** The queue depth the `pending` copy quotes (0 for every other kind). */
  pendingUploads: number;
  /** The reason the `failed` copy quotes; null for every other kind. */
  error: string | null;
}

export function deriveSyncDisplay(input: SyncDisplayInput): SyncDisplay {
  const pendingUploads = Math.max(0, input.pendingUploads);
  // Priority: whatever most needs the user's attention wins, so a real failure
  // is never hidden behind a 「同步中」 that is merely retrying.
  const sdkError = input.downloadError ?? input.uploadError;
  if (sdkError !== null) {
    return { kind: 'failed', pendingUploads, error: sdkError };
  }
  if (input.manual?.kind === 'failed') {
    return { kind: 'failed', pendingUploads, error: input.manual.reason };
  }
  if (!input.configured) {
    return { kind: 'offline', pendingUploads, error: null };
  }
  if (input.connecting || input.downloading || input.uploading || input.manual?.kind === 'running') {
    return { kind: 'syncing', pendingUploads, error: null };
  }
  if (pendingUploads > 0) {
    return { kind: 'pending', pendingUploads, error: null };
  }
  if (!input.connected) {
    return { kind: 'offline', pendingUploads, error: null };
  }
  return { kind: 'synced', pendingUploads, error: null };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * 「10月16日 14:32」 in LOCAL time (the user's clock is the meaningful one for
 * a sync they just watched happen), prefixed with the year when the sync did
 * not happen this year — 「5月3日 09:12」 would otherwise read as this year.
 *
 * Returns null for a sync that never completed: `SyncStatus.lastSyncedAt` is
 * undefined both before the first full sync AND after a PowerSync service
 * restart, so the card must say 「尚未完成过同步」 rather than print a time it
 * does not have (issue #22 AC2 / AC3). `now` is injected (hook-guidelines
 * Rule 4).
 */
export function formatLastSyncedAt(now: Date, lastSyncedAt: Date | undefined): string | null {
  if (lastSyncedAt === undefined) return null;
  if (Number.isNaN(lastSyncedAt.getTime())) return null;
  const monthDay = `${lastSyncedAt.getMonth() + 1}月${lastSyncedAt.getDate()}日`;
  const clock = `${pad2(lastSyncedAt.getHours())}:${pad2(lastSyncedAt.getMinutes())}`;
  return lastSyncedAt.getFullYear() === now.getFullYear()
    ? `${monthDay} ${clock}`
    : `${lastSyncedAt.getFullYear()}年${monthDay} ${clock}`;
}

/**
 * A PowerSync service error, split out of the SDK's message.
 *
 * The SDK surfaces a service rejection as the WHOLE HTTP response —
 * `HTTP <status>: {"error":{"code":"PSYNC_S2101","status":401,
 * "description":"…","name":"AuthorizationError"}}` — and handing that
 * verbatim to a screen is how a JSON blob ends up on the sync card.
 */
export interface SyncFailure {
  /**
   * `auth` — the service rejected our credentials. Retrying cannot fix it
   * (only the deployment's authentication config can), so the card must say
   * so instead of quietly resending. `other` — network / protocol / bugs.
   */
  kind: 'auth' | 'other';
  /** The service's error code when the body carried one (e.g. PSYNC_S2101). */
  code: string | null;
  /** The service's own description, for a secondary line. */
  detail: string | null;
  /** The untouched message — the fallback copy's source. */
  raw: string;
}

/**
 * PowerSync service codes that mean "your credentials were rejected"
 * (docs.powersync.com/debugging/error-codes):
 * S2101 = no key matched the token's `kid`, S2102 = the signature could not
 * be verified, S2103 = the token expired.
 */
const SYNC_AUTH_ERROR_CODES: ReadonlySet<string> = new Set([
  'PSYNC_S2101',
  'PSYNC_S2102',
  'PSYNC_S2103',
]);

/** Longest raw message a card prints before elision — a service body is a
 *  wall of JSON and must never become the whole card. */
export const SYNC_FAILURE_MAX_LENGTH = 160;

export function truncateForDisplay(text: string, max = SYNC_FAILURE_MAX_LENGTH): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

interface ParsedServiceError {
  code: string | null;
  detail: string | null;
  status: number | null;
  name: string | null;
}

/** Find and parse the JSON body inside an SDK message (`HTTP <s>: {…}`).
 *  Returns null when the message carries none. */
function parseServiceError(raw: string): ParsedServiceError | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const error = (parsed as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return null;
  const body = error as Record<string, unknown>;
  return {
    code: typeof body.code === 'string' ? body.code : null,
    detail:
      typeof body.description === 'string'
        ? body.description
        : typeof body.message === 'string'
          ? body.message
          : null,
    status: typeof body.status === 'number' ? body.status : null,
    name: typeof body.name === 'string' ? body.name : null,
  };
}

/**
 * Turn the SDK's raw failure message into something a screen can render.
 * Returns null when there is no failure.
 *
 * Two INDEPENDENT auth signals, because they can disagree: a known code, or
 * a 401/403 the service itself named an `AuthorizationError` — an
 * unrecognized code must still read as auth when status and name both say so.
 */
export function describeSyncFailure(raw: string | null): SyncFailure | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const parsed = parseServiceError(trimmed);
  if (parsed === null) {
    return { kind: 'other', code: null, detail: null, raw: trimmed };
  }
  const authByCode = parsed.code !== null && SYNC_AUTH_ERROR_CODES.has(parsed.code);
  const authByStatus =
    (parsed.status === 401 || parsed.status === 403) && parsed.name === 'AuthorizationError';
  return {
    kind: authByCode || authByStatus ? 'auth' : 'other',
    code: parsed.code,
    detail: parsed.detail,
    raw: trimmed,
  };
}
