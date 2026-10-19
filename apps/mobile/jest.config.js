/**
 * Jest 29 (jest-expo preset).
 *
 * - `@/*` path alias (tsconfig "paths", also used by Metro via Expo).
 * - `.css` → stub: Metro/NativeWind process the real `global.css`; in the
 *   jest environment the style registration is irrelevant (components
 *   render unstyled — the smoke test never asserts styles).
 * - Audio assets (`.wav`, …) → a numeric stub: `lib/notification-sound.ts`
 *   requires the bundled tones the way Metro does, and jest-resolve cannot
 *   load them (issue #54).
 * - transformIgnorePatterns: the jest-expo preset default only allows
 *   react-native/expo through the babel transform. ESM-only dependencies
 *   (PowerSync's client packages, the react-navigation / standard-navigation
 *   bridge under expo-router 57, NativeWind's interop) must be transformed
 *   as well — same pnpm caveat as packages/db's jest config: the real files
 *   live under `node_modules/.pnpm/…/node_modules/<pkg>`, so the pattern
 *   also allows the `.pnpm` hop.
 */
module.exports = {
  preset: 'jest-expo',
  testTimeout: 15000,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '\\.css$': '<rootDir>/test/css-mock.js',
    // Audio assets are Metro assets, not jest modules (issue #54).
    '\\.(wav|mp3|m4a|aac|ogg)$': '<rootDir>/test/audio-mock.js',
  },
  // Shared mock fixtures live under __tests__/mocks/ — excluded so jest's
  // default testMatch (anything under __tests__/) doesn't run them as suites.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/__tests__/mocks/'],
  transformIgnorePatterns: [
    'node_modules/(?!\\.pnpm|((jest-)?react-native|@react-native|@react-native-community|expo|@expo|react-navigation|@react-navigation|standard-navigation|nativewind|react-native-css-interop|@powersync|@journeyapps|comlink|kysely))',
  ],
};
