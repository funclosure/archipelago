import { test, expect } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEEPER_VOICE, MENTOR_VOICE, VOICE_MODEL, createVoice } from "../../src/server/voice.ts";

const home = () => mkdtempSync(join(tmpdir(), "archipelago-voice-"));

test("no key, no voice; the key comes from the environment or ~/.archipelago/elevenlabs.key", () => {
  expect(createVoice({ env: {}, home: home() })).toBeNull();
  const h = home();
  writeFileSync(join(h, "elevenlabs.key"), "sk_file\n");
  const v = createVoice({ env: {}, home: h })!;
  expect(v.roles()).toEqual(["mentor", "judge"]);
  expect([v.name("mentor"), v.name("judge")]).toEqual(["Matilda", "George"]);
  expect(createVoice({ env: { ELEVENLABS_API_KEY: "k", ARCHIPELAGO_VOICE_MENTOR: "someone-else" }, home: home() })!.name("mentor")).toBeNull();
  expect(createVoice({ env: { ELEVENLABS_API_KEY: "sk_env" }, home: home() })?.model).toBe(VOICE_MODEL);
});

test("each persona's voice and the model can be changed, and a persona silenced with off", () => {
  const v = createVoice({ env: { ELEVENLABS_API_KEY: "k", ARCHIPELAGO_VOICE_KEEPER: "off", ARCHIPELAGO_VOICE_MODEL: "eleven_v3" }, home: home() })!;
  expect(v.roles()).toEqual(["mentor"]);
  expect(v.model).toBe("eleven_v3");
  expect(createVoice({ env: { ELEVENLABS_API_KEY: "k", ARCHIPELAGO_VOICE_MENTOR: "off" }, home: home() })!.roles()).toEqual(["judge"]);
});

test("a reading streams from ElevenLabs once, with the key in a header, and replays from the cache", async () => {
  const h = home();
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(new Blob(["ID3", "mp3-bytes"]).stream(), { headers: { "Content-Type": "audio/mpeg" } });
  }) as unknown as typeof fetch;
  const v = createVoice({ env: { ELEVENLABS_API_KEY: "sk_test" }, home: h, fetch: fake })!;
  const first = await v.speak("mentor", "轉彎的時候", "zh");
  expect(first.headers.get("content-type")).toBe("audio/mpeg");
  expect(await first.text()).toBe("ID3mp3-bytes");
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${MENTOR_VOICE}/stream?output_format=mp3_44100_128`);
  expect((calls[0].init.headers as Record<string, string>)["xi-api-key"]).toBe("sk_test");
  expect(JSON.parse(String(calls[0].init.body))).toEqual({ text: "轉彎的時候", model_id: VOICE_MODEL, language_code: "zh" });
  for (let i = 0; i < 20 && !(existsSync(join(h, "voice")) && readdirSync(join(h, "voice")).some((f) => f.endsWith(".mp3"))); i++) await Bun.sleep(5);
  expect(await (await v.speak("mentor", "轉彎的時候", "zh")).text()).toBe("ID3mp3-bytes");
  expect(calls).toHaveLength(1); // the replay cost nothing
  await v.speak("judge", "Why?", "en");
  expect(calls[1].url).toContain(`/${KEEPER_VOICE}/stream`); // the Keeper in its own voice
  const quiet = createVoice({ env: { ELEVENLABS_API_KEY: "k", ARCHIPELAGO_VOICE_KEEPER: "off" }, home: h, fetch: fake })!;
  await expect(quiet.speak("judge", "Why?", "en")).rejects.toThrow("no voice for judge");
});

test("a refusal from ElevenLabs is a 502 naming its status, and nothing is kept", async () => {
  const h = home();
  const v = createVoice({ env: { ELEVENLABS_API_KEY: "k" }, home: h, fetch: (async () => new Response("no", { status: 401 })) as unknown as typeof fetch })!;
  const res = await v.speak("mentor", "Hi", "en");
  expect(res.status).toBe(502);
  expect(await res.json()).toEqual({ error: "the voice service answered 401" });
  expect(existsSync(join(h, "voice"))).toBe(false);
});
