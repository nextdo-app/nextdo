/**
 * Human-facing labels for engine reason codes (Now screen "Why this?").
 *
 * The engine emits machine `Reason` objects (core `ReasonCode`); the
 * presentation layer turns them into short, readable phrases. This is pure
 * presentation — no engine logic (spec: component-guidelines). Labels are
 * keyed by the exact `ReasonCode` union so a missing code is a type error.
 */
import type { FilterRuleId, ReasonCode } from '@nextdo/core';

export const REASON_LABELS: Record<ReasonCode, string> = {
  // score reasons (weighted)
  'deadline-urgency': '截止时间快到了',
  'goal-value': '价值高',
  'project-importance': '支撑一个重要项目',
  'time-fit': '正好匹配你现有的时间',
  'waiting-time': '已经等了一阵子了',
  'habit-commitment': '有连续打卡记录要保持',
  'health-protection': '有助于保护健康',
  // eligibility reasons (why it can run right now)
  'context-match': '符合你当前的场景',
  'window-open': '正处于它的时间窗口内',
  'time-fits': '放得进你现有的时间',
  'dependency-clear': '它依赖的事项已完成',
  'calendar-preempt': '提前占了接下来一小时',
};

/**
 * The reason codes the Now card shows under 「为什么是它？」.
 *
 * `context-match` names the retired 场景 feature (#46), and `time-fits` /
 * `dependency-clear` hold for every surviving candidate, so none of them
 * explains why THIS action was picked. The labels stay in `REASON_LABELS`
 * (the engine still emits the codes); only the display filters them.
 */
export const DISPLAY_REASON_CODES: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  'deadline-urgency',
  'goal-value',
  'project-importance',
  'time-fit',
  'waiting-time',
  'habit-commitment',
  'health-protection',
  'window-open',
  'calendar-preempt',
]);

/**
 * Labels for the engine's filter rules (the "all filtered" empty state —
 * PRD R4: explainable exclusion, one line per rule).
 */
export const FILTER_RULE_LABELS: Record<FilterRuleId, string> = {
  snoozed: '已稍后，未到提醒时间',
  'context-mismatch': '与当前场景不匹配',
  'too-long': '预估时长超过可用时间',
  'window-mismatch': '不在时间窗口内',
  dependency: '依赖的行动未完成',
  'calendar-conflict': '与日程冲突',
};

/** The `ReasonCode` union re-exported for the screens. */
export type { ReasonCode };
