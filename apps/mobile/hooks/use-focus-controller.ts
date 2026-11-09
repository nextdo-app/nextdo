import { useContext } from 'react';
import { FocusContext } from '@/components/focus-provider';

export function useFocusController() {
  const focus = useContext(FocusContext);
  if (focus === null) throw new Error('FocusProvider is missing');
  return focus;
}
