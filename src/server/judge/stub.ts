import type { JudgeRunner } from "./runner.ts";
import { islandContext, proposeReef, recordVerdict } from "./tools.ts";

/**
 * No-login judge for `serve --stub` and tests. Reads the thread, reacts to a keyword in the reader's
 * last message, and writes through the same tool functions the SDK runner uses:
 *   "settled" → record_verdict settled · "reef" → propose_reef · "fail" → throws · else a canned follow-up.
 */
export const stubRunner: JudgeRunner = async ({ dbPath, domain, island, emit }) => {
  const deps = { dbPath, domain, island };
  const ctx = islandContext(deps);
  const last = [...ctx.thread].reverse().find((m) => m.role === "you");
  const say = (text: string) => {
    emit({ type: "text", text });
    return text;
  };
  if (!last) return say(`Tell me how ${ctx.island.name} works, in your own words, and where it breaks.`);
  const text = last.body.toLowerCase();
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
  return say(`Say more about ${ctx.island.name}.`);
};
