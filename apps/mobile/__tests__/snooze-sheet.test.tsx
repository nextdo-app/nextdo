/**
 * Component tests — the snooze choice sheet (components/snooze-sheet):
 * the ONE common shortcut (10 分钟后) + the 自定义时间 flow through the
 * DateTimePicker 'datetime' mode (日/时/分 chips). `now` is injected as a
 * fixed Date — every expected target is device-local.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { logger } from '@nextdo/core';
import { SnoozeSheet } from '@/components/snooze-sheet';

const NOW = new Date(2026, 8, 22, 10, 0, 0); // local Mon 2026-09-22 10:00

function renderSheet(onSelect: jest.Mock = jest.fn(async () => true), onClose: jest.Mock = jest.fn()) {
  const view = render(<SnoozeSheet open={true} now={NOW} onSelect={onSelect} onClose={onClose} />);
  return { onSelect, onClose, ...view };
}

describe('SnoozeSheet', () => {
  it('shows exactly one common option (10 分钟后) + the custom row', () => {
    renderSheet();
    expect(screen.getByText('稍后提醒')).toBeTruthy();
    expect(screen.getByText('10 分钟后')).toBeTruthy();
    expect(screen.getByText('自定义时间')).toBeTruthy();
    // The old four-option presets are gone.
    expect(screen.queryByText('30 分钟后')).toBeNull();
    expect(screen.queryByText(/今晚 20:00/)).toBeNull();
    expect(screen.queryByText(/明晚 20:00/)).toBeNull();
    expect(screen.queryByText(/明天 08:00/)).toBeNull();
  });

  it('the common shortcut snoozes to now + 10m and closes after saving', async () => {
    const { onSelect, onClose } = renderSheet();
    fireEvent.press(screen.getByText('10 分钟后'));
    expect(onSelect).toHaveBeenCalledWith(new Date(NOW.getTime() + 10 * 60_000));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('自定义时间: 明天 14:30 through the day/hour/minute chips', async () => {
    const { onSelect, onClose } = renderSheet();
    fireEvent.press(screen.getByText('自定义时间'));

    // The picker opened (seeded at now + 1h = 今天 11:00).
    expect(screen.getByText('自定义提醒时间')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: '日 明天' }));
    fireEvent.press(screen.getByRole('button', { name: '小时 14' }));
    fireEvent.press(screen.getByRole('button', { name: '分钟 30' }));
    fireEvent.press(screen.getByRole('button', { name: '确定' }));

    expect(onSelect).toHaveBeenCalledWith(new Date(2026, 8, 23, 14, 30, 0));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('the 时/分 chip grids pick any hour and minute (23:59)', async () => {
    const { onSelect, onClose } = renderSheet();
    fireEvent.press(screen.getByText('自定义时间'));

    // Day stays the seeded 今天; jump straight to 23:59 via the chips.
    fireEvent.press(screen.getByRole('button', { name: '小时 23' }));
    fireEvent.press(screen.getByRole('button', { name: '分钟 59' }));
    fireEvent.press(screen.getByRole('button', { name: '确定' }));

    expect(onSelect).toHaveBeenCalledWith(new Date(2026, 8, 22, 23, 59, 0));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('a past custom time is rejected with an inline message (no snooze)', () => {
    const { onSelect, onClose } = renderSheet();
    fireEvent.press(screen.getByText('自定义时间'));

    // Seed is 今天 11:00 — pick an already-past hour (now = 10:00).
    fireEvent.press(screen.getByRole('button', { name: '小时 09' }));
    fireEvent.press(screen.getByRole('button', { name: '确定' }));

    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('所选时间已过，请选晚于现在的时间')).toBeTruthy();
  });

  it('after a rejected past time, the next valid pick snoozes (error clears)', async () => {
    const { onSelect, onClose } = renderSheet();
    fireEvent.press(screen.getByText('自定义时间'));
    fireEvent.press(screen.getByRole('button', { name: '小时 09' }));
    fireEvent.press(screen.getByRole('button', { name: '确定' }));
    expect(screen.getByText('所选时间已过，请选晚于现在的时间')).toBeTruthy();

    // Reopen: the error is gone, and the seed (今天 11:00) is valid as-is.
    fireEvent.press(screen.getByText('自定义时间'));
    expect(screen.queryByText('所选时间已过，请选晚于现在的时间')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: '确定' }));
    expect(onSelect).toHaveBeenCalledWith(new Date(2026, 8, 22, 11, 0, 0));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('the picker 取消 keeps the sheet open without snoozing', () => {
    const { onSelect, onClose } = renderSheet();
    fireEvent.press(screen.getByText('自定义时间'));
    // Two 取消 buttons now (sheet + picker) — press the picker's.
    const cancels = screen.getAllByRole('button', { name: '取消' });
    fireEvent.press(cancels.at(-1)!);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('自定义时间')).toBeTruthy();
  });

  it('the sheet 取消 closes without snoozing', () => {
    const { onSelect, onClose } = renderSheet();
    fireEvent.press(screen.getByRole('button', { name: '取消' }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps a failed save open and retries the same target', async () => {
    const onSelect = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { onClose } = renderSheet(onSelect);
    fireEvent.press(screen.getByText('10 分钟后'));
    await waitFor(() => expect(screen.getByText('保存失败，请重试')).toBeTruthy());
    expect(screen.getByText('提醒时间：今天 10:10')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: '重试保存' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSelect.mock.calls).toEqual([
      [new Date(2026, 8, 22, 10, 10)],
      [new Date(2026, 8, 22, 10, 10)],
    ]);
  });

  it('keeps the custom selection when reopening the picker after failure', async () => {
    const onSelect = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { onClose } = renderSheet(onSelect);
    fireEvent.press(screen.getByText('自定义时间'));
    fireEvent.press(screen.getByRole('button', { name: '日 明天' }));
    fireEvent.press(screen.getByRole('button', { name: '小时 14' }));
    fireEvent.press(screen.getByRole('button', { name: '分钟 30' }));
    fireEvent.press(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => expect(screen.getByText('保存失败，请重试')).toBeTruthy());

    fireEvent.press(screen.getByText('自定义时间'));
    fireEvent.press(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSelect.mock.calls).toEqual([
      [new Date(2026, 8, 23, 14, 30)],
      [new Date(2026, 8, 23, 14, 30)],
    ]);
  });

  it('keeps direct retry after canceling an edit to a failed custom selection', async () => {
    const onSelect = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { onClose } = renderSheet(onSelect);
    fireEvent.press(screen.getByText('自定义时间'));
    fireEvent.press(screen.getByRole('button', { name: '日 明天' }));
    fireEvent.press(screen.getByRole('button', { name: '小时 14' }));
    fireEvent.press(screen.getByRole('button', { name: '分钟 30' }));
    fireEvent.press(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => expect(screen.getByText('保存失败，请重试')).toBeTruthy());

    fireEvent.press(screen.getByText('自定义时间'));
    fireEvent.press(screen.getByRole('button', { name: '小时 16' }));
    fireEvent.press(screen.getAllByRole('button', { name: '取消' }).at(-1)!);
    expect(screen.getByText('提醒时间：明天 14:30')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: '重试保存' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSelect.mock.calls).toEqual([
      [new Date(2026, 8, 23, 14, 30)],
      [new Date(2026, 8, 23, 14, 30)],
    ]);
  });

  it('prevents duplicate saves and dismissal while a save is pending', async () => {
    let finish!: (ok: boolean) => void;
    const onSelect = jest.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const { onClose } = renderSheet(onSelect);
    const shortcut = screen.getByRole('button', { name: /10 分钟后/ });
    act(() => {
      fireEvent.press(shortcut);
      fireEvent.press(shortcut);
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByText('正在保存…')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: '取消' }));
    fireEvent.press(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { finish(true); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('handles a rejected save with a visible retry instead of an unhandled rejection', async () => {
    const failure = new Error('local write failed');
    const log = jest.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      const { onClose } = renderSheet(jest.fn().mockRejectedValue(failure));
      fireEvent.press(screen.getByText('10 分钟后'));
      await waitFor(() => expect(screen.getByText('保存失败，请重试')).toBeTruthy());
      expect(screen.getByRole('button', { name: '重试保存' })).toBeTruthy();
      expect(onClose).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith('snooze selection save failed', failure);
    } finally {
      log.mockRestore();
    }
  });

  it('rejects retrying a retained time that has since passed', async () => {
    const onSelect = jest.fn().mockResolvedValue(false);
    const { onClose, rerender } = renderSheet(onSelect);
    fireEvent.press(screen.getByText('10 分钟后'));
    await waitFor(() => expect(screen.getByText('保存失败，请重试')).toBeTruthy());
    rerender(<SnoozeSheet open now={new Date(2026, 8, 22, 10, 11)} onSelect={onSelect} onClose={onClose} />);
    fireEvent.press(screen.getByRole('button', { name: '重试保存' }));
    expect(screen.getByText('所选时间已过，请选晚于现在的时间')).toBeTruthy();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
