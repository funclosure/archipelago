import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import { ArchipelagoError } from "../../core/errors.ts";
import { readProtocol } from "./protocol.ts";
import { runTool, type TurnDeps } from "./tools.ts";
import { personaFor, type Persona, type ToolName } from "./persona.ts";
import { TOOL_SHAPES, toolDescriptionsFor } from "./tool-specs.ts";
import { SDK_DEFAULT_MODEL, type JudgeRunner } from "./runner.ts";

export const DEFAULT_MODEL = SDK_DEFAULT_MODEL;
const SERVER = "archipelago";
const MAX_TURNS = 16;

async function loadSdk() {
  try {
    return await import("@anthropic-ai/claude-agent-sdk");
  } catch {
    throw new ArchipelagoError("the Claude Agent SDK is not installed: run `bun install` in the archipelago folder");
  }
}

type Sdk = Awaited<ReturnType<typeof loadSdk>>;

/** One actionable sentence for each way a judge turn can end early. */
export function describeSdkError(code: string): string {
  switch (code) {
    case "authentication_failed":
    case "oauth_org_not_allowed":
      return "Claude Code is not logged in. Run `claude login` in a terminal (or start the server with ANTHROPIC_API_KEY set), then send again.";
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

/** The tool names the SDK may call for a persona: its own, and nothing else (`tools: []` closes the built-ins). */
export function allowedToolsFor(persona: Persona): string[] {
  return persona.toolNames.map((t) => `mcp__${SERVER}__${t}`);
}

/** The persona's tools as MCP tools, from the specs both runners share. */
function toolsFor(sdk: Sdk, deps: TurnDeps, persona: Persona): SdkMcpToolDefinition<any>[] {
  const describe = toolDescriptionsFor(persona) as Record<ToolName, string>;
  return persona.toolNames.map((name) => sdk.tool(name, describe[name], TOOL_SHAPES[name], async (args) => runTool(persona, deps, name, args)));
}

/** One stateless turn on the Agent SDK, through ANTHROPIC_API_KEY when it is set and the user's Claude Code login otherwise, as the turn's persona. */
export const sdkRunner: JudgeRunner = async ({ dbPath, domain, island, mode = "judge", emit, signal }) => {
  const sdk = await loadSdk();
  const persona = personaFor(mode);
  const deps: TurnDeps = { dbPath, domain, island, mode };
  const context = persona.buildContext(deps);
  const systemPrompt = `${readProtocol(persona)}\n\n${persona.renderContext(context)}`;
  const prompt = persona.renderThreadPrompt(context.thread, context.asks);

  const server = sdk.createSdkMcpServer({ name: SERVER, version: "0.1.0", tools: toolsFor(sdk, deps, persona) });

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
      allowedTools: allowedToolsFor(persona),
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
