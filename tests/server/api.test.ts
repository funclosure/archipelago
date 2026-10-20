import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { addMessage } from "../../src/core/repositories/messageRepository.ts";
import { listLandmarks, setLandmarks } from "../../src/core/repositories/landmarkRepository.ts";
import { createApiRunner, describeApiError, effortFromEnv, type OpenStream, type TurnStream } from "../../src/server/judge/api.ts";
import { createRunner, defaultJudge, judgeModel, type JudgeEvent } from "../../src/server/judge/runner.ts";
import { islandContext, runTool } from "../../src/server/judge/tools.ts";
import { ArchipelagoError } from "../../src/core/errors.ts";

type Message = Anthropic.Beta.Messages.BetaMessage;
type StreamEvent = Anthropic.Beta.Messages.BetaRawMessageStreamEvent;
type Params = Parameters<OpenStream>[0];

let dir: string;
let dbPath: string;
let domainId: number;
let caching: number;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-api-"));
  dbPath = join(dir, "test.sqlite");
  const db = openDatabase(dbPath);
  domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  caching = upsertIsland(db, { domainId, slug: "caching", name: "Caching" }).id;
  setLandmarks(db, domainId, caching, [
    { slug: "hit-ratio", name: "Hit ratio" }, { slug: "eviction", name: "Eviction" }, { slug: "invalidation", name: "Invalidation" }, { slug: "stampede", name: "Stampede" },
  ]);
  addMessage(db, { domainId, islandId: caching, role: "you", kind: "text", body: "hit ratio is hits over lookups, and it falls when the working set outgrows the cache" });
  db.close();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** One scripted response: the events it streams, then its final message, or an error instead. */
type Step = { events?: StreamEvent[]; message?: Partial<Message>; error?: unknown };

function textEvents(...texts: string[]): StreamEvent[] {
  return texts.flatMap((text, index) => [
    { type: "content_block_start", index, content_block: { type: "text", text: "", citations: null } },
    { type: "content_block_delta", index, delta: { type: "text_delta", text } },
  ]) as StreamEvent[];
}

const message = (stop_reason: string, content: unknown[]): Partial<Message> => ({ stop_reason, content } as unknown as Partial<Message>);
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });

/** A stream factory that plays the steps in order and records every request it was asked to make. */
function scripted(steps: Step[]) {
  const requests: Params[] = [];
  const open: OpenStream = (params) => {
    requests.push(structuredClone(params));
    const step = steps[requests.length - 1];
    if (!step) throw new Error(`no scripted step ${requests.length}`);
    let listener: ((event: StreamEvent) => void) | undefined;
    const stream: TurnStream = {
      on: (_event, l) => (listener = l),
      finalMessage: async () => {
        for (const event of step.events ?? []) listener?.(event);
        if (step.error) throw step.error;
        return step.message as Message;
      },
    };
    return stream;
  };
  return { open, requests };
}

async function run(steps: Step[], opts: { mode?: "judge" | "mentor"; signal?: AbortSignal } = {}) {
  const script = scripted(steps);
  const runner = createApiRunner({ toolbox: { context: islandContext, run: runTool }, openStream: script.open, model: "claude-opus-5-5", effort: "high" });
  const events: JudgeEvent[] = [];
  const reply = runner({ dbPath, domain: "sd", island: "caching", mode: opts.mode, emit: (e) => events.push(e), signal: opts.signal });
  return { reply, events, requests: script.requests };
}

test("a text-only turn streams its deltas and resolves with the reply", async () => {
  const { reply, events } = await run([{ events: textEvents("Good. "), message: message("end_turn", [{ type: "text", text: "Good. " }]) }]);
  expect(await reply).toBe("Good. ");
  expect(events).toEqual([{ type: "text", text: "Good. " }]);
});

test("the first request carries the cached protocol, the context, the persona's tools, effort, and fallbacks", async () => {
  const { reply, requests } = await run([{ message: message("end_turn", []) }]);
  await reply;
  const [first] = requests;
  const system = first!.system as { text: string; cache_control?: unknown }[];
  expect(system[0]!.text).toContain("## Tools");
  expect(system[0]!.cache_control).toEqual({ type: "ephemeral" });
  expect(system[1]!.text).toContain("Caching");
  expect(system[1]!.cache_control).toBeUndefined();
  expect((first!.tools as { name: string }[]).map((t) => t.name)).toEqual(["island_context", "record_verdict", "propose_reef", "set_landmarks", "unlock_landmark", "ask_reader", "board_write"]);
  expect((first!.tools as { eager_input_streaming?: boolean }[]).every((t) => t.eager_input_streaming === true)).toBe(true);
  expect((first!.tools as { input_schema: Record<string, unknown> }[])[4]!.input_schema).toMatchObject({ type: "object", required: ["slug", "evidence"] });
  expect((first!.tools as { input_schema: Record<string, unknown> }[])[4]!.input_schema.$schema).toBeUndefined();
  expect(first!.model).toBe("claude-opus-5-5");
  expect(first!.output_config).toEqual({ effort: "high" });
  expect(first!.betas).toEqual(["server-side-fallback-2026-07-01"]);
  expect(first!.fallbacks).toBe("default");
  expect(first!.cache_control).toEqual({ type: "ephemeral" });
  expect(first!.messages).toHaveLength(1);
});

test("the mentor gets its own five tools and MENTOR.md", async () => {
  const { reply, requests } = await run([{ message: message("end_turn", []) }], { mode: "mentor" });
  await reply;
  expect((requests[0]!.tools as { name: string }[]).map((t) => t.name)).toEqual(["island_context", "set_landmarks", "mark_explored", "ask_reader", "board_write"]);
  expect((requests[0]!.system as { text: string }[])[0]!.text).toContain("There are no verdict tools here");
});

test("a tool call runs against the database, reports progress, and its result goes back in the next request", async () => {
  const call = toolUse("t1", "unlock_landmark", { slug: "hit-ratio", evidence: "hits over lookups" });
  const { reply, events, requests } = await run([
    { message: message("tool_use", [call]) },
    { events: textEvents("Lit. Next: what evicts first?"), message: message("end_turn", [{ type: "text", text: "Lit. Next: what evicts first?" }]) },
  ]);
  expect(await reply).toBe("Lit. Next: what evicts first?");
  expect(events[0]).toEqual({ type: "progress", message: "unlock_landmark" });
  const db = openDatabase(dbPath);
  expect(listLandmarks(db, caching).find((l) => l.slug === "hit-ratio")!.unlockedAt).not.toBeNull();
  db.close();
  const second = requests[1]!.messages;
  expect(second).toHaveLength(3);
  expect(second[1]).toEqual({ role: "assistant", content: [call] } as never);
  const result = (second[2]!.content as { type: string; tool_use_id: string; content: { text: string }[]; is_error?: boolean }[])[0]!;
  expect(result.tool_use_id).toBe("t1");
  expect(result.is_error).toBeUndefined();
  expect(JSON.parse(result.content[0]!.text)).toMatchObject({ slug: "hit-ratio", unlocked: 1, total: 4 });
});

test("parallel tool calls are answered together in one user message", async () => {
  const { reply, requests } = await run([
    { message: message("tool_use", [toolUse("a", "island_context", {}), toolUse("b", "unlock_landmark", { slug: "eviction", evidence: "outgrows the cache" })]) },
    { message: message("end_turn", []) },
  ]);
  await reply;
  const results = requests[1]!.messages[2]!.content as { tool_use_id: string }[];
  expect(results.map((r) => r.tool_use_id)).toEqual(["a", "b"]);
});

test("a failing tool returns its error as is_error and the turn goes on", async () => {
  const { reply, requests } = await run([
    { message: message("tool_use", [toolUse("t1", "unlock_landmark", { slug: "nope", evidence: "hits over lookups" })]) },
    { message: message("end_turn", []) },
  ]);
  await reply;
  const result = (requests[1]!.messages[2]!.content as { is_error?: boolean; content: { text: string }[] }[])[0]!;
  expect(result.is_error).toBe(true);
  expect(JSON.parse(result.content[0]!.text).error).toBeTruthy();
});

test("a tool outside the persona's list is refused, never run", async () => {
  const { reply, requests } = await run(
    [
      { message: message("tool_use", [toolUse("t1", "record_verdict", { target: "island:caching", state: "settled", confidence: 0.9, evidence: "hits over lookups", rationale: "x" })]) },
      { message: message("end_turn", []) },
    ],
    { mode: "mentor" },
  );
  await reply;
  const result = (requests[1]!.messages[2]!.content as { is_error?: boolean; content: { text: string }[] }[])[0]!;
  expect(result.is_error).toBe(true);
  expect(result.content[0]!.text).toContain("no tool named record_verdict for the mentor");
});

test("text before and after a tool call is joined with one blank line", async () => {
  const { reply } = await run([
    { events: textEvents("Right."), message: message("tool_use", [{ type: "text", text: "Right." }, toolUse("t1", "island_context", {})]) },
    { events: textEvents("Next question?"), message: message("end_turn", [{ type: "text", text: "Next question?" }]) },
  ]);
  expect(await reply).toBe("Right.\n\nNext question?");
});

test("the turn stops after sixteen requests", async () => {
  const loop = Array.from({ length: 16 }, (_, i) => ({ message: message("tool_use", [toolUse(`t${i}`, "island_context", {})]) }));
  const { reply, requests } = await run(loop);
  await expect(reply).rejects.toThrow("the judge took too many steps on one turn");
  expect(requests).toHaveLength(16);
});

test("a refusal ends the turn with a plain sentence", async () => {
  const { reply } = await run([{ message: message("refusal", []) }]);
  await expect(reply).rejects.toThrow("The judge declined this turn. Rephrase and send again.");
});

test("max_tokens on a tool call never runs the tool", async () => {
  const { reply } = await run([{ message: message("max_tokens", [toolUse("t1", "unlock_landmark", { slug: "hit-ratio" })]) }]);
  await expect(reply).rejects.toThrow("cut off");
  const db = openDatabase(dbPath);
  expect(listLandmarks(db, caching).every((l) => l.unlockedAt === null)).toBe(true);
  db.close();
});

test("an aborted signal starts no request", async () => {
  const abort = new AbortController();
  abort.abort();
  const { reply, requests } = await run([{ message: message("end_turn", []) }], { signal: abort.signal });
  await expect(reply).rejects.toThrow("cancelled");
  expect(requests).toHaveLength(0);
});

test("an unparseable streamed tool input re-issues the request, and its partial text is dropped", async () => {
  const { reply, requests } = await run([
    { events: textEvents("partial"), error: new Anthropic.AnthropicError("Unable to parse tool parameter JSON from model.") },
    { events: textEvents("Whole."), message: message("end_turn", [{ type: "text", text: "Whole." }]) },
  ]);
  expect(await reply).toBe("Whole.");
  expect(requests).toHaveLength(2);
});

test("missing credentials end the turn at once with the key sentence, never retried as a parse failure", async () => {
  const { reply, requests } = await run([
    { error: new Anthropic.AnthropicError("Could not resolve authentication method. Expected one of apiKey, authToken, credentials, config, or profile to be set.") },
  ]);
  await expect(reply).rejects.toThrow("ANTHROPIC_API_KEY is not set");
  expect(requests).toHaveLength(1);
});

test("any other SDK error is not retried", async () => {
  const { reply, requests } = await run([{ error: new Anthropic.AnthropicError("something else") }]);
  await expect(reply).rejects.toThrow("something else");
  expect(requests).toHaveLength(1);
});

test("API errors become one actionable sentence; aborts and our own errors pass through", () => {
  const headers = new Headers();
  const status = (Klass: new (...args: any[]) => Error, code: number) => new Klass(code, { type: "error", error: {} }, "x", headers);
  const said = (error: unknown) => (describeApiError(error, "claude-opus-5-5") as Error).message;
  expect(said(status(Anthropic.AuthenticationError, 401))).toContain("ANTHROPIC_API_KEY was rejected");
  expect(said(status(Anthropic.PermissionDeniedError, 403))).toContain("cannot use claude-opus-5-5");
  expect(said(status(Anthropic.NotFoundError, 404))).toContain("ARCHIPELAGO_MODEL");
  expect(said(status(Anthropic.RateLimitError, 429))).toContain("rate-limited");
  expect(said(status(Anthropic.InternalServerError, 529))).toContain("overloaded");
  expect(said(new Anthropic.APIConnectionError({ message: "down" }))).toContain("Cannot reach the Claude API");
  const abort = new Anthropic.APIUserAbortError();
  expect(describeApiError(abort, "m")).toBe(abort);
  const ours = new ArchipelagoError("ours");
  expect(describeApiError(ours, "m")).toBe(ours);
});

test("effort comes from ARCHIPELAGO_EFFORT only when it names a level", () => {
  expect(effortFromEnv("medium")).toBe("medium");
  expect(effortFromEnv("loud")).toBe("high");
  expect(effortFromEnv(undefined)).toBe("high");
});

test("the default judge: ARCHIPELAGO_JUDGE, then the stub flag, then the API with a key, else the SDK", () => {
  expect(defaultJudge({ ARCHIPELAGO_JUDGE: "sdk", ANTHROPIC_API_KEY: "k" })).toBe("sdk");
  expect(defaultJudge({ ARCHIPELAGO_STUB: "1", ANTHROPIC_API_KEY: "k" })).toBe("stub");
  expect(defaultJudge({ ANTHROPIC_API_KEY: "k" })).toBe("api");
  expect(defaultJudge({})).toBe("sdk");
  expect(() => defaultJudge({ ARCHIPELAGO_JUDGE: "gpt" })).toThrow("must be one of api, sdk, stub");
  expect(judgeModel("api", {})).toBe("claude-opus-5-5");
  expect(judgeModel("sdk", {})).toBe("claude-opus-5");
  expect(judgeModel("api", { ARCHIPELAGO_MODEL: "claude-sonnet-5-5" })).toBe("claude-sonnet-5-5");
  expect(judgeModel("stub", {})).toBeNull();
});

test("createRunner('api') is constructible without a key; nothing runs until a turn", () => {
  expect(typeof createRunner("api")).toBe("function");
});
