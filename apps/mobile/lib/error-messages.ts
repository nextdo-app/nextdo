/**
 * User-facing (Chinese) copy for typed `NextdoError` codes (PRD R8).
 * Screens map errors through `errorMessage` instead of surfacing raw
 * English messages; codes without a mapping fall back to the typed
 * message itself (still specific, never swallowed).
 */
import { NextdoError } from '@nextdo/core';

const ERROR_MESSAGES: Record<string, string> = {
  // Clarify / re-clarify
  'clarify.incomplete': '答案不完整，请检查后重新提交',
  'project.needs-outcome': '项目必须有明确结果（"完成"是什么样）',
  'clarify.est-minutes': '行动必须有预估时长（分钟）',
  'clarify.project-value': '项目价值需在 1–5 之间',
  'reclarify.unsupported-kind': '习惯不能重新明晰（请编辑习惯本身）',
  'reclarify.action-not-open': '只有进行中的行动可以重新明晰',
  'clarify.project-not-found': '这个项目不存在了',
  'clarify.project-not-active': '这个项目当前不是进行中状态，无法挂接',
  // Core invariants
  'validation.waitingForItem.waitingOn': '请填写在等谁 / 什么',
  'validation.calendarAction.startsAt': '请选择开始时间',
  'validation.calendarAction.deadline': '截止时间格式不正确',
  'validation.nextAction.deadline': '截止时间格式不正确',
  'validation.focusSession.plannedMinutes': '专注时长无效（预设只能是 25 / 45 / 60 分钟）',
  'validation.focusSession.pausedSec': '暂停时长无效',
  // Storage / not-found
  'inbox.not-found': '这条收件箱记录不存在了',
  'action.not-found': '这个行动不存在了（可能已被删除）',
  'project.not-found': '这个项目不存在了',
  'somedayMaybeItem.not-found': '这条"有空再说"记录不存在了',
  'waitingForItem.not-found': '这条等待事项不存在了',
  'context.not-found': '这个场景不存在了',
  'habit.not-found': '这个习惯不存在了',
  'focusSession.not-found': '这个专注会话不存在了',
  'focusSession.not-active': '会话已结束，不能记录暂停',
  'habit.checkin-outside-window': '当前时间不在该习惯设定的时间窗口内',
};

/**
 * Map any thrown value to user-facing Chinese copy. `invalid-transition:*`
 * codes are dynamic (core `assertTransition`) — matched by prefix.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof NextdoError) {
    const mapped = ERROR_MESSAGES[error.code];
    if (mapped !== undefined) return mapped;
    if (error.code.startsWith('invalid-transition:')) {
      return '这个状态变更不被允许';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
