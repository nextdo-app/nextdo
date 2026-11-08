import { useCallback, useMemo, useRef, useState } from 'react';
import { usePowerSync } from '@powersync/react';
import { submitReview, wrapDb } from '@nextdo/db';
import {
  logger,
  toIso,
  ulid,
  type DailyReviewAnswers,
  type DailyReviewSnapshot,
  type WeeklyReviewAnswers,
  type WeeklyReviewSnapshot,
} from '@nextdo/core';
import { errorMessage } from '@/lib/error-messages';
import { useAppClock } from './use-app-clock';

export type ReviewRecordInput =
  | { kind: 'daily'; snapshot: DailyReviewSnapshot; answers: DailyReviewAnswers }
  | { kind: 'weekly'; snapshot: WeeklyReviewSnapshot; answers: WeeklyReviewAnswers };

export interface UseSubmitReviewResult {
  submit: (input: ReviewRecordInput) => Promise<boolean>;
  error: string | null;
  submitting: boolean;
}

export function useSubmitReview(): UseSubmitReviewResult {
  const powersync = usePowerSync();
  const db = useMemo(() => wrapDb(powersync), [powersync]);
  const now = useAppClock();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const submitted = useRef(false);
  const attemptId = useRef<string | null>(null);

  const submit = useCallback(
    async (input: ReviewRecordInput): Promise<boolean> => {
      if (inFlight.current || submitted.current) return false;
      inFlight.current = true;
      setSubmitting(true);
      attemptId.current ??= ulid(now);
      const nowIso = toIso(now);
      const record = {
        id: attemptId.current,
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
        at: nowIso,
        ...input,
      };
      try {
        await submitReview(db, { record, now });
        submitted.current = true;
        setError(null);
        return true;
      } catch (err: unknown) {
        logger.error('review submission failed', err instanceof Error ? err : new Error(String(err)));
        setError(errorMessage(err));
        return false;
      } finally {
        inFlight.current = false;
        setSubmitting(false);
      }
    },
    [db, now],
  );

  return { submit, error, submitting };
}
