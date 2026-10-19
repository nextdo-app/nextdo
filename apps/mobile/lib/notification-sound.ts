/**
 * In-app notification tones (issue #54) — the ONE place that knows how the
 * bundled WAV assets map to a user's `soundTone`, and the ONE place that
 * plays them. Playback is at unity gain: the tone follows the DEVICE volume,
 * so the volume buttons / silent switch are the only level controls (there
 * is no in-app volume setting that could fight with them).
 *
 * Who calls what:
 *
 *   focus screen      → `playFocusCompletionSound()`  (the timer hits zero;
 *                       plays even when the app is foregrounded on native,
 *                       where no OS notification exists for it)
 *   tauri adapter     → `playReminderSound()` after a desktop notification
 *                       fires (in-session delivery only)
 *   settings screen   → `playNotificationTone(tone)` when the user taps a
 *                       tone, so a choice can be HEARD before it is kept
 *
 * Native reminder sounds are NOT played here: `expo-notifications` delivers
 * them with the OS notification (`shouldPlaySound` / `sound: false`), so
 * playing an in-app tone too would double the sound on every foreground
 * reminder.
 *
 * Platform notes:
 * - `expo-audio` is required LAZILY so a Node/jest environment (and any
 *   bundle that never plays a sound) never touches the native module.
 * - iOS silent-switch: `playsInSilentMode: true` — a focus completion the
 *   user asked for is a deliberate alert, not incidental audio.
 * - Playback is at unity gain: the OS volume buttons (and the iOS silent
 *   switch) are the only level controls — see the header note.
 */
import { logger } from '@nextdo/core';
import {
  loadNotificationSettings,
  type NotificationSoundTone,
} from '@/lib/notification-settings';

/** The bundled tones — one WAV per stored choice. */
const TONE_SOURCES: Record<NotificationSoundTone, number> = {
  // An asset reference must be a literal `require` for Metro.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  gentle: require('../assets/sounds/gentle.wav'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  important: require('../assets/sounds/important.wav'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  alarm: require('../assets/sounds/alarm.wav'),
};

type AudioModule = typeof import('expo-audio');
type AudioPlayer = ReturnType<AudioModule['createAudioPlayer']>;

let audioModule: AudioModule | null | undefined;
let audioModeReady = false;
const players = new Map<NotificationSoundTone, AudioPlayer>();

/** Lazy, failure-tolerant `expo-audio` load (jest / non-audio bundles). */
function getAudioModule(): AudioModule | null {
  if (audioModule !== undefined) return audioModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    audioModule = require('expo-audio') as AudioModule;
  } catch (error) {
    logger.warn('notification-sound: expo-audio unavailable', error);
    audioModule = null;
  }
  return audioModule;
}

async function ensureAudioMode(audio: AudioModule): Promise<void> {
  if (audioModeReady) return;
  audioModeReady = true;
  try {
    await audio.setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
    });
  } catch (error) {
    // A tone is best-effort; a mode failure must never break the caller.
    logger.warn('notification-sound: setAudioModeAsync failed', error);
  }
}

/**
 * Play one bundled tone at the device volume (unity gain). Never throws — a
 * sound is a nice-to-have and must not turn a timer transition or a
 * notification into an error path.
 */
export async function playNotificationTone(tone: NotificationSoundTone): Promise<void> {
  const audio = getAudioModule();
  if (audio === null) return;
  try {
    await ensureAudioMode(audio);
    let player = players.get(tone);
    if (player === undefined) {
      player = audio.createAudioPlayer(TONE_SOURCES[tone]);
      players.set(tone, player);
    }
    await player.seekTo(0);
    player.play();
  } catch (error) {
    logger.warn(`notification-sound: failed to play '${tone}'`, error);
  }
}

/**
 * The focus timer reached zero. Honors `focusSoundEnabled` and the shared
 * tone choice; reads the stored settings fresh so a Settings change applies
 * to the very next session without remounting the screen.
 */
export async function playFocusCompletionSound(): Promise<void> {
  const settings = await loadNotificationSettings();
  if (!settings.focusSoundEnabled) return;
  await playNotificationTone(settings.soundTone);
}

/** The desktop (tauri) adapter's notification fired — plays only when the
 *  reminder switch is on and the notification actually went out. */
export async function playReminderSound(): Promise<void> {
  const settings = await loadNotificationSettings();
  if (!settings.reminderSoundEnabled) return;
  await playNotificationTone(settings.soundTone);
}

/** Test seam: drop cached players so a fresh mock module is picked up. */
export function resetNotificationSoundForTests(): void {
  players.clear();
  audioModule = undefined;
  audioModeReady = false;
}
