/**
 * Component tests — CaptureSchedulePreview (issue #101).
 *
 * The preview is informational: it shows the parsed suggestion, lets the
 * user switch its kind, adjust the time through the picker, or dismiss the
 * parse entirely. It never edits the captured text.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { CaptureSchedule } from '@nextdo/core';
import { describeCaptureSchedule } from '@nextdo/core';
import { CaptureSchedulePreview } from '@/components/capture-schedule-preview';

const NOW = new Date(2026, 10, 21, 10, 0, 0); // Sat 2026-11-21

const CALENDAR: CaptureSchedule = {
  kind: 'calendar',
  date: '2026-11-22',
  time: '15:00',
  startsAt: '2026-11-22T15:00:00.000Z',
  estMinutes: 30,
  matchedText: '明天下午3点开会',
};

function renderPreview(schedule: CaptureSchedule = CALENDAR) {
  const onChange = jest.fn();
  const onClear = jest.fn();
  render(
    <CaptureSchedulePreview
      schedule={schedule}
      now={NOW}
      onChange={onChange}
      onClear={onClear}
    />,
  );
  return { onChange, onClear };
}

describe('CaptureSchedulePreview', () => {
  it('renders the suggestion label and both kind toggles', () => {
    renderPreview();
    expect(screen.getByText(describeCaptureSchedule(CALENDAR, NOW))).toBeTruthy();
    expect(screen.getByText('截止')).toBeTruthy();
    expect(screen.getByText('日程')).toBeTruthy();
  });

  it('切换类型 rebuilds the schedule for the other kind', () => {
    const { onChange } = renderPreview();
    fireEvent.press(screen.getByText('截止'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'deadline',
        date: '2026-11-22',
        time: '15:00',
        deadline: expect.any(String),
      }),
    );
  });

  it('修改 opens the picker and applies the chosen time', () => {
    const { onChange } = renderPreview();
    fireEvent.press(screen.getByText('修改'));
    expect(screen.getAllByText('修改识别到的时间').length).toBeGreaterThan(0);

    fireEvent.press(screen.getByLabelText('快捷 15分'));
    fireEvent.press(screen.getByText('确定'));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'calendar',
        date: '2026-11-22',
        time: '15:15',
      }),
    );
    // The picker closes after confirming.
    expect(screen.queryByText('确定')).toBeNull();
  });

  it('撤销 dismisses the parse', () => {
    const { onClear } = renderPreview();
    fireEvent.press(screen.getByText('撤销'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
