/**
 * The native calendar boundary's target selection.
 *
 * What matters here is only the CHOICE, not expo-calendar itself: the user's
 * picked calendar (a Google or iCloud one the OS already holds) must win, and
 * a pick that no longer exists must degrade to the default target instead of
 * silently dropping the reminder.
 */
jest.mock('@nextdo/core', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

interface FakeCalendar {
  id: string;
  title: string;
  allowsModifications?: boolean;
  ownerAccount?: { name?: string };
  createEvent: jest.Mock;
  listEvents: jest.Mock;
}

const mockGetCalendars = jest.fn<Promise<FakeCalendar[]>, []>();
const mockCreateCalendar = jest.fn<Promise<FakeCalendar>, [{ title: string }]>();

jest.mock('expo-calendar', () => ({
  getCalendars: () => mockGetCalendars(),
  createCalendar: (details: { title: string }) => mockCreateCalendar(details),
  getCalendarPermissions: async () => ({ granted: true, status: 'granted' }),
  requestCalendarPermissions: async () => ({ granted: true, status: 'granted' }),
}));

import {
  createCalendarEvent,
  ensureCalendar,
  findCalendar,
  listCalendars,
  listEventsForImport,
} from './device';
import { NEXTDO_EVENT_NOTE } from './reconcile';

function calendar(id: string, title: string, extra: Partial<FakeCalendar> = {}): FakeCalendar {
  return { id, title, createEvent: jest.fn(), listEvents: jest.fn(async () => []), ...extra };
}

describe('native calendar target', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('the calendar the user picked wins over the Nextdo one', async () => {
    const nextdo = calendar('cal-nextdo', 'Nextdo');
    const gmail = calendar('cal-gmail', 'Personal', { ownerAccount: { name: 'Gmail' } });
    mockGetCalendars.mockResolvedValue([nextdo, gmail]);

    const target = await ensureCalendar('cal-gmail');

    expect(target?.id).toBe('cal-gmail');
    // No Nextdo calendar was created — the pick short-circuits the default.
    expect(mockCreateCalendar).not.toHaveBeenCalled();
  });

  it('a pick that vanished falls back to the Nextdo default', async () => {
    const nextdo = calendar('cal-nextdo', 'Nextdo');
    mockGetCalendars.mockResolvedValue([nextdo]);

    // The user deleted that calendar, or signed the account out.
    const target = await ensureCalendar('cal-gone');

    expect(target?.id).toBe('cal-nextdo');
  });

  it('a read-only pick is refused in favour of the default', async () => {
    const nextdo = calendar('cal-nextdo', 'Nextdo');
    const holidays = calendar('cal-holidays', '节假日', { allowsModifications: false });
    mockGetCalendars.mockResolvedValue([nextdo, holidays]);

    const target = await ensureCalendar('cal-holidays');

    expect(target?.id).toBe('cal-nextdo');
  });

  it('with no pick, the Nextdo calendar is reused when it exists', async () => {
    const nextdo = calendar('cal-nextdo', 'Nextdo');
    const gmail = calendar('cal-gmail', 'Personal');
    mockGetCalendars.mockResolvedValue([gmail, nextdo]);

    const target = await ensureCalendar(null);

    expect(target?.id).toBe('cal-nextdo');
    expect(mockCreateCalendar).not.toHaveBeenCalled();
  });

  it('with no pick and no Nextdo calendar, one is created', async () => {
    const created = calendar('cal-new', 'Nextdo');
    mockGetCalendars.mockResolvedValue([]);
    mockCreateCalendar.mockResolvedValue(created);

    const target = await ensureCalendar();

    expect(target?.id).toBe('cal-new');
    expect(mockCreateCalendar).toHaveBeenCalledWith({ title: 'Nextdo' });
  });

  it('listCalendars names the account so two calendars are tellable apart', async () => {
    mockGetCalendars.mockResolvedValue([
      calendar('cal-gmail', 'Personal', { ownerAccount: { name: 'Gmail' } }),
      calendar('cal-icloud', '家庭', { ownerAccount: { name: 'iCloud' } }),
      calendar('cal-holidays', '节假日', { allowsModifications: false }),
    ]);

    expect(await listCalendars()).toEqual([
      { id: 'cal-gmail', title: 'Personal', source: 'Gmail', allowsModifications: true },
      { id: 'cal-icloud', title: '家庭', source: 'iCloud', allowsModifications: true },
      // Read-only calendars are reported, not filtered — the caller decides.
      { id: 'cal-holidays', title: '节假日', source: null, allowsModifications: false },
    ]);
  });

  it('findCalendar resolves a pick to the real calendar object', async () => {
    const gmail = calendar('cal-gmail', 'Personal');
    mockGetCalendars.mockResolvedValue([gmail]);

    expect(await findCalendar('cal-gmail')).toBe(gmail);
    expect(await findCalendar('cal-gone')).toBeNull();
  });

  it('listEventsForImport merges every calendar and only returns plain data', async () => {
    const gmail = calendar('cal-gmail', 'Personal');
    const work = calendar('cal-work', 'Work');
    gmail.listEvents.mockResolvedValue([
      {
        id: 'evt-gmail',
        title: '组会',
        startDate: new Date('2026-11-21T09:00:00.000Z'),
        endDate: new Date('2026-11-21T10:00:00.000Z'),
        allDay: false,
        availability: 'busy',
        status: 'confirmed',
        notes: '',
      },
    ]);
    work.listEvents.mockResolvedValue([
      {
        id: 'evt-work',
        title: '评审',
        // The SDK accepts string dates too; the boundary normalizes them.
        startDate: '2026-11-21T11:00:00.000Z',
        endDate: '2026-11-21T12:00:00.000Z',
        allDay: true,
        availability: 'free',
        status: 'canceled',
        notes: '由 Nextdo 自动同步',
      },
    ]);
    mockGetCalendars.mockResolvedValue([gmail, work]);

    const start = new Date('2026-11-21T00:00:00.000Z');
    const end = new Date('2026-11-22T00:00:00.000Z');
    const events = await listEventsForImport(start, end);

    expect(events).toEqual([
      {
        id: 'evt-gmail',
        title: '组会',
        startsAt: '2026-11-21T09:00:00.000Z',
        endsAt: '2026-11-21T10:00:00.000Z',
        allDay: false,
        availability: 'busy',
        status: 'confirmed',
        notes: '',
      },
      {
        id: 'evt-work',
        title: '评审',
        startsAt: '2026-11-21T11:00:00.000Z',
        endsAt: '2026-11-21T12:00:00.000Z',
        allDay: true,
        availability: 'free',
        status: 'canceled',
        notes: '由 Nextdo 自动同步',
      },
    ]);
    expect(gmail.listEvents).toHaveBeenCalledWith(start, end);
    expect(work.listEvents).toHaveBeenCalledWith(start, end);
  });

  it('writes the user note AND the origin marker on create (review R2)', async () => {
    const gmail = calendar('cal-gmail', 'Personal');
    gmail.createEvent.mockResolvedValue({ id: 'evt-mirror' });

    const mapping = await createCalendarEvent(gmail as never, {
      actionId: 'ca-1',
      title: '准备合同',
      startsAt: '2026-11-21T10:30:00.000Z',
      endsAt: '2026-11-21T11:00:00.000Z',
      notes: '带合同，会议室 B',
    });

    expect(mapping?.eventId).toBe('evt-mirror');
    expect(gmail.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        // The note survives for the user; the marker makes the event
        // recognisable as Nextdo's own mirror on another device.
        notes: `带合同，会议室 B\n\n${NEXTDO_EVENT_NOTE}`,
      }),
    );
  });

  it('listEventsForImport fails loudly so the caller can keep its snapshot', async () => {
    const gmail = calendar('cal-gmail', 'Personal');
    gmail.listEvents.mockRejectedValue(new Error('calendar access revoked'));
    mockGetCalendars.mockResolvedValue([gmail]);

    await expect(
      listEventsForImport(new Date(), new Date()),
    ).rejects.toThrow('calendar access revoked');
  });
});
