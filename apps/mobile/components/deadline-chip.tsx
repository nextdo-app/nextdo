/**
 * The deadline state chip (issue #16).
 *
 * Every list and detail row that shows a deadline renders it through this
 * one component, so a project and an action due at the same instant always
 * read the same way — and so the 「逾期」/「临近」 threshold has exactly one
 * home (`deadlineStatus` in core). Colour alone never carries the meaning:
 * the label always spells out 逾期 / 今天截止 / 还剩 N 天.
 */
import { Tag, type TagTone } from '@nextdo/ui';
import { deadlineStatus, formatDeadline, type DeadlineStatus } from '@nextdo/core';

/** `overdue` is the only state that must shout; `soon` should warn, not alarm. */
const TONE_BY_STATUS: Record<Exclude<DeadlineStatus, 'none'>, TagTone> = {
  overdue: 'danger',
  soon: 'warning',
  upcoming: 'neutral',
};

export interface DeadlineChipProps {
  deadline?: string | null;
  now: Date;
}

/** Renders nothing when there is no deadline — an empty chip is just noise. */
export function DeadlineChip({ deadline, now }: DeadlineChipProps) {
  const status = deadlineStatus(deadline, now);
  if (status === 'none') return null;
  return <Tag label={formatDeadline(deadline, now)} tone={TONE_BY_STATUS[status]} />;
}