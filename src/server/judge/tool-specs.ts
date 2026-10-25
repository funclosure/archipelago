// What both runners send the model about each tool: its wording per persona, its input shape, and the
// shape of a result. The SDK runner wraps these as MCP tools; the API runner sends them as JSON Schema.
// No database here: `runTool` in tools.ts dispatches a call.
import { z } from "zod";
import { ArchipelagoError } from "../../core/errors.ts";
import type { Persona, ToolName } from "./persona.ts";

/** Each tool's wording as the judge (or, for its two tools, the cartographer) reads it; the mentor overrides what reads differently in its mode. */
const DESCRIPTIONS: Record<ToolName, string> = {
  island_context: "This island: verdict and history, islets, straits to neighbours, nearest open water, pending reef proposals, the board, and the thread so far. Read fresh.",
  record_verdict: "Write a sandbar, settled, or mountainous verdict on island:<slug> or strait:<a>~<b>. Evidence is a verbatim quote from the reader. Reefs are not accepted here; use propose_reef.",
  propose_reef: "Show the reader a reef: the specific false claim and the concrete consequence. The reef is written only if they confirm it.",
  set_landmarks: "Name this island's 4–6 landmarks (key concepts) once, when the context says it has none. Slugs are lowercase-kebab; names are short. terms: 2–5 words a reply uses for each landmark, in the reader's language plus the English term where the field writes it in English; the page marks them in the conversation.",
  unlock_landmark: "Light one landmark the reader's latest answer covered: they explained or applied it, not merely named it. Evidence is a verbatim quote from that answer.",
  ask_reader: "Ask the reader to choose: a question and 2–4 short options, one of them what they would say if they already understood. The options appear under your reply; end the reply with the question and stop.",
  board_write: "Pin, update, or remove a card on this island's board (see the board section of your protocol). op add: kind (diagram | note | code), body (mermaid source, markdown, or code), lang for code, and an optional one-line title. op update: id plus the fields to change. op remove: id. You may only update or remove cards you wrote.",
  mark_explored: "Mark one landmark explored: the reader engaged it in their own words (asked about it, restated it, or tried it on an example). Evidence is a verbatim quote of at least two words and twelve characters (or six Chinese, Japanese, or Korean characters) from the reader's latest message; anything else is refused. Marking it again changes nothing.",
  loose_end:
    "Note or close a loose end on this island: something the reader found confusing (confused), asked and left open (asked), or means to come back to (later). Both personas read the open ones. op open: kind, landmark (its slug, or null when it is about the island as a whole), note (one line in the reader's language: what went wrong and, when you explained it, what you explained), evidence. op close: id, evidence, when the reader's latest message shows it cleared up. Evidence is a verbatim quote of at least two words and twelve characters (or six Chinese, Japanese, or Korean characters) from the reader's latest message in this thread; anything else is refused.",
  point_to:
    "Point the reader at another island of this domain when their words belong there more than here: a link to sail there appears under your reply and carries their latest message as the question to take along. island: its slug, from the islands elsewhere in your context (never this island). why: one line in the reader's language on what that island holds for them.",
  chart_context: "This scale: the islands and straits here, at island scale the island's landmarks, board, and two threads, every slug taken in the domain, how many islands the next sketch may add, the pending sketch, and your thread. Read fresh.",
  propose_sketch: "Propose a sketch at this scale: new islands (slug, name, one-line summary, 4–6 landmarks each, every landmark with 2–5 terms: the words a reply uses for it), straits between islands at this scale, an optional harbour, name or summary updates to islands already here, seas (a name on the water over the islands it groups; new seas only, each island in at most one), and, when the context says the domain's name is provisional, the domain's name (top scale only) with its ASCII kebab-case slug. It replaces any pending sketch. Nothing reaches the map until the reader approves it there.",
};

const MENTOR_DESCRIPTIONS: Partial<Record<ToolName, string>> = {
  island_context:
    "Who the reader is (their ground, the claims to avoid building on, their note), this island, its landmarks explored or not, the board, and the mentor thread so far. Read fresh.",
  ask_reader:
    "Ask the reader a check-in: a question and 2–4 short options, all plausible. The options appear under your reply; end the reply with the question and stop.",
  mark_explored:
    "Mark one landmark explored: the reader engaged it in their own words. Evidence is a verbatim quote of at least two words and twelve characters (or six Chinese, Japanese, or Korean characters) from the reader's latest message; a pick from your own ask_reader options is not their words (own words typed instead are). Anything else is refused.",
};

/** Each of the persona's tools with the description it sees, in the persona's tool order. */
export function toolDescriptionsFor(persona: Persona): Partial<Record<ToolName, string>> {
  const own = persona.id === "mentor" ? MENTOR_DESCRIPTIONS : {};
  return Object.fromEntries(persona.toolNames.map((name) => [name, own[name] ?? DESCRIPTIONS[name]]));
}

/** The input each tool takes, as the model sees it. The tool functions validate again with the core schemas. */
export const TOOL_SHAPES: Record<ToolName, z.ZodRawShape> = {
  island_context: {},
  record_verdict: {
    target: z.string(),
    state: z.enum(["sandbar", "settled", "mountainous"]),
    confidence: z.number().min(0).max(1),
    evidence: z.string(),
    rationale: z.string(),
  },
  propose_reef: {
    target: z.string(),
    claim: z.string(),
    consequence: z.string(),
    evidence: z.string(),
    confidence: z.number().min(0).max(1),
    rationale: z.string(),
  },
  set_landmarks: { items: z.array(z.object({ slug: z.string(), name: z.string(), terms: z.array(z.string()).max(8).optional() })).min(4).max(6) },
  unlock_landmark: { slug: z.string(), evidence: z.string() },
  ask_reader: { question: z.string(), options: z.array(z.string()).min(2).max(4) },
  board_write: {
    op: z.enum(["add", "update", "remove"]),
    id: z.number().int().positive().optional(),
    kind: z.enum(["diagram", "note", "code"]).optional(),
    title: z.string().optional(),
    body: z.string().optional(),
    lang: z.string().nullable().optional(),
  },
  mark_explored: { slug: z.string(), evidence: z.string() },
  loose_end: {
    op: z.enum(["open", "close"]),
    id: z.number().int().positive().optional(),
    kind: z.enum(["confused", "asked", "later"]).optional(),
    landmark: z.string().nullable().optional(),
    note: z.string().optional(),
    evidence: z.string(),
  },
  point_to: { island: z.string(), why: z.string() },
  chart_context: {},
  propose_sketch: {
    islands: z
      .array(z.object({ slug: z.string(), name: z.string(), summary: z.string(), landmarks: z.array(z.object({ slug: z.string(), name: z.string(), terms: z.array(z.string()).max(8).optional() })).min(4).max(6) }))
      .optional(),
    straits: z.array(z.object({ from: z.string(), to: z.string(), name: z.string().optional() })).optional(),
    harbour: z.string().optional(),
    name: z.string().optional(),
    slug: z.string().optional(),
    updates: z.array(z.object({ slug: z.string(), name: z.string().optional(), summary: z.string().optional() })).optional(),
    seas: z.array(z.object({ name: z.string(), islands: z.array(z.string()) })).optional(),
  },
};

/** A tool's JSON Schema for the Messages API: the zod shape, without the `$schema` marker. */
export function inputSchemaFor(name: ToolName): { type: "object"; [key: string]: unknown } {
  const { $schema: _, ...schema } = z.toJSONSchema(z.object(TOOL_SHAPES[name])) as { $schema?: string; type: "object" };
  return schema;
}

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export const toolResult = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

/** Tool failures go back to the model as JSON `{ error }` so it can correct itself, never as a thrown exception. */
export function toolError(error: unknown): ToolResult {
  let payload: unknown;
  if (error instanceof ArchipelagoError) payload = error.toJSON();
  else if (error instanceof z.ZodError) payload = { error: error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
  else payload = { error: error instanceof Error ? error.message : String(error) };
  return { content: [{ type: "text", text: JSON.stringify(payload) }], isError: true };
}

/** The persona's tools for the Messages API, in its order. Inputs stream as generated; the tool functions validate them. */
export function toolDefinitionsFor(persona: Persona) {
  const describe = toolDescriptionsFor(persona) as Record<ToolName, string>;
  return persona.toolNames.map((name) => ({ name, description: describe[name], input_schema: inputSchemaFor(name), eager_input_streaming: true }));
}
