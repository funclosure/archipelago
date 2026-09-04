import { test, expect } from "bun:test";
import { readProtocol } from "../../src/server/judge/protocol.ts";

test("the protocol names the four states, the three tools, and the teaching rule", () => {
  const text = readProtocol();
  for (const word of ["sandbar", "settled", "mountainous", "reef", "record_verdict", "propose_reef", "island_context"]) {
    expect(text).toContain(word);
  }
  expect(text).toMatch(/verdict first/i);
  expect(text).not.toContain("bun run src/cli/index.ts");
});
