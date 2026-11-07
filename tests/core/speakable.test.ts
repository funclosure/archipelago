import { test, expect } from "bun:test";
import { VOICE_MAX, forVoice, speakableText, speechLanguage } from "../../src/core/speakable.ts";

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
