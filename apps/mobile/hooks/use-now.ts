/**
 * The Now screen's recommendation (design.md §4.1 — extended from the
 * scaffold vertical slice): pool → engine → the ONE action, PLUS the
 * ranked eligible list ("稍后 N 个可执行事项"), the filtered-out list with
 * rules (explainable empty state), and the re-clarify candidates.
 *
 * The engine context is the user's persisted setting
 * (`useEngineContextSettings`) — the scaffold hardcoded `[]`/60; the default
 * constant is the same value so an unloaded store never changes behavior.
 *
 * Engine output is computed, never stored (state-management Rule 5):
 * `recommend()` re-runs (memoized on pool + context + clock) whenever any
 * input changes — the Now screen always reflects the current DB snapshot.
 */
import { useMemo } from 'react';
import {
  RECLARIFY_THRESHOLD,
  recommend,
  type CandidateAction,
  type FilterRuleId,
  type Reason,
} from '@nextdo/core';
import { useActionPool } from './use-action-pool';
import { useAppClock } from './use-app-clock';
import {
  DEFAULT_ENGINE_CONTEXT,
  useEngineContextSettings,
  type EngineContextSettings,
} from '@/lib/engine-context';

export interface NowEligible {
  action: CandidateAction;
  score: number;
  reasons: Reason[];
}

export interface NowFiltered {
  action: CandidateAction;
  rule: FilterRuleId;
}

export interface NowNeedsReclarify {
  action: CandidateAction;
  consecutiveSkips: number;
}

export interface NowData {
  /** null = nothing to recommend (empty pool, or every candidate filtered). */
  recommended: CandidateAction | null;
  score: number;
  /** Score + eligibility reasons — the screen shows the top three. */
  reasons: Reason[];
  /** Hard-filter survivors, ranked — backs "换一个" and the "稍后" list. */
  eligible: NowEligible[];
  /** Exclusions + the rule — the explainable "all filtered" empty state. */
  filtered: NowFiltered[];
  /** Candidates with consecutiveSkips ≥ RECLARIFY_THRESHOLD. */
  needsReclarify: NowNeedsReclarify[];
  /** True when the pool itself has no candidates (vs all-filtered). */
  poolEmpty: boolean;
  /** The recommended action trips the re-clarify banner at this count. */
  recommendedConsecutiveSkips: number;
}

export interface UseNowResult {
  data: NowData | null;
  error: string | null;
}

export function useNow(context?: EngineContextSettings | null): UseNowResult {
  const now = useAppClock();
  const poolQuery = useActionPool(now);
  // Always call the settings hook (Rules of Hooks) — the screen owns ONE
  // instance and passes it in so the pool recomputes on chip changes;
  // without an explicit context this falls back to loading the store here.
  const { settings: loadedSettings } = useEngineContextSettings();
  const effectiveContext = context ?? loadedSettings ?? DEFAULT_ENGINE_CONTEXT;

  const data = useMemo<NowData | null>(() => {
    const pool = poolQuery.data;
    if (pool === null) return null;
    // Issue #46: the 场景 (contexts) feature is offline — an EMPTY context
    // list means "anywhere" in the engine contract, so nothing is filtered
    // out by location and legacy actions with `contextIds` still surface.
    const output = recommend({
      ...pool,
      context: { contextIds: [], availableMinutes: effectiveContext.availableMinutes },
      now,
    });

    const byId = new Map(pool.actions.map((candidate) => [candidate.id, candidate]));
    const pick = (id: string): CandidateAction | undefined => byId.get(id);

    const eligible: NowEligible[] = output.eligible
      .map((scored) => {
        const action = pick(scored.actionId);
        return action === undefined
          ? null
          : { action, score: scored.score, reasons: scored.reasons };
      })
      .filter((entry): entry is NowEligible => entry !== null);

    const filtered: NowFiltered[] = output.filtered
      .map((entry) => {
        const action = pick(entry.actionId);
        return action === undefined ? null : { action, rule: entry.rule };
      })
      .filter((entry): entry is NowFiltered => entry !== null);

    const needsReclarify: NowNeedsReclarify[] = output.needsReclarify
      .map((entry) => {
        const action = pick(entry.actionId);
        return action === undefined ? null : { action, consecutiveSkips: entry.consecutiveSkips };
      })
      .filter((entry): entry is NowNeedsReclarify => entry !== null);

    const recommendedScored = output.recommended;
    const recommended = recommendedScored === null ? null : pick(recommendedScored.actionId) ?? null;

    return {
      recommended,
      score: recommendedScored?.score ?? 0,
      reasons: recommendedScored?.reasons ?? [],
      eligible,
      filtered,
      needsReclarify,
      poolEmpty: pool.actions.length === 0,
      recommendedConsecutiveSkips: recommended?.consecutiveSkips ?? 0,
    };
  }, [poolQuery.data, effectiveContext, now]);

  return { data, error: poolQuery.error };
}

/** True when the engine wants the Now screen to offer re-clarify (PRD R3). */
export function shouldOfferReclarify(consecutiveSkips: number): boolean {
  return consecutiveSkips >= RECLARIFY_THRESHOLD;
}
