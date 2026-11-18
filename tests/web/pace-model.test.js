import { describe, expect, test } from "bun:test";
import { PACE_END_CPS, PACE_MAX_CPS, PACE_MIN_CPS, WORD_MAX, paceAdvance, revealCut, revealed, wordCut } from "../../src/web/pace-model.js";
import { openMark } from "../../src/web/thread.js";

describe("paceAdvance", () => {
  test("never runs past what has arrived", () => {
    expect(paceAdvance(0, 10, 10_000, false)).toBe(10);
    expect(paceAdvance(10, 10, 16, false)).toBe(10);
  });
  test("a little waiting comes at the slowest pace; more comes faster, up to the fastest", () => {
    expect(paceAdvance(0, 5, 1000, false)).toBeCloseTo(5);
    expect(paceAdvance(0, 1000, 100, false) - 0).toBeCloseTo((PACE_MAX_CPS * 100) / 1000);
    const few = paceAdvance(0, 20, 100, false);
    const many = paceAdvance(0, 200, 100, false);
    expect(few).toBeCloseTo((PACE_MIN_CPS * 100) / 1000);
    expect(many).toBeGreaterThan(few);
  });
  test("once the reply is whole the rest comes at least at the end pace", () => {
    expect(paceAdvance(0, 50, 100, true)).toBeCloseTo((PACE_END_CPS * 100) / 1000);
  });
});

describe("wordCut", () => {
  test("stops at the end of the word it falls in", () => {
    expect(wordCut("The quick brown fox", 6, false)).toBe(9);
    expect(wordCut("The quick brown fox", 9, false)).toBe(9);
  });
  test("a word still arriving waits for its end, unless the reply is whole", () => {
    expect(wordCut("The quick bro", 12, false)).toBe(9);
    expect(wordCut("The quick bro", 13, false)).toBe(9);
    expect(wordCut("The quick bro", 13, true)).toBe(13);
    expect(wordCut("The quick ", 10, false)).toBe(10);
  });
  test("Chinese is shown a character at a time", () => {
    expect(wordCut("快取是一種", 2, false)).toBe(2);
    expect(wordCut("快取是一種", 5, false)).toBe(5);
  });
  test("a very long word may be shown in parts", () => {
    const long = `see ${"x".repeat(WORD_MAX + 20)} then`;
    expect(wordCut(long, 10, false)).toBe(10);
  });
});

describe("revealed", () => {
  test("a list mark alone waits for its first word", () => {
    expect(revealed("Steps:\n- ", 9, false)).toBe("Steps:\n");
    expect(revealed("Steps:\n- read it", 11, false)).toBe("Steps:\n- read");
    expect(revealed("Intro\n## ", 9, false)).toBe("Intro\n");
  });
  test("a fence's opening line waits until it is whole", () => {
    expect(revealed("Look:\n```merm", 13, false)).toBe("Look:");
    expect(revealed("Look:\n```mermaid\ngraph", 16, false)).toBe("Look:\n```mermaid");
  });
  test("code in a fence is shown as written, with nothing closed", () => {
    expect(revealed("```js\nconst a = `x", 18, false)).toBe("```js\nconst a =");
    expect(revealed("```js\nlet **a", 13, false)).toBe("```js\nlet");
  });
  test("a table's header waits for the line that says it is one, then goes out with it", () => {
    const head = "Compare:\n| a | b |";
    expect(revealed(head, head.length, false)).toBe("Compare:\n");
    expect(revealed(`${head}\n|--`, 20, false)).toBe("Compare:\n");
    const table = `${head}\n|---|---|\n| 1 | 2 |`;
    expect(revealed(table, 14, false)).toBe(`${head}\n|---|---|`);
    expect(revealed(table, table.length, true)).toBe(table);
  });
  test("a row of pipes that is no table reads on as prose", () => {
    const text = "| not a table |\nJust words here and more";
    expect(revealed(text, 26, false)).toBe("| not a table |\nJust words");
  });
  test("an inline mark left open is closed, so it draws as it will", () => {
    expect(revealed("It is **really fast and", 18, false)).toBe("It is **really fast**");
    expect(revealed("Call `cache.get and", 14, false)).toBe("Call `cache.get`");
    expect(revealed("An *idea that", 9, false)).toBe("An *idea*");
  });
  test("the whole text, as it is, once everything is shown", () => {
    const text = "Done **now";
    expect(revealed(text, text.length, true)).toBe(text);
  });
  test("what is shown only ever grows, and ends as the whole reply", () => {
    const reply = [
      "Caching keeps a **copy** of what was read, so the next read is cheap.",
      "",
      "- A hit is served from memory",
      "- A miss goes to `disk` and fills the cache",
      "",
      "| Policy | Evicts |",
      "|:--|--:|",
      "| LRU | the least recently used |",
      "| LFU | the least *often* used |",
      "",
      "```mermaid",
      "graph LR; A-->B",
      "```",
      "",
      "快取的重點是：**命中率**。你覺得呢？",
    ].join("\n");
    // Arrives in uneven bursts; each frame moves the reveal on 16 ms.
    let received = 0;
    let pos = 0;
    let shown = 0;
    const sizes = [3, 40, 1, 1, 90, 7, 200, 2, 30];
    for (let frame = 0; frame < 4000 && (received < reply.length || pos < reply.length); frame++) {
      if (frame % 9 === 0 && received < reply.length) received = Math.min(reply.length, received + sizes[(frame / 9) % sizes.length]);
      const text = reply.slice(0, received);
      const done = received === reply.length;
      pos = paceAdvance(pos, text.length, 16, done);
      const cut = revealCut(text, pos, done);
      expect(cut).toBeGreaterThanOrEqual(shown);
      shown = cut;
    }
    expect(revealed(reply, pos, true)).toBe(reply);
  });
});

describe("openMark", () => {
  test("names the mark a line leaves open, or nothing", () => {
    expect(openMark("plain words")).toBe("");
    expect(openMark("**done** and **open")).toBe("**");
    expect(openMark("a `span")).toBe("`");
    expect(openMark("_quiet words")).toBe("_");
    expect(openMark("snake_case stays")).toBe("");
    expect(openMark("2 * 3")).toBe("");
    expect(openMark("ends **")).toBe("");
  });
});
