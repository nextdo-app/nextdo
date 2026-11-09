import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { View } from 'react-native';
import { FocusIsland } from '@nextdo/ui';
import type { FocusIslandRequest, FocusIslandSnapshot } from '@/lib/focus-island-contract';

const mockListeners = new Map<string, (value: unknown) => void>();
const mockInvoke = jest
  .fn<Promise<undefined>, [string, Record<string, unknown>?]>()
  .mockResolvedValue(undefined);
const mockSetScheme = jest.fn();
jest.mock('nativewind', () => ({ useColorScheme: () => ({ setColorScheme: mockSetScheme }) }));
jest.mock('@/hooks/use-app-fonts', () => ({ useAppFonts: () => true }));
jest.mock('@/lib/focus-island-desktop', () => ({
  invokeFocusDesktop: (command: string, args?: Record<string, unknown>) =>
    mockInvoke(command, args),
  listenFocusDesktop: async (event: string, receive: (value: unknown) => void) => {
    mockListeners.set(event, receive);
    return () => {
      mockListeners.delete(event);
    };
  },
  reportFocusDesktopError: (error: unknown) => String(error),
}));
import { FocusIslandClient } from '@/components/focus-island-client';

const snapshot: FocusIslandSnapshot = {
  generation: 'owner-1',
  revision: 1,
  sessionId: 's1',
  actionId: 'a1',
  actionKind: 'next',
  title: 'Current action',
  phase: 'running',
  startedAt: '2026-11-09T10:00:00.000Z',
  endedAt: null,
  plannedMinutes: 25,
  pausedSec: 0,
  pauseStartedAt: null,
  breakEndsAt: null,
  breakMinutes: null,
  isDark: false,
  busy: false,
  error: null,
};
const commandCalls = () =>
  mockInvoke.mock.calls.filter(([name]) => name === 'focus_island_command');

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-09T10:00:00.000Z'));
  mockListeners.clear();
  mockInvoke.mockClear();
  mockSetScheme.mockClear();
});
afterEach(() => {
  jest.useRealTimers();
});

it('keeps long expanded content inside the native viewport instead of rejecting its size', async () => {
  const view = render(<FocusIslandClient />);
  await waitFor(() => expect(mockListeners.size).toBe(2));
  act(() => {
    mockListeners.get('focus-island:snapshot')!(snapshot);
  });
  fireEvent.press(view.getByLabelText('展开专注岛'));
  const content = view
    .UNSAFE_getAllByType(View)
    .find((node) => typeof node.props.onLayout === 'function')!;
  fireEvent(content, 'layout', { nativeEvent: { layout: { height: 1200 } } });
  expect(mockInvoke).toHaveBeenLastCalledWith('focus_island_resize', {
    expanded: true,
    height: 720,
  });
});

it('keeps compact state accessible and reveals full text when expanded', async () => {
  const title = 'A long current action that must stay available when the capsule truncates it';
  const view = render(<FocusIslandClient />);
  await waitFor(() => expect(mockListeners.size).toBe(2));
  act(() => {
    mockListeners.get('focus-island:snapshot')!({ ...snapshot, title });
  });
  const toggle = view.getByLabelText('展开专注岛');
  const description = view.getByText(`${title}，专注进行中，25:00`);
  expect(toggle.props['aria-describedby']).toBe(description.props.nativeID);
  expect(view.getByText(title).props.numberOfLines).toBe(1);
  expect(view.getByText('专注进行中')).toBeTruthy();
  act(() => {
    mockListeners.get('focus-island:snapshot')!({
      ...snapshot,
      title,
      revision: 2,
      phase: 'paused',
      pauseStartedAt: Date.parse(snapshot.startedAt!),
    });
  });
  expect(view.getByText(`${title}，已暂停，25:00`)).toBeTruthy();
  expect(view.getByText('已暂停')).toBeTruthy();
  fireEvent.press(toggle);
  expect(view.getByText('已暂停')).toBeTruthy();
  expect(view.getByText(title).props.numberOfLines).toBeUndefined();
  expect(view.getByText('继续')).toBeTruthy();
  expect(commandCalls()).toHaveLength(0);
});

it('keeps the in-app capsule state visible without opting into compact mode', () => {
  const view = render(
    <FocusIsland
      title="Current action"
      clock="25:00"
      stateLabel="专注进行中"
      expanded={false}
      onToggle={() => undefined}
    />,
  );
  expect(view.getByText('专注进行中')).toBeTruthy();
  expect(view.getByLabelText('展开专注岛').props['aria-describedby']).toBeUndefined();
});

it('does not claim an unacknowledged pause or retry it after timeout', async () => {
  const view = render(<FocusIslandClient />);
  await waitFor(() => expect(mockListeners.size).toBe(2));
  act(() => {
    mockListeners.get('focus-island:snapshot')!(snapshot);
  });
  fireEvent.press(view.getByLabelText('展开专注岛'));
  fireEvent.press(view.getByText('暂停'));
  expect(commandCalls()).toHaveLength(1);
  expect(view.queryByText('已暂停')).toBeNull();
  act(() => {
    jest.advanceTimersByTime(8_001);
  });
  expect(view.getByText('操作未确认，请打开主窗口并重新连接')).toBeTruthy();
  expect(commandCalls()).toHaveLength(1);
  fireEvent.press(view.getByText('重新连接'));
  act(() => {
    mockListeners.get('focus-island:snapshot')!({
      ...snapshot,
      revision: 2,
      phase: 'paused',
      pauseStartedAt: Date.parse(snapshot.startedAt!),
    });
  });
  fireEvent.press(view.getByText('继续'));
  const request = commandCalls().at(-1)![1]!.request as FocusIslandRequest;
  expect(request.command).toBe('resume');
  expect(commandCalls()).toHaveLength(2);
  act(() => {
    mockListeners.get('focus-island:result')!({
      requestId: request.requestId,
      generation: request.generation,
      ok: true,
      error: null,
    });
  });
  expect(view.queryByText('操作未确认，请打开主窗口并重新连接')).toBeNull();
});

it('ignores old revisions and snapshots from a retired main-window generation', async () => {
  const view = render(<FocusIslandClient />);
  await waitFor(() => expect(mockListeners.size).toBe(2));
  const receive = mockListeners.get('focus-island:snapshot')!;
  act(() => {
    receive({ ...snapshot, revision: 3, title: 'Newest action' });
    receive({ ...snapshot, revision: 2 });
  });
  expect(view.getByText('Newest action')).toBeTruthy();
  act(() => {
    receive({ ...snapshot, generation: 'owner-2', title: 'Restarted owner', isDark: true });
    receive({ ...snapshot, revision: 4 });
  });
  expect(view.getByText('Restarted owner')).toBeTruthy();
  expect(mockSetScheme).toHaveBeenLastCalledWith('dark');
  view.unmount();
  expect(mockListeners.size).toBe(0);
});
