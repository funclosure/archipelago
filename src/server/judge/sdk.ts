import { z } from "zod";
import { ArchipelagoError } from "../../core/errors.ts";
import { readProtocol } from "./protocol.ts";
import { renderContext, renderThreadPrompt } from "./context.ts";
import { islandContext, proposeReef, recordVerdict } from "./tools.ts";
import type { JudgeRunner } from "./runner.ts";

export const DEFAULT_MODEL = "claude-opus-5";
const SERVER = "archipelago";
const TOOL_NAMES = ["island_context", "record_verdict", "propose_reef"];
const MAX_TURNS = 8;

async function loadSdk() {
  try {
    return await import("@anthropic-ai/claude-agent-sdk");
  } catch {
    throw new ArchipelagoError("the Claude Agent SDK is not installed: run `bun install` in the archipelago folder");
  }
}

/** One actionable sentence for each way a judge turn can end early. */
export function describeSdkError(code: string): string {
  switch (code) {
    case "authentication_failed":
    case "oauth_org_not_allowed":
      return "Claude Code is not logged in. Run `claude login` in a terminal, then send again.";
    case "billing_error":
    case "account_on_hold":
      return "The Claude account behind this login cannot run the judge right now (billing).";
    case "rate_limit":
    case "overloaded":
      return "Claude is rate-limited or overloaded. Wait a moment and send again.";
    case "model_not_found":
      return `The judge model is not available. Set ARCHIPELAGO_MODEL to a model you can use (default ${DEFAULT_MODEL}).`;
    default:
      return `The judge stopped: ${code}.`;
  }
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

/** Tool failures go back to the model as JSON `{ error }` so it can correct itself, never as a thrown exception. */
function failed(error: unknown): ToolResult {
  let payload: unknown;
  if (error instanceof ArchipelagoError) payload = error.toJSON();
  else if (error instanceof z.ZodError) payload = { error: error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
  else payload = { error: error instanceof Error ? error.message : String(error) };
  return { content: [{ type: "text", text: JSON.stringify(payload) }], isError: true };
}

function guard(fn: () => unknown): ToolResult {
  try {
    return ok(fn());
  } catch (error) {
    return failed(error);
  }
}

/** One stateless judge turn on the Agent SDK, through the user's Claude Code login. */
export const sdkRunner: JudgeRunner = async ({ dbPath, domain, island, emit, signal }) => {
  const sdk = await loadSdk();
  const deps = { dbPath, domain, island };
  const context = islandContext(deps);
  const systemPrompt = `${readProtocol()}\n\n${renderContext(context)}`;
  const prompt = renderThreadPrompt(context.thread);

  const server = sdk.createSdkMcpServer({
    name: SERVER,
    version: "0.1.0",
    tools: [
      sdk.tool(
        "island_context",
        "This island: verdict and history, islets, straits to neighbours, nearest open water, pending reef proposals, and the thread so far. Read fresh.",
        {},
        async () => guard(() => islandContext(deps)),
      ),
      sdk.tool(
        "record_verdict",
        "Write a sandbar, settled, or mountainous verdict on island:<slug> or strait:<a>~<b>. Evidence is a verbatim quote from the reader. Reefs are not accepted here; use propose_reef.",
        {
          target: z.string(),
          state: z.enum(["sandbar", "settled", "mountainous"]),
          confidence: z.number().min(0).max(1),
          evidence: z.string(),
          rationale: z.string(),
        },
        async (args) => guard(() => recordVerdict(deps, args)),
      ),
      sdk.tool(
        "propose_reef",
        "Show the reader a reef: the specific false claim and the concrete consequence. The reef is written only if they confirm it.",
        {
          target: z.string(),
          claim: z.string(),
          consequence: z.string(),
          evidence: z.string(),
          confidence: z.number().min(0).max(1),
          rationale: z.string(),
        },
        async (args) => guard(() => proposeReef(deps, args)),
      ),
    ],
  });

  // The caller cancels a hung turn through `signal`; the SDK stops on its own AbortController.
  const abortController = new AbortController();
  if (signal) {
    if (signal.aborted) abortController.abort();
    else signal.addEventListener("abort", () => abortController.abort(), { once: true });
  }

  const conversation = sdk.query({
    prompt,
    options: {
      abortController,
      systemPrompt,
      model: process.env.ARCHIPELAGO_MODEL ?? DEFAULT_MODEL,
      includePartialMessages: true,
      mcpServers: { [SERVER]: server },
      tools: [],
      allowedTools: TOOL_NAMES.map((t) => `mcp__${SERVER}__${t}`),
      disallowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Agent", "WebFetch", "WebSearch", "NotebookEdit", "TodoWrite"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      maxTurns: MAX_TURNS,
      cwd: process.cwd(),
    },
  });

  let reply = "";
  try {
    for await (const message of conversation) {
      if (message.type === "stream_event") {
        if (message.parent_tool_use_id) continue;
        const ev = message.event;
        // A new text block after earlier text means a tool call ran in between: keep them separate paragraphs.
        if (ev.type === "content_block_start" && ev.content_block.type === "text" && reply) {
          reply += "\n\n";
          emit({ type: "text", text: "\n\n" });
          continue;
        }
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta" && ev.delta.text) {
          reply += ev.delta.text;
          emit({ type: "text", text: ev.delta.text });
        }
        continue;
      }
      if (message.type === "assistant") {
        if (message.error) throw new ArchipelagoError(describeSdkError(message.error));
        for (const block of message.message.content) {
          if (block.type === "tool_use") emit({ type: "progress", message: block.name.replace(`mcp__${SERVER}__`, "") });
        }
        continue;
      }
      if (message.type === "result") {
        if (message.subtype !== "success") {
          throw new ArchipelagoError(message.errors.length ? message.errors.join("; ") : describeSdkError(message.subtype));
        }
        if (message.is_error) throw new ArchipelagoError(message.result);
        if (!reply) reply = message.result; // no deltas arrived (older transport); the result carries the text
      }
    }
  } finally {
    conversation.close();
  }
  return reply;
};
