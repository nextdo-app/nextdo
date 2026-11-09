import { createContext, type ReactNode } from 'react';
import { useFocusRuntime } from '@/hooks/use-focus-runtime';
import { FocusDesktopBridge } from './focus-desktop-bridge';

export const FocusContext = createContext<ReturnType<typeof useFocusRuntime> | null>(null);

export function FocusProvider({ children }: { children: ReactNode }) {
  const focus = useFocusRuntime();
  return (
    <FocusContext.Provider value={focus}>
      <FocusDesktopBridge focus={focus} />
      {children}
    </FocusContext.Provider>
  );
}
