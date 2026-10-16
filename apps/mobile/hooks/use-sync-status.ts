/**
 * The cloud-sync status for the Settings card (issue #22).
 *
 * Reads the PowerSync SDK's live status through `useStatus()` and derives the
 * card's four display states with the pure `deriveSyncDisplay`
 * (`lib/sync-status.ts`). `@powersync/react` is the ONLY PowerSync package the
 * app may import outside `packages/db`, and `useStatus` is explicitly inside
 * that boundary (`.trellis/spec/app/database-guidelines.md`).
 *
 * `syncNow()` is the honest implementation of 「立即同步」. PowerSync has no
 * "sync now" API — it is a long-lived streaming connection, so "立刻同步一下"
 * has to mean "re-establish the stream and flush what is queued". Re-entering
 * `connect(connector)` does exactly that (the upload queue is flushed on
 * (re)connect), and it is the only public, STABLE way to force a pass.
 * `requestCheckpoint()` is deliberately NOT used: it is marked @alpha, requires
 * `checkpointMode: 'requests'` (the SDK default is `'legacy'`) and a service
 * version ≥ 1.24.0 — wiring it would make a UI feature depend on a deployment
 * upgrade, and it would throw against the current stack.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePowerSync, useStatus } from '@powersync/react';
import {
  createPowerSyncConnector,
  getOwnerToken,
  getStoredBackendConfig,
  type StoredBackendConfig,
} from '@nextdo/db';
import { logger } from '@nextdo/core';
import {
  deriveSyncDisplay,
  type ManualSyncState,
  type SyncDisplay,
} from '@/lib/sync-status';

/**
 * Bound on 「立即同步」 waiting for the stream to settle. The SDK retries a
 * failed connection INTERNALLY and `connect()` resolves regardless, so without
 * this an offline device would leave the button on 同步中… forever (AC4).
 */
const SYNC_NOW_TIMEOUT_MS = 8000;

const SYNC_TIMEOUT_MESSAGE = '同步超时，请检查网络后重试';
const NOT_CONNECTED_MESSAGE = '尚未连接同步服务器';

export interface UseSyncStatusResult {
  display: SyncDisplay;
  /** The SDK's last-completed-sync time; undefined until one completes — and
   *  RESET by a PowerSync service restart, which is why the card renders a
   *  「尚未完成过同步」 line instead of a guess. */
  lastSyncedAt: Date | undefined;
  /** The last manual attempt, for the card's feedback line. */
  manual: ManualSyncState;
  syncNow: () => Promise<void>;
}

export function useSyncStatus(configured: boolean): UseSyncStatusResult {
  const powersync = usePowerSync();
  const status = useStatus();
  const [pendingUploads, setPendingUploads] = useState(0);
  const [manual, setManual] = useState<ManualSyncState>(null);

  // Queue depth, re-read on every SDK status change: a local write enqueueing
  // an upload and the queue draining afterwards both surface as status
  // transitions, so no poll is needed. Skipped while sync is not configured —
  // no card state can show the number there.
  useEffect(() => {
    if (!configured) {
      setPendingUploads(0);
      return;
    }
    let disposed = false;
    void powersync
      .getUploadQueueStats()
      .then((stats) => {
        if (!disposed) setPendingUploads(stats.count);
      })
      .catch((error: unknown) => {
        logger.warn(
          'upload queue stats read failed',
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    return () => {
      disposed = true;
    };
  }, [powersync, status, configured]);

  const display = useMemo(
    () =>
      deriveSyncDisplay({
        configured,
        connected: status.connected,
        connecting: status.connecting,
        downloading: status.downloading,
        uploading: status.uploading,
        downloadError: status.downloadError ? status.downloadError.message : null,
        uploadError: status.uploadError ? status.uploadError.message : null,
        pendingUploads,
        manual,
      }),
    [configured, status, pendingUploads, manual],
  );

  const syncNow = useCallback(async (): Promise<void> => {
    setManual({ kind: 'running' });

    let token: string | null = null;
    let config: StoredBackendConfig | null = null;
    try {
      token = await getOwnerToken();
      if (token !== null) config = await getStoredBackendConfig();
    } catch (error) {
      // `token` and `config` keep their initial nulls — the guard below is
      // what reports the failure.
      logger.warn(
        'sync now: auth read failed',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    if (token === null || config === null) {
      setManual({ kind: 'failed', reason: NOT_CONNECTED_MESSAGE });
      return;
    }

    const timerRef: { id: ReturnType<typeof setTimeout> | null } = { id: null };
    try {
      const timedOut = new Promise<never>((_resolve, reject) => {
        timerRef.id = setTimeout(() => {
          reject(new Error(SYNC_TIMEOUT_MESSAGE));
        }, SYNC_NOW_TIMEOUT_MS);
      });
      await powersync.connect(createPowerSyncConnector(config));
      const settled = powersync.waitForStatus(
        (next) => next.connected && !next.downloading && !next.uploading,
      );
      // The timeout may win this race while `settled` is still pending (and it
      // rejects later on a disconnect) — never leave that unhandled.
      settled.catch(() => undefined);
      await Promise.race([settled, timedOut]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setManual({ kind: 'failed', reason: message });
      return;
    } finally {
      if (timerRef.id !== null) clearTimeout(timerRef.id);
    }

    // Connected and idle is not the same as "nothing went wrong": the SDK
    // keeps the failure on the status until the next SUCCESSFUL pass, and a
    // silent success report over a live failure is the one thing AC4 forbids.
    const after = powersync.currentStatus;
    const failure = after.downloadError ?? after.uploadError;
    setManual(failure ? { kind: 'failed', reason: failure.message } : { kind: 'ok' });
  }, [powersync]);

  return { display, lastSyncedAt: status.lastSyncedAt, manual, syncNow };
}
