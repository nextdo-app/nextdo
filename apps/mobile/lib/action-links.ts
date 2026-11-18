/**
 * Deep-link builders for the Now screen's actions.
 *
 * The focus route takes the action's estimate as a `preset` so the focus
 * timer opens on the same duration the recommendation card showed. Both the
 * hero's 开始 button and a list row's title must build the same href — this
 * helper is the single definition.
 */
import type { CandidateAction } from '@nextdo/core';

export function focusHref(
  action: Pick<CandidateAction, 'id' | 'kind' | 'estMinutes'>,
): string {
  const preset = action.estMinutes > 0 ? `&preset=${action.estMinutes}` : '';
  return `/focus/${action.id}?kind=${action.kind}${preset}`;
}
