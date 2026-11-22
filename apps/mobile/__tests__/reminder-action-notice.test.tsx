/**
 * Issue #99: the inline-action failure banner — rendered by the root
 * `<ReminderDelivery/>`, so it must render nothing when there is no failure
 * and expose a dismissible Chinese message otherwise.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ReminderActionNotice } from '@/components/reminder-action-notice';

describe('ReminderActionNotice', () => {
  it('renders nothing without a failure', () => {
    render(<ReminderActionNotice message={null} onDismiss={jest.fn()} />);
    expect(screen.queryByTestId('reminder-action-notice')).toBeNull();
  });

  it('shows the mapped message and dismisses', () => {
    const onDismiss = jest.fn();
    render(
      <ReminderActionNotice
        message="这个行动不存在了（可能已被删除）"
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByTestId('reminder-action-notice')).toBeTruthy();
    expect(
      screen.getByText('通知操作失败：这个行动不存在了（可能已被删除）'),
    ).toBeTruthy();

    fireEvent.press(screen.getByLabelText('关闭通知操作失败提示'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
