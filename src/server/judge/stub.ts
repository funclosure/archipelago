import { ArchipelagoError } from "../../core/errors.ts";
import type { JudgeRunner, JudgeTurn } from "./runner.ts";
import { chartContext, proposeSketchTool } from "./chart.ts";
import { personaFor } from "./persona.ts";
import { askReader, boardWrite, islandContext, looseEnd, markExplored, pointTo, proposeReef, recordVerdict, setLandmarks, unlockLandmark } from "./tools.ts";

const CANNED = [
  { slug: "shape", name: "Shape", terms: ["shape", "structure"] }, { slug: "scale", name: "Scale", terms: ["scale", "load"] },
  { slug: "failure", name: "Failure", terms: ["failure", "breaks"] }, { slug: "tradeoff", name: "Tradeoff", terms: ["tradeoff", "cost"] },
];

/** The stub for whichever persona the turn is for: the judge's unless the turn says mentor. */
export const stubRunner: JudgeRunner = (turn) => personaFor(turn.mode ?? "judge").stubTurn(turn);

/**
 * No-login judge for `serve --stub` and tests. Reads the thread, reacts to a keyword in the reader's
 * last message, and writes through the same tool functions the SDK runner uses:
 *   first open on a landmark-less island → set_landmarks (four canned) · then, in the order they are tested:
 *   "unlock <slug>" → unlock_landmark · "the first option" (once asked) → unlock_landmark "shape" · "fail" → throws ·
 *   "reef" → propose_reef · "settled" → record_verdict settled · "cleared" → loose_end closes the oldest open one ·
 *   "pin" → board_write (a canned diagram) ·
 *   "code" → a canned swift fence · the second answer that matched none of those, unasked → ask_reader
 *   (canned) · else a canned follow-up.
 * A function declaration, not a const: persona.ts imports it while this module may still be evaluating.
 */
/** The judge's and the mentor's turns always name an island. */
function islandOf(island: string | undefined): string {
  if (island === undefined) throw new ArchipelagoError("a judge or mentor turn needs an island");
  return island;
}

export async function judgeStubTurn({ dbPath, domain, island, emit }: JudgeTurn): Promise<string> {
  const deps = { dbPath, domain, island: islandOf(island) };
  let ctx = islandContext(deps);
  const say = (text: string) => {
    emit({ type: "text", text });
    return text;
  };
  const last = [...ctx.thread].reverse().find((m) => m.role === "you");
  if (!last) {
    if (ctx.landmarks.length === 0) {
      emit({ type: "progress", message: "set_landmarks" });
      setLandmarks(deps, { items: CANNED });
      ctx = islandContext(deps);
    }
    const names = ctx.landmarks.map((l) => l.slug).join(", ");
    return say(`Here the coastline has ${ctx.landmarks.length} points: ${names}. Tell me how ${ctx.island.name} works, in your own words, and where it breaks.`);
  }
  const text = last.body.toLowerCase();
  // `unlock` is tested before `fail`, so `unlock failure` lights the canned Failure landmark instead of throwing.
  const unlock = /unlock\s+([a-z0-9-]+)/.exec(text);
  if (unlock) {
    emit({ type: "progress", message: "unlock_landmark" });
    const lit = unlockLandmark(deps, { slug: unlock[1], evidence: last.body });
    return say(`You put it as "${last.body.slice(0, 40)}". That charts ${lit.name}: ${lit.unlocked} of ${lit.total}. What about the rest?`);
  }
  if (text === "the first option" && ctx.landmarks.some((l) => l.slug === "shape" && l.unlockedAt === null)) {
    emit({ type: "progress", message: "unlock_landmark" });
    const lit = unlockLandmark(deps, { slug: "shape", evidence: last.body });
    return say(`You chose "${last.body}". That charts ${lit.name}: ${lit.unlocked} of ${lit.total}.`);
  }
  if (text.includes("fail")) throw new Error("stub failure");
  if (text.includes("reef")) {
    emit({ type: "progress", message: "propose_reef" });
    proposeReef(deps, {
      target: `island:${island}`, claim: last.body, consequence: "the stub says something breaks",
      evidence: last.body, confidence: 0.8, rationale: "stub: the message contained the word reef",
    });
    return say("That sounds wrong to me. Confirm or dispute the reef below.");
  }
  if (text.includes("settled")) {
    emit({ type: "progress", message: "record_verdict" });
    recordVerdict(deps, {
      target: `island:${island}`, state: "settled", confidence: 0.8, evidence: last.body,
      rationale: "stub: the message contained the word settled",
    });
    return say(`Charted as settled. Where next: ${ctx.nearestOpenWater[0] ?? "nowhere, everything is charted"}.`);
  }
  if (text.includes("cleared") && ctx.looseEnds.length > 0) {
    emit({ type: "progress", message: "loose_end" });
    const closed = looseEnd(deps, { op: "close", id: ctx.looseEnds[0]!.id, evidence: last.body }, "judge").looseEnd;
    return say(`That clears up the loose end: ${closed.note}. Say more about ${ctx.island.name}.`);
  }
  if (text.includes("pin")) {
    emit({ type: "progress", message: "board_write" });
    boardWrite(deps, { op: "add", kind: "diagram", title: "Request path", body: "flowchart TB\n  app[App] --> cache[Cache]\n  cache --> db[(Database)]" });
    return say("Pinned Request path to the board. Where on that path does a stale read come from?");
  }
  if (text.includes("code")) {
    const snippet = [
      "final class Cache<Key: Hashable> {",
      "  private var store: [Key: Int] = [:]",
      "  func get(_ key: Key) -> Int? { store[key] }",
      "  func set(_ key: Key, _ value: Int) { store[key] = value }",
      "  var count: Int { store.count }",
      "}",
    ].join("\n");
    return say(`Look at how this cache is read and written from two threads.\n\n\`\`\`swift\n${snippet}\n\`\`\`\n\nWhere does it break?`);
  }
  // A second answer that matched none of the keywords above gets a canned ask, once.
  const answers = ctx.thread.filter((m) => m.role === "you" && m.kind === "text").length;
  if (answers === 2 && ctx.asks.length === 0) {
    emit({ type: "progress", message: "ask_reader" });
    askReader(deps, { question: "Stub check: which of these is true?", options: ["the first option", "the second option", "the third option"] });
    return say("Stub check: which of these is true?");
  }
  return say(`Say more about ${ctx.island.name}.`);
}

/**
 * No-login mentor for `serve --stub` and tests, through the same tools: first open on a landmark-less island →
 * set_landmarks (the same four) · then "explore <slug>" → mark_explored, quoting the whole message ·
 * "elsewhere" → point_to the first other island in the domain ·
 * "confus" or 困惑 → loose_end (confused, on the first landmark the message names by slug or name, else the island) ·
 * "fail" → throws · "pin" → board_write as the mentor (a canned note) · else a canned follow-up.
 * A function declaration, not a const: persona.ts imports it while this module may still be evaluating.
 */
export async function mentorStubTurn({ dbPath, domain, island, emit }: JudgeTurn): Promise<string> {
  const deps = { dbPath, domain, island: islandOf(island), mode: "mentor" as const };
  let ctx = islandContext(deps);
  const say = (text: string) => {
    emit({ type: "text", text });
    return text;
  };
  const last = ctx.thread.findLast((m) => m.role === "you" && m.kind === "text");
  if (!last) {
    if (ctx.landmarks.length === 0) {
      emit({ type: "progress", message: "set_landmarks" });
      setLandmarks(deps, { items: CANNED });
      ctx = islandContext(deps);
    }
    const names = ctx.landmarks.map((l) => l.slug).join(", ");
    return say(
      `Here the coastline has ${ctx.landmarks.length} points: ${names}. One way in, from everyday life since I do not know your ground yet: ${ctx.island.name} is like a pantry by the stove. Where do you want to start?`,
    );
  }
  const text = last.body.toLowerCase();
  // `explore` is tested before `fail`, so `explore failure` marks the canned Failure landmark instead of throwing.
  const explore = /explore\s+([a-z0-9-]+)/.exec(text);
  if (explore) {
    emit({ type: "progress", message: "mark_explored" });
    const out = markExplored(deps, { slug: explore[1], evidence: last.body });
    return say(`That's ${out.name} explored: ${out.explored} of ${out.total}. Want to try it on an example of your own?`);
  }
  if (text.includes("elsewhere") && ctx.elsewhere.length > 0) {
    emit({ type: "progress", message: "point_to" });
    const there = pointTo(deps, { island: ctx.elsewhere[0]!.slug, why: `That lives on ${ctx.elsewhere[0]!.name}.` }, "mentor");
    return say(`In short: it depends. ${there.name} is the place to go deeper; your question goes along.`);
  }
  if (text.includes("confus") || text.includes("困惑")) {
    emit({ type: "progress", message: "loose_end" });
    const landmark = ctx.landmarks.find((l) => text.includes(l.slug) || last.body.includes(l.name))?.slug ?? null;
    looseEnd(deps, { op: "open", kind: "confused", landmark, note: "The reader found this confusing.", evidence: last.body }, "mentor");
    return say(`Noted as something to come back to. Here is ${ctx.island.name} again, in plain terms.`);
  }
  if (text.includes("fail")) throw new Error("stub failure");
  if (text.includes("pin")) {
    emit({ type: "progress", message: "board_write" });
    boardWrite(deps, { op: "add", kind: "note", title: "Analogy", body: `${ctx.island.name} is a pantry by the stove: close, small, and sometimes stale.` }, "mentor");
    return say("Pinned the analogy to the board. Where does it break for you?");
  }
  return say(`Here is more on ${ctx.island.name}, in plain terms. Try it on an example of your own.`);
}

/** Generic parts of any field: the stub's top scale. */
const TOP = ["foundations", "tools", "patterns", "failure-modes", "trade-offs", "practice"];
const ISLETS = ["basics", "mechanics", "edge-cases", "in-practice"];
const title = (slug: string) => slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
const canned = (prefix: string, slug: string) => ({
  slug: `${prefix}${slug}`,
  name: title(slug),
  summary: `The ${slug.replace(/-/g, " ")} of this field.`,
  landmarks: ["what", "why", "when", "limits"].map((l) => ({ slug: l, name: title(l) })),
});

/**
 * No-login cartographer for `serve --stub` and tests, through the same tool: an empty scale → propose_sketch
 * (six canned islands at the top, four islets inside an island, chained by straits, the first as harbour, two seas) ·
 * "rename" → propose_sketch updating the first island's summary · "fail" → throws · else a canned line.
 * A function declaration, not a const: persona.ts imports it while this module may still be evaluating.
 */
export async function cartographerStubTurn({ dbPath, domain, island, emit }: JudgeTurn): Promise<string> {
  const deps = { dbPath, domain, island };
  const ctx = chartContext(deps);
  const say = (text: string) => {
    emit({ type: "text", text });
    return text;
  };
  const last = ctx.thread.findLast((m) => m.role === "you" && m.kind === "text");
  const text = last?.body.toLowerCase() ?? "";
  if (text.includes("fail")) throw new Error("stub failure");
  if (ctx.islands.length === 0) {
    const islands = ctx.scale ? ISLETS.map((s) => canned(`${ctx.scale!.slug}-`, s)) : TOP.map((s) => canned("", s));
    emit({ type: "progress", message: "propose_sketch" });
    proposeSketchTool(deps, {
      islands,
      straits: islands.slice(1).map((isle, i) => ({ from: islands[i]!.slug, to: isle.slug })),
      harbour: islands[0]!.slug,
      seas: [
        { name: "Shallows", islands: islands.slice(0, Math.ceil(islands.length / 2)).map((i) => i.slug) },
        { name: "Deeps", islands: islands.slice(Math.ceil(islands.length / 2)).map((i) => i.slug) },
      ],
      // A domain made from a description alone gets a name: its provisional one, title-cased, says the stub was here.
      ...(!ctx.scale && ctx.domain.provisional ? { name: `${ctx.domain.name.replace(/…$/, "")} (charted)` } : {}),
    });
    return say(`Here is a first sketch of ${ctx.scale ? ctx.scale.name : ctx.domain.name}: ${islands.length} islands. Approve it, or say what to change.`);
  }
  if (text.includes("rename")) {
    const first = ctx.islands[0]!;
    emit({ type: "progress", message: "propose_sketch" });
    proposeSketchTool(deps, { updates: [{ slug: first.slug, summary: `${first.name}, as the reader asked.` }] });
    return say(`I proposed a new summary for ${first.name}. Approve it, or say what to change.`);
  }
  return say(`This scale has ${ctx.islands.length} islands. Say what to add or change.`);
}
