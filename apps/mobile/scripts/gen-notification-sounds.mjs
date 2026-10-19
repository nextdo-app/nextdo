/**
 * Notification sound assets (task 09-30, design §2.3; issue #54 adds the
 * user-selectable 'gentle' tone) — regenerates the three custom tones as
 * 16-bit mono PCM WAV (44.1 kHz, far under Apple's 30 s cap):
 *
 *   assets/sounds/gentle.wav    — the soft default chime (660 → 880 Hz);
 *   assets/sounds/important.wav — a short two-tone chirp (880 → 1320 Hz);
 *   assets/sounds/alarm.wav     — a triple beep (1046 Hz × 3).
 *
 * Pure Node (no dependencies). Run from the repo root:
 *   node apps/mobile/scripts/gen-notification-sounds.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 44100;

/** Synthesize a tone with a 8 ms attack / 12 ms release envelope. */
function tone(freq, durationMs, sampleRate = SAMPLE_RATE) {
  const n = Math.floor((sampleRate * durationMs) / 1000);
  const out = new Float32Array(n);
  const attack = Math.floor((sampleRate * 8) / 1000);
  const release = Math.floor((sampleRate * 12) / 1000);
  for (let i = 0; i < n; i += 1) {
    let envelope = 1;
    if (i < attack) envelope = i / attack;
    else if (i > n - release) envelope = (n - i) / release;
    out[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * envelope;
  }
  return out;
}

/** Concatenate segments with silence gaps between them. */
function sequence(parts) {
  let total = 0;
  for (const part of parts) {
    total += part.samples.length + part.gapBefore;
  }
  const out = new Float32Array(total);
  let cursor = 0;
  for (const part of parts) {
    cursor += part.gapBefore;
    out.set(part.samples, cursor);
    cursor += part.samples.length;
  }
  return out;
}

/** Issue #54 — the default tone: lower, slower, softer than the other two. */
const gentle = sequence([
  { samples: tone(660, 180), gapBefore: 100 },
  { samples: tone(880, 240), gapBefore: 70 },
]);

/** The two reminder tones — deliberately different: a rising chirp vs a repeated beep. */
const important = sequence([
  { samples: tone(880, 160), gapBefore: 120 },
  { samples: tone(1320, 200), gapBefore: 60 },
]);

const alarm = sequence([
  { samples: tone(1046, 220), gapBefore: 120 },
  { samples: tone(1046, 220), gapBefore: 160 },
  { samples: tone(1046, 320), gapBefore: 160 },
]);

function toWav(samples) {
  const n = samples.length;
  const buffer = Buffer.alloc(44 + n * 2);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + n * 2, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] * 0.9));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buffer;
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'gentle.wav'), toWav(gentle));
writeFileSync(join(outDir, 'important.wav'), toWav(important));
writeFileSync(join(outDir, 'alarm.wav'), toWav(alarm));
console.log(
  `wrote gentle.wav (${((gentle.length / SAMPLE_RATE) * 1000).toFixed(0)} ms), ` +
    `important.wav (${((important.length / SAMPLE_RATE) * 1000).toFixed(0)} ms) and ` +
    `alarm.wav (${((alarm.length / SAMPLE_RATE) * 1000).toFixed(0)} ms)`,
);
