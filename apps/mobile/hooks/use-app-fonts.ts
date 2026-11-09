import { useEffect, useState } from 'react';
import { isReactNativeRuntime } from '@nextdo/db';
import { logger } from '@nextdo/core';
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

export function useAppFonts(): boolean {
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
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
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

  const fontsReady = isWeb
    ? webFontsReady
    : (epilogueLoaded || epilogueError !== null) && (jakartaLoaded || jakartaError !== null);
  return fontsReady;
}
