import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { InboxItem } from '@nextdo/core';
import { QuickCaptureModal } from '@/components/quick-capture-modal';

/** A freshly captured item (R1 handoff payload). */
const ITEM: InboxItem = {
  id: 'inbox-new-1',
  createdAt: '2026-09-22T02:00:00.000Z',
  updatedAt: '2026-09-22T02:00:00.000Z',
  deletedAt: null,
  title: '买牛奶和咖啡豆',
  capturedAt: '2026-09-22T02:00:00.000Z',
};

describe('QuickCaptureModal', () => {
  it('renders title and inputs when visible', () => {
    render(
      <QuickCaptureModal
        visible={true}
        onClose={jest.fn()}
        onAdd={jest.fn(async () => null)}
      />,
    );

    expect(screen.getByText('有什么想记下的？')).toBeTruthy();
    expect(screen.getByPlaceholderText(/记下任何事/)).toBeTruthy();
  });

  it('submits captured text and hands the saved item to onCaptured', async () => {
    const onAdd = jest.fn(async () => ITEM);
    const onCaptured = jest.fn();
    render(
      <QuickCaptureModal
        visible={true}
        onClose={jest.fn()}
        onAdd={onAdd}
        onCaptured={onCaptured}
      />,
    );

    const input = screen.getByPlaceholderText(/记下任何事/);
    fireEvent.changeText(input, '买牛奶和咖啡豆');
    fireEvent.press(screen.getByText('记录'));

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith('买牛奶和咖啡豆');
    });

    // R1 handoff: the parent gets the item (it opens the Clarify wizard).
    await waitFor(() => {
      expect(onCaptured).toHaveBeenCalledWith(ITEM);
    });
    // The draft is reset for the next capture.
    expect(screen.getByPlaceholderText(/记下任何事/).props.value).toBe('');
  });

  it('记录并澄清 saves then hands the item to onCapturedAndClarify (issue #58)', async () => {
    const onAdd = jest.fn(async () => ITEM);
    const onCaptured = jest.fn();
    const onCapturedAndClarify = jest.fn();
    render(
      <QuickCaptureModal
        visible={true}
        onClose={jest.fn()}
        onAdd={onAdd}
        onCaptured={onCaptured}
        onCapturedAndClarify={onCapturedAndClarify}
      />,
    );

    const input = screen.getByPlaceholderText(/记下任何事/);
    fireEvent.changeText(input, '买牛奶和咖啡豆');
    fireEvent.press(screen.getByText('记录并澄清'));

    await waitFor(() => {
      expect(onCapturedAndClarify).toHaveBeenCalledWith(ITEM);
    });
    // A clarify handoff is NOT a plain save — the parent gets exactly one.
    expect(onCaptured).not.toHaveBeenCalled();
  });

  it('hides 记录并澄清 when the parent does not offer the handoff', () => {
    render(
      <QuickCaptureModal
        visible={true}
        onClose={jest.fn()}
        onAdd={jest.fn(async () => null)}
        onCaptured={jest.fn()}
      />,
    );

    expect(screen.queryByText('记录并澄清')).toBeNull();
  });

  it('a failed save (null) does not call onCaptured', async () => {
    const onAdd = jest.fn(async () => null);
    const onCaptured = jest.fn();
    render(
      <QuickCaptureModal
        visible={true}
        onClose={jest.fn()}
        onAdd={onAdd}
        onCaptured={onCaptured}
      />,
    );

    const input = screen.getByPlaceholderText(/记下任何事/);
    fireEvent.changeText(input, '保存失败');
    fireEvent.press(screen.getByText('记录'));

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith('保存失败');
    });
    expect(onCaptured).not.toHaveBeenCalled();
    // The draft is kept so the user can retry.
    expect(screen.getByPlaceholderText(/记下任何事/).props.value).toBe('保存失败');
  });

  it('calls onClose when backdrop or cancel button is pressed', () => {
    const onClose = jest.fn();
    render(
      <QuickCaptureModal
        visible={true}
        onClose={onClose}
        onAdd={jest.fn(async () => null)}
      />,
    );

    fireEvent.press(screen.getByText('稍后再说'));
    expect(onClose).toHaveBeenCalled();
  });

  it('submits on Enter key press', async () => {
    const onAdd = jest.fn(async () => ITEM);
    const onCaptured = jest.fn();
    render(
      <QuickCaptureModal
        visible={true}
        onClose={jest.fn()}
        onAdd={onAdd}
        onCaptured={onCaptured}
      />,
    );

    const input = screen.getByPlaceholderText(/记下任何事/);
    fireEvent.changeText(input, '键盘回车录入');
    fireEvent(input, 'keyPress', { nativeEvent: { key: 'Enter' } });

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith('键盘回车录入');
    });
    await waitFor(() => {
      expect(onCaptured).toHaveBeenCalledWith(ITEM);
    });
  });

  it('dismisses modal on Escape key press', () => {
    const onClose = jest.fn();
    render(
      <QuickCaptureModal
        visible={true}
        onClose={onClose}
        onAdd={jest.fn(async () => null)}
      />,
    );

    const input = screen.getByPlaceholderText(/记下任何事/);
    fireEvent(input, 'keyPress', { nativeEvent: { key: 'Escape' } });

    expect(onClose).toHaveBeenCalled();
  });
});
