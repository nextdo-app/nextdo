/**
 * Inbox screen tests — capture / clarify decoupling (#58) + the Paper
 * Serenity row rework.
 *
 * A plain save (Enter / [记录], in the modal or the inline card) leaves the
 * item pending in the inbox; only [记录并澄清] funnels through the R1 handoff
 * (design §2: 记一条问一条) and opens the wizard. [开始澄清] walks the pending
 * list in batch mode. The one-shot `recapture=1` route param (from the
 * wizard's "再记一条") reopens the modal and clears itself.
 *
 * Row rework (design §2): relative capture time from the app clock, the
 * warning-colored "优先澄清" meta for captures older than 24h (the text
 * itself is the signal), and the "处理 →" button (same navigation as the
 * row title).
 *
 * The PowerSync layer is mocked at the package boundary (same shell mocks
 * as tabs.smoke.test.tsx); `addInboxItem` returns the item so the mutation
 * hook resolves to it (PRD R1). List rows come from the static
 * `mockQueryResult.data` (set per test BEFORE render — `useQuery` returns
 * the same object reference).
 */
jest.mock('@nextdo/db', () => {
  const compilable = () => ({
    compile: () => ({ sql: 'SELECT 1', parameters: [] }),
    execute: async () => [],
  });
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    disconnect: async () => undefined,
    close: async () => undefined,
  };
  return {
    createPowerSyncDatabase: () => powersync,
    // R6 startup token check (background, non-blocking): a valid stored
    // token — the screen renders regardless (there is no gate in R6).
    getOwnerToken: async () => 'test-owner-token',
    getStoredBackendConfig: async () => null,
    fetchCredentialsOnce: async () => ({ ok: true, token: 'ps-service-jwt' }),
    setOwnerToken: async () => undefined,
    clearOwnerToken: async () => undefined,
    subscribeToOwnerTokenChange: () => () => undefined,
    createPowerSyncConnector: () => ({
      fetchCredentials: async () => null,
      uploadData: async () => undefined,
    }),
    subscribeAppStream: async () => undefined,
    wrapDb: () => ({}),
    // The delivery hook's source query (task 09-30 — the root layout
    // mounts useReminderDelivery in every renderRouter test).
    listScheduledReminders: async () => [],
    seedDefaultContexts: async () => 0,
    isReactNativeRuntime: () => false,
    queryEnginePool: async () => ({ actions: [], calendar: [], projects: [] }),
    poolTriggerWatchQuery: compilable,
    inboxItemsWatchQuery: compilable,
    projectsWatchQuery: compilable,
    reviewRecordsWatchQuery: compilable,
    waitingForWatchQuery: compilable,
    skipAction: async () => undefined,
    completeAction: async () => undefined,
    snoozeAction: async () => undefined,
    trashAction: async () => undefined,
    // R1: resolves to the created item (id drives the Clarify handoff).
    addInboxItem: jest.fn(async (_db: unknown, item: unknown) => item),
    trashInboxItem: async () => undefined,
    listInboxItems: async () => [],
    listProjects: async () => [],
    listProjectActions: async () => [],
    listContexts: async () => [],
    addContext: async () => undefined,
    listHabits: async () => [],
    listHabitDays: async () => [],
  };
});

// The static watch-query result — the inbox list renders from
// `mockQueryResult.data` (the `@powersync/react` mock's `useQuery` returns
// this same object reference). Set it BEFORE renderRouter.
const mockQueryResult: {
  data: InboxItem[];
  isLoading: boolean;
  isFetching: boolean;
  error: undefined;
  refresh: () => Promise<void>;
} = {
  data: [],
  isLoading: false,
  isFetching: false,
  error: undefined,
  refresh: async () => undefined,
};

jest.mock('@powersync/react', () => {
  const React = jest.requireActual('react');
  const powersync = {
    init: async () => undefined,
    connect: () => Promise.resolve(undefined),
    close: async () => undefined,
    // The delivery hook subscribes to local changes (task 09-30) — a
    // no-op subscription in tests (the mocked queries never fire it).
    onChange: () => () => undefined,
  };
  return {
    PowerSyncContext: React.createContext(powersync),
    usePowerSync: () => powersync,
    useQuery: () => mockQueryResult,
    useStatus: () => ({ status: 'synced', isSynced: true }),
  };
});

// The root layout mounts the delivery engine (task 09-30) — jest runs as
// Platform 'ios', so the real native adapter drives expo-notifications
// (mocked: idle OS state — nothing pending, permission undetermined).
jest.mock('expo-notifications', () => mockExpoNotifications);

import { mockExpoNotifications } from './mocks/expo-notifications';

import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { router } from 'expo-router';
import { Modal } from 'react-native';
import { addInboxItem } from '@nextdo/db';
import type { InboxItem } from '@nextdo/core';

const mockedAddInboxItem = addInboxItem as jest.Mock;

const HOUR_MS = 60 * 60 * 1000;

function inboxItem(id: string, title: string, capturedAt: string): InboxItem {
  return { id, createdAt: capturedAt, updatedAt: capturedAt, deletedAt: null, title, capturedAt };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryResult.data = [];
});

describe('Inbox screen — capture / clarify decoupling (#58)', () => {
  it('inline capture card: [记录并澄清] opens the Clarify wizard for the new item', async () => {
    const view = renderRouter('app', { initialUrl: '/(tabs)/inbox' });
    await act(async () => {});

    // The launch modal is open by default — dismiss it to reach the card.
    fireEvent.press(screen.getByText('稍后再说'));

    // The inline capture input (its full placeholder differs from the modal's).
    const input = screen.getByPlaceholderText('有什么事情占据着你现在的注意力？');
    expect(screen.getByText('支持自然输入，待会儿逐个澄清')).toBeTruthy();
    fireEvent.changeText(input, '内联捕获');
    fireEvent.press(screen.getByText('记录并澄清'));

    await waitFor(() => expect(view.getPathname().startsWith('/clarify/')).toBe(true));
    expect(mockedAddInboxItem).toHaveBeenCalledTimes(1);
    expect(mockedAddInboxItem.mock.calls[0][1]).toMatchObject({ title: '内联捕获' });
  });

  it('inline capture card: [记录] / Enter saves and stays on the inbox', async () => {
    const view = renderRouter('app', { initialUrl: '/(tabs)/inbox' });
    await act(async () => {});
    fireEvent.press(screen.getByText('稍后再说'));

    const input = screen.getByPlaceholderText('有什么事情占据着你现在的注意力？');
    fireEvent.changeText(input, '先记下来');
    fireEvent(input, 'submitEditing');

    await waitFor(() => expect(mockedAddInboxItem).toHaveBeenCalledTimes(1));
    expect(mockedAddInboxItem.mock.calls[0][1]).toMatchObject({ title: '先记下来' });
    // #58: the item stays pending — no wizard, no navigation.
    expect(view.getPathname()).toBe('/inbox');
  });

  it('quick-capture modal: [记录] saves and closes the modal only', async () => {
    const view = renderRouter('app', { initialUrl: '/(tabs)/inbox' });
    await act(async () => {});

    const input = screen.getByPlaceholderText('记下任何事…（Enter 快速保存）');
    fireEvent.changeText(input, '弹窗捕获');
    fireEvent(input, 'submitEditing');

    await waitFor(() => expect(mockedAddInboxItem).toHaveBeenCalledTimes(1));
    expect(mockedAddInboxItem.mock.calls[0][1]).toMatchObject({ title: '弹窗捕获' });
    expect(view.getPathname()).toBe('/inbox');
    expect(view.root.findByType(Modal).props.visible).toBe(false);
  });

  it('quick-capture modal: [记录并澄清] hands off to the Clarify wizard', async () => {
    const view = renderRouter('app', { initialUrl: '/(tabs)/inbox' });
    await act(async () => {});

    const input = screen.getByPlaceholderText('记下任何事…（Enter 快速保存）');
    fireEvent.changeText(input, '弹窗澄清');
    // The inline card behind the modal carries the same label — scope to the modal.
    fireEvent.press(within(view.root.findByType(Modal)).getByText('记录并澄清'));

    await waitFor(() => expect(view.getPathname().startsWith('/clarify/')).toBe(true));
    expect(mockedAddInboxItem).toHaveBeenCalledTimes(1);
    expect(mockedAddInboxItem.mock.calls[0][1]).toMatchObject({ title: '弹窗澄清' });
    // The modal closed as part of the handoff.
    expect(view.root.findByType(Modal).props.visible).toBe(false);
  });

  it('recapture=1: reopens the modal and consumes the param (one-shot)', async () => {
    const view = renderRouter('app', { initialUrl: '/(tabs)/inbox' });
    await act(async () => {});

    // Close the launch modal first, so the param can be observed reopening it.
    fireEvent.press(screen.getByText('稍后再说'));
    expect(view.root.findByType(Modal).props.visible).toBe(false);

    // "再记一条" from the wizard navigates back with the one-shot param.
    act(() => {
      router.navigate({ pathname: '/(tabs)/inbox', params: { recapture: '1' } });
    });
    await act(async () => {});

    // The modal reopened…
    expect(view.root.findByType(Modal).props.visible).toBe(true);
    // …and the param was consumed (no re-trigger on later renders).
    expect(view.getSearchParams().recapture ?? undefined).toBeUndefined();
  });

  it('a failed save (null) stays on the inbox screen', async () => {
    mockedAddInboxItem.mockRejectedValueOnce(new Error('local write failed'));
    const view = renderRouter('app', { initialUrl: '/(tabs)/inbox' });
    await act(async () => {});

    fireEvent.press(screen.getByText('稍后再说'));
    const input = screen.getByPlaceholderText('有什么事情占据着你现在的注意力？');
    fireEvent.changeText(input, '会失败的捕获');
    fireEvent(input, 'submitEditing');

    await act(async () => {});
    expect(view.getPathname()).toBe('/inbox');
    // The draft is kept for a retry.
    expect(screen.getByPlaceholderText('有什么事情占据着你现在的注意力？').props.value).toBe(
      '会失败的捕获',
    );
  });
});

describe('Inbox screen — Paper Serenity rows (design §2)', () => {
  // The screen's clock is the fake system time pinned at render — both rows
  // are built relative to it, so the 24h comparison is deterministic.
  async function renderWithTwoRows() {
    const t = Date.now();
    mockQueryResult.data = [
      inboxItem('inbox-old', '两天前记下的事', new Date(t - 48 * HOUR_MS).toISOString()),
      inboxItem('inbox-fresh', '刚刚记下的事', new Date(t - 10 * 60 * 1000).toISOString()),
    ];
    const view = renderRouter('app', { initialUrl: '/(tabs)/inbox' });
    // The root auth gate (prod-deploy R3) renders asynchronously — flush it
    // before interacting, or '稍后再说' is not mounted yet (still the
    // loading placeholder).
    await act(async () => {});
    fireEvent.press(screen.getByText('稍后再说'));
    return view;
  }

  it('shows the 清空大脑 header, both capture actions and the 待澄清 count', async () => {
    await renderWithTwoRows();
    await act(async () => {});
    expect(screen.getByText('清空大脑')).toBeTruthy();
    expect(screen.getByText('先记下来，不用现在想清楚。')).toBeTruthy();
    expect(screen.getByText('记录并澄清')).toBeTruthy();
    expect(screen.getByText('记录')).toBeTruthy();
    // #58: the count row names what is actually pending — 待澄清.
    expect(screen.getByText('待澄清')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('开始澄清')).toBeTruthy();
    expect(screen.getByText('GTD 澄清心法')).toBeTruthy();
  });

  it('[开始澄清] opens the oldest pending item in batch mode', async () => {
    const view = await renderWithTwoRows();
    await act(async () => {});

    fireEvent.press(screen.getByText('开始澄清'));

    await waitFor(() => expect(view.getPathname()).toBe('/clarify/inbox-old'));
    expect(view.getSearchParams().batch).toBe('1');
  });

  it('captures older than 24h carry the 优先澄清 meta; fresh ones do not', async () => {
    await renderWithTwoRows();
    await act(async () => {});

    expect(screen.getByText('两天前记下的事')).toBeTruthy();
    expect(screen.getByText('刚刚记下的事')).toBeTruthy();
    // Exactly one row carries the warning meta (the 48h one).
    expect(screen.getAllByText(/优先澄清/)).toHaveLength(1);
    // The fresh row's meta is the relative time only (10 分钟前).
    expect(screen.getByText('10 分钟前')).toBeTruthy();
  });

  it('the row 处理 → button opens the Clarify wizard for that item', async () => {
    const view = await renderWithTwoRows();
    await act(async () => {});

    fireEvent.press(screen.getAllByText('处理 →')[1]!);

    await waitFor(() => expect(view.getPathname()).toBe('/clarify/inbox-fresh'));
  });
});
