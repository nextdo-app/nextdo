import type { ReminderActionKind } from '@nextdo/core';

export type FocusPhase =
  'idle' | 'running' | 'paused' | 'time-up' | 'completed' | 'break' | 'break-complete';

export const FOCUS_PHASE_LABELS: Record<FocusPhase, string> = {
  idle: '准备专注',
  running: '专注进行中',
  paused: '已暂停',
  'time-up': '时间到',
  completed: '专注已完成',
  break: '休息中',
  'break-complete': '休息结束',
};

/** Presentation only: the main window keeps the authoritative database row. */
export interface FocusIslandSnapshot {
  generation: string;
  revision: number;
  sessionId: string | null;
  actionId: string | null;
  actionKind: ReminderActionKind | null;
  title: string;
  phase: FocusPhase;
  startedAt: string | null;
  endedAt: string | null;
  plannedMinutes: number | null;
  pausedSec: number;
  pauseStartedAt: number | null;
  breakEndsAt: number | null;
  breakMinutes: 5 | 10 | null;
  isDark: boolean;
  busy: boolean;
  error: string | null;
}

export type FocusIslandCommand =
  | 'pause'
  | 'resume'
  | 'complete'
  | 'continue'
  | 'break-5'
  | 'break-10'
  | 'end-break'
  | 'finish-break';

export interface FocusIslandRequest {
  requestId: string;
  generation: string;
  revision: number;
  sessionId: string;
  command: FocusIslandCommand;
}

export interface FocusIslandResult {
  requestId: string;
  generation: string;
  ok: boolean;
  error: string | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function nullableInstant(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function nullableDate(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

export function isFocusIslandSnapshot(value: unknown): value is FocusIslandSnapshot {
  if (!record(value)) return false;
  return (
    typeof value.generation === 'string' &&
    value.generation.length > 0 &&
    Number.isSafeInteger(value.revision) &&
    Number(value.revision) >= 0 &&
    nullableString(value.sessionId) &&
    nullableString(value.actionId) &&
    (value.actionKind === null ||
      (typeof value.actionKind === 'string' &&
        ['next', 'habit', 'calendar'].includes(value.actionKind))) &&
    typeof value.title === 'string' &&
    typeof value.phase === 'string' &&
    ['idle', 'running', 'paused', 'time-up', 'completed', 'break', 'break-complete'].includes(
      value.phase,
    ) &&
    nullableDate(value.startedAt) &&
    nullableDate(value.endedAt) &&
    (value.plannedMinutes === null ||
      (Number.isInteger(value.plannedMinutes) &&
        Number(value.plannedMinutes) >= 1 &&
        Number(value.plannedMinutes) <= 180)) &&
    typeof value.pausedSec === 'number' &&
    Number.isFinite(value.pausedSec) &&
    value.pausedSec >= 0 &&
    nullableInstant(value.pauseStartedAt) &&
    nullableInstant(value.breakEndsAt) &&
    (value.breakMinutes === null || value.breakMinutes === 5 || value.breakMinutes === 10) &&
    typeof value.isDark === 'boolean' &&
    typeof value.busy === 'boolean' &&
    nullableString(value.error) &&
    (value.phase === 'idle' ||
      (typeof value.sessionId === 'string' &&
        typeof value.actionId === 'string' &&
        value.actionKind !== null &&
        value.startedAt !== null))
  );
}

export function isFocusIslandRequest(value: unknown): value is FocusIslandRequest {
  return (
    record(value) &&
    typeof value.requestId === 'string' &&
    value.requestId.length > 0 &&
    typeof value.generation === 'string' &&
    value.generation.length > 0 &&
    Number.isSafeInteger(value.revision) &&
    Number(value.revision) >= 0 &&
    typeof value.sessionId === 'string' &&
    value.sessionId.length > 0 &&
    typeof value.command === 'string' &&
    [
      'pause',
      'resume',
      'complete',
      'continue',
      'break-5',
      'break-10',
      'end-break',
      'finish-break',
    ].includes(value.command)
  );
}

export function isFocusIslandResult(value: unknown): value is FocusIslandResult {
  return (
    record(value) &&
    typeof value.requestId === 'string' &&
    typeof value.generation === 'string' &&
    typeof value.ok === 'boolean' &&
    nullableString(value.error)
  );
}
