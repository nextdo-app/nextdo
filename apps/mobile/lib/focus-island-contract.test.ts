import {
  isFocusIslandRequest,
  isFocusIslandResult,
  isFocusIslandSnapshot,
  type FocusIslandSnapshot,
} from './focus-island-contract';
import { focusDisplay } from '@/hooks/use-focus-display';

const snapshot: FocusIslandSnapshot = {
  generation: 'owner-1',
  revision: 3,
  sessionId: 'session-1',
  actionId: 'action-1',
  actionKind: 'next',
  title: 'Write report',
  phase: 'running',
  startedAt: '2026-11-09T10:00:00.000Z',
  endedAt: null,
  plannedMinutes: 25,
  pausedSec: 10,
  pauseStartedAt: null,
  breakEndsAt: null,
  breakMinutes: null,
  isDark: false,
  busy: false,
  error: null,
};
const request = {
  requestId: 'r1',
  generation: 'owner-1',
  revision: 3,
  sessionId: 'session-1',
  command: 'pause',
};

describe('focus island boundary', () => {
  it('accepts the typed presentation and command, rejecting malformed event values', () => {
    expect(isFocusIslandSnapshot(snapshot)).toBe(true);
    expect(isFocusIslandRequest(request)).toBe(true);
    expect(isFocusIslandRequest({ ...request, command: ['pause'] })).toBe(false);
    expect(isFocusIslandRequest({ ...request, revision: -1 })).toBe(false);
    expect(isFocusIslandSnapshot({ ...snapshot, phase: ['running'] })).toBe(false);
    expect(isFocusIslandSnapshot({ ...snapshot, actionKind: ['next'] })).toBe(false);
    expect(isFocusIslandSnapshot({ ...snapshot, startedAt: 'yesterday' })).toBe(false);
    expect(isFocusIslandSnapshot({ ...snapshot, pausedSec: Number.NaN })).toBe(false);
    expect(isFocusIslandSnapshot({ ...snapshot, sessionId: null })).toBe(false);
    expect(
      isFocusIslandResult({ requestId: 'r1', generation: 'owner-1', ok: true, error: null }),
    ).toBe(true);
    expect(isFocusIslandResult({ requestId: 'r1', ok: true })).toBe(false);
  });

  it('derives clocks from anchors after a delayed tick, and freezes a pause', () => {
    const now = new Date('2026-11-09T10:10:00.000Z');
    expect(focusDisplay(snapshot, now).clock).toBe('15:10');
    const paused = { ...snapshot, pauseStartedAt: Date.parse('2026-11-09T10:05:00.000Z') };
    expect(focusDisplay(paused, now).clock).toBe('20:10');
    expect(focusDisplay({ ...snapshot, plannedMinutes: null }, now)).toMatchObject({
      clock: '09:50',
      progress: null,
    });
  });
});
