// Claude on the Messages API: the adapter the shared loop (loop.ts) runs a persona's turn through. The request
// (protocol cached, effort, refusal fallbacks), the stream's events, and the SDK's errors are Claude's; the turn
// itself (tool calls through the ToolBox, the request cap, retries) is the loop's.
import Anthropic from "@anthropic-ai/sdk";
import { ArchipelagoError } from "../../core/errors.ts";
import { createModelRunner, type ModelAdapter, type StepEnd, type ToolBox, type TurnRequest } from "./loop.ts";
import { API_DEFAULT_MODEL, type JudgeRunner } from "./runner.ts";

export type { ToolBox } from "./loop.ts";

type Effort = NonNullable<NonNullable<Anthropic.Beta.Messages.BetaOutputConfig["effort"]>>;
export const DEFAULT_EFFORT: Effort = "high";
const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];
const MAX_TOKENS = 64000;
/** Server-side refusal fallbacks, routed by refusal category. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

type Params = Parameters<Anthropic["beta"]["messages"]["stream"]>[0];
type Message = Anthropic.Beta.Messages.BetaMessage;
type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type StreamEvent = Anthropic.Beta.Messages.BetaRawMessageStreamEvent;

/** What the adapter needs of a stream: its raw events as they arrive, and the whole message at the end. */
export type TurnStream = {
  on(event: "streamEvent", listener: (event: StreamEvent) => void): unknown;
  finalMessage(): Promise<Message>;
};
export type OpenStream = (params: Params, options: { signal?: AbortSignal }) => TurnStream;

export type ApiRunnerOptions = {
  toolbox: ToolBox;
  /** Tests pass a scripted stream; by default a client is made on the first turn from the environment. */
  openStream?: OpenStream;
  model?: string;
  effort?: Effort;
  /** The key, when it does not come from the environment: the hosted build passes the reader's. */
  apiKey?: string;
  /** In the browser (the hosted build): the SDK is told so, and errors point at Your key, not the environment. */
  hosted?: boolean;
};

/** `ARCHIPELAGO_EFFORT` when it names an effort level, else the default. */
export function effortFromEnv(raw = process.env.ARCHIPELAGO_EFFORT): Effort {
  return EFFORTS.includes(raw as Effort) ? (raw as Effort) : DEFAULT_EFFORT;
}

/** The turn's first request in Claude's shape: the protocol cached, the context after it, the thread as one user message. */
export function requestFor(request: TurnRequest, effort: Effort): Params {
  return {
    model: request.model,
    max_tokens: MAX_TOKENS,
    system: [
      { type: "text", text: request.protocol, cache_control: { type: "ephemeral" } },
      { type: "text", text: request.context },
    ],
    // Inputs stream as generated; the tool functions validate them.
    tools: request.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema, eager_input_streaming: true })),
    messages: [{ role: "user", content: request.prompt }],
    cache_control: { type: "ephemeral" },
    output_config: { effort },
    betas: [FALLBACK_BETA],
    fallbacks: "default",
  };
}

/** One actionable sentence for each way the API can fail a turn. Aborts and our own errors pass through. */
export function describeApiError(error: unknown, model: string, hosted = false): unknown {
  if (error instanceof ArchipelagoError || error instanceof Anthropic.APIUserAbortError) return error;
  const say = (message: string) => new ArchipelagoError(message);
  if (isMissingCredentials(error)) return say(hosted ? HOSTED_MISSING_KEY : MISSING_KEY);
  if (error instanceof Anthropic.AuthenticationError) {
    return say(hosted ? "The API key was rejected. Open Your key in the domain menu, paste it again, then send again." : "ANTHROPIC_API_KEY was rejected. Check the key, then send again.");
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return say(hosted ? `This API key cannot use ${model}. Pick another model under Your key in the domain menu.` : `This API key cannot use ${model}. Set ARCHIPELAGO_MODEL to a model it can use.`);
  }
  if (error instanceof Anthropic.NotFoundError) {
    return say(hosted ? `The model ${model} is not available. Pick another model under Your key in the domain menu.` : `The model ${model} is not available. Set ARCHIPELAGO_MODEL (default ${API_DEFAULT_MODEL}).`);
  }
  if (error instanceof Anthropic.RateLimitError) return say("Claude is rate-limited. Wait a moment and send again.");
  if (error instanceof Anthropic.InternalServerError) return say("Claude is overloaded. Wait a moment and send again.");
  if (error instanceof Anthropic.APIConnectionError) return say("Cannot reach the Claude API. Check the connection, then send again.");
  return error;
}

/** The SDK's client, made once and only when a turn needs it, so a server without a key still starts. */
function defaultOpenStream({ apiKey, hosted }: Pick<ApiRunnerOptions, "apiKey" | "hosted">): OpenStream {
  let client: Anthropic | undefined;
  return (params, options) => {
    if (!client) {
      try {
        // In a browser the SDK refuses to run unless told it is meant to (it then sends the header the API's CORS needs).
        client = new Anthropic({ ...(apiKey ? { apiKey } : {}), ...(hosted ? { dangerouslyAllowBrowser: true } : {}) });
      } catch {
        throw new ArchipelagoError(hosted ? HOSTED_MISSING_KEY : MISSING_KEY);
      }
    }
    return client.beta.messages.stream(params, options);
  };
}

// The SDK raises these two as plain AnthropicError with no subclass, so its own wording is the only handle.
/** A streamed tool input the SDK could not parse: re-issue the request. */
const isUnparsedToolInput = (error: unknown) =>
  error instanceof Anthropic.AnthropicError && !(error instanceof Anthropic.APIError) && error.message.startsWith("Unable to parse tool parameter JSON");
/** No key, token, or profile: the client resolves credentials at the first request, not when it is made. */
const isMissingCredentials = (error: unknown) =>
  error instanceof Anthropic.AnthropicError && !(error instanceof Anthropic.APIError) && error.message.startsWith("Could not resolve authentication method");
const MISSING_KEY = "ANTHROPIC_API_KEY is not set. Set it in the server's environment, or run `archipelago serve --judge sdk`.";
const HOSTED_MISSING_KEY = "No API key is set. Open Your key in the domain menu and paste one.";

/** The Messages API as a ModelAdapter: one conversation per turn, its history in Claude's message shape. */
export function claudeAdapter(options: Pick<ApiRunnerOptions, "openStream" | "effort" | "apiKey" | "hosted">): ModelAdapter {
  const open = options.openStream ?? defaultOpenStream(options);
  return {
    describeError: (error, model) => describeApiError(error, model, options.hosted),
    start: (request) => {
      const params = requestFor(request, options.effort ?? effortFromEnv());
      const messages: MessageParam[] = [...params.messages];
      let pendingAssistant: Message["content"] | null = null;
      return {
        async step(sink, signal): Promise<StepEnd> {
          let message: Message;
          try {
            const stream = open({ ...params, messages }, { signal });
            stream.on("streamEvent", (event) => {
              if (event.type === "content_block_start" && event.content_block.type === "text") sink.paragraph();
              else if (event.type === "content_block_delta" && event.delta.type === "text_delta") sink.text(event.delta.text);
            });
            message = await stream.finalMessage();
          } catch (error) {
            if (isUnparsedToolInput(error)) return { kind: "retry" };
            throw error;
          }
          switch (message.stop_reason) {
            case "tool_use": {
              const calls = message.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
              if (calls.length) pendingAssistant = message.content;
              return { kind: "tools", calls: calls.map((c) => ({ id: c.id, name: c.name, input: c.input })) };
            }
            case "pause_turn":
              messages.push({ role: "assistant", content: message.content });
              return { kind: "continue" };
            case "max_tokens":
              return { kind: "cut", midTool: message.content.at(-1)?.type === "tool_use" };
            case "refusal":
              return { kind: "refused" };
            case "end_turn":
            case "stop_sequence":
              return { kind: "done" };
            default:
              return { kind: "other", reason: String(message.stop_reason) };
          }
        },
        addResults(results) {
          if (pendingAssistant) messages.push({ role: "assistant", content: pendingAssistant });
          pendingAssistant = null;
          // Every result of one response goes back together, in one user message.
          messages.push({
            role: "user",
            content: results.map(({ call, result }) => ({
              type: "tool_result" as const, tool_use_id: call.id, content: result.content, ...(result.isError ? { is_error: true } : {}),
            })),
          });
        },
      };
    },
  };
}

export function createApiRunner(options: ApiRunnerOptions): JudgeRunner {
  const adapter = claudeAdapter(options);
  const model = options.model ?? process.env.ARCHIPELAGO_MODEL ?? API_DEFAULT_MODEL;
  return createModelRunner({ toolbox: options.toolbox, adapter, model });
}
