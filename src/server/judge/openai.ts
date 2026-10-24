// The OpenAI-style chat API as a ModelAdapter: `POST {baseUrl}/chat/completions`, streamed as server-sent events,
// tools as functions. Google Gemini (its OpenAI-compatible endpoint), OpenAI, OpenRouter, and local servers such
// as Ollama all speak it. Plain fetch and our own stream reading, no vendor SDK, so the hosted build stays small.
import { ArchipelagoError } from "../../core/errors.ts";
import { createModelRunner, type ModelAdapter, type StepEnd, type ToolBox, type ToolCall, type TurnRequest } from "./loop.ts";
import type { JudgeRunner } from "./runner.ts";

/** Known endpoints by name, so `ARCHIPELAGO_BASE_URL=gemini` is enough; any other value is taken as a base URL. */
export const PROVIDERS = {
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyEnv: "GEMINI_API_KEY", label: "Gemini" },
  openai: { baseUrl: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY", label: "OpenAI" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY", label: "OpenRouter" },
  ollama: { baseUrl: "http://localhost:11434/v1", keyEnv: null, label: "Ollama" },
} as const;
export type ProviderName = keyof typeof PROVIDERS;

export type ChatOptions = {
  baseUrl: string;
  apiKey?: string;
  /** Tests pass a scripted fetch; by default the global one. */
  fetch?: typeof fetch;
  /** In the browser (the hosted build): errors point at Your key, not the environment. */
  hosted?: boolean;
  /** How hard the model thinks (`minimal`, `low`, `medium`, `high`); the model's own default when absent. */
  effort?: string;
};

/**
 * Gemini sends nothing, not even headers, until it has thought, and its server drops a stream that stays silent for
 * 60 s. Asking for thought summaries makes it stream from the first seconds; they are read and never shown.
 */
export function isGemini(baseUrl: string): boolean {
  return /(^|\.)generativelanguage\.googleapis\.com$/.test(hostOf(baseUrl));
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

type ChatToolCall = { id: string; type: "function"; function: { name: string; arguments: string }; [extra: string]: unknown };
type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** A response the API refused with an HTTP status: kept whole so the loop's error can name what to do. */
export class ChatHttpError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/**
 * A JSON Schema every OpenAI-style server accepts. Gemini's endpoint takes a narrower subset than OpenAI's:
 * no `additionalProperties`, no exclusive bounds, no type lists. `["string", "null"]` becomes a nullable string;
 * a bound at JavaScript's safe-integer limit says nothing, so it goes.
 */
export function portableSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(portableSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "additionalProperties" || key === "$schema" || key === "exclusiveMinimum" || key === "exclusiveMaximum") continue;
    if ((key === "maximum" && value === MAX_SAFE) || (key === "minimum" && value === -MAX_SAFE)) continue;
    if (key === "type" && Array.isArray(value)) {
      const types = value.filter((t) => t !== "null");
      out.type = types.length === 1 ? types[0] : types;
      if (types.length < value.length) out.nullable = true;
      continue;
    }
    out[key] = portableSchema(value);
  }
  return out;
}

/** A request body: the protocol and the context as one system message (protocol first, so a provider's prefix cache can hold it), the thread as the user's. */
export function chatBodyFor(request: TurnRequest, messages: ChatMessage[], options: { gemini?: boolean; effort?: string } = {}) {
  const thinking = options.gemini
    ? { extra_body: { google: { thinking_config: { include_thoughts: true, ...(options.effort ? { thinking_level: options.effort } : {}) } } } }
    : options.effort
      ? { reasoning_effort: options.effort }
      : {};
  return {
    model: request.model,
    stream: true,
    messages,
    tools: request.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: portableSchema(t.schema) } })),
    ...thinking,
  };
}

/** Server-sent events from a fetch body, one parsed `data:` payload at a time; `[DONE]` ends it. */
async function* events(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let cut: number;
    while ((cut = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, "");
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      if (data === "[DONE]") return;
      yield JSON.parse(data);
    }
    if (done) return;
  }
}

type Delta = { content?: string | null; extra_content?: { google?: { thought?: boolean } }; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string }; [extra: string]: unknown }[] };
type Chunk = { choices?: { delta?: Delta; finish_reason?: string | null }[]; error?: { message?: string } };

export function chatAdapter(options: ChatOptions): ModelAdapter {
  const doFetch = options.fetch ?? fetch;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const host = hostOf(options.baseUrl);
  const gemini = isGemini(options.baseUrl);
  return {
    describeError: (error, model) => describeChatError(error, model, host, options.hosted),
    start: (request) => {
      const messages: ChatMessage[] = [
        { role: "system", content: `${request.protocol}\n\n${request.context}` },
        { role: "user", content: request.prompt },
      ];
      let pending: { text: string; calls: ChatToolCall[] } | null = null;
      let fresh = 0; // ids for tool calls a server sent without one
      return {
        async step(sink, signal): Promise<StepEnd> {
          const response = await doFetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}) },
            body: JSON.stringify(chatBodyFor(request, messages, { gemini, effort: options.effort })),
            signal,
          });
          if (!response.ok || !response.body) throw new ChatHttpError(response.status, await response.text().catch(() => ""));

          let text = "";
          let finish: string | null = null;
          const calls: ChatToolCall[] = [];
          for await (const raw of events(response.body)) {
            const chunk = raw as Chunk;
            if (chunk.error) throw new ArchipelagoError(`The model's server reported an error: ${chunk.error.message ?? "unknown"}`);
            const choice = chunk.choices?.[0];
            if (!choice) continue;
            const delta = choice.delta ?? {};
            // A thought summary only keeps the stream alive; the reply starts after it, behind a `</thought>` tag.
            const content = delta.extra_content?.google?.thought ? "" : (delta.content ?? "").replace(/^<\/?thought>/, "");
            if (content) {
              if (!text) sink.paragraph(); // a new reply after a tool call starts its own paragraph
              text += content;
              sink.text(content);
            }
            for (const part of delta.tool_calls ?? []) {
              const at = part.index ?? calls.length;
              const { index: _i, id, function: fn, ...extra } = part;
              const call = (calls[at] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
              Object.assign(call, extra); // vendor fields (Gemini's thought signature) go back exactly as they came
              if (id) call.id = id;
              if (fn?.name) call.function.name += fn.name;
              if (fn?.arguments) call.function.arguments += fn.arguments;
            }
            if (choice.finish_reason) finish = choice.finish_reason;
          }

          const made = calls.filter(Boolean);
          if (finish === "length") return { kind: "cut", midTool: made.length > 0 };
          if (finish === "content_filter") return { kind: "refused" };
          if (made.length) {
            const parsed: ToolCall[] = [];
            for (const call of made) {
              if (!call.id) call.id = `call_${++fresh}`;
              let input: unknown;
              try {
                input = call.function.arguments.trim() ? JSON.parse(call.function.arguments) : {};
              } catch {
                return { kind: "retry" };
              }
              parsed.push({ id: call.id, name: call.function.name, input });
            }
            pending = { text, calls: made };
            return { kind: "tools", calls: parsed };
          }
          if (finish === "stop" || finish === null) return { kind: "done" };
          return { kind: "other", reason: finish };
        },
        addResults(results) {
          if (pending) messages.push({ role: "assistant", content: pending.text || null, tool_calls: pending.calls });
          pending = null;
          for (const { call, result } of results) {
            messages.push({ role: "tool", tool_call_id: call.id, content: result.content.map((c) => c.text).join("\n") });
          }
        },
      };
    },
  };
}

/** One actionable sentence for each way an OpenAI-style server can fail a turn. Aborts and our own errors pass through. */
export function describeChatError(error: unknown, model: string, host: string, hosted = false): unknown {
  if (error instanceof ArchipelagoError) return error;
  if (error instanceof Error && error.name === "AbortError") return error;
  const say = (message: string) => new ArchipelagoError(message);
  const key = hosted ? "Open Your key in the domain menu and check it" : "Check ARCHIPELAGO_API_KEY (or the provider's own key variable)";
  const pick = hosted ? "Pick another model under Your key in the domain menu." : "Set ARCHIPELAGO_MODEL to one it serves.";
  if (error instanceof ChatHttpError) {
    if (error.status === 401 || error.status === 403) return say(`${host} rejected the API key. ${key}, then send again.`);
    if (error.status === 404) return say(`${host} does not serve the model ${model}. ${pick}`);
    if (error.status === 400 && /model/i.test(error.body)) return say(`${host} refused the model ${model}. ${pick}`);
    if (error.status === 429) return say(`${host} is rate-limiting this key. Wait a moment and send again.`);
    if (error.status >= 500) return say(`${host} is overloaded or down. Wait a moment and send again.`);
    return say(`${host} refused the request (HTTP ${error.status}): ${error.body.slice(0, 200)}`);
  }
  if (error instanceof TypeError) return say(`Cannot reach ${host}. Check the connection and the base URL, then send again.`);
  return error;
}

const CHAT_EFFORTS = ["minimal", "low", "medium", "high"];

/** ARCHIPELAGO_EFFORT in the chat servers' terms: Claude's `xhigh` and `max` are their `high`; anything else unknown is dropped. */
export function chatEffort(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (raw === "xhigh" || raw === "max") return "high";
  return CHAT_EFFORTS.includes(raw) ? raw : undefined;
}

export type ChatRunnerOptions = ChatOptions & { toolbox: ToolBox; model: string };

export function createChatRunner(options: ChatRunnerOptions): JudgeRunner {
  return createModelRunner({ toolbox: options.toolbox, adapter: chatAdapter(options), model: options.model });
}

/**
 * The chat runner's settings from the environment: ARCHIPELAGO_BASE_URL (a provider's name or a URL), the key from
 * ARCHIPELAGO_API_KEY or that provider's own variable, ARCHIPELAGO_MODEL, which has no default here, and ARCHIPELAGO_EFFORT
 * when set (Gemini's thinking level, or `reasoning_effort` elsewhere).
 */
export function chatSettingsFromEnv(env: Record<string, string | undefined> = process.env): { baseUrl: string; apiKey?: string; model: string; effort?: string } {
  const named = env.ARCHIPELAGO_BASE_URL as ProviderName | undefined;
  const provider = named && named in PROVIDERS ? PROVIDERS[named] : null;
  const baseUrl = provider?.baseUrl ?? env.ARCHIPELAGO_BASE_URL;
  if (!baseUrl) throw new ArchipelagoError(`ARCHIPELAGO_BASE_URL is not set. Name a provider (${Object.keys(PROVIDERS).join(", ")}) or give a base URL.`);
  const model = env.ARCHIPELAGO_MODEL;
  if (!model) throw new ArchipelagoError("ARCHIPELAGO_MODEL is not set. The openai judge has no default model; name one the server serves.");
  const apiKey = env.ARCHIPELAGO_API_KEY ?? (provider?.keyEnv ? env[provider.keyEnv] : undefined);
  const effort = chatEffort(env.ARCHIPELAGO_EFFORT);
  return { baseUrl, model, ...(apiKey ? { apiKey } : {}), ...(effort ? { effort } : {}) };
}
