// The judge and the mentor on the Messages API: one streaming tool-use loop per turn, the persona's tools
// and nothing else. The database is reached only through the injected ToolBox, so the loop itself can run
// wherever the SDK runs.
import Anthropic from "@anthropic-ai/sdk";
import { ArchipelagoError } from "../../core/errors.ts";
import { personaFor, type Persona, type PersonaContext } from "./persona.ts";
import { readProtocol } from "./protocol.ts";
import { API_DEFAULT_MODEL, type JudgeRunner } from "./runner.ts";
import { toolDefinitionsFor, type ToolResult } from "./tool-specs.ts";
import type { TurnDeps } from "./tools.ts";

type Effort = NonNullable<NonNullable<Anthropic.Beta.Messages.BetaOutputConfig["effort"]>>;
export const DEFAULT_EFFORT: Effort = "high";
const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];
/** Requests per turn, like the SDK runner's MAX_TURNS. */
const MAX_REQUESTS = 16;
const MAX_TOKENS = 64000;
/** Re-issues of one request whose streamed tool input could not be parsed. */
const JSON_RETRIES = 2;
/** Server-side refusal fallbacks, routed by refusal category. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

type Params = Parameters<Anthropic["beta"]["messages"]["stream"]>[0];
type Message = Anthropic.Beta.Messages.BetaMessage;
type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type StreamEvent = Anthropic.Beta.Messages.BetaRawMessageStreamEvent;

/** What the loop needs of a stream: its raw events as they arrive, and the whole message at the end. */
export type TurnStream = {
  on(event: "streamEvent", listener: (event: StreamEvent) => void): unknown;
  finalMessage(): Promise<Message>;
};
export type OpenStream = (params: Params, options: { signal?: AbortSignal }) => TurnStream;

/** The loop's only way to the island: read its context, run one tool call. */
export type ToolBox = {
  context: (persona: Persona, deps: TurnDeps) => PersonaContext;
  run: (persona: Persona, deps: TurnDeps, name: string, input: unknown) => ToolResult;
};

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

/** The turn's first request: the protocol cached, the island's context after it, the thread as one user message. */
export function requestFor(persona: Persona, context: PersonaContext, model: string, effort: Effort): Params {
  return {
    model,
    max_tokens: MAX_TOKENS,
    system: [
      { type: "text", text: readProtocol(persona), cache_control: { type: "ephemeral" } },
      { type: "text", text: persona.renderContext(context) },
    ],
    tools: toolDefinitionsFor(persona),
    messages: [{ role: "user", content: persona.renderThreadPrompt(context.thread, context.asks) }],
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

export function createApiRunner(options: ApiRunnerOptions): JudgeRunner {
  const open = options.openStream ?? defaultOpenStream(options);
  return async ({ dbPath, domain, island, mode = "judge", emit, signal }) => {
    const persona = personaFor(mode);
    const deps: TurnDeps = { dbPath, domain, island, mode };
    const model = options.model ?? process.env.ARCHIPELAGO_MODEL ?? API_DEFAULT_MODEL;
    const params = requestFor(persona, options.toolbox.context(persona, deps), model, options.effort ?? effortFromEnv());
    const messages: MessageParam[] = [...params.messages];
    const cancelled = () => new ArchipelagoError(`the ${persona.id}'s turn was cancelled`);

    let reply = "";
    let jsonRetries = 0;
    for (let requests = 0; ; requests++) {
      if (requests === MAX_REQUESTS) throw new ArchipelagoError(`the ${persona.id} took too many steps on one turn`);
      if (signal?.aborted) throw cancelled();
      const before = reply;
      let message: Message;
      try {
        const stream = open({ ...params, messages }, { signal });
        stream.on("streamEvent", (event) => {
          // A new text block after earlier text means a tool call ran in between: keep them separate paragraphs.
          if (event.type === "content_block_start" && event.content_block.type === "text" && reply) {
            reply += "\n\n";
            emit({ type: "text", text: "\n\n" });
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta" && event.delta.text) {
            reply += event.delta.text;
            emit({ type: "text", text: event.delta.text });
          }
        });
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (error) {
        if (isUnparsedToolInput(error) && jsonRetries++ < JSON_RETRIES) {
          reply = before; // the request is re-issued whole; its partial text is not the reply
          continue;
        }
        throw describeApiError(error, model, options.hosted);
      }

      switch (message.stop_reason) {
        case "tool_use": {
          const calls = message.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
          if (calls.length === 0) return reply;
          messages.push({ role: "assistant", content: message.content });
          const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
          for (const call of calls) {
            if (signal?.aborted) throw cancelled();
            emit({ type: "progress", message: call.name });
            const result = options.toolbox.run(persona, deps, call.name, call.input);
            results.push({ type: "tool_result", tool_use_id: call.id, content: result.content, ...(result.isError ? { is_error: true } : {}) });
          }
          // Every result of one response goes back together, in one user message.
          messages.push({ role: "user", content: results });
          continue;
        }
        case "pause_turn":
          messages.push({ role: "assistant", content: message.content });
          continue;
        case "max_tokens":
          if (message.content.at(-1)?.type === "tool_use") throw new ArchipelagoError(`the ${persona.id}'s reply was cut off. Send again.`);
          return reply;
        case "refusal":
          throw new ArchipelagoError(`The ${persona.id} declined this turn. Rephrase and send again.`);
        case "end_turn":
        case "stop_sequence":
          return reply;
        default:
          if (reply) return reply;
          throw new ArchipelagoError(`the ${persona.id} stopped: ${message.stop_reason}`);
      }
    }
  };
}
