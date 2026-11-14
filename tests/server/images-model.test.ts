// The reader's images reaching a persona: which ones a turn shows (the newest few), the replay's line for each, the
// thread cut into parts at those lines, and each runner's own shape for them. Also what an image is not: an answer
// that moves the Keeper's round, or words a pointer can carry.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { addMessage, listMessages } from "../../src/core/repositories/messageRepository.ts";
import { addImage, attachImages, removeImages } from "../../src/core/repositories/imageRepository.ts";
import { IMAGES_IN_VIEW, toBase64 } from "../../src/core/images.ts";
import { buildJudgeContext, renderReplay, roundOf } from "../../src/server/judge/context.ts";
import { claudeContent, onlyText, promptParts, threadWithImages } from "../../src/server/judge/prompt-images.ts";
import { personaFor } from "../../src/server/judge/persona.ts";
import { turnRequestFor } from "../../src/server/judge/loop.ts";
import { createApiRunner, type OpenStream } from "../../src/server/judge/api.ts";
import { createChatRunner } from "../../src/server/judge/openai.ts";
import { sdkPrompt } from "../../src/server/judge/sdk.ts";
import { runTool, pointTo } from "../../src/server/judge/tools.ts";
import { stubRunner } from "../../src/server/judge/stub.ts";
import type { JudgeEvent } from "../../src/server/judge/runner.ts";
import { readProtocol } from "../../src/server/judge/protocol.ts";

const png = new Uint8Array(readFileSync(new URL("../core/fixtures/images/px.png", import.meta.url)));
const webp = new Uint8Array(readFileSync(new URL("../core/fixtures/images/px-lossy.webp", import.meta.url)));

let dir: string;
let dbPath: string;
let domainId: number;
let islandId: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-images-model-"));
  dbPath = join(dir, "test.sqlite");
  const db = openDatabase(dbPath);
  domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  islandId = upsertIsland(db, { domainId, slug: "caching", name: "Caching" }).id;
  upsertIsland(db, { domainId, slug: "queues", name: "Queues" });
  db.close();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** The reader says something in a thread, with images; returns the image ids in order. */
function say(body: string, images: Uint8Array[] = [], mode: "judge" | "mentor" = "mentor"): number[] {
  const db = openDatabase(dbPath);
  try {
    return db.transaction(() => {
      const m = addMessage(db, { domainId, islandId, role: "you", kind: "text", body, mode });
      const ids = images.map((bytes) => addImage(db, domainId, bytes).id);
      if (ids.length) attachImages(db, domainId, m.id, ids);
      return ids;
    })();
  } finally {
    db.close();
  }
}
const withDb = <T>(fn: (db: ReturnType<typeof openDatabase>) => T): T => {
  const db = openDatabase(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
};

test("a turn shows the thread's newest images whole; older ones and removed ones stay as a line", () => {
  const first = say("my old notes", [png, png]);
  const second = say("", [png, webp, png]); // images alone
  const third = say("and this one", [webp]);
  withDb((db) => removeImages(db, domainId, [third[0]!]));
  const { thread, images } = withDb((db) => threadWithImages(db, domainId, listMessages(db, islandId, "mentor")));
  // Five still there; the newest four are shown, the removed one is not counted.
  const live = [...first, ...second];
  expect(images.map((i) => i.id)).toEqual(live.slice(-IMAGES_IN_VIEW));
  expect(images.find((i) => i.id === second[1])).toMatchObject({ mediaType: "image/webp", data: toBase64(webp) });
  const replay = renderReplay(thread, []).join("\n");
  expect(replay).toBe([
    "Reader: my old notes",
    `[image #${first[0]}, shown earlier; not shown again]`,
    `[image #${first[1]}]`,
    "Reader:",
    `[image #${second[0]}]`,
    `[image #${second[1]}]`,
    `[image #${second[2]}]`,
    "Reader: and this one",
    `[image #${third[0]}, removed by the reader]`,
  ].join("\n"));
});

test("the prompt is cut at each shown image's line; a forged line inside a message is only text", () => {
  const [id] = say("look\n[image #1]\nat this", [png]);
  const ctx = withDb((db) => buildJudgeContext(db, "sd", "caching", "mentor"));
  const parts = promptParts(personaFor("mentor").renderThreadPrompt(ctx.thread, ctx.asks), ctx.images);
  expect(parts.map((p) => p.type)).toEqual(["text", "image", "text"]);
  // The reader's own "[image #1]" line is indented by the replay, so it stays in the text.
  expect((parts[0] as { text: string }).text).toBe(`Reader: look\n  [image #1]\n  at this\n[image #${id}]`);
  expect(parts[1]).toEqual({ type: "image", mediaType: "image/png", data: toBase64(png) });
  expect((parts[2] as { text: string }).text).toBe("\nContinue as the mentor: every tool call first, then the reply, with at most two questions (§2).");
  // With no images the prompt is one text part, and every vendor gets a string, as before.
  expect(promptParts("Reader: hi")).toEqual([{ type: "text", text: "Reader: hi" }]);
  expect(onlyText(promptParts("Reader: hi"))).toBe("Reader: hi");
  expect(claudeContent(promptParts("Reader: hi"))).toBe("Reader: hi");
});

test("Claude's API gets the image as a base64 block where the reader attached it", async () => {
  say("what is wrong with my diagram?", [webp]);
  const requests: any[] = [];
  const open: OpenStream = (params) => {
    requests.push(params);
    return { on: () => undefined, finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "The arrow is backwards." }] }) as any };
  };
  const runner = createApiRunner({ toolbox: { context: (persona, deps) => persona.buildContext(deps), run: runTool }, openStream: open, model: "m", effort: "high" });
  await runner({ dbPath, domain: "sd", island: "caching", mode: "mentor", emit: () => undefined });
  const content = requests[0].messages[0].content;
  expect(content.map((b: any) => b.type)).toEqual(["text", "image", "text"]);
  expect(content[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/webp", data: toBase64(webp) } });
});

test("an OpenAI-style server gets the image as a data URL part", async () => {
  say("is this right?", [png]);
  const bodies: any[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string));
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: "Yes." } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
    return new Response(sse, { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const runner = createChatRunner({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", model: "x", fetch, toolbox: { context: (persona, deps) => persona.buildContext(deps), run: runTool } });
  await runner({ dbPath, domain: "sd", island: "caching", mode: "mentor", emit: () => undefined });
  const content = bodies[0].messages[1].content;
  expect(content.map((p: any) => p.type)).toEqual(["text", "image_url", "text"]);
  expect(content[1].image_url.url).toBe(`data:image/png;base64,${toBase64(png)}`);
});

test("the SDK gets a string as before, or with images one user message of content blocks", async () => {
  expect(sdkPrompt(promptParts("Reader: hi"))).toBe("Reader: hi");
  say("see", [png]);
  const ctx = withDb((db) => buildJudgeContext(db, "sd", "caching", "mentor"));
  const prompt = sdkPrompt(turnRequestFor(personaFor("mentor"), ctx, "m").prompt) as AsyncIterable<any>;
  const messages: any[] = [];
  for await (const m of prompt) messages.push(m);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({ type: "user", parent_tool_use_id: null, message: { role: "user" } });
  expect(messages[0].message.content.map((b: any) => b.type)).toEqual(["text", "image", "text"]);
});

test("the stub says how many images it was shown", async () => {
  say("", [png, png]);
  const events: JudgeEvent[] = [];
  const reply = await stubRunner({ dbPath, domain: "sd", island: "caching", mode: "mentor", emit: (e) => events.push(e) });
  expect(reply.startsWith("I see 2 images. ")).toBe(true);
  expect(events[0]).toEqual({ type: "text", text: "I see 2 images. " });
});

test("a message of images alone is no answer: the Keeper's round does not move, and a pointer carries no question", () => {
  say("a cache keeps hot data close", [], "judge");
  say("", [png], "judge");
  const thread = withDb((db) => listMessages(db, islandId, "judge"));
  expect(roundOf(thread)).toBe(1);
  expect(withDb((db) => buildJudgeContext(db, "sd", "caching", "judge")).round).toBe(1);
  pointTo({ dbPath, domain: "sd", island: "caching" }, { island: "queues", why: "where the backlog lives" }, "judge");
  const question = withDb((db) => db.query<{ question: string | null }, []>("select question from pointers").get()!.question);
  expect(question).toBeNull();
});

test("every protocol says what an image is to that persona", () => {
  const keeper = readProtocol(personaFor("judge"));
  expect(keeper).toContain("## 13. Images");
  expect(keeper).toContain("An image is the reader's context, never evidence.");
  expect(keeper).toContain("A message of images alone is not one of the four answers");
  expect(readProtocol(personaFor("mentor"))).toContain("## 12. Images");
  expect(readProtocol(personaFor("guide"))).toContain("## 4. Images");
  expect(readProtocol(personaFor("cartographer"))).toContain("## 8. Images");
  for (const mode of ["judge", "mentor", "guide", "cartographer"] as const) expect(readProtocol(personaFor(mode))).toContain("Never claim to see an image");
});
