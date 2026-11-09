import { act, render, waitFor } from '@testing-library/react-native';
import type { useFocusRuntime } from '@/hooks/use-focus-runtime';
import type { FocusIslandSnapshot } from '@/lib/focus-island-contract';

const mockListeners = new Map<string, (value: unknown) => void>();
const mockInvoke = jest
  .fn<Promise<undefined>, [string, Record<string, unknown>?]>()
  .mockResolvedValue(undefined);
jest.mock('@/lib/theme', () => ({ useAppTheme: () => ({ isDark: false }) }));
jest.mock('@/lib/focus-island-desktop', () => ({
  isDesktopFocusAvailable: () => true,
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
import { FocusDesktopBridge } from '@/components/focus-desktop-bridge';

const view: FocusIslandSnapshot = {
  generation: 'g1',
  revision: 0,
  sessionId: 's1',
  actionId: 'a1',
  actionKind: 'next',
  title: 'Report',
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
function fixture(): ReturnType<typeof useFocusRuntime> {
  return {
    action: { id: 'a1', kind: 'next' },
    session: null,
    loaded: true,
    recoveryError: null,
    retryRecovery: jest.fn(),
    titleLoaded: true,
    view,
    attach: jest.fn(() => true),
    start: jest.fn(async () => true),
    run: jest.fn(async () => true),
    dismiss: jest.fn(),
    reportError: jest.fn(),
  };
}
function snapshot(): FocusIslandSnapshot {
  return mockInvoke.mock.calls.filter(([command]) => command === 'focus_island_publish').at(-1)![1]!
    .snapshot as FocusIslandSnapshot;
}
function send(requestId: string, overrides: Record<string, unknown> = {}) {
  const current = snapshot();
  mockListeners.get('focus-island:command')!({
    requestId,
    generation: current.generation,
    revision: current.revision,
    sessionId: current.sessionId,
    command: 'pause',
    ...overrides,
  });
}

beforeEach(() => {
  mockListeners.clear();
  mockInvoke.mockClear();
});

it('rejects stale sessions/revisions and acknowledges only the owner result', async () => {
  const focus = fixture();
  render(<FocusDesktopBridge focus={focus} />);
  await waitFor(() => expect(mockListeners.has('focus-island:command')).toBe(true));
  await act(async () => {
    send('old', { sessionId: 'old-session' });
  });
  expect(focus.run).not.toHaveBeenCalled();
  expect(mockInvoke).toHaveBeenCalledWith('focus_island_reply', {
    result: expect.objectContaining({ requestId: 'old', ok: false }),
  });
  await act(async () => {
    send('r1');
  });
  expect(focus.run).toHaveBeenCalledWith('pause');
  expect(mockInvoke).toHaveBeenCalledWith('focus_island_reply', {
    result: { requestId: 'r1', generation: 'g1', ok: true, error: null },
  });
});

it('rejects simultaneous commands while the owner is committing', async () => {
  const focus = fixture();
  let finish: (ok: boolean) => void = () => undefined;
  focus.run = jest.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  render(<FocusDesktopBridge focus={focus} />);
  await waitFor(() => expect(mockListeners.has('focus-island:command')).toBe(true));
  await act(async () => {
    send('first');
    send('second');
  });
  expect(focus.run).toHaveBeenCalledTimes(1);
  expect(mockInvoke).toHaveBeenCalledWith('focus_island_reply', {
    result: expect.objectContaining({ requestId: 'second', ok: false }),
  });
  await act(async () => {
    finish(false);
  });
  expect(mockInvoke).toHaveBeenCalledWith('focus_island_reply', {
    result: expect.objectContaining({ requestId: 'first', ok: false }),
  });
});

it('publishes on ready and removes every listener on unmount', async () => {
  const result = render(<FocusDesktopBridge focus={fixture()} />);
  await waitFor(() => expect(mockListeners.size).toBe(3));
  mockInvoke.mockClear();
  act(() => {
    mockListeners.get('focus-island:ready')!(null);
  });
  expect(mockInvoke).toHaveBeenCalledWith('focus_island_publish', expect.anything());
  result.unmount();
  expect(mockListeners.size).toBe(0);
});
