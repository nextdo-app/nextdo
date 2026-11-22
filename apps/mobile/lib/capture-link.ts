/**
 * Build the Clarify route for a capture whose preview has a date/time
 * suggestion (issue #101). The hint rides in route params: the inbox item
 * itself stays a raw title (no schema/sync change), and Clarify prefills
 * its deadline / startsAt fields from these values.
 *
 * Only ISO values leave this function, and Clarify validates them again —
 * URL params are user-editable input, not trusted state.
 */
import type { CaptureSchedule } from '@nextdo/core';

export function clarifyHrefWithSchedule(
  inboxItemId: string,
  schedule: CaptureSchedule | null,
): string {
  const base = `/clarify/${inboxItemId}`;
  if (schedule === null) return base;
  const params: string[] = [];
  // A deadline always informs the action form. A clock time (deadline or
  // calendar) can also seed the calendar form's start.
  if (schedule.kind === 'deadline' && schedule.deadline !== undefined) {
    params.push(`deadline=${encodeURIComponent(schedule.deadline)}`);
  }
  if (schedule.startsAt !== undefined) {
    params.push(`startsAt=${encodeURIComponent(schedule.startsAt)}`);
    params.push(`estMinutes=${encodeURIComponent(String(schedule.estMinutes ?? 30))}`);
  }
  if (params.length === 0) return base;
  return `${base}?${params.join('&')}`;
}
