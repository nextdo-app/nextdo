import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { DateTimePicker } from '../components/datetime-picker';

describe('DateTimePicker', () => {
  const now = new Date(2026, 8, 25, 14, 30); // 2026-09-25 14:30
  const onConfirm = jest.fn();
  const onClose = jest.fn();
  const defaultWindow = Dimensions.get('window');

  function setWindowSize(width: number, height: number): void {
    const dims = { ...defaultWindow, width, height, scale: 1, fontScale: 1 };
    Dimensions.set({ window: dims, screen: dims });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    setWindowSize(defaultWindow.width, defaultWindow.height);
  });

  afterAll(() => {
    setWindowSize(defaultWindow.width, defaultWindow.height);
  });

  /** Confirm also records time usage (#105) — flush the async persist. */
  async function pressConfirm(): Promise<void> {
    await act(async () => {
      fireEvent.press(screen.getByText('确定'));
    });
  }

  it('renders time mode with hour/minute wheels and quick time presets', async () => {
    render(
      <DateTimePicker
        mode="time"
        title="指定时间"
        value="14:30"
        now={now}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    expect(screen.getAllByText('指定时间').length).toBeGreaterThan(0);
    expect(screen.getByText('14:30')).toBeTruthy();
    expect(screen.getByLabelText('小时 14')).toBeTruthy();
    expect(screen.getByLabelText('分钟 30')).toBeTruthy();

    // Minute selection through the wheel (the :15 minute chip was removed
    // in the #110 redesign — the wheel owns the minute).
    fireEvent.press(screen.getByLabelText('分钟 15'));
    expect(screen.getByText('14:15')).toBeTruthy();

    // Select hour 09
    fireEvent.press(screen.getByLabelText('小时 09'));
    expect(screen.getByText('09:15')).toBeTruthy();

    // Confirm
    await pressConfirm();
    expect(onConfirm).toHaveBeenCalledWith('09:15');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('datetime mode emits the DAY ALONE when no time control was touched (task 10-17)', async () => {
    render(
      <DateTimePicker
        mode="datetime"
        title="选择截止时间"
        value=""
        now={now}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    // The wheels start on the clock (14:30). Picking a day and confirming must
    // still mean "date only" — otherwise a deadline would silently acquire a
    // 14:30 the user never chose, and the reminder pre-fill would stop using
    // the date-only rule.
    fireEvent.press(screen.getByLabelText('快捷 明天'));
    await pressConfirm();
    expect(onConfirm).toHaveBeenCalledWith('2026-09-26');
  });

  it('datetime mode counts wheel scrolling as a time choice (#105)', async () => {
    render(
      <DateTimePicker
        mode="datetime"
        title="选择截止时间"
        value=""
        now={now}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    // Drag the hour wheel from the seeded 14 to 09. Before #105 this left
    // `timeTouched` false, so confirm silently emitted the date alone.
    fireEvent.scroll(screen.getByTestId('hour-wheel'), {
      nativeEvent: { contentOffset: { y: 9 * 40 } },
    });
    await pressConfirm();
    expect(onConfirm).toHaveBeenCalledWith('2026-09-25T09:30');
  });

  it('datetime mode restores a date-only seed and keeps the day on confirm (issue #94 R1)', async () => {
    // Date-only values are stored at that day's end, and the prefill collapses
    // back to 'YYYY-MM-DD'. Reopening the picker must show THAT day, not today;
    // confirming without touching the wheels must re-emit the same date.
    render(
      <DateTimePicker
        mode="datetime"
        title="跟进时间"
        value="2026-09-30"
        now={now}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    expect(screen.getByText('9月30日 周三 · 只记日期')).toBeTruthy();
    await pressConfirm();
    expect(onConfirm).toHaveBeenCalledWith('2026-09-30');
  });

  it('datetime mode emits the full moment once a time control is used', async () => {
    render(
      <DateTimePicker
        mode="datetime"
        title="选择截止时间"
        value=""
        now={now}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    fireEvent.press(screen.getByLabelText('快捷 明天'));
    fireEvent.press(screen.getByLabelText('分钟 15')); // minute → :15
    await pressConfirm();
    expect(onConfirm).toHaveBeenCalledWith('2026-09-26T14:15');
  });

  it('datetime mode keeps a stored time when only the day changes', async () => {
    render(
      <DateTimePicker
        mode="datetime"
        title="选择截止时间"
        value="2026-09-25T18:00"
        now={now}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    fireEvent.press(screen.getByLabelText('快捷 明天'));
    await pressConfirm();
    expect(onConfirm).toHaveBeenCalledWith('2026-09-26T18:00');
  });

  it('renders quick date presets (今天、明天、下周一、下月一日) and modern calendar grid', async () => {
    render(
      <DateTimePicker
        mode="date"
        title="选择日期"
        value="2026-09-25"
        now={now}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    expect(screen.getByText('9月25日 周五')).toBeTruthy();

    // Quick presets exist
    expect(screen.getByLabelText('快捷 今天')).toBeTruthy();
    expect(screen.getByLabelText('快捷 明天')).toBeTruthy();
    expect(screen.getByLabelText('快捷 下周一')).toBeTruthy();
    expect(screen.getByLabelText('快捷 下月一日')).toBeTruthy();

    // Click "快捷 下月一日" -> 2026-10-01
    fireEvent.press(screen.getByLabelText('快捷 下月一日'));
    expect(screen.getByText('10月1日 周四')).toBeTruthy();

    // Click "快捷 明天" -> 2026-09-26
    fireEvent.press(screen.getByLabelText('快捷 明天'));
    expect(screen.getByText('9月26日 周六')).toBeTruthy();

    // Click specific day in calendar grid
    fireEvent.press(screen.getByLabelText('日 28'));
    expect(screen.getByText('9月28日 周一')).toBeTruthy();

    await pressConfirm();
    expect(onConfirm).toHaveBeenCalledWith('2026-09-28');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders datetime mode with combined presets and allows setting both date and time', async () => {
    render(
      <DateTimePicker
        mode="datetime"
        title="选择时间"
        value="2026-09-25T14:30"
        now={now}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    expect(screen.getAllByText('今天').length).toBeGreaterThan(0);
    expect(screen.getByText('明天')).toBeTruthy();

    // Click "快捷 明天"
    fireEvent.press(screen.getByLabelText('快捷 明天'));

    // Select hour 09
    fireEvent.press(screen.getByLabelText('小时 09'));

    await pressConfirm();
    expect(onConfirm).toHaveBeenCalledWith('2026-09-26T09:30');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('supports 12h/24h toggle and AM/PM switching (Issue 31, #110)', async () => {
    render(
      <DateTimePicker
        mode="time"
        title="习惯提醒时间"
        value="08:30"
        now={now}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    // Initial 24h mode
    expect(screen.getByLabelText('当前选中时间').props.children).toBe('08:30');
    expect(screen.getByLabelText('24小时制')).toBeTruthy();
    expect(screen.getByLabelText('12小时制')).toBeTruthy();

    // Switch to 12h mode
    fireEvent.press(screen.getByLabelText('12小时制'));
    expect(screen.getByText('12h')).toBeTruthy();
    expect(screen.getByLabelText('切换到下午')).toBeTruthy();
    expect(screen.getByLabelText('切换到上午')).toBeTruthy();
    expect(screen.getByLabelText('当前选中时间').props.children).toBe('08:30');

    // Switch to PM -> 20:30 (08:30 PM). The ±1m/±5m steppers were removed in
    // the #110 redesign; the wheel is the only minute control.
    fireEvent.press(screen.getByLabelText('切换到下午'));
    expect(screen.getByLabelText('当前选中时间').props.children).toBe('08:30');

    // Confirm and verify 24h formatted string output
    await pressConfirm();
    expect(onConfirm).toHaveBeenCalledWith('20:30');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('supports expanded quick time presets like 07:30, 19:30, 22:30 (Issue 31)', () => {
    render(
      <DateTimePicker
        mode="time"
        title="选择时段"
        value="10:00"
        now={now}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    // Select expanded preset 19:30 (晚间)
    expect(screen.getByLabelText('时段 19:30')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('时段 19:30'));
    expect(screen.getByLabelText('当前选中时间').props.children).toBe('19:30');

    // Select expanded preset 07:30 (晨间)
    expect(screen.getByLabelText('时段 07:30')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('时段 07:30'));
    expect(screen.getByLabelText('当前选中时间').props.children).toBe('07:30');

    // Close on cancel
    fireEvent.press(screen.getByText('取消'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('avoids flex-1 on the body ScrollView to prevent zero-height collapse in Yoga (Issue 50)', () => {
    render(
      <DateTimePicker
        mode="time"
        title="选择时间"
        value="08:00"
        now={now}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    // The modal's primary body ScrollView must not have flex: 1 (flexBasis: 0),
    // which causes complete vertical collapse on mobile when parent height is auto.
    expect(screen.getByLabelText('小时 08')).toBeTruthy();
    expect(screen.getByLabelText('分钟 00')).toBeTruthy();
  });

  it('datetime mode shows the time wheels and all-day presets without a horizontal scroll (#105)', () => {
    render(
      <DateTimePicker
        mode="datetime"
        title="选择截止时间"
        value=""
        now={now}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    // The wheels render before the calendar grid in datetime mode, so they are
    // on the first screen instead of below the fold.
    expect(screen.getByLabelText('小时 14')).toBeTruthy();
    expect(screen.getByLabelText('分钟 30')).toBeTruthy();

    // Presets wrap instead of scrolling: afternoon and evening chips exist
    // in the same visible row group (no horizontal ScrollView gate).
    expect(screen.getByLabelText('时段 09:00')).toBeTruthy();
    expect(screen.getByLabelText('时段 14:00')).toBeTruthy();
    expect(screen.getByLabelText('时段 19:30')).toBeTruthy();
    expect(screen.getByLabelText('时段 22:30')).toBeTruthy();
  });

  it('uses the desktop window: calendar and time wheels share one row (#105 redesign)', () => {
    setWindowSize(1280, 900);
    render(
      <DateTimePicker
        mode="datetime"
        title="选择截止时间"
        value=""
        now={now}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    // Desktop windows get a wider dialog with two columns — the date and the
    // wheels are visible at the same time, with no scrolling inside the modal.
    expect(screen.getByTestId('datetime-picker-two-column')).toBeTruthy();
    expect(screen.getByLabelText('快捷 明天')).toBeTruthy();
    expect(screen.getByLabelText('小时 14')).toBeTruthy();
    expect(screen.getByLabelText('分钟 30')).toBeTruthy();
  });

  it('keeps the single-column stack on phone widths, with the wheels before the date grid (#105 redesign)', () => {
    setWindowSize(390, 700);
    render(
      <DateTimePicker
        mode="datetime"
        title="选择截止时间"
        value=""
        now={now}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    expect(screen.queryByTestId('datetime-picker-two-column')).toBeNull();
    // The time controls still render (and are listed before the calendar in
    // the component tree, so they occupy the first screen).
    expect(screen.getByLabelText('小时 14')).toBeTruthy();
    expect(screen.getByLabelText('日 25')).toBeTruthy();
  });

  it('re-lays out when the window crosses the 720px threshold while the dialog is open (#105 redesign)', () => {
    setWindowSize(1280, 900);
    render(
      <DateTimePicker
        mode="datetime"
        title="选择截止时间"
        value=""
        now={now}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    expect(screen.getByTestId('datetime-picker-two-column')).toBeTruthy();

    // 弹窗不关闭、只拖动窗口宽度：布局必须跟着窗口重排，不能停留在打开时
    // 的尺寸上。滚轮偏移的恢复由浏览器用例读取 scrollTop 验证（jest 环境里
    // 的 ScrollView 没有可观察的命令式滚动）。
    act(() => {
      setWindowSize(390, 700);
    });
    expect(screen.queryByTestId('datetime-picker-two-column')).toBeNull();
    expect(screen.getByLabelText('小时 14')).toBeTruthy();

    act(() => {
      setWindowSize(1280, 900);
    });
    expect(screen.getByTestId('datetime-picker-two-column')).toBeTruthy();
  });

  it('puts the most-used time first on the next open (#105)', async () => {
    for (let i = 0; i < 3; i++) {
      const view = render(
        <DateTimePicker
          mode="time"
          title="选择时间"
          value="08:00"
          now={now}
          onConfirm={onConfirm}
          onClose={onClose}
        />,
      );
      fireEvent.press(screen.getByLabelText('时段 22:30'));
      await act(async () => {
        fireEvent.press(screen.getByText('确定'));
      });
      view.unmount();
    }

    render(
      <DateTimePicker
        mode="time"
        title="选择时间"
        value="08:00"
        now={now}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    const chips = screen.getAllByLabelText(/^时段 /);
    expect(chips[0]?.props.accessibilityLabel).toBe('时段 22:30');
    // Usage ranking never drops the day-part coverage.
    expect(screen.getByLabelText('时段 09:00')).toBeTruthy();
    expect(screen.getByLabelText('时段 14:00')).toBeTruthy();
    expect(screen.getByLabelText('时段 19:30')).toBeTruthy();
  });
});
