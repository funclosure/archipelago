# API runner: the judge on the Messages API

**Date:** 2026-10-20
**Status:** designed
**Builds on:** web judge (`2026-09-04-web-judge-design.md`), mentor mode (`2026-09-30-mentor-mode-design.md`), the Claude Code plugin (PR #1)
**Unlocks:** the cartographer in the app (change A), which runs through this runner as a third persona; the bring-your-own-key web app (route 2), which runs this loop in the browser.

## Why

Every judge and mentor turn runs on the Claude Agent SDK, which starts a Claude Code process for each turn. That ties the judge to a machine with Claude Code installed and logged in, and rules out a browser or a serverless host. Distribution needs a judge that is a plain HTTP client: one tool-use loop over `POST /v1/messages`, the same tools, the same protocols, behind the same `JudgeRunner` type. Nothing on the page changes.

## Decisions

| Question | Decision |
|---|---|
| Shape | A third runner beside `sdk` and `stub`: `src/server/judge/api.ts`, implementing `JudgeRunner` unchanged. Routes, personas, protocols, and the page do not change. |
| Loop | A manual streaming loop (`client.beta.messages.stream` + `finalMessage()`), not the SDK's beta tool runner. We already own validation (zod in `tools.ts`), and we need the abort signal, the turn cap, and the `progress` events the route expects. |
| Library | `@anthropic-ai/sdk`, pinned exactly at `0.123.0` (already installed under the Agent SDK, so the plugin's install does not grow). |
| Which runner | `serve --judge api|sdk|stub` (env `ARCHIPELAGO_JUDGE`). Default: `api` when `ANTHROPIC_API_KEY` is set, otherwise `sdk`. `--stub` stays as an alias for `--judge stub`. `serve` prints the judge it chose. |
| Model | `ARCHIPELAGO_MODEL` for both runners. The API runner defaults to `claude-opus-5-5`; the SDK runner keeps `claude-opus-5` until we compare them on real turns (open question 1). |
| Effort | `output_config.effort: "high"`, overridable by `ARCHIPELAGO_EFFORT`. Opus 5.5 defaults to `medium`, and the judge's classification (PROTOCOL §3) is the work that most needs depth. Thinking is always on in Opus 5.5 and is not configured. |
| Refusals | Server-side fallbacks on by default (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). A turn whose whole chain refuses ends with an error event: "The judge declined this turn. Rephrase and send again." |
| Tool surface | Exactly the persona's `toolNames`, nothing else. No server tools (no web search, no code execution). Same closure as the SDK runner, by construction. |
| Shared tool specs | Tool descriptions and input schemas move out of `sdk.ts` into `tool-specs.ts`, used by both runners. Each schema is written once in zod; the API runner sends `z.toJSONSchema(...)`. |
| Protocol rule | One new line in PROTOCOL.md and MENTOR.md: make every tool call first, then write the whole reply after the last tool returns. See *Text between tool calls* below. |

## Text between tool calls

On Claude Opus 5.5, text the model writes between tool calls comes back as progress-update `thinking` blocks, empty unless asked for, not as `text`. Only the text after the last tool call is a `text` block. The judge's turns today interleave freely: a sentence of acknowledgement, `unlock_landmark`, then the next question. Under the API runner the first sentence would vanish from the reply.

The fix is in protocol text before code, as the project's convention asks. PROTOCOL.md and MENTOR.md each gain one rule under the tools section: *Make every tool call first. Write the whole reply after the last tool returns; text written before a tool call is not shown.* It already matches `ask_reader` ("after the tool returns, end the reply with the question"), costs the SDK runner nothing, and keeps both runners showing the same reply.

The runner still concatenates every `text` block it sees, separated by a blank line as `sdk.ts` does, so a model that ignores the rule loses nothing it would have shown. A protocol test asserts the rule's presence in both files.

## The loop

`apiRunner({ dbPath, domain, island, mode, emit, signal })`:

1. `persona = personaFor(mode)`; `context = islandContext(deps)` (the one read the SDK runner also makes before the turn).
2. Build the request once:
   - `system`: two text blocks. The protocol (`readProtocol(persona)`) carries `cache_control: { type: "ephemeral" }`; it is identical across every island and turn of a persona, so it caches. The rendered context (`persona.renderContext(context)`) follows uncached.
   - `tools`: `toolDefinitionsFor(persona)` from `tool-specs.ts`, in the persona's order. Each sets `eager_input_streaming: true`; inputs are validated by the tool functions (below).
   - `messages`: one user message, `persona.renderThreadPrompt(context.thread, context.asks)`. The thread stays replayed as text, as today, so a turn is stateless and nothing new is stored.
   - Top-level `cache_control: { type: "ephemeral" }`, so each loop iteration reads the previous one's prefix.
   - `model`, `max_tokens: 64000`, `output_config: { effort }`, `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`.
3. Loop, at most 16 requests per turn (the SDK runner's `MAX_TURNS`):
   - Open the stream with `{ signal }`. Forward each text delta as `emit({ type: "text", text })`. When a new `text` block starts after earlier reply text, emit and keep `"\n\n"`.
   - `message = await stream.finalMessage()`. Append `message.content` unchanged to `messages` (thinking blocks included; never strip or edit them).
   - `stop_reason`:
     - `end_turn`: done; resolve with the reply.
     - `tool_use`: for each `tool_use` block, `emit({ type: "progress", message: name })`, run it through `runTool(persona, deps, name, input)`, and collect every `tool_result` into one user message (parallel calls answered together).
     - `pause_turn`: continue without tool results.
     - `max_tokens`: if the last block is a `tool_use`, throw "the judge's reply was cut off; send again" without running it; otherwise end with what was written.
     - `refusal`: throw the declined message above.
   - Past 16 requests: throw "the judge took too many steps on one turn".
4. A JSON parse failure from eager input streaming re-issues the request, at most twice per turn; any `Anthropic.APIError` is never retried here (the SDK already retries 429 and 5xx twice).

### Tool calls

`runTool` is today's `guard()` from `sdk.ts`, moved to `tool-specs.ts`: it calls the same function in `tools.ts` with the raw input, and returns either `{ content: JSON.stringify(result) }` or `{ content: JSON.stringify({ error }), is_error: true }`. The tool functions already parse `unknown` input with zod, so a malformed or truncated input becomes an error the model can correct, never a write. A name outside the persona's list returns an error result; it is never dispatched.

### Errors

Typed SDK errors become one actionable sentence, like `describeSdkError`:

| Error | Message |
|---|---|
| `AuthenticationError` | ANTHROPIC_API_KEY was rejected. Check the key, then send again. |
| `PermissionDeniedError` | This API key cannot use the judge's model. Set ARCHIPELAGO_MODEL to one it can use. |
| `NotFoundError` | The judge model is not available. Set ARCHIPELAGO_MODEL (default claude-opus-5-5). |
| `RateLimitError` | Claude is rate-limited. Wait a moment and send again. |
| `InternalServerError` (incl. 529 overloaded) | Claude is overloaded. Wait a moment and send again. |
| `APIConnectionError` | Cannot reach the Claude API. Check the connection, then send again. |
| `APIUserAbortError` | Rethrown as is: the route already reports its own timeout and ignores a departed reader. |

### Cancellation

`signal` goes to every request as the SDK's request option; aborting it cancels the open stream. The loop checks `signal.aborted` before each request and before running tools, so an aborted turn never starts a write. The route's settle wait (`TURN_SETTLE_MS`) is unchanged.

## Code layout

```
src/server/judge/
  tool-specs.ts   NEW  descriptions per persona (moved from sdk.ts), zod input shapes, runTool, toolDefinitionsFor
  api.ts          NEW  apiRunner: request build, loop, error mapping. Imports @anthropic-ai/sdk, never bun:sqlite.
  sdk.ts          builds its MCP tools from tool-specs.ts; behaviour unchanged
  runner.ts       createRunner(kind: "api" | "sdk" | "stub"); api and sdk imported lazily
src/cli/index.ts  serve --judge, ARCHIPELAGO_JUDGE, default by ANTHROPIC_API_KEY, prints the choice
src/server/index.ts  ServerOptions.judge replaces stub (stub stays accepted)
```

`api.ts` reaches the database only through `islandContext` and `runTool`, passed in as a `ToolBox` (`{ context(deps), run(persona, deps, name, input) }`) with the server's implementation as the default. The browser port (route 2) supplies its own `ToolBox` over SQLite in WebAssembly and reuses the loop unchanged.

## Testing

`bun test` never calls the network. `api.ts` takes its stream factory as an option (default: `new Anthropic().beta.messages.stream`); tests pass a scripted fake that yields stream events and a final message per request.

- One text-only turn: deltas are emitted in order; the reply resolves.
- A tool turn: `unlock_landmark` runs against a temp database and lights the landmark; its `tool_result` goes back in the next request; `progress` is emitted with the tool name.
- Parallel tool calls produce one user message with every result.
- A tool error (an unknown slug) returns `is_error` with the tool's JSON, and the loop continues.
- A tool outside the persona's list (`record_verdict` from the mentor) is refused, not run.
- Text before and after a tool call is joined with one blank line.
- The 16-request cap, `refusal`, and `max_tokens` on a `tool_use` each end with their message.
- An aborted signal before a request starts no request and no write.
- Each typed error maps to its sentence.
- The request carries the persona's tools only, the protocol block with `cache_control`, effort, and fallbacks.
- `createRunner("api")` without `ANTHROPIC_API_KEY` set is still constructible; the first turn reports the authentication sentence.
- Protocol test: PROTOCOL.md and MENTOR.md both carry the tools-first rule.

By hand, once: one judge turn and one mentor turn per runner on a real island, comparing replies, tool calls, and `usage.cache_read_input_tokens` on the second loop iteration.

## Out of scope

- The browser port and its storage (route 2).
- The cartographer persona (change A).
- Changing the SDK runner's model or removing the SDK runner.
- Storing turns as Messages API history instead of replaying the thread as text.
- A cost meter on the page.

## Open questions

1. **SDK runner model.** Bump `claude-opus-5` to `claude-opus-5-5` as well, after comparing the two runners on real turns, so both judges behave alike?
2. **Effort per persona.** The mentor answers questions rather than classifying; `medium` may serve it as well at lower cost. Measure before splitting.
3. **Default runner for key holders.** With this design, a user who has `ANTHROPIC_API_KEY` set in their shell moves from the SDK runner to the API runner without asking. That is the intent, but the startup line should say so plainly.
