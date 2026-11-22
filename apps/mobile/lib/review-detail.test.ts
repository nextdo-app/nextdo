import type { DailyReviewRecord, WeeklyReviewRecord } from '@nextdo/core';
import { reviewDetailSections } from './review-detail';

const BASE = {
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
  deletedAt: null,
};

const daily: DailyReviewRecord = {
  ...BASE,
  id: 'daily-1',
  kind: 'daily',
  at: '2026-11-20T10:00:00.000Z',
  snapshot: {
    titles: { project: '项目一', waiting: '等回复' },
    inboxCount: 2,
    completedToday: ['action-1'],
    stillOpen: [],
    projectsMissingActions: ['project'],
    waitingFollowUps: ['waiting'],
    calendarToday: [],
    calendarTomorrow: [],
    repeatedSkips: [],
  },
  answers: {
    completedActionIds: [],
    rescheduled: [],
    skippedNoted: [],
    tomorrowMustDo: [],
  },
};

const weekly: WeeklyReviewRecord = {
  ...BASE,
  id: 'weekly-1',
  kind: 'weekly',
  at: '2026-11-20T10:00:00.000Z',
  snapshot: {
    titles: { waiting: '等回复', someday: '想法' },
    inboxCount: 1,
    projects: [{ id: 'project', title: '项目一', hasOpenAction: false, lastProgressAt: null }],
    waitingFollowUps: ['waiting'],
    somedayCount: 1,
    stalledProjects: ['project'],
    calendarNext7: [],
  },
  answers: {
    inboxCleared: true,
    followUpsRaised: ['waiting'],
    calendarReasonable: true,
    somedayDecisions: [{ id: 'someday', to: 'keep' }],
    projectDecisions: [{ id: 'project', to: 'done' }],
  },
};

function section(record: ReturnType<typeof reviewDetailSections>, title: string) {
  const found = record.find((entry) => entry.title === title);
  if (found === undefined) throw new Error(`missing section: ${title}`);
  return found;
}

describe('reviewDetailSections', () => {
  it('links projects and waiting items in a daily record', () => {
    const sections = reviewDetailSections(daily, {});
    expect(section(sections, '缺少行动的项目').entries).toEqual([
      { text: '项目一', href: '/projects/project' },
    ]);
    expect(section(sections, '待跟进事项').entries).toEqual([
      { text: '等回复', href: '/waiting' },
    ]);
  });

  it('does not link entries without a destination route', () => {
    const sections = reviewDetailSections(daily, {});
    expect(section(sections, '回顾前今日完成').entries).toEqual([{ text: '标题不可用（action-1）' }]);
    expect(section(sections, '回顾时的收件箱').entries).toEqual([{ text: '2 条' }]);
  });

  it('links projects, waiting items and Someday decisions in a weekly record', () => {
    const sections = reviewDetailSections(weekly, {});
    expect(section(sections, '回顾时的项目').entries).toEqual([
      {
        text: '项目一 · 缺少行动 · 最近进展：暂无',
        href: '/projects/project',
      },
    ]);
    expect(section(sections, '项目状态决定').entries).toEqual([
      { text: '项目一 → 已完成', href: '/projects/project' },
    ]);
    expect(section(sections, 'Someday 决定').entries).toEqual([
      { text: '想法 → 保留', href: '/someday' },
    ]);
    expect(section(sections, '本次跟进（仅记录）').entries).toEqual([
      { text: '等回复', href: '/waiting' },
    ]);
  });

  it('falls back to current titles and marks them as such', () => {
    const withoutSavedTitles = { ...daily, snapshot: { ...daily.snapshot, titles: undefined } };
    const sections = reviewDetailSections(withoutSavedTitles, { project: '项目改名' });
    expect(section(sections, '缺少行动的项目').entries[0]).toEqual({
      text: '项目改名（当前标题）',
      href: '/projects/project',
    });
  });
});
