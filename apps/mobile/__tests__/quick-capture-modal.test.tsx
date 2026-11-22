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
      expect(onAdd).toHaveBeenCalledWith('买牛奶和咖啡豆', null);
    });

    // R1 handoff: the parent gets the item (it opens the Clarify wizard).
    await waitFor(() => {
      expect(onCaptured).toHaveBeenCalledWith(ITEM, null);
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
      expect(onCapturedAndClarify).toHaveBeenCalledWith(ITEM, null);
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
      expect(onAdd).toHaveBeenCalledWith('保存失败', null);
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
      expect(onAdd).toHaveBeenCalledWith('键盘回车录入', null);
    });
    await waitFor(() => {
      expect(onCaptured).toHaveBeenCalledWith(ITEM, null);
    });
  });

  it.each([
    { isComposing: true, keyCode: 13 },
    { isComposing: false, keyCode: 229 },
    { keyCode: 229 },
  ])('keeps the draft when Enter confirms IME input (%j)', async (composition) => {
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
    fireEvent.changeText(input, '买牛奶');
    fireEvent(input, 'keyPress', { nativeEvent: { key: 'Enter', ...composition } });

    expect(onAdd).not.toHaveBeenCalled();
    expect(onCaptured).not.toHaveBeenCalled();
    expect(input.props.value).toBe('买牛奶');

    fireEvent.changeText(input, ITEM.title);
    fireEvent(input, 'keyPress', {
      nativeEvent: { key: 'Enter', isComposing: false, keyCode: 13 },
    });

    await waitFor(() => expect(onCaptured).toHaveBeenCalledWith(ITEM, null));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(ITEM.title, null);
    expect(input.props.value).toBe('');
  });

  it('keeps Shift+Enter available for multiline input', () => {
    const onAdd = jest.fn(async () => ITEM);
    render(<QuickCaptureModal visible={true} onClose={jest.fn()} onAdd={onAdd} />);

    const input = screen.getByPlaceholderText(/记下任何事/);
    fireEvent.changeText(input, '买牛奶');
    fireEvent(input, 'keyPress', { nativeEvent: { key: 'Enter', shiftKey: true } });

    expect(onAdd).not.toHaveBeenCalled();
    expect(input.props.value).toBe('买牛奶');
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

  it('previews a parsed calendar suggestion and hands it to the parent (issue #101)', async () => {
    const onAdd = jest.fn(async () => ITEM);
    const onCapturedAndClarify = jest.fn();
    render(
      <QuickCaptureModal
        visible={true}
        onClose={jest.fn()}
        onAdd={onAdd}
        onCapturedAndClarify={onCapturedAndClarify}
      />,
    );

    fireEvent.changeText(screen.getByPlaceholderText(/记下任何事/), '明天下午3点开会');
    // The preview appears under the input; the raw title is untouched.
    expect(screen.getByText('日程')).toBeTruthy();
    expect(screen.getByText('撤销')).toBeTruthy();

    fireEvent.press(screen.getByText('记录并澄清'));

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith(
        '明天下午3点开会',
        expect.objectContaining({ kind: 'calendar' }),
      );
    });
    await waitFor(() => {
      expect(onCapturedAndClarify).toHaveBeenCalledWith(
        ITEM,
        expect.objectContaining({ kind: 'calendar' }),
      );
    });
  });

  it('撤销解析 removes the preview and saves without a schedule (issue #101)', async () => {
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
    fireEvent.changeText(input, '明天下午3点前提交报告');
    expect(screen.getByText('截止')).toBeTruthy();

    fireEvent.press(screen.getByText('撤销'));
    expect(screen.queryByText('截止')).toBeNull();
    // 撤销 never edits the text itself.
    expect(input.props.value).toBe('明天下午3点前提交报告');

    fireEvent.press(screen.getByText('记录'));
    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith('明天下午3点前提交报告', null);
    });
    await waitFor(() => {
      expect(onCaptured).toHaveBeenCalledWith(ITEM, null);
    });
  });

  it('a dismissal does not leak into the next capture of the same text (#101 review)', async () => {
    const onAdd = jest.fn(async () => ITEM);
    render(<QuickCaptureModal visible={true} onClose={jest.fn()} onAdd={onAdd} />);

    const input = screen.getByPlaceholderText(/记下任何事/);
    fireEvent.changeText(input, '明天下午3点开会');
    expect(screen.getByText('日程')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('撤销时间解析'));
    expect(screen.queryByText('日程')).toBeNull();

    fireEvent.press(screen.getByText('记录'));
    await waitFor(() => expect(input.props.value).toBe(''));

    // A finished capture is a new input — the same text parses again.
    fireEvent.changeText(input, '明天下午3点开会');
    expect(screen.getByText('日程')).toBeTruthy();
  });
});
