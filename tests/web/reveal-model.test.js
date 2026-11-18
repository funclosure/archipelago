import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FADE_LAG_MS, FADE_MS, FADE_SPREAD_MS, FADE_STEP_MS, WORD_MAX, arrive, revealed, shownCut, wordEnd, wordsIn } from "../../src/web/reveal-model.js";
import { openMark } from "../../src/web/thread.js";

describe("wordEnd", () => {
  test("a word still arriving waits for its end, unless the reply is whole", () => {
    expect(wordEnd("The quick bro", false)).toBe(9);
    expect(wordEnd("The quick bro", true)).toBe(13);
    expect(wordEnd("The quick ", false)).toBe(9);
    expect(wordEnd("The quick\n\n", false)).toBe(9);
    expect(wordEnd("", false)).toBe(0);
  });
  test("Chinese runs on a character at a time", () => {
    expect(wordEnd("快取是一種", false)).toBe(5);
    expect(wordEnd("快取 is", false)).toBe(2);
  });
  test("a very long word may be shown in parts", () => {
    const long = `see ${"x".repeat(WORD_MAX + 20)}`;
    expect(wordEnd(long, false)).toBe(long.length - WORD_MAX);
  });
});

describe("revealed", () => {
  test("a list mark alone waits for its first word", () => {
    expect(revealed("Steps:\n- ", false)).toBe("Steps:\n");
    expect(revealed("Steps:\n- read it", false)).toBe("Steps:\n- read");
    expect(revealed("Intro\n## ", false)).toBe("Intro\n");
  });
  test("a fence's opening line waits until it is whole", () => {
    expect(revealed("Look:\n```merm", false)).toBe("Look:");
    expect(revealed("Look:\n```mermaid\ngraph", false)).toBe("Look:\n```mermaid");
  });
  test("code in a fence is shown as written, with nothing closed", () => {
    expect(revealed("```js\nconst a = `x", false)).toBe("```js\nconst a =");
    expect(revealed("```js\nlet **a", false)).toBe("```js\nlet");
  });
  test("a table's header waits for the line that says it is one, then goes out with it", () => {
    const head = "Compare:\n| a | b |";
    expect(revealed(head, false)).toBe("Compare:\n");
    expect(revealed(`${head}\n|--`, false)).toBe("Compare:\n");
    expect(revealed(`${head}\n|---|---|\n| 1 | 2`, false)).toBe(`${head}\n|---|---|\n| 1 |`);
    const table = `${head}\n|---|---|\n| 1 | 2 |`;
    expect(revealed(table, true)).toBe(table);
  });
  test("a row of pipes that is no table reads on as prose", () => {
    expect(revealed("| not a table |\nJust words here", false)).toBe("| not a table |\nJust words");
  });
  test("an inline mark left open is closed, so it draws as it will", () => {
    expect(revealed("It is **really fast and", false)).toBe("It is **really fast**");
    expect(revealed("Call `cache.get and", false)).toBe("Call `cache.get`");
    expect(revealed("An *idea that", false)).toBe("An *idea*");
  });
  test("the whole text, as it is, once the reply is whole", () => {
    expect(revealed("Done **now", true)).toBe("Done **now");
  });
  test("what is shown only ever grows as the reply arrives, and ends as the whole reply", () => {
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
    // Every prefix, as uneven bursts or a character at a time would bring it.
    let shown = 0;
    for (let n = 0; n <= reply.length; n++) {
      const cut = shownCut(reply.slice(0, n), false);
      expect(cut).toBeGreaterThanOrEqual(shown);
      shown = cut;
    }
    expect(revealed(reply, true)).toBe(reply);
  });
});

describe("wordsIn", () => {
  test("words between two places, whitespace left out", () => {
    expect(wordsIn("ab cd  ef", 0, 9)).toEqual([[0, 2], [3, 5], [7, 9]]);
    expect(wordsIn("ab cd ef", 3, 8)).toEqual([[3, 5], [6, 8]]);
    expect(wordsIn("ab cd", 1, 5)).toEqual([[1, 2], [3, 5]]);
    expect(wordsIn("   ", 0, 3)).toEqual([]);
  });
  test("a wide character is a word of its own", () => {
    expect(wordsIn("快取 is", 0, 5)).toEqual([[0, 1], [1, 2], [3, 5]]);
  });
});

describe("arrive", () => {
  test("a block's first words start one after another from now", () => {
    const { record, wave } = arrive(undefined, "one two three", 1000);
    expect(record.words.map((w) => [w.from, w.to])).toEqual([[0, 3], [4, 7], [8, 13]]);
    expect(record.words.map((w) => w.start)).toEqual([1000, 1000 + FADE_STEP_MS, 1000 + 2 * FADE_STEP_MS]);
    expect(wave).toBe(1000 + 3 * FADE_STEP_MS);
  });
  test("a long burst sweeps in within the spread, however many words", () => {
    const text = Array.from({ length: 300 }, (_, i) => `w${i}`).join(" ");
    const { record } = arrive(undefined, text, 0);
    expect(record.words.at(-1).start).toBeLessThan(FADE_SPREAD_MS);
    expect(record.words.at(-1).start).toBeGreaterThan(FADE_SPREAD_MS * 0.9);
  });
  test("drawn again, what it showed keeps its timing and only the new words start now", () => {
    const first = arrive(undefined, "one two", 1000);
    const second = arrive(first.record, "one two three", 1100, first.wave);
    expect(second.record.words.slice(0, 2)).toEqual(first.record.words);
    expect(second.record.words[2]).toEqual({ from: 8, to: 13, start: 1100 });
  });
  test("words done fading are forgotten; a text that changed fades again from where it changed", () => {
    const first = arrive(undefined, "cost is $O(n", 0);
    const later = arrive(first.record, "cost is O(n²)", FADE_MS + 100, first.wave);
    expect(later.record.words).toEqual([{ from: 8, to: 13, start: FADE_MS + 100 }]);
  });
  test("new words wait for those still sweeping in before them, but never long", () => {
    const first = arrive(undefined, "one two three four", 0);
    const next = arrive(undefined, "five", 10, first.wave);
    expect(next.record.words[0].start).toBe(first.wave);
    const far = arrive(undefined, "six", 0, 5000);
    expect(far.record.words[0].start).toBe(FADE_LAG_MS);
  });
  test("the same text drawn again (a theme change) starts nothing new", () => {
    const first = arrive(undefined, "one two", 0);
    const again = arrive(first.record, "one two", 100, first.wave);
    expect(again.record.words).toEqual(first.record.words);
    expect(again.wave).toBe(first.wave);
  });
  test("the fade lasts as long as styles.css says", () => {
    const css = readFileSync(new URL("../../src/web/styles.css", import.meta.url), "utf8");
    expect(css.match(/--t-fade:\s*(\d+)ms/)?.[1]).toBe(String(FADE_MS));
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
