/**
 * The Settings tab's view of the latest reminder-delivery failure
 * (issue #92) — a thin subscription to the in-memory feedback store.
 *
 * One hook per file (hook-guidelines Rule 1). The web adapter writes the
 * store; the screen only reads it.
 */
import { useSyncExternalStore } from 'react';
import {
  getReminderDeliveryFailure,
  subscribeToReminderDeliveryFailure,
  type ReminderDeliveryFailure,
} from '@/lib/reminders/delivery-feedback';

export function useReminderDeliveryFailure(): ReminderDeliveryFailure | null {
  return useSyncExternalStore(
    subscribeToReminderDeliveryFailure,
    getReminderDeliveryFailure,
    getReminderDeliveryFailure,
  );
}
