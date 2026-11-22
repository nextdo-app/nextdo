import { fireEvent, render, screen } from '@testing-library/react-native';
import type { DailyReviewRecord } from '@nextdo/core';

const mockPush = jest.fn();

const record: DailyReviewRecord = {
  id: 'daily-1',
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
  deletedAt: null,
  kind: 'daily',
  at: '2026-11-20T10:00:00.000Z',
  snapshot: {
    titles: { project: '项目一', waiting: '等回复' },
    inboxCount: 0,
    completedToday: [],
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

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: jest.fn(),
  },
  useLocalSearchParams: () => ({ id: 'daily-1' }),
}));

jest.mock('@/hooks/use-review-detail', () => ({
  useReviewDetail: () => ({
    data: { record, currentTitles: {} },
    loading: false,
    error: null,
    reload: jest.fn(),
  }),
}));

import ReviewDetailScreen from '../app/review/[id]';

describe('ReviewDetailScreen links', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('opens the matching project from a linked entry', () => {
    render(<ReviewDetailScreen />);
    fireEvent.press(screen.getByLabelText('打开：项目一'));
    expect(mockPush).toHaveBeenCalledWith('/projects/project');
  });

  it('opens the waiting list from a linked entry', () => {
    render(<ReviewDetailScreen />);
    fireEvent.press(screen.getByLabelText('打开：等回复'));
    expect(mockPush).toHaveBeenCalledWith('/waiting');
  });

  it('keeps unlinked entries as plain text', () => {
    render(<ReviewDetailScreen />);
    expect(screen.queryByLabelText('打开：0 条')).toBeNull();
    expect(screen.getByText('0 条')).toBeTruthy();
  });
});
