// The conformance script's checks, and one whole run of its script on the stub (whose replies break the rules on purpose).
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkTurn, cjkShare, hasTex, leakedSlugs, questionMarks, runScript, SCRIPT, simplified, worst, type Observed, type Turn } from "../../scripts/conformance.ts";

test("questions are counted in prose only, half- and full-width, never in code or URLs", () => {
  expect(questionMarks("Why? 為什麼？")).toBe(2);
  expect(questionMarks("Look:\n```js\nconst a = b ?? c ? 1 : 2;\n```\nWhat prints?")).toBe(1);
  expect(questionMarks("See https://x.dev/a?b=1 and `x?.y`. Which one?")).toBe(1);
  // A placeholder in SQL quoted without backticks is not a question; the sentence after it is.
  expect(questionMarks("查詢是「WHERE user_id = ? AND status = 'paid'」，目前完全沒有索引。你會怎麼設計索引？")).toBe(1);
  expect(questionMarks("Run INSERT INTO t VALUES (?, ?) twice. What breaks?")).toBe(1);
  expect(questionMarks("首頁的 key 會怎麼樣？你會選哪一種淘汰策略？")).toBe(2);
  expect(questionMarks("Is it *fresh?* Or stale?!")).toBe(2);
});

test("the CJK share ignores code and punctuation", () => {
  expect(cjkShare("命中率是 hit ratio")).toBeCloseTo(4 / 12);
  expect(cjkShare("All English here.")).toBe(0);
  expect(cjkShare("中文\n```swift\nlet cache = NSCache()\n```")).toBe(1);
});

test("only hyphenated slugs count as leaked, as whole words outside code", () => {
  const slugs = ["hit-ratio", "eviction", "cache-stampede"];
  expect(leakedSlugs("The hit-ratio falls; eviction runs.", slugs)).toEqual(["hit-ratio"]);
  expect(leakedSlugs("A `cache-stampede` in code, and a cache-stampeded word.", slugs)).toEqual([]);
});

test("TeX is inline dollars or a backslash command; prices are not", () => {
  expect(hasTex("It is $O(n^2)$ overall.")).toBe(true);
  expect(hasTex("roughly \\frac{1}{2} of it")).toBe(true);
  expect(hasTex("It costs $5 and then $10 more.")).toBe(false);
  expect(hasTex("O(n²) in plain text")).toBe(false);
});

test("Simplified characters are caught; Traditional ones are not", () => {
  expect(simplified("这个问题")).toEqual(["这", "问", "题"]);
  expect(simplified("這個問題")).toEqual([]);
});

test("checkTurn fails the hard rules, warns on judgement, and passes a clean turn", () => {
  const turn: Turn = { id: "t", mode: "judge", domain: "sd", island: "caching", lang: "en", require: ["unlock_landmark"], hope: ["propose_reef"], forbid: ["island_context"] };
  const clean: Observed = {
    reply: "You said the ratio falls as the working set grows. What happens when the cache is cold?",
    tools: ["unlock_landmark", "propose_reef"], error: null, slugs: ["hit-ratio"], quotes: [{ what: "lit hit-ratio", verbatim: true }], refused: [], decided: false,
  };
  expect(worst(checkTurn(turn, clean))).toBe("pass");
  expect(worst(checkTurn(turn, { ...clean, tools: ["unlock_landmark"] }))).toBe("warn");
  expect(worst(checkTurn(turn, { ...clean, tools: ["island_context", "unlock_landmark", "propose_reef"] }))).toBe("warn");
  const bad = checkTurn(turn, { ...clean, tools: [], reply: "The hit-ratio is $h/n$. Why? And how?", quotes: [{ what: "lit hit-ratio", verbatim: false }], refused: ["unlock_landmark: no landmark x"] });
  const says = bad.filter((c) => c.level === "fail").map((c) => c.say);
  expect(says).toEqual([
    "did not call unlock_landmark",
    "tool refused: unlock_landmark: no landmark x",
    "lit hit-ratio: evidence is not a verbatim quote",
    "2 question marks (at most 1)",
    "slugs in the reply: hit-ratio",
    "TeX in the reply",
  ]);
  expect(checkTurn(turn, { ...clean, error: "rate limited" })).toEqual([{ level: "fail", say: "turn failed: rate limited" }]);
  expect(checkTurn({ ...turn, decided: true }, clean).some((c) => c.say.startsWith("no verdict"))).toBe(true);
});

test("an image turn fails when it lit a landmark or decided anything from the image", () => {
  const turn: Turn = { id: "t", mode: "judge", domain: "sd", island: "indexes", lang: "en", images: ["b-tree-lookup.png"], lightsNothing: true };
  const looked: Observed = { reply: "I see a lookup for 45 through the root. Can you say in a sentence why it reads two pages?", tools: [], error: null, slugs: [], quotes: [], refused: [], decided: false, lit: [], decidedNow: false };
  expect(worst(checkTurn(turn, looked))).toBe("pass");
  const fails = checkTurn(turn, { ...looked, lit: ["b-tree"], decidedNow: true }).filter((c) => c.level === "fail").map((c) => c.say);
  expect(fails).toEqual(["lit b-tree from an image", "decided from an image"]);
});

test("the whole script runs on the stub, and its English, slug-naming replies fail", async () => {
  const dir = mkdtempSync(join(tmpdir(), "archipelago-conformance-test-"));
  try {
    const result = await runScript("stub", dir);
    expect(result.model).toBeNull();
    expect(result.turns.map((t) => t.id)).toEqual(SCRIPT.map((t) => t.id));
    expect(result.turns[0]!.tools).toContain("set_landmarks");
    expect(result.turns.at(-1)!.tools).toContain("propose_sketch"); // the new domain's slug was found
    expect(result.turns[1]!.checks.some((c) => c.say.startsWith("slugs in the reply"))).toBe(true);
    expect(result.turns.every((t) => !t.checks.some((c) => c.say.startsWith("turn failed")))).toBe(true);
    // The image reached the persona: the stub says how many it was shown, and lit nothing from it.
    const image = result.turns.find((t) => t.id === "judge: an answer as an image alone")!;
    expect(image.reply.startsWith("I see 1 image.")).toBe(true);
    expect(image.checks.some((c) => c.say.endsWith("from an image"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
