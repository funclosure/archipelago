import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { addMessage } from "../../src/core/repositories/messageRepository.ts";
import { setLandmarks } from "../../src/core/repositories/landmarkRepository.ts";
import { chatBodyFor, chatEffort, chatSettingsFromEnv, createChatRunner, isGemini, portableSchema } from "../../src/server/judge/openai.ts";
import { inputSchemaFor } from "../../src/server/judge/tool-specs.ts";
import { createRunner, judgeModel, parseJudgeKind, type JudgeEvent } from "../../src/server/judge/runner.ts";
import { runTool } from "../../src/server/judge/tools.ts";

let dir: string;
let dbPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-openai-"));
  dbPath = join(dir, "test.sqlite");
  const db = openDatabase(dbPath);
  const domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  const caching = upsertIsland(db, { domainId, slug: "caching", name: "Caching" }).id;
  setLandmarks(db, domainId, caching, [
    { slug: "hit-ratio", name: "Hit ratio" }, { slug: "eviction", name: "Eviction" }, { slug: "invalidation", name: "Invalidation" }, { slug: "stampede", name: "Stampede" },
  ]);
  addMessage(db, { domainId, islandId: caching, role: "you", kind: "text", body: "hit ratio is hits over lookups, and it falls when the working set outgrows the cache" });
  db.close();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** One scripted response: the SSE chunks it streams (split anywhere), or an HTTP status and body instead. */
type Step = { chunks?: unknown[]; split?: number; status?: number; body?: string; throws?: unknown };

const sse = (chunks: unknown[]) => chunks.map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}\r\n\r\n`).join("") + "data: [DONE]\n\n";
const text = (content: string) => ({ choices: [{ delta: { content } }] });
const finish = (reason: string) => ({ choices: [{ delta: {}, finish_reason: reason }] });
const callPart = (index: number, part: Record<string, unknown>) => ({ choices: [{ delta: { tool_calls: [{ index, ...part }] } }] });

function scripted(steps: Step[]) {
  const bodies: any[] = [];
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    urls.push(url);
    headers.push(init.headers as Record<string, string>);
    bodies.push(JSON.parse(init.body as string));
    const step = steps[bodies.length - 1];
    if (!step) throw new Error(`no scripted step ${bodies.length}`);
    if (step.throws) throw step.throws;
    if (step.status) return new Response(step.body ?? "", { status: step.status });
    const payload = new TextEncoder().encode(sse(step.chunks ?? []));
    const size = step.split ?? 7; // deliver in small pieces so events straddle reads
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < payload.length; i += size) controller.enqueue(payload.slice(i, i + size));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: fakeFetch, bodies, urls, headers };
}

async function run(steps: Step[], opts: { mode?: "judge" | "mentor" } = {}) {
  const script = scripted(steps);
  const runner = createChatRunner({
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", apiKey: "k-123", model: "gemini-flash", fetch: script.fetch,
    toolbox: { context: (persona, deps) => persona.buildContext(deps), run: runTool },
  });
  const events: JudgeEvent[] = [];
  const reply = runner({ dbPath, domain: "sd", island: "caching", mode: opts.mode, emit: (e) => events.push(e) });
  return { reply, events, ...script };
}

test("a text-only turn streams its deltas, and the request carries the protocol, context, thread, and the persona's tools", async () => {
  const { reply, events, bodies, urls, headers } = await run([{ chunks: [text("Good. "), text("Now: why?"), finish("stop")] }]);
  expect(await reply).toBe("Good. Now: why?");
  expect(events).toEqual([{ type: "text", text: "Good. " }, { type: "text", text: "Now: why?" }]);
  expect(urls[0]).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  expect(headers[0]!.Authorization).toBe("Bearer k-123");
  const body = bodies[0];
  expect(body).toMatchObject({ model: "gemini-flash", stream: true });
  expect(body.messages.map((m: any) => m.role)).toEqual(["system", "user"]);
  expect(body.messages[0].content).toContain("Caching"); // the context rides after the protocol
  expect(body.messages[1].content).toContain("hit ratio is hits over lookups");
  const names = body.tools.map((t: any) => t.function.name);
  expect(names).toContain("unlock_landmark");
  expect(names).not.toContain("mark_explored");
  expect(JSON.stringify(body.tools)).not.toContain("additionalProperties");
});

test("a tool call streamed in pieces runs through the toolbox, and its result goes back with the call as sent", async () => {
  const { reply, events, bodies } = await run([
    {
      chunks: [
        callPart(0, { id: "c1", type: "function", function: { name: "unlock_landmark", arguments: '{"slug":"hit' }, extra_content: { google: { thought_signature: "sig" } } }),
        callPart(0, { function: { arguments: '-ratio","evidence":"hits over lookups"}' } }),
        finish("tool_calls"),
      ],
    },
    { chunks: [text("Lit. Next: eviction."), finish("stop")] },
  ]);
  expect(await reply).toBe("Lit. Next: eviction.");
  expect(events[0]).toEqual({ type: "progress", message: "unlock_landmark" });
  const second = bodies[1].messages;
  expect(second.at(-2)).toEqual({
    role: "assistant", content: null,
    tool_calls: [{ id: "c1", type: "function", function: { name: "unlock_landmark", arguments: '{"slug":"hit-ratio","evidence":"hits over lookups"}' }, extra_content: { google: { thought_signature: "sig" } } }],
  });
  expect(second.at(-1).role).toBe("tool");
  expect(second.at(-1).tool_call_id).toBe("c1");
  expect(JSON.parse(second.at(-1).content)).toMatchObject({ slug: "hit-ratio", unlocked: 1 });
});

test("reasoning details (OpenRouter's, Gemini's signatures inside) are merged by index and go back on the assistant message", async () => {
  const detail = (d: Record<string, unknown>) => ({ choices: [{ delta: { reasoning_details: [d] } }] });
  const { reply, bodies } = await run([
    {
      chunks: [
        detail({ type: "reasoning.text", index: 0, text: "Think" }),
        detail({ type: "reasoning.text", index: 0, text: "ing.", signature: null }),
        detail({ type: "reasoning.encrypted", index: 1, data: "sig" }),
        callPart(0, { id: "r1", function: { name: "island_context", arguments: "{}" } }),
        finish("tool_calls"),
      ],
    },
    { chunks: [text("Done."), finish("stop")] },
  ]);
  expect(await reply).toBe("Done.");
  expect(bodies[1].messages.at(-2).reasoning_details).toEqual([
    { type: "reasoning.text", index: 0, text: "Thinking.", signature: null },
    { type: "reasoning.encrypted", index: 1, data: "sig" },
  ]);
  expect(bodies[0].messages.some((m: any) => "reasoning_details" in m)).toBe(false);
});

test("text between tool calls becomes separate paragraphs, and a call without an id gets one", async () => {
  const { reply, bodies } = await run([
    { chunks: [text("First."), callPart(0, { function: { name: "island_context", arguments: "" } }), finish("tool_calls")] },
    { chunks: [text("Second."), finish("stop")] },
  ]);
  expect(await reply).toBe("First.\n\nSecond.");
  expect(bodies[1].messages.at(-2)).toMatchObject({ role: "assistant", content: "First.", tool_calls: [{ id: "call_1" }] });
  expect(bodies[1].messages.at(-1).tool_call_id).toBe("call_1");
});

test("tool calls that end with finish_reason stop still run (Gemini sends it that way)", async () => {
  const { reply, bodies } = await run([
    { chunks: [callPart(0, { id: "g1", function: { name: "island_context", arguments: "{}" } }), finish("stop")] },
    { chunks: [text("Done."), finish("stop")] },
  ]);
  expect(await reply).toBe("Done.");
  expect(bodies).toHaveLength(2);
});

test("unparseable tool arguments re-issue the request, and its partial text is dropped", async () => {
  const { reply, bodies } = await run([
    { chunks: [text("partial"), callPart(0, { id: "x", function: { name: "island_context", arguments: "{not json" } }), finish("tool_calls")] },
    { chunks: [text("Whole."), finish("stop")] },
  ]);
  expect(await reply).toBe("Whole.");
  expect(bodies).toHaveLength(2);
  expect(bodies[1].messages).toHaveLength(2); // the bad response was not added to the history
});

test("cut off mid tool call, or filtered, the turn ends with one sentence", async () => {
  const cut = await run([{ chunks: [callPart(0, { id: "c", function: { name: "island_context", arguments: "{" } }), finish("length")] }]);
  await expect(cut.reply).rejects.toThrow("cut off");
  const filtered = await run([{ chunks: [text("I"), finish("content_filter")] }]);
  await expect(filtered.reply).rejects.toThrow("declined");
});

test("HTTP failures become one actionable sentence naming the server", async () => {
  await expect((await run([{ status: 401, body: "bad key" }])).reply).rejects.toThrow("generativelanguage.googleapis.com rejected the API key");
  await expect((await run([{ status: 404, body: "no such model" }])).reply).rejects.toThrow("does not serve the model gemini-flash");
  await expect((await run([{ status: 429 }])).reply).rejects.toThrow("rate-limiting");
  await expect((await run([{ status: 503 }])).reply).rejects.toThrow("overloaded");
  await expect((await run([{ throws: new TypeError("fetch failed") }])).reply).rejects.toThrow("Cannot reach generativelanguage.googleapis.com");
  await expect((await run([{ chunks: [{ error: { message: "quota" } }] }])).reply).rejects.toThrow("quota");
});

test("portableSchema drops what Gemini's endpoint refuses and keeps the meaning", () => {
  const board = portableSchema(inputSchemaFor("board_write")) as any;
  expect(board.additionalProperties).toBeUndefined();
  expect(board.properties.lang).toEqual({ type: "string", nullable: true });
  expect(board.properties.id).toEqual({ type: "integer" });
  expect(board.properties.op).toEqual({ type: "string", enum: ["add", "update", "remove"] });
  expect(board.required).toEqual(["op"]);
});

test("the openai judge reads its settings from the environment", () => {
  expect(chatSettingsFromEnv({ ARCHIPELAGO_BASE_URL: "gemini", ARCHIPELAGO_MODEL: "gemini-flash", GEMINI_API_KEY: "g" })).toEqual({
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-flash", apiKey: "g",
  });
  expect(chatSettingsFromEnv({ ARCHIPELAGO_BASE_URL: "http://localhost:1234/v1", ARCHIPELAGO_MODEL: "local", ARCHIPELAGO_API_KEY: "a" })).toEqual({
    baseUrl: "http://localhost:1234/v1", model: "local", apiKey: "a",
  });
  expect(chatSettingsFromEnv({ ARCHIPELAGO_BASE_URL: "ollama", ARCHIPELAGO_MODEL: "qwen" })).toEqual({ baseUrl: "http://localhost:11434/v1", model: "qwen" });
  expect(() => chatSettingsFromEnv({ ARCHIPELAGO_MODEL: "m" })).toThrow("ARCHIPELAGO_BASE_URL is not set");
  expect(() => chatSettingsFromEnv({ ARCHIPELAGO_BASE_URL: "gemini" })).toThrow("ARCHIPELAGO_MODEL is not set");
  expect(parseJudgeKind("openai", "--judge")).toBe("openai");
  expect(judgeModel("openai", { ARCHIPELAGO_MODEL: "gemini-flash" })).toBe("gemini-flash");
  expect(judgeModel("openai", {})).toBeNull();
  expect(typeof createRunner("openai")).toBe("function"); // settings are read on the first turn, not here
});

test("on Gemini, thought summaries keep the stream alive and never reach the reply", async () => {
  const thought = (content: string) => ({ choices: [{ delta: { content, extra_content: { google: { thought: true } } } }] });
  const { reply, events, bodies } = await run([{ chunks: [thought("<thought>**Weighing it**"), thought("still thinking"), text("</thought>Good. "), text("Why?"), finish("stop")] }]);
  expect(await reply).toBe("Good. Why?");
  expect(events).toEqual([{ type: "text", text: "Good. " }, { type: "text", text: "Why?" }]);
  expect(bodies[0].extra_body).toEqual({ google: { thinking_config: { include_thoughts: true } } });
  expect(bodies[0].reasoning_effort).toBeUndefined();
});

test("the effort becomes Gemini's thinking level, or reasoning_effort elsewhere", () => {
  const request = { model: "m", protocol: "p", context: "c", prompt: "t", tools: [] };
  expect(chatBodyFor(request, [], { gemini: true, effort: "low" }).extra_body).toEqual({ google: { thinking_config: { include_thoughts: true, thinking_level: "low" } } });
  expect(chatBodyFor(request, [], { effort: "low" })).toMatchObject({ reasoning_effort: "low" });
  expect("reasoning_effort" in chatBodyFor(request, [])).toBe(false);
  expect(isGemini("https://generativelanguage.googleapis.com/v1beta/openai")).toBe(true);
  expect(isGemini("https://openrouter.ai/api/v1")).toBe(false);
  expect([chatEffort("max"), chatEffort("medium"), chatEffort("bogus"), chatEffort(undefined)]).toEqual(["high", "medium", undefined, undefined]);
  expect(chatSettingsFromEnv({ ARCHIPELAGO_BASE_URL: "gemini", ARCHIPELAGO_MODEL: "g", ARCHIPELAGO_EFFORT: "low" }).effort).toBe("low");
});
