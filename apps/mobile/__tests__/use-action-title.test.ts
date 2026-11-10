import { act, renderHook, waitFor } from '@testing-library/react-native';
import { getActionDetails, type ActionDetails, type ActionKind } from '@nextdo/db';
import { logger } from '@nextdo/core';
import { useActionTitle } from '@/hooks/use-action-title';

jest.mock('@nextdo/db', () => ({
  getActionDetails: jest.fn(),
  wrapDb: () => ({}),
}));
jest.mock('@powersync/react', () => {
  const db = {};
  return { usePowerSync: () => db };
});

const lookup = jest.mocked(getActionDetails);
const details: ActionDetails = {
  title: 'Target action',
  projectId: 'project-1',
  contextIds: ['office'],
};
beforeEach(() => {
  lookup.mockReset();
});

it('loads one action and clears its metadata when the target is removed', async () => {
  lookup.mockResolvedValue(details);
  const { result, rerender } = renderHook(
    ({ kind, id }: { kind: ActionKind | null; id: string | null }) => useActionTitle(kind, id),
    { initialProps: { kind: 'next', id: 'action-1' } },
  );
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current).toEqual({ ...details, loaded: true, error: null });
  expect(lookup).toHaveBeenCalledWith(expect.anything(), 'next', 'action-1');
  rerender({ kind: null, id: null });
  expect(result.current).toEqual({
    title: null,
    projectId: null,
    contextIds: [],
    loaded: false,
    error: null,
  });
  expect(lookup).toHaveBeenCalledTimes(1);
});

it('ignores an old query after a different action has loaded', async () => {
  let resolveOld!: (value: ActionDetails) => void;
  lookup.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveOld = resolve;
    }),
  );
  lookup.mockResolvedValueOnce({ ...details, title: 'New action' });
  const { result, rerender } = renderHook(({ id }: { id: string }) => useActionTitle('next', id), {
    initialProps: { id: 'old' },
  });
  rerender({ id: 'new' });
  await waitFor(() => expect(result.current.title).toBe('New action'));
  await act(async () => {
    resolveOld(details);
  });
  expect(result.current.title).toBe('New action');
});

it('settles missing actions without an error', async () => {
  lookup.mockResolvedValue(null);
  const { result } = renderHook(() => useActionTitle('calendar', 'missing'));
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current).toEqual({
    title: null,
    projectId: null,
    contextIds: [],
    loaded: true,
    error: null,
  });
});

it('reports a failed query instead of leaving the loader pending', async () => {
  const log = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  try {
    lookup.mockRejectedValue(new Error('Local read failed'));
    const { result } = renderHook(() => useActionTitle('habit', 'day-1'));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.error).toBe('Local read failed');
    expect(log).toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});
