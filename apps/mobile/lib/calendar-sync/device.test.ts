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
}

const mockGetCalendars = jest.fn<Promise<FakeCalendar[]>, []>();
const mockCreateCalendar = jest.fn<Promise<FakeCalendar>, [{ title: string }]>();

jest.mock('expo-calendar', () => ({
  getCalendars: () => mockGetCalendars(),
  createCalendar: (details: { title: string }) => mockCreateCalendar(details),
  getCalendarPermissions: async () => ({ granted: true, status: 'granted' }),
  requestCalendarPermissions: async () => ({ granted: true, status: 'granted' }),
}));

import { ensureCalendar, findCalendar, listCalendars } from './device';

function calendar(id: string, title: string, extra: Partial<FakeCalendar> = {}): FakeCalendar {
  return { id, title, createEvent: jest.fn(), ...extra };
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
});
