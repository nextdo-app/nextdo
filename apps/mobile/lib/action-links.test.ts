import { focusHref } from './action-links';

describe('focusHref', () => {
  it('carries the estimate as the focus preset', () => {
    expect(focusHref({ id: 'a-1', kind: 'next', estMinutes: 25 })).toBe(
      '/focus/a-1?kind=next&preset=25',
    );
  });

  it('omits the preset when the action has no estimate', () => {
    expect(focusHref({ id: 'a-2', kind: 'next', estMinutes: 0 })).toBe('/focus/a-2?kind=next');
  });

  it('keeps the kind for habit and calendar actions', () => {
    expect(focusHref({ id: 'hd-1', kind: 'habit', estMinutes: 10 })).toBe(
      '/focus/hd-1?kind=habit&preset=10',
    );
    expect(focusHref({ id: 'c-1', kind: 'calendar', estMinutes: 30 })).toBe(
      '/focus/c-1?kind=calendar&preset=30',
    );
  });
});
