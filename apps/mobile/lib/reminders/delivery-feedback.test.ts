/**
 * The in-memory delivery-failure store (issue #92) — the Settings hint's
 * source. The adapter-side write/clear is covered by the web adapter
 * suite; this pins the store semantics: notify once, clear, subscribe.
 */
import {
  __resetReminderDeliveryFeedbackForTests,
  clearReminderDeliveryFailure,
  getReminderDeliveryFailure,
  reportReminderDeliveryFailure,
  subscribeToReminderDeliveryFailure,
} from './delivery-feedback';

beforeEach(() => {
  __resetReminderDeliveryFeedbackForTests();
});

describe('reminder delivery feedback', () => {
  it('stores the latest failure and notifies subscribers', () => {
    const listener = jest.fn();
    subscribeToReminderDeliveryFailure(listener);

    reportReminderDeliveryFailure('rem-1', new Error('boom'));

    expect(getReminderDeliveryFailure()).toMatchObject({
      reminderId: 'rem-1',
      message: 'boom',
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify again for the same reminder + error (tick retries)', () => {
    const listener = jest.fn();
    subscribeToReminderDeliveryFailure(listener);

    reportReminderDeliveryFailure('rem-1', new Error('boom'));
    reportReminderDeliveryFailure('rem-1', new Error('boom'));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('a different failure replaces the previous one', () => {
    reportReminderDeliveryFailure('rem-1', new Error('boom'));
    reportReminderDeliveryFailure('rem-2', 'no notification permission');

    expect(getReminderDeliveryFailure()).toMatchObject({
      reminderId: 'rem-2',
      message: 'no notification permission',
    });
  });

  it('clears on success and notifies; clearing an empty store is a no-op', () => {
    const listener = jest.fn();
    subscribeToReminderDeliveryFailure(listener);

    clearReminderDeliveryFailure();
    expect(listener).not.toHaveBeenCalled();

    reportReminderDeliveryFailure('rem-1', new Error('boom'));
    clearReminderDeliveryFailure();

    expect(getReminderDeliveryFailure()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe stops notifications', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToReminderDeliveryFailure(listener);
    unsubscribe();

    reportReminderDeliveryFailure('rem-1', new Error('boom'));

    expect(listener).not.toHaveBeenCalled();
  });
});
