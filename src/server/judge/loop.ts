// One persona turn on a model API, whichever vendor serves it: read the context, send it, stream the text, run
// the tool calls the model asks for through the injected ToolBox, send the results back, until the model stops.
// What differs per vendor (the request, the stream, how results go back, what an error means) lives in a
// ModelAdapter; this loop never sees a vendor's types.
import { ArchipelagoError } from "../../core/errors.ts";
import { personaFor, type Persona, type PersonaContext } from "./persona.ts";
import { readProtocol } from "./protocol.ts";
import type { JudgeRunner } from "./runner.ts";
import { toolDescriptionsFor, inputSchemaFor, type ToolResult } from "./tool-specs.ts";
import type { ToolName } from "./persona.ts";
import type { TurnDeps } from "./tools.ts";

/** Requests per turn, like the SDK runner's MAX_TURNS. */
export const MAX_REQUESTS = 16;
/** Re-issues of one request whose streamed tool input could not be parsed. */
export const JSON_RETRIES = 2;

/** The loop's only way to the island: read its context, run one tool call. */
export type ToolBox = {
  context: (persona: Persona, deps: TurnDeps) => PersonaContext;
  run: (persona: Persona, deps: TurnDeps, name: string, input: unknown) => ToolResult;
};

/** A tool as every vendor needs it: name, wording for this persona, and its input's JSON Schema. */
export type ToolSpec = { name: ToolName; description: string; schema: { type: "object"; [key: string]: unknown } };

/** What a turn sends first, vendor-neutral: the protocol (stable, worth caching), the context, the thread, the tools. */
export type TurnRequest = { model: string; protocol: string; context: string; prompt: string; tools: ToolSpec[] };

export type ToolCall = { id: string; name: string; input: unknown };

/** How one response ended, in the loop's terms. */
export type StepEnd =
  | { kind: "tools"; calls: ToolCall[] } // run these, send the results back, ask again
  | { kind: "continue" } // the vendor paused mid-turn: ask again as is
  | { kind: "done" } // the reply is complete
  | { kind: "cut"; midTool: boolean } // out of output tokens, possibly in the middle of a tool call
  | { kind: "refused" } // the model declined the turn
  | { kind: "retry" } // the response was unusable (a tool input that would not parse): re-issue it whole
  | { kind: "other"; reason: string };

/** Where a response's text goes as it streams: `paragraph` when a new text block starts after a tool call. */
export type TextSink = { text: (delta: string) => void; paragraph: () => void };

/** One turn's conversation with a vendor: it owns the message history in that vendor's shape. */
export type Conversation = {
  step: (sink: TextSink, signal?: AbortSignal) => Promise<StepEnd>;
  addResults: (results: { call: ToolCall; result: ToolResult }[]) => void;
};

export type ModelAdapter = {
  start: (request: TurnRequest) => Conversation;
  /** One actionable sentence for a failure, or the error unchanged (aborts, our own errors). */
  describeError: (error: unknown, model: string) => unknown;
};

/** The persona's tools, vendor-neutral, in its order. */
export function toolSpecsFor(persona: Persona): ToolSpec[] {
  const describe = toolDescriptionsFor(persona) as Record<ToolName, string>;
  return persona.toolNames.map((name) => ({ name, description: describe[name], schema: inputSchemaFor(name) }));
}

/** The turn's first request: the protocol, the island's context, the thread as one prompt. */
export function turnRequestFor(persona: Persona, context: PersonaContext, model: string): TurnRequest {
  return {
    model,
    protocol: readProtocol(persona),
    context: persona.renderContext(context),
    prompt: persona.renderThreadPrompt(context.thread, context.asks),
    tools: toolSpecsFor(persona),
  };
}

export type ModelRunnerOptions = { toolbox: ToolBox; adapter: ModelAdapter; model: string };

export function createModelRunner({ toolbox, adapter, model }: ModelRunnerOptions): JudgeRunner {
  return async ({ dbPath, domain, island, mode = "judge", emit, signal }) => {
    const persona = personaFor(mode);
    const deps: TurnDeps = { dbPath, domain, island, mode };
    const conversation = adapter.start(turnRequestFor(persona, toolbox.context(persona, deps), model));
    const cancelled = () => new ArchipelagoError(`the ${persona.id}'s turn was cancelled`);

    let reply = "";
    let jsonRetries = 0;
    const sink: TextSink = {
      text: (delta) => {
        if (!delta) return;
        reply += delta;
        emit({ type: "text", text: delta });
      },
      // A new text block after earlier text means a tool call ran in between: keep them separate paragraphs.
      paragraph: () => {
        if (!reply) return;
        reply += "\n\n";
        emit({ type: "text", text: "\n\n" });
      },
    };

    for (let requests = 0; ; requests++) {
      if (requests === MAX_REQUESTS) throw new ArchipelagoError(`the ${persona.id} took too many steps on one turn`);
      if (signal?.aborted) throw cancelled();
      const before = reply;
      let end: StepEnd;
      try {
        end = await conversation.step(sink, signal);
      } catch (error) {
        throw adapter.describeError(error, model);
      }
      if (end.kind === "retry") {
        if (jsonRetries++ < JSON_RETRIES) {
          reply = before; // the request is re-issued whole; its partial text is not the reply
          continue;
        }
        throw new ArchipelagoError(`the ${persona.id} sent a tool call that could not be read. Send again.`);
      }
      jsonRetries = 0;

      switch (end.kind) {
        case "tools": {
          if (end.calls.length === 0) return reply;
          const results: { call: ToolCall; result: ToolResult }[] = [];
          for (const call of end.calls) {
            if (signal?.aborted) throw cancelled();
            emit({ type: "progress", message: call.name });
            results.push({ call, result: toolbox.run(persona, deps, call.name, call.input) });
          }
          // Every result of one response goes back together.
          conversation.addResults(results);
          continue;
        }
        case "continue":
          continue;
        case "cut":
          if (end.midTool) throw new ArchipelagoError(`the ${persona.id}'s reply was cut off. Send again.`);
          return reply;
        case "refused":
          throw new ArchipelagoError(`The ${persona.id} declined this turn. Rephrase and send again.`);
        case "done":
          return reply;
        default:
          if (reply) return reply;
          throw new ArchipelagoError(`the ${persona.id} stopped: ${end.reason}`);
      }
    }
  };
}
