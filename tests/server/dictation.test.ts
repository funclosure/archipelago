import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DICTATION_MODEL, createDictation, stubDictation, traditional } from "../../src/server/dictation.ts";
import { TALK_BYTES_MAX, TALK_SECONDS_MAX, TALK_BITS_PER_SECOND, audioExtension, audioType } from "../../src/core/dictation.ts";

const home = () => mkdtempSync(join(tmpdir(), "archipelago-dictation-"));

test("no key, no ears; the voices' key serves, and ARCHIPELAGO_DICTATION_MODEL picks the model or turns it off", () => {
  expect(createDictation({ env: {}, home: home() })).toBeNull();
  const h = home();
  writeFileSync(join(h, "elevenlabs.key"), "sk_file\n");
  expect(createDictation({ env: {}, home: h })?.model).toBe(DICTATION_MODEL);
  expect(createDictation({ env: { ELEVENLABS_API_KEY: "k", ARCHIPELAGO_DICTATION_MODEL: "scribe_v2" }, home: home() })?.model).toBe("scribe_v2");
  expect(createDictation({ env: { ELEVENLABS_API_KEY: "k", ARCHIPELAGO_DICTATION_MODEL: "off" }, home: home() })).toBeNull();
});

test("a recording goes to ElevenLabs once, as a file under the key, and comes back as words", async () => {
  const sent: { url: string; key: string | null; form: FormData }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    sent.push({ url, key: new Headers(init.headers).get("xi-api-key"), form: init.body as FormData });
    return Response.json({ language_code: "zho", language_probability: 0.97, text: " 我覺得 cache 是一種記憶。 ", words: [] });
  }) as unknown as typeof fetch;
  const d = createDictation({ env: { ELEVENLABS_API_KEY: "sk_test" }, home: home(), fetch: fake })!;
  expect(await d.transcribe(new Uint8Array([1, 2, 3, 4]), "audio/webm", "zh-TW")).toEqual({ text: "我覺得 cache 是一種記憶。", language: "zho" });
  expect(sent).toHaveLength(1);
  expect(sent[0].url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
  expect(sent[0].key).toBe("sk_test");
  const form = sent[0].form;
  expect(form.get("model_id")).toBe(DICTATION_MODEL);
  expect(form.get("tag_audio_events")).toBe("false");
  expect(form.get("language_code")).toBeNull(); // the service hears the language itself: an answer may mix two
  const file = form.get("file") as File;
  expect(file.name).toBe("answer.webm");
  expect(file.type).toBe("audio/webm");
  expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([1, 2, 3, 4]);
});

test("Chinese comes back Traditional, character by character: the words stay the reader's, English and Japanese as they were", async () => {
  // What Scribe v3 wrote for the Taiwan voice of macOS `say` on 2026-11-18.
  expect(await traditional("我觉得快取会记住最近的答案，这样就不用再问资料库一次。")).toBe("我覺得快取會記住最近的答案，這樣就不用再問資料庫一次。");
  expect(await traditional("我觉得 cache 的 eviction policy 很重要，尤其是 LRU，因为它会先丢掉最久没用的资料。")).toBe("我覺得 cache 的 eviction policy 很重要，尤其是 LRU，因為它會先丟掉最久沒用的資料。");
  expect(await traditional("这个软件")).toBe("這個軟件"); // the characters change, never the word: 軟件 is what was said
  expect(await traditional("我覺得這樣很好")).toBe("我覺得這樣很好");
  expect(await traditional("I think a cache keeps the most recent answers.")).toBe("I think a cache keeps the most recent answers.");
  expect(await traditional("キャッシュは最近の答えを覚えている。")).toBe("キャッシュは最近の答えを覚えている。");
  expect(await traditional("")).toBe("");
});

test("a transcript in Simplified goes back to the page in Traditional", async () => {
  const d = createDictation({ env: { ELEVENLABS_API_KEY: "k" }, home: home(), fetch: (async () => Response.json({ language_code: "zho", text: "这样就不用再问一次。" })) as unknown as typeof fetch })!;
  expect(await d.transcribe(new Uint8Array([1]), "audio/webm", "en")).toEqual({ text: "這樣就不用再問一次。", language: "zho" });
});

test("a refusal is said in ElevenLabs' own words where it gives any, else the key, the service busy, or its status", async () => {
  const answering = (res: () => Response) => createDictation({ env: { ELEVENLABS_API_KEY: "k" }, home: home(), fetch: (async () => res()) as unknown as typeof fetch })!;
  const refused = (res: () => Response) => answering(res).transcribe(new Uint8Array([1]), "audio/mp4", "en");
  // A key restricted to Text to Speech: the reason names the missing permission, not just "refused".
  const missing = "The API key you used is missing the permission speech_to_text to execute this operation.";
  await expect(refused(() => Response.json({ detail: { status: "missing_permissions", message: missing } }, { status: 401 }))).rejects.toThrow(`ElevenLabs said: ${missing}`);
  await expect(refused(() => Response.json({ detail: { status: "quota_exceeded", message: "This request exceeds your quota." } }, { status: 401 }))).rejects.toThrow("ElevenLabs said: This request exceeds your quota.");
  await expect(refused(() => Response.json({ detail: [{ msg: "Invalid model_id" }] }, { status: 422 }))).rejects.toThrow("ElevenLabs said: Invalid model_id");
  await expect(refused(() => Response.json({ detail: "Bad file" }, { status: 400 }))).rejects.toThrow("ElevenLabs said: Bad file");
  // No words of its own: what the status means.
  await expect(refused(() => new Response("no", { status: 401 }))).rejects.toThrow(/^the speech service refused the ElevenLabs key$/);
  await expect(refused(() => new Response("slow", { status: 429 }))).rejects.toThrow("busy");
  await expect(refused(() => Response.json({ detail: {} }, { status: 500 }))).rejects.toThrow(/^the speech service answered 500$/);
  await expect(refused(() => new Response("", { status: 500 }))).rejects.toThrow(/^the speech service answered 500$/);
});

test("the stub hears in the page's language, without a service", async () => {
  const stub = stubDictation();
  expect(await stub.transcribe(new Uint8Array(2048), "audio/webm", "en")).toEqual({ text: "This is what the stub heard (2 KB of audio).", language: "eng" });
  expect((await stub.transcribe(new Uint8Array(10), "audio/webm", "zh-TW")).text).toBe("這是替身聽到的話（1 KB 的錄音）。");
});

test("recordings are the browser's audio kinds, under a cap two minutes of speech stay well below", () => {
  expect(audioType("audio/webm;codecs=opus")).toBe("audio/webm");
  expect(audioType(" Audio/MP4 ")).toBe("audio/mp4");
  expect(audioType("audio/ogg; codecs=opus")).toBe("audio/ogg");
  expect(audioType("video/webm")).toBeNull();
  expect(audioType("text/html")).toBeNull();
  expect(audioType("")).toBeNull();
  expect(audioExtension("audio/mp4")).toBe("mp4");
  expect(audioExtension("audio/ogg;codecs=opus")).toBe("ogg");
  expect(TALK_BYTES_MAX).toBeGreaterThan((TALK_SECONDS_MAX * TALK_BITS_PER_SECOND) / 8);
  expect(TALK_BYTES_MAX).toBeLessThan(5 * 1024 * 1024);
});
