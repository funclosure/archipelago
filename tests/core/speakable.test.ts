import { test, expect } from "bun:test";
import { VOICE_MAX, forVoice, speakableText, speechLanguage, spoken } from "../../src/core/speakable.ts";

test("only the prose of a reply is read: fences go, markdown marks go, links keep their words", () => {
  const body = [
    "## Carving",
    "Tip the ski on **edge** and let the *sidecut* steer. See [the turn](https://x.example) above.",
    "",
    "```mermaid",
    "graph LR; a-->b",
    "```",
    "",
    "- first, the `edge`",
    "> a quote",
    "",
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
    "",
    "Where does the speed go?",
  ].join("\n");
  expect(speakableText(body)).toBe("Carving\nTip the ski on edge and let the sidecut steer. See the turn above.\n\nfirst, the edge\na quote\n\na b\n1 2\n\nWhere does the speed go?");
  expect(speakableText("Try it.\n\n```demo\n<div>")).toBe("Try it."); // a fence still open at the end
  expect(speakableText("```js\nx\n```")).toBe("");
  expect(speakableText("snake_case and 2 * 3 * 4 stay")).toBe("snake_case and 2 * 3 * 4 stay");
});

test("a long reply is cut at a sentence end before the cap", () => {
  const long = "One sentence here. ".repeat(400);
  const text = speakableText(long);
  expect(text.length).toBeLessThanOrEqual(VOICE_MAX);
  expect(text.endsWith(".")).toBe(true);
});

test("the language follows the reply: Chinese when a fifth of its letters are", () => {
  expect(speechLanguage("轉彎的時候，重心為什麼要往前？")).toBe("zh");
  expect(speechLanguage("想想看 carving 的時候 edge 怎麼咬住雪面")).toBe("zh");
  expect(speechLanguage("Carve the turn; 弧 is an arc.")).toBe("en");
  expect(forVoice("巴哥", "zh")).toBe("巴哥"); // the map is empty until a word turns up wrong
});

test("notation is said in words for the voice: Big-O, indexing, powers, arrows, comparisons", () => {
  expect(spoken("Read or write a[i]: O(1). A scan is O(n).", "en")).toBe("Read or write a at i: O of 1. A scan is O of n.");
  expect(spoken("Sorting is O(n log n); binary search O(log n).", "en")).toBe("Sorting is O of n log n; binary search O of log n.");
  expect(spoken("Nested loops are O(n^2), pairs O(n²), brute force O(2^n), grids O(n*m).", "en"))
    .toBe("Nested loops are O of n squared, pairs O of n squared, brute force O of 2 to the n, grids O of n times m.");
  expect(spoken("Θ(n) and Ω(1); a[i+1] → a[i]; i ≤ n, j ≥ 0, x ≠ y, 3 × 4.", "en"))
    .toBe("Θ of n and Ω of 1; a at i plus 1 to a at i; i at most n, j at least 0, x is not y, 3 times 4.");
  expect(spoken("O(√n) with n³ steps", "en")).toBe("O of root n with n cubed steps");
  expect(spoken("存取 a[i] 是 O(1)，掃描是 O(n²)。i ≤ n → 結束", "zh")).toBe("存取 a 的第 i 個 是 O of 1，掃描是 O of n 平方。i 小於等於 n 到 結束");
  // words that only look like notation stay
  expect(spoken("Oh (really) and NO(thing) stay; email@a.b too", "en")).toBe("Oh (really) and NO(thing) stay; email@a.b too");
  expect(forVoice("O(1)", "en")).toBe("O of 1");
});
