/**
 * Component tests — the action menu's two-step delete (issue #89).
 *
 * A single tap on 删除行动 must not soft-delete: the row arms, names the
 * recovery path, and only the second tap calls `onTrash`. Closing the sheet
 * disarms, so reopening never shows a primed delete.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { ActionMenuModal } from '@/components/action-menu-modal';

function setup(overrides: Partial<ComponentProps<typeof ActionMenuModal>> = {}) {
  const props = {
    visible: true,
    actionTitle: '买打印机墨盒',
    onClose: jest.fn(),
    onSnooze: jest.fn(),
    onTrash: jest.fn(),
    ...overrides,
  };
  const view = render(<ActionMenuModal {...props} />);
  return { props, view };
}

describe('ActionMenuModal delete confirmation (issue #89)', () => {
  it('first tap arms the delete instead of trashing', () => {
    const { props } = setup();

    fireEvent.press(screen.getByRole('button', { name: '删除行动' }));

    expect(props.onTrash).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByText('确认删除？')).toBeTruthy();
    expect(screen.getByText('删除后可在「设置 → 回收站」恢复')).toBeTruthy();
  });

  it('second tap trashes once and closes the sheet', () => {
    const { props } = setup();

    fireEvent.press(screen.getByRole('button', { name: '删除行动' }));
    fireEvent.press(screen.getByRole('button', { name: '确认删除行动' }));

    expect(props.onTrash).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('closing and reopening disarms the delete', () => {
    const { props, view } = setup();

    fireEvent.press(screen.getByRole('button', { name: '删除行动' }));
    expect(screen.getByText('确认删除？')).toBeTruthy();

    view.rerender(<ActionMenuModal {...props} visible={false} />);
    view.rerender(<ActionMenuModal {...props} visible={true} />);

    expect(screen.getByRole('button', { name: '删除行动' })).toBeTruthy();
    expect(screen.queryByText('确认删除？')).toBeNull();
  });
});
