import { fireEvent, render, screen } from '@testing-library/react-native';
import { DateTimePicker } from '../components/datetime-picker';

describe('DateTimePicker', () => {
  const now = new Date(2026, 8, 25, 14, 30); // 2026-09-25 14:30
  const onConfirm = jest.fn();
  const onClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders time mode with hour/minute wheels, quick time presets, and minute chips', () => {
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

    // Fast preset minutes (:15)
    fireEvent.press(screen.getByLabelText('快捷 15分'));
    expect(screen.getByText('14:15')).toBeTruthy();

    // Select hour 09
    fireEvent.press(screen.getByLabelText('小时 09'));
    expect(screen.getByText('09:15')).toBeTruthy();

    // Confirm
    fireEvent.press(screen.getByText('确定'));
    expect(onConfirm).toHaveBeenCalledWith('09:15');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('datetime mode emits the DAY ALONE when no time control was touched (task 10-17)', () => {
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
    fireEvent.press(screen.getByText('确定'));
    expect(onConfirm).toHaveBeenCalledWith('2026-09-26');
  });

  it('datetime mode emits the full moment once a time control is used', () => {
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
    fireEvent.press(screen.getByLabelText('快捷 15分')); // minute → :15
    fireEvent.press(screen.getByText('确定'));
    expect(onConfirm).toHaveBeenCalledWith('2026-09-26T14:15');
  });

  it('datetime mode keeps a stored time when only the day changes', () => {
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
    fireEvent.press(screen.getByText('确定'));
    expect(onConfirm).toHaveBeenCalledWith('2026-09-26T18:00');
  });

  it('renders quick date presets (今天、明天、下周一、下月一日) and modern calendar grid', () => {
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

    expect(screen.getByText('2026年09月25日')).toBeTruthy();

    // Quick presets exist
    expect(screen.getByLabelText('快捷 今天')).toBeTruthy();
    expect(screen.getByLabelText('快捷 明天')).toBeTruthy();
    expect(screen.getByLabelText('快捷 下周一')).toBeTruthy();
    expect(screen.getByLabelText('快捷 下月一日')).toBeTruthy();

    // Click "快捷 下月一日" -> 2026-10-01
    fireEvent.press(screen.getByLabelText('快捷 下月一日'));
    expect(screen.getByText('2026年10月01日')).toBeTruthy();

    // Click "快捷 明天" -> 2026-09-26
    fireEvent.press(screen.getByLabelText('快捷 明天'));
    expect(screen.getByText('2026年09月26日')).toBeTruthy();

    // Click specific day in calendar grid
    fireEvent.press(screen.getByLabelText('日 28'));
    expect(screen.getByText('2026年09月28日')).toBeTruthy();

    fireEvent.press(screen.getByText('确定'));
    expect(onConfirm).toHaveBeenCalledWith('2026-09-28');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders datetime mode with combined presets and allows setting both date and time', () => {
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

    fireEvent.press(screen.getByText('确定'));
    expect(onConfirm).toHaveBeenCalledWith('2026-09-26T09:30');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('supports 12h/24h toggle, AM/PM switching, and minute fine-tuning (Issue 31)', () => {
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
    expect(screen.getByText('12小时制')).toBeTruthy();
    expect(screen.getByLabelText('切换到下午')).toBeTruthy();
    expect(screen.getByLabelText('切换到上午')).toBeTruthy();
    expect(screen.getByLabelText('当前选中时间').props.children).toBe('08:30');

    // Fine-tune minute +5m -> 08:35
    fireEvent.press(screen.getByLabelText('微调 加5分钟'));
    expect(screen.getByLabelText('当前选中时间').props.children).toBe('08:35');

    // Fine-tune minute +1m -> 08:36
    fireEvent.press(screen.getByLabelText('微调 加1分钟'));
    expect(screen.getByLabelText('当前选中时间').props.children).toBe('08:36');

    // Fine-tune minute -5m -> 08:31
    fireEvent.press(screen.getByLabelText('微调 减5分钟'));
    expect(screen.getByLabelText('当前选中时间').props.children).toBe('08:31');

    // Switch to PM -> 20:31 (08:31 PM)
    fireEvent.press(screen.getByLabelText('切换到下午'));
    expect(screen.getByLabelText('当前选中时间').props.children).toBe('08:31');

    // Confirm and verify 24h formatted string output
    fireEvent.press(screen.getByText('确定'));
    expect(onConfirm).toHaveBeenCalledWith('20:31');
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
});
