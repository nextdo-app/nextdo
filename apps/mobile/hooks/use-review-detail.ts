import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { getReviewDetails, wrapDb } from '@nextdo/db';
import { logger } from '@nextdo/core';
import { errorMessage } from '@/lib/error-messages';

export function useReviewDetail(id: string) {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const [data, setData] = useState<Awaited<ReturnType<typeof getReviewDetails>>>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getReviewDetails(db, id).then((result) => {
      if (!cancelled) setData(result);
    }).catch((err: unknown) => {
      if (cancelled) return;
      logger.error('review detail query failed', err instanceof Error ? err : new Error(String(err)));
      setError(errorMessage(err));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [db, id, reloadKey]);
  return { data, loading, error, reload };
}
