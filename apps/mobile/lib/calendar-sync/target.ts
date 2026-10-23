/**
 * The target-calendar handle shared by both calendar implementations.
 *
 * A native device hands out a real `ExpoCalendar` (its `createEvent` is a
 * method on the calendar object); the desktop shell resolves the calendar
 * inside Rust on every write, so it only carries an id. Keeping both shapes in
 * one union lets the sync hook stay platform-agnostic while each
 * implementation narrows to what it needs.
 *
 * `expo-calendar` is imported as a TYPE only — it pulls in a native module at
 * runtime, which must never reach the web bundle.
 */
import type { ExpoCalendar } from 'expo-calendar';

export type CalendarTarget =
  | { kind: 'native'; calendar: ExpoCalendar }
  | { kind: 'desktop'; id: string };

/**
 * The id persisted in the sync state.
 *
 * It is a diagnostic breadcrumb, not a lookup key: every write resolves its
 * calendar again (a user can delete the Nextdo calendar between passes), so a
 * stale value here never breaks the next reconcile.
 */
export function calendarTargetId(target: CalendarTarget): string {
  return target.kind === 'native' ? target.calendar.id : target.id;
}
