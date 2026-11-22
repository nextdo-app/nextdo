/**
 * Route test — app/clarify/[inboxId] (issue #101).
 *
 * The capture preview passes its suggestion as route params. The route must
 * validate them into a ClarifyPrefill and hand it to the wizard; malformed
 * params are ignored so the wizard still opens without a hint.
 */
let mockParams: Record<string, string | undefined> = {};
let mockWizardProps: Record<string, unknown> | null = null;

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@/components/clarify-wizard', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    ClarifyWizard: (props: Record<string, unknown>) => {
      mockWizardProps = props;
      return React.createElement(View, { testID: 'clarify-wizard' });
    },
  };
});

import { render, screen } from '@testing-library/react-native';
import ClarifyScreen from '@/app/clarify/[inboxId]';

describe('Clarify route — capture prefill (issue #101)', () => {
  beforeEach(() => {
    mockWizardProps = null;
  });

  it('converts valid params into a ClarifyPrefill', () => {
    mockParams = {
      inboxId: 'inbox-1',
      startsAt: new Date(2026, 10, 22, 15, 0).toISOString(),
      estMinutes: '30',
    };
    render(<ClarifyScreen />);

    expect(screen.getByTestId('clarify-wizard')).toBeTruthy();
    expect(mockWizardProps?.prefill).toEqual({
      deadline: '',
      startsAtDate: '2026-11-22',
      startsAtTime: '15:00',
      estMinutes: 30,
    });
    expect(mockWizardProps?.id).toBe('inbox-1');
  });

  it('passes a null prefill when the params are missing or malformed', () => {
    mockParams = { inboxId: 'inbox-1', deadline: 'garbage' };
    render(<ClarifyScreen />);
    expect(mockWizardProps?.prefill).toBeNull();
  });
});
