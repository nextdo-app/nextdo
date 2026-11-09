import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { elapsedSeconds, formatClock, remainingSeconds } from '@/lib/focus-timer';
import type { FocusIslandSnapshot } from '@/lib/focus-island-contract';

/** Sub-minute display clock; it never writes a row or broadcasts a tick. */
export function useFocusDisplay(snapshot: FocusIslandSnapshot) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const interval = setInterval(refresh, 1000);
    const subscription = AppState.addEventListener('change', refresh);
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, []);
  return focusDisplay(snapshot, now);
}

export function focusDisplay(snapshot: FocusIslandSnapshot, now: Date) {
  if (snapshot.phase === 'break' && snapshot.breakEndsAt !== null) {
    const remaining = Math.max(0, Math.ceil((snapshot.breakEndsAt - now.getTime()) / 1000));
    return {
      clock: formatClock(remaining),
      elapsed: 0,
      progress: 1 - remaining / ((snapshot.breakMinutes ?? 5) * 60),
    };
  }
  if (snapshot.startedAt === null) return { clock: '准备开始', elapsed: 0, progress: null };
  const effectiveNow = new Date(
    snapshot.pauseStartedAt ??
      (snapshot.endedAt === null ? now.getTime() : Date.parse(snapshot.endedAt)),
  );
  const elapsed = elapsedSeconds(new Date(snapshot.startedAt), snapshot.pausedSec, effectiveNow);
  const remaining = remainingSeconds(
    new Date(snapshot.startedAt),
    snapshot.plannedMinutes,
    snapshot.pausedSec,
    effectiveNow,
  );
  return {
    clock: snapshot.phase === 'break-complete' ? '00:00' : formatClock(remaining ?? elapsed),
    elapsed,
    progress:
      snapshot.plannedMinutes === null
        ? null
        : Math.min(1, elapsed / (snapshot.plannedMinutes * 60)),
  };
}
