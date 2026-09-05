import type { Database } from "bun:sqlite";
import { openDatabase } from "../../core/db.ts";
import { listAsks } from "../../core/repositories/askRepository.ts";
import type { JudgeRunner } from "./runner.ts";
import { askReader, islandContext, proposeReef, recordVerdict, setLandmarks, unlockLandmark } from "./tools.ts";

/** Mirrors tools.ts's private helper: each call opens and closes the database, like every request. */
function withDb<T>(dbPath: string | undefined, fn: (db: Database) => T): T {
  const db = openDatabase(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const CANNED = [
  { slug: "shape", name: "Shape" }, { slug: "scale", name: "Scale" }, { slug: "failure", name: "Failure" }, { slug: "tradeoff", name: "Tradeoff" },
];

/**
 * No-login judge for `serve --stub` and tests. Reads the thread, reacts to a keyword in the reader's
 * last message, and writes through the same tool functions the SDK runner uses:
 *   first open on a landmark-less island → set_landmarks (four canned) · "unlock <slug>" → unlock_landmark ·
 *   "the first option" (once asked) → unlock_landmark "shape" · the second answer, unasked → ask_reader (canned) ·
 *   "fail" → throws · "reef" → propose_reef · "settled" → record_verdict settled · else a canned follow-up.
 */
export const stubRunner: JudgeRunner = async ({ dbPath, domain, island, emit }) => {
  const deps = { dbPath, domain, island };
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
  // A second answer that matched none of the keywords above gets a canned ask, once.
  const answers = ctx.thread.filter((m) => m.role === "you" && m.kind === "text").length;
  if (answers === 2 && withDb(dbPath, (db) => listAsks(db, ctx.islandId).length) === 0) {
    emit({ type: "progress", message: "ask_reader" });
    askReader(deps, { question: "Stub check: which of these is true?", options: ["the first option", "the second option", "the third option"] });
    return say("Stub check: which of these is true?");
  }
  return say(`Say more about ${ctx.island.name}.`);
};
