// The personas' voices, on ElevenLabs, for `archipelago serve` only (the hosted build has no server to keep a key on).
// The key is read here and never leaves the server: ELEVENLABS_API_KEY, else ~/.archipelago/elevenlabs.key. Each
// reading is streamed to the page as it arrives and kept under ~/.archipelago/voice/, so a replay costs nothing.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MessageRole } from "../core/types.ts";
import type { Voice } from "./api-routes.ts";

/** ElevenLabs' real-time model: under a second to the first sound, Mandarin included (picked by ear, 2026-11-07). */
export const VOICE_MODEL = "eleven_v4_turbo";
/** Matilda, the Mentor's voice: warm, a patient tutor (picked by ear over Lily, 2026-11-07). */
export const MENTOR_VOICE = "XrExE9yKIg1WjnnlVkGX";
/** George, the Keeper's voice: a calm British storyteller, set apart from the Mentor's (picked by ear, 2026-11-07). */
export const KEEPER_VOICE = "JBFqnCBsd6RMkjVDRZzb";

const ELEVENLABS = "https://api.elevenlabs.io/v1/text-to-speech";

/** Names for the voices tried by ear, so the page can say who is reading; another voice reads unnamed. */
const VOICE_NAMES: Record<string, string> = {
  XrExE9yKIg1WjnnlVkGX: "Matilda", JBFqnCBsd6RMkjVDRZzb: "George", pFZP5JQG7iQjIQuC4Bku: "Lily", EXAVITQu4vr4xnSDxMaL: "Sarah",
  cjVigY5qzO86Huf0OWal: "Eric", onwK4e9ZLuTAKqWW03F9: "Daniel", Xb7hH8MSUJpSbSDYk0k2: "Alice",
};

export type VoiceOptions = {
  env?: Record<string, string | undefined>;
  /** Where the key file and the cache live; `~/.archipelago` by default. */
  home?: string;
  fetch?: typeof fetch;
};

/** The voices this server has, or null without a key. ARCHIPELAGO_VOICE_MENTOR and ARCHIPELAGO_VOICE_KEEPER name
 *  another voice; `off` silences that persona. */
export function createVoice(options: VoiceOptions = {}): Voice | null {
  const env = options.env ?? process.env;
  const home = options.home ?? join(homedir(), ".archipelago");
  const keyFile = join(home, "elevenlabs.key");
  const key = env.ELEVENLABS_API_KEY?.trim() || (existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : "");
  if (!key) return null;
  const model = env.ARCHIPELAGO_VOICE_MODEL?.trim() || VOICE_MODEL;
  const voices: Partial<Record<MessageRole, string>> = {};
  for (const [role, setting, fallback] of [["mentor", env.ARCHIPELAGO_VOICE_MENTOR, MENTOR_VOICE], ["judge", env.ARCHIPELAGO_VOICE_KEEPER, KEEPER_VOICE]] as const) {
    const voice = setting?.trim() || fallback;
    if (voice !== "off") voices[role] = voice;
  }
  const cacheDir = join(home, "voice");
  const send = options.fetch ?? fetch;

  return {
    model,
    roles: () => Object.keys(voices) as MessageRole[],
    name: (role) => VOICE_NAMES[voices[role] ?? ""] ?? null,
    async speak(role, text, language) {
      const voice = voices[role];
      if (!voice) throw new Error(`no voice for ${role}`);
      const name = createHash("sha256").update(`${model}\n${voice}\n${language}\n${text}`).digest("hex");
      const file = join(cacheDir, `${name}.mp3`);
      const headers = { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=31536000, immutable" };
      if (existsSync(file)) return new Response(readFileSync(file), { headers });
      const res = await send(`${ELEVENLABS}/${voice}/stream?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: model, language_code: language }),
      });
      if (!res.ok || !res.body) return Response.json({ error: `the voice service answered ${res.status}` }, { status: 502 });
      // One branch plays; the other is kept once whole, even if the reader stops listening (the reading is paid for).
      const [play, keep] = res.body.tee();
      void (async () => {
        const chunks: Uint8Array[] = [];
        for await (const chunk of keep) chunks.push(chunk);
        mkdirSync(cacheDir, { recursive: true });
        writeFileSync(`${file}.part`, Buffer.concat(chunks));
        renameSync(`${file}.part`, file);
      })().catch(() => {});
      return new Response(play, { headers });
    },
  };
}
