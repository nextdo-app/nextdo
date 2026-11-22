/**
 * Visible reminder-delivery feedback (issue #92).
 *
 * Native and tauri delivery failures have an OS-level surface (the OS may
 * reject a schedule, and the Settings block reports the permission state).
 * A browser `Notification` / `showNotification` rejection has neither — it
 * would vanish into the console while the user sees nothing. This tiny
 * in-memory store keeps the LATEST web delivery failure so the Settings
 * tab can render it; the next successful send clears it.
 *
 * Deliberately not persisted: a failure is about the current page session,
 * and a reload re-evaluates the browser permission from scratch. Nothing
 * here is a business row.
 *
 * Kept platform-free so the web adapter and the Settings screen can share
 * it without importing browser globals at module load.
 */

export interface ReminderDeliveryFailure {
  /** The reminder row whose notification the browser refused. */
  reminderId: string;
  /** The raw error message — logged/diagnostic; the UI shows fixed copy. */
  message: string;
  at: Date;
}

let current: ReminderDeliveryFailure | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A misbehaving subscriber must not break delivery.
    }
  }
}

/**
 * Record a failed send. A repeat of the SAME reminder + message does not
 * notify again (the 30 s tick may retry inside the grace window).
 */
export function reportReminderDeliveryFailure(reminderId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (current?.reminderId === reminderId && current.message === message) return;
  current = { reminderId, message, at: new Date() };
  notify();
}

/** A successful send proves the channel works again — drop the warning. */
export function clearReminderDeliveryFailure(): void {
  if (current === null) return;
  current = null;
  notify();
}

export function getReminderDeliveryFailure(): ReminderDeliveryFailure | null {
  return current;
}

/** Subscribe to store changes (the Settings hook). Returns unsubscribe. */
export function subscribeToReminderDeliveryFailure(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test hook: drop the store between suites. */
export function __resetReminderDeliveryFeedbackForTests(): void {
  current = null;
  listeners.clear();
}
