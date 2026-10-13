/**
 * Root layout (design.md §4): the PowerSync provider (the `packages/db`
 * platform client instance, connected once) + the navigation stack.
 *
 * - The instance is created once per app launch — it owns the local SQLite
 *   and the sync/upload loops.
 * - The connect/disconnect lifecycle is owned by the app, driven by the
 *   token + stored-addresses state (via `subscribeToOwnerTokenChange`):
 *   `connect()` is called only while BOTH an owner token AND the stored
 *   sync-server config are present, and `disconnect()` when either is
 *   missing. The PowerSync v2 SDK does NOT idle on null credentials —
 *   calling `connect()` while signed out makes its sync loop retry
 *   `buildRequest()` forever and log "Not signed in" every cycle. Offline
 *   (no token / no config) the app still works against the local DB; it
 *   simply does not sync.
 * - The single v1 stream is subscribed explicitly once after init (the
 *   service declares it `auto_subscribe: true`; the stream name stays in
 *   `packages/db`).
 * - Auth (prod-deploy R6 — cloud sync is OPTIONAL): there is NO
 *   first-launch gate — the app is local-first and renders the main tree
 *   unconditionally (the font gate below is the only render blocker).
 *   Cloud sync is configured from the Settings tab (`useCloudSync`). A
 *   BACKGROUND startup check validates the stored token + config (it never
 *   blocks rendering): the PowerSync v2 SDK swallows 401s inside its retry
 *   loop, so a rejected token would spin the sync loop forever while the
 *   Settings tab claimed 「已连接」 — the check clears a 401 TOKEN ONLY
 *   (the stored addresses stay, so reconnecting means re-entering the token,
 *   not the server; the provider's subscription disconnects), keeps
 *   everything else (200 / network error → offline-first, the next startup
 *   re-checks).
 * - Font gate (design §1.3): Epilogue + Plus Jakarta Sans load before the
 *   stack renders; until then a canvas placeholder stands in (no white
 *   flash, no `expo-splash-screen` dependency).
 */
import '../global.css';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Stack } from 'expo-router';
import { StatusBar, Text, View } from 'react-native';
import { useAppTheme } from '@/lib/theme';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
// Subpath imports on purpose: the package root re-exports every face of the
// family and Metro follows each `require`, so a root import bundles all 18
// Epilogue / 14 Plus Jakarta Sans faces. Importing per-weight keeps only the
// seven the type system actually uses.
import { Epilogue_500Medium } from '@expo-google-fonts/epilogue/500Medium';
import { Epilogue_600SemiBold } from '@expo-google-fonts/epilogue/600SemiBold';
import { Epilogue_700Bold } from '@expo-google-fonts/epilogue/700Bold';
import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular';
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold';
import { PowerSyncContext } from '@powersync/react';
import { useReminderDelivery } from '@/hooks/use-reminder-delivery';
import { IosInstallPrompt } from '@/components/ios-install-prompt';
import { AutoUpdateNotifier } from '@/components/auto-update-dialog';
import {
  clearOwnerToken,
  createPowerSyncConnector,
  createPowerSyncDatabase,
  fetchCredentialsOnce,
  getOwnerToken,
  getStoredBackendConfig,
  isReactNativeRuntime,
  subscribeAppStream,
  subscribeToOwnerTokenChange,
  type StoredBackendConfig,
} from '@nextdo/db';
import { logger } from '@nextdo/core';
import { POWERSYNC_WEB_WORKER_PATH } from '@/lib/env';

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/* ---------------- Web font gate ----------------
 *
 * expo-font's web path verifies a font load with `fontfaceobserver`,
 * which polls `document.fonts.load()` and is unreliable in WebKit (the
 * Tauri macOS webview): it rejects with a 12000ms timeout even though
 * the font is applied. On web we therefore load each face with the
 * standard FontFace API instead — one explicit success/failure per
 * face, no polling. `useFonts` still owns native (see RootLayout).
 *
 * The app tsconfig lib is ES2022 without DOM (packages/db follows the
 * same pattern), so the web globals are reached through typed views.
 */
const WEB_FONT_TIMEOUT_MS = 12000;

/** Same faces the native `useFonts` maps in RootLayout (display:
 *  Epilogue, body: Plus Jakarta Sans — design §1.3). At runtime the
 *  constants are asset URI strings on web (typed `number` for native). */
const WEB_FONT_FACES: ReadonlyArray<readonly [family: string, source: number | string]> = [
  ['Epilogue', Epilogue_600SemiBold],
  ['Epilogue_500Medium', Epilogue_500Medium],
  ['Epilogue_600SemiBold', Epilogue_600SemiBold],
  ['Epilogue_700Bold', Epilogue_700Bold],
  ['Plus Jakarta Sans', PlusJakartaSans_400Regular],
  ['PlusJakartaSans_400Regular', PlusJakartaSans_400Regular],
  ['PlusJakartaSans_500Medium', PlusJakartaSans_500Medium],
  ['PlusJakartaSans_600SemiBold', PlusJakartaSans_600SemiBold],
  ['PlusJakartaSans_700Bold', PlusJakartaSans_700Bold],
];

type WebFontCtor = new (family: string, source: string) => { load(): Promise<unknown> };

/** Load ONE face with the FontFace API and register it in
 *  document.fonts so `fontFamily: 'Epilogue'` & co. resolve. Rejects on
 *  network/decode failure (a hung fetch is bounded by the caller's
 *  timeout, not by this promise). */
function loadWebFontFace(family: string, uri: string): Promise<void> {
  const g = globalThis as unknown as {
    FontFace?: WebFontCtor;
    document: { fonts: { add(face: unknown): void } };
  };
  const FontFaceCtor = g.FontFace;
  if (typeof FontFaceCtor === 'undefined') {
    return Promise.reject(new Error('FontFace API unavailable'));
  }
  const face = new FontFaceCtor(family, `url("${uri}")`);
  return face.load().then((loaded) => {
    g.document.fonts.add(loaded);
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: ${ms}ms timeout exceeded`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** PowerSyncContext.Provider wrapper — the ONLY `@powersync/react` usage
 *  outside the data hooks (database-guidelines boundary). */
function PowerSyncProvider({ children }: { children: ReactNode }) {
  const powersync = useMemo(
    () => createPowerSyncDatabase({ web: { workerPath: POWERSYNC_WEB_WORKER_PATH } }),
    [],
  );

  useEffect(() => {
    let disposed = false;
    let unsubscribeOwnerToken: (() => void) | null = null;

    // Connect / disconnect from the token + stored-addresses state. The
    // PowerSync v2 SDK does not idle on null credentials: connect() while
    // signed out spins its sync loop, logging "Not signed in" every cycle.
    // So: token AND config present -> connect(); otherwise -> disconnect()
    // (offline, still usable locally). Both are re-read on every poke.
    const setSyncFromAuth = async () => {
      let token: string | null;
      let config: StoredBackendConfig | null = null;
      try {
        token = await getOwnerToken();
      } catch (error) {
        logger.error('owner token read failed', toError(error));
        token = null;
      }
      if (token !== null) {
        try {
          config = await getStoredBackendConfig();
        } catch (error) {
          logger.error('stored backend config read failed', toError(error));
        }
      }
      if (disposed) return;
      if (token === null || config === null) {
        logger.info(
          token === null
            ? 'powersync: no owner token — staying disconnected'
            : 'powersync: owner token present but no stored backend config — staying disconnected',
        );
        try {
          await powersync.disconnect();
        } catch (error) {
          logger.warn('powersync disconnect failed', toError(error));
        }
        return;
      }
      // connect() re-disconnects any prior connect() itself; the SDK retries
      // rejections internally, so a rejection here is not fatal.
      powersync
        .connect(createPowerSyncConnector(config))
        .catch((error: unknown) => {
          logger.error('powersync connect failed', toError(error));
        });
    };

    const start = async () => {
      try {
        await powersync.init();
      } catch (error) {
        logger.error('powersync init failed', toError(error));
        return;
      }
      if (disposed) return;
      // The single v1 stream (client-side subscription; the service
      // auto-subscribes too). Registered once, independent of auth. Failure
      // is not fatal: the sync loop retries on connect.
      //
      // The default contexts are seeded SERVER-SIDE (server/app/src/seed.ts,
      // single-writer) — the client no longer seeds. Client-side seeding was
      // racy: two fresh client DBs could both seed and upload two sets of
      // defaults, which then sync back to every client as duplicate tags.
      try {
        await subscribeAppStream(powersync);
      } catch (error) {
        logger.warn('stream subscription failed', toError(error));
      }
      if (disposed) return;
      // Drive the connection from the current token, then follow sign-in /
      // sign-out events for the life of the app.
      void setSyncFromAuth();
      unsubscribeOwnerToken = subscribeToOwnerTokenChange(() => {
        void setSyncFromAuth();
      });
    };
    void start();
    return () => {
      disposed = true;
      unsubscribeOwnerToken?.();
      void powersync.close().catch((error: unknown) => {
        logger.warn('powersync close failed', toError(error));
      });
    };
  }, [powersync]);

  return (
    <PowerSyncContext.Provider value={powersync}>
      <ReminderDelivery />
      {children}
    </PowerSyncContext.Provider>
  );
}

/**
 * The reminder delivery engine (task 09-30 design §5): mounted inside the
 * PowerSync provider (the reconcile reads the local DB through the
 * provider's instance) and outside the Stack (no route state is needed —
 * a notification tap routes to the Now tab via the router). Renders
 * nothing — the hook IS the UI (its permission state is read by the
 * Settings screen through its own hook).
 */
function ReminderDelivery() {
  useReminderDelivery();
  return null;
}

export default function RootLayout() {
  // Paper Serenity type (design §1.3): Epilogue for display, Plus Jakarta
  // Sans for body. Each weight is its own map key (the platform registers one
  // face per key — web @font-face / Android Typeface), plus the real family
  // names as entries so `fontFamily: 'Epilogue' | 'Plus Jakarta Sans'`
  // (tailwind `display` / `sans`) resolves on every platform: iOS matches the
  // fonts' internal family directly, web/android resolve the key.
  //
  // Web loads the SAME faces through the web font gate below (WEB_FONT_
  // FACES) instead of expo-font — hence the empty maps on web.
  const isWeb = !isReactNativeRuntime();
  const [epilogueLoaded, epilogueError] = useFonts(
    isWeb
      ? {}
      : {
          Epilogue: Epilogue_600SemiBold,
          Epilogue_500Medium,
          Epilogue_600SemiBold,
          Epilogue_700Bold,
        },
  );
  const [jakartaLoaded, jakartaError] = useFonts(
    isWeb
      ? {}
      : {
          'Plus Jakarta Sans': PlusJakartaSans_400Regular,
          PlusJakartaSans_400Regular,
          PlusJakartaSans_500Medium,
          PlusJakartaSans_600SemiBold,
          PlusJakartaSans_700Bold,
        },
  );

  // Web font gate (see the section above): every face loaded explicitly;
  // a failure logs and releases the gate on system fonts (the app must
  // never brick on a broken font).
  const [webFontsReady, setWebFontsReady] = useState(false);
  useEffect(() => {
    if (!isWeb) return;
    // Non-browser web runtimes (jest) have no FontFace API — there is
    // nothing to register, release the gate. Every real browser has it.
    if (typeof (globalThis as { FontFace?: unknown }).FontFace !== 'function') {
      setWebFontsReady(true);
      return;
    }
    let disposed = false;
    void (async () => {
      const results = await Promise.allSettled(
        WEB_FONT_FACES.map(([family, source]) =>
          withTimeout(loadWebFontFace(family, String(source)), WEB_FONT_TIMEOUT_MS, family),
        ),
      );
      const failures = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      if (disposed) return;
      if (failures.length > 0) {
        // One diagnostic line: a broken FETCH and a broken engine report
        // look identical from the gate, so probe the first face's URL and
        // log the UA (Tauri forwards console to its stdout in dev).
        const g = globalThis as unknown as {
          navigator: { userAgent: string };
          fetch(input: string): Promise<{ status: number }>;
        };
        const firstFailure = failures[0];
        if (firstFailure !== undefined) {
          const [firstFamily, firstSource] = WEB_FONT_FACES[0] ?? ['', ''];
          const probe = await g
            .fetch(String(firstSource))
            .then((r) => r.status)
            .catch((e: unknown) => String(e));
          logger.error(
            `web font load failed (${failures.length}/${WEB_FONT_FACES.length}; ` +
              `fetch probe ${firstFamily}=${probe}; ua=${g.navigator.userAgent})`,
            toError(firstFailure.reason),
          );
        }
      }
      setWebFontsReady(true);
    })();
    return () => {
      disposed = true;
    };
  }, [isWeb]);

  // A failed font load must not brick the app on the placeholder — log it and
  // fall back to the system fonts.
  useEffect(() => {
    if (epilogueError !== null) logger.error('Epilogue font load failed', epilogueError);
    if (jakartaError !== null) logger.error('Plus Jakarta Sans font load failed', jakartaError);
  }, [epilogueError, jakartaError]);

  /* ---------------- Startup token hygiene check (prod-deploy R6) ----------------
   *
   * Background ONLY — never blocks rendering (the app is local-first).
   * The PowerSync v2 SDK swallows a 401 inside its retry loop (the
   * connector's `credentials.rejected` never surfaces to the app), so a
   * stale stored token would spin the sync loop forever while the
   * Settings tab claimed 「已连接」. One /credentials round-trip at
   * startup, using the STORED token + config:
   *
   *   startup → getOwnerToken() + getStoredBackendConfig()
   *     either missing      → do nothing
   *     both stored         → fetchCredentialsOnce(config, token)
   *       200               → do nothing (the provider's existing mechanism
   *                           connects)
   *       401               → clearOwnerToken() ONLY (the stored addresses
   *                           stay — the provider's subscription
   *                           disconnects; the Settings tab reads it as
   *                           「未连接」 and re-entering the token is the
   *                           recovery path)
   *       network / 5xx     → do nothing (offline-first; the next startup
   *                           re-checks — v1 has no in-session 401 awareness)
   */
  useEffect(() => {
    let disposed = false;
    const start = async () => {
      let token: string | null;
      let config: StoredBackendConfig | null;
      try {
        token = await getOwnerToken();
      } catch (error) {
        logger.error('owner token read failed', toError(error));
        return;
      }
      if (token === null) return;
      try {
        config = await getStoredBackendConfig();
      } catch (error) {
        logger.error('stored backend config read failed', toError(error));
        return;
      }
      if (config === null) return;
      const result = await fetchCredentialsOnce(config, token);
      if (disposed) return;
      if (result.ok === false && result.kind === 'rejected' && result.status === 401) {
        // 401 → clear the token ONLY; the stored addresses stay (the user
        // re-enters the token, not the server, to reconnect).
        logger.warn('stored owner token rejected (401) — clearing it');
        try {
          await clearOwnerToken();
        } catch (error) {
          logger.error('owner token clear failed', toError(error));
        }
      }
    };
    void start();
    return () => {
      disposed = true;
    };
  }, []);

  // Font gate: no `<Stack>` (a native) or web content until the faces are
  // registered — the placeholder (canvas background + centered label) is
  // what prevents a white flash; no native splash-screen module needed. A
  // failed load (native error !== null; web gate failure) releases the
  // gate: the app runs on system fonts.
  const fontsReady = isWeb
    ? webFontsReady
    : (epilogueLoaded || epilogueError !== null) &&
      (jakartaLoaded || jakartaError !== null);
  // `isDark` drives the StatusBar only. The `<html class="dark">` write that
  // Tailwind's `darkMode: 'class'` selectors key off is owned by `useAppTheme`
  // itself (lib/theme.ts) — duplicating it here raced with NativeWind's own
  // class write and left 「跟随系统」 half-dark.
  const { isDark } = useAppTheme();

  if (!fontsReady) {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
        <View className="flex-1 items-center justify-center bg-canvas dark:bg-canvas-dark">
          <Text className="text-base text-muted dark:text-muted-dark">加载中…</Text>
        </View>
      </SafeAreaProvider>
    );
  }
  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <PowerSyncProvider>
        <Stack screenOptions={{ headerShown: false }} />
        <IosInstallPrompt />
        <AutoUpdateNotifier />
      </PowerSyncProvider>
    </SafeAreaProvider>
  );
}
