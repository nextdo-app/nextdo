import { logger } from '@nextdo/core';

interface DesktopHost {
  window?: {
    __NEXTDO_FOCUS_ISLAND__?: boolean;
    __NEXTDO_FOCUS_NOTCH_RESERVE__?: number;
    __TAURI_INTERNALS__?: {
      invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
    };
  };
}

export function isFocusIslandWindow(): boolean {
  return (globalThis as DesktopHost).window?.__NEXTDO_FOCUS_ISLAND__ === true;
}

/** Center gap the native window reserved for a macOS cutout; 0 elsewhere. */
export function focusIslandNotchReserve(): number {
  const value = (globalThis as DesktopHost).window?.__NEXTDO_FOCUS_NOTCH_RESERVE__;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function isDesktopFocusAvailable(): boolean {
  return typeof (globalThis as DesktopHost).window?.__TAURI_INTERNALS__?.invoke === 'function';
}

export function invokeFocusDesktop<T = void>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const internals = (globalThis as DesktopHost).window?.__TAURI_INTERNALS__;
  return internals
    ? internals.invoke<T>(command, args)
    : Promise.reject(new Error('专注岛仅在桌面应用中可用'));
}

/** The official listener API stays behind the desktop runtime guard. */
export async function listenFocusDesktop(
  event: string,
  receive: (value: unknown) => void,
): Promise<() => void> {
  if (!isDesktopFocusAvailable()) return () => undefined;
  const { listen } = await import('@tauri-apps/api/event');
  return listen<unknown>(event, (message) => receive(message.payload));
}

export function reportFocusDesktopError(error: unknown): string {
  logger.error(
    'focus island bridge failed',
    error instanceof Error ? error : new Error(String(error)),
  );
  return error instanceof Error ? error.message : String(error);
}
