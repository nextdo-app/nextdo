import type { ReviewRecord } from '@nextdo/core';
import { formatLocalDateTime } from './format';
import { PROJECT_STATUS_LABELS } from './status-labels';
import { tomorrowAt } from './review-dates';

type Section = { title: string; lines: string[] };

/** Saved labels take precedence; old records never claim to recover a past title. */
export function reviewDetailSections(record: ReviewRecord, currentTitles: Record<string, string>): Section[] {
  const title = (id: string): string => {
    const saved = record.snapshot.titles?.[id] ?? (record.kind === 'weekly'
      ? record.snapshot.projects.find((project) => project.id === id)?.title : undefined);
    if (saved !== undefined) return saved;
    const current = currentTitles[id];
    return current === undefined ? `标题不可用（${id}）` : `${current}（当前标题）`;
  };
  const section = (heading: string, ids: string[]): Section => ({ title: heading, lines: ids.map(title) });
  if (record.kind === 'daily') {
    const { snapshot, answers } = record;
    return [
      { title: '回顾时的收件箱', lines: [`${snapshot.inboxCount} 条`] },
      section('回顾前今日完成', snapshot.completedToday),
      section('回顾时未完成', snapshot.stillOpen),
      section('缺少行动的项目', snapshot.projectsMissingActions),
      section('待跟进事项', snapshot.waitingFollowUps),
      section('当日日程', snapshot.calendarToday),
      section('次日日程', snapshot.calendarTomorrow),
      section('反复跳过', snapshot.repeatedSkips),
      section('本次标记完成', answers.completedActionIds),
      { title: '本次排期', lines: answers.rescheduled.map((entry) => `${title(entry.actionId)} → ${formatLocalDateTime(entry.toDate)}`) },
      { title: '安排到次日（按当前时区重算）', lines: answers.tomorrowMustDo.map((id) => `${title(id)} → ${formatLocalDateTime(tomorrowAt(8, new Date(record.at)).toISOString())}`) },
      section('暂不处理（仅记录）', answers.skippedNoted),
    ];
  }
  const { snapshot, answers } = record;
  const somedayLabels = { keep: '保留', trash: '删除', project: '转为项目', action: '转为行动' };
  return [
    { title: '回顾时的收件箱与 Someday', lines: [`收件箱 ${snapshot.inboxCount} 条`, `Someday ${snapshot.somedayCount} 条`] },
    { title: '回顾时的项目', lines: snapshot.projects.map((project) =>
      `${title(project.id)} · ${project.hasOpenAction ? '有进行中的行动' : '缺少行动'} · 最近进展：${project.lastProgressAt === null ? '暂无' : formatLocalDateTime(project.lastProgressAt)}`) },
    section('待跟进事项', snapshot.waitingFollowUps),
    section('停滞项目', snapshot.stalledProjects),
    section('未来 7 天日程', snapshot.calendarNext7),
    { title: '项目状态决定', lines: answers.projectDecisions.map((entry) => `${title(entry.id)} → ${PROJECT_STATUS_LABELS[entry.to]}`) },
    { title: 'Someday 决定', lines: answers.somedayDecisions.map((entry) => `${title(entry.id)} → ${somedayLabels[entry.to]}`) },
    section('本次跟进（仅记录）', answers.followUpsRaised),
    { title: '本次确认', lines: [`收件箱已清空：${answers.inboxCleared ? '是' : '否'}`, `日程安排合理：${answers.calendarReasonable ? '是' : '否'}`] },
  ];
}
