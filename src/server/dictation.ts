// Push-to-talk's other half: the reader's spoken answer as words, on ElevenLabs' speech-to-text (Scribe), for
// `archipelago serve` only, with the key the voices read (`elevenLabsKey` in voice.ts; the hosted build has no server
// to keep one on). The recording lives in memory for the one request: it is never written anywhere, and nothing of it
// is kept once the words are back. The service hears the language itself, so an answer may mix English and Chinese.
import { audioExtension } from "../core/dictation.ts";
import type { Dictation } from "./api-routes.ts";
import { elevenLabsKey, type VoiceOptions } from "./voice.ts";

/** ElevenLabs' model for recorded speech ("Use Scribe v3 for recorded audio"); ARCHIPELAGO_DICTATION_MODEL names
 *  another, and `off` turns push-to-talk off while the voices stay. */
export const DICTATION_MODEL = "scribe_v3";

const ELEVENLABS_STT = "https://api.elevenlabs.io/v1/speech-to-text";

/** Push-to-talk on ElevenLabs, or null without a key. */
export function createDictation(options: VoiceOptions = {}): Dictation | null {
  const env = options.env ?? process.env;
  const key = elevenLabsKey(options);
  const model = env.ARCHIPELAGO_DICTATION_MODEL?.trim() || DICTATION_MODEL;
  if (!key || model === "off") return null;
  const send = options.fetch ?? fetch;
  return {
    model,
    async transcribe(audio, type) {
      const form = new FormData();
      form.append("model_id", model);
      form.append("tag_audio_events", "false"); // "(laughter)" is not the reader's words
      form.append("file", new Blob([new Uint8Array(audio)], { type }), `answer.${audioExtension(type)}`);
      const res = await send(ELEVENLABS_STT, { method: "POST", headers: { "xi-api-key": key }, body: form });
      if (!res.ok) throw new Error(await refusal(res));
      const body = (await res.json()) as { text?: unknown; language_code?: unknown };
      return {
        text: typeof body.text === "string" ? body.text.trim() : "",
        language: typeof body.language_code === "string" ? body.language_code : null,
      };
    },
  };
}

/**
 * Why the service said no, in its own words where it gave any: a key without the Speech to Text permission, an
 * exhausted quota, a model it does not know. Without them, the key refused, the service busy, or its status.
 */
async function refusal(res: Response): Promise<string> {
  const said = await reasonOf(res);
  if (said) return `ElevenLabs said: ${said}`;
  if (res.status === 401) return "the speech service refused the ElevenLabs key";
  if (res.status === 429) return "the speech service is busy: try again in a moment";
  return `the speech service answered ${res.status}`;
}

/** ElevenLabs' sentence in an error body: `detail` as a string, as `{ status, message }`, or as a list of `{ msg }`. */
async function reasonOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown; message?: unknown };
    const first = Array.isArray(body.detail) ? body.detail[0] : body.detail;
    const detail = first as { message?: unknown; msg?: unknown } | string | undefined;
    const said = typeof detail === "string" ? detail : detail?.message ?? detail?.msg ?? body.message;
    return typeof said === "string" ? said.trim() : "";
  } catch {
    return ""; // no body worth reading
  }
}

/** The stub's ears (`serve --stub`): no service and no key, a sentence in the page's language, so the page's half can be tried. */
export function stubDictation(): Dictation {
  return {
    model: "stub",
    async transcribe(audio, _type, language) {
      const kb = Math.max(1, Math.round(audio.length / 1024));
      return language === "zh-TW"
        ? { text: `這是替身聽到的話（${kb} KB 的錄音）。`, language: "zho" }
        : { text: `This is what the stub heard (${kb} KB of audio).`, language: "eng" };
    },
  };
}
