/**
 * Unit tests — useCaptureSchedule (issue #101).
 *
 * The preview state is a live parse of the draft, plus an override that is
 * keyed by the text it was made for: an explicit edit / 撤销 sticks until
 * the text changes, and then parsing resumes for the new text.
 */
import { act, renderHook } from '@testing-library/react-native';
import {
  useCaptureSchedule,
  type UseCaptureScheduleResult,
} from '@/hooks/use-capture-schedule';

const NOW = new Date(2026, 10, 21, 10, 0, 0); // Sat 2026-11-21

describe('useCaptureSchedule', () => {
  it('parses the draft into a calendar suggestion', () => {
    const { result } = renderHook(() => useCaptureSchedule('明天下午3点开会', NOW));
    expect(result.current.schedule).toMatchObject({
      kind: 'calendar',
      date: '2026-11-22',
      time: '15:00',
    });
  });

  it('returns null when the text has no date/time', () => {
    const { result } = renderHook(() => useCaptureSchedule('买牛奶', NOW));
    expect(result.current.schedule).toBeNull();
  });

  it('clear() dismisses the suggestion without touching the text', () => {
    const { result } = renderHook(() => useCaptureSchedule('明天下午3点开会', NOW));
    act(() => result.current.clear());
    expect(result.current.schedule).toBeNull();
  });

  it('an override applies to its own text and survives re-renders', () => {
    const { result, rerender } = renderHook<
      UseCaptureScheduleResult,
      { text: string }
    >(({ text }) => useCaptureSchedule(text, NOW), {
      initialProps: { text: '明天下午3点开会' },
    });
    act(() => result.current.setSchedule(null));
    rerender({ text: '明天下午3点开会' });
    expect(result.current.schedule).toBeNull();
  });

  it('continuing to type resumes live parsing after an override', () => {
    const { result, rerender } = renderHook<
      UseCaptureScheduleResult,
      { text: string }
    >(({ text }) => useCaptureSchedule(text, NOW), {
      initialProps: { text: '明天下午3点开会' },
    });
    act(() => result.current.clear());
    expect(result.current.schedule).toBeNull();

    rerender({ text: '后天上午10点开会' });
    expect(result.current.schedule).toMatchObject({
      kind: 'calendar',
      date: '2026-11-23',
      time: '10:00',
    });
  });

  it('reset() drops an override so the same text parses again', () => {
    const { result } = renderHook(() => useCaptureSchedule('明天下午3点开会', NOW));
    act(() => result.current.clear());
    expect(result.current.schedule).toBeNull();

    act(() => result.current.reset());
    expect(result.current.schedule).toMatchObject({ kind: 'calendar', date: '2026-11-22' });
  });

  it('emptying the draft drops an override made for the old text', () => {
    const { result, rerender } = renderHook<
      UseCaptureScheduleResult,
      { text: string }
    >(({ text }) => useCaptureSchedule(text, NOW), {
      initialProps: { text: '明天下午3点开会' },
    });
    act(() => result.current.clear());
    expect(result.current.schedule).toBeNull();

    rerender({ text: '' });
    rerender({ text: '明天下午3点开会' });
    expect(result.current.schedule).toMatchObject({ kind: 'calendar', date: '2026-11-22' });
  });
});
