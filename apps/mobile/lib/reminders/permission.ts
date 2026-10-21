/**
 * Contextual permission request (D4 / R5): the FIRST reminder-creating
 * action — a successful snooze, a clarify / re-clarify calendar
 * submission (a calendar action starting within 60 min creates a
 * reminder row) — asks the OS for notification permission.
 *
 * Semantics:
 * - native: ask ONLY while `undetermined` (the OS would not show the
 *   prompt again anyway — a denied user is guided from the Settings
 *   block instead, not re-nagged);
 * - tauri: no-op (desktop always reports granted, no prompt model);
 * - web: no-op (R6).
 *
 * NEVER blocks the business flow: callers fire-and-forget, and any
 * failure is logged, not thrown — a denied / failed permission just means
 * the reminder rows exist but are not delivered (D4: 被拒不阻塞).
 */
import { logger } from '@nextdo/core';
import { getDeliveryAdapter } from './adapters';

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function maybeRequestNotificationPermission(): Promise<void> {
  try {
    const adapter = getDeliveryAdapter();
    if (adapter.platform !== 'native') return;
    const state = await adapter.permission();
    if (state.status === 'undetermined' || (state.status === 'denied' && state.canAskAgain)) {
      await adapter.requestPermission();
    }
  } catch (error) {
    logger.warn('notification permission request failed', toError(error));
  }
}
