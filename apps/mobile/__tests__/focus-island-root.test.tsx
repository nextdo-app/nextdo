import { render } from '@testing-library/react-native';

const mockCreateDatabase = jest.fn();
const mockGetOwnerToken = jest.fn();
const mockReminder = jest.fn();
const mockCalendar = jest.fn();
jest.mock('@nextdo/db', () => ({
  isReactNativeRuntime: () => false,
  createPowerSyncDatabase: (...args: unknown[]) => mockCreateDatabase(...args),
  getOwnerToken: () => mockGetOwnerToken(),
}));
jest.mock('@powersync/react', () => ({
  PowerSyncContext: jest.requireActual('react').createContext(null),
}));
jest.mock('@/lib/theme', () => ({ useAppTheme: () => ({ isDark: false }) }));
jest.mock('@/hooks/use-app-fonts', () => ({ useAppFonts: () => true }));
jest.mock('@/hooks/use-reminder-delivery', () => ({ useReminderDelivery: () => mockReminder() }));
jest.mock('@/hooks/use-calendar-sync', () => ({ useCalendarSync: () => mockCalendar() }));
jest.mock('@/components/focus-island-client', () => ({
  FocusIslandClient: () => {
    const { createElement } = jest.requireActual('react');
    const { Text } = jest.requireActual('react-native');
    return createElement(Text, null, 'isolated capsule');
  },
}));
import RootLayout from '@/app/_layout';

it('chooses the capsule root before database and startup effects mount', () => {
  const host = globalThis as unknown as { window?: { __NEXTDO_FOCUS_ISLAND__?: boolean } };
  const previous = host.window;
  host.window = { __NEXTDO_FOCUS_ISLAND__: true };
  try {
    const view = render(<RootLayout />);
    expect(view.getByText('isolated capsule')).toBeTruthy();
    expect(mockCreateDatabase).not.toHaveBeenCalled();
    expect(mockGetOwnerToken).not.toHaveBeenCalled();
    expect(mockReminder).not.toHaveBeenCalled();
    expect(mockCalendar).not.toHaveBeenCalled();
    view.unmount();
  } finally {
    if (previous === undefined) delete host.window;
    else host.window = previous;
  }
});
