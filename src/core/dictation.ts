// Push-to-talk's limits and the recordings it takes, for the route (`POST /api/transcribe`) and the transcriber
// (`src/server/dictation.ts`). The page mirrors the limits in `src/web/dictation-model.js`; a test keeps them equal.

/** The longest one recording runs: the page stops it by itself here, and the words so far are heard. */
export const TALK_SECONDS_MAX = 120;
/** The page records speech at this bit rate: plenty for a voice, and two minutes stay under a megabyte. */
export const TALK_BITS_PER_SECOND = 48_000;
/** The most one recording may weigh: two minutes at four times the page's bit rate, for a browser that ignores it. */
export const TALK_BYTES_MAX = Math.ceil((TALK_SECONDS_MAX * TALK_BITS_PER_SECOND * 4) / 8);

/** What a browser's MediaRecorder writes (WebM or Ogg with Opus, Safari's MP4 with AAC), and a file name's ending for each. */
const AUDIO_TYPES: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

/** A recording's media type without its parameters ("audio/webm;codecs=opus" → "audio/webm"), or null for one not taken. */
export function audioType(type: string): string | null {
  const base = String(type).split(";")[0].trim().toLowerCase();
  return Object.hasOwn(AUDIO_TYPES, base) ? base : null;
}

/** The ending a file of this type is sent under, since the service reads the name as well as the bytes. */
export function audioExtension(type: string): string {
  return AUDIO_TYPES[audioType(type) ?? ""] ?? "webm";
}
