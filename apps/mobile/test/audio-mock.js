/**
 * Jest stub for bundled audio assets (`lib/notification-sound.ts` requires the
 * WAV tones through Metro, but jest-resolve has no asset loader). The module
 * only needs SOME non-null handle — playback is mocked away in tests anyway.
 */
module.exports = 1;
