import { test, expect } from "bun:test";
import { readProtocol } from "../../src/server/judge/protocol.ts";

test("the protocol names the states, the five tools, the round shape, and the four-answer rule", () => {
  const text = readProtocol();
  for (const word of ["sandbar", "settled", "mountainous", "reef", "record_verdict", "propose_reef", "island_context", "set_landmarks", "unlock_landmark", "ask_reader", "## 7. Diagrams", "## 8. Asking with options"]) {
    expect(text).toContain(word);
  }
  expect(text).toMatch(/acknowledge/i);
  expect(text).toMatch(/fourth reader answer/i);
  expect(text).toMatch(/verdict first/i);
  expect(text).toMatch(/replace the nudge and the question/i);
  expect(text).not.toContain("bun run src/cli/index.ts");
});
