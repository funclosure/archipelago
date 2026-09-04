import { test, expect } from "bun:test";
import { threadItems, proposalFromBody, paragraphs } from "../../src/web/thread.js";

const proposal = { target: "island:caching", claim: "never stale", consequence: "stale prices", evidence: "q", confidence: 0.7, rationale: "r", status: "pending" };

test("proposalFromBody parses a proposal and rejects anything else", () => {
  expect(proposalFromBody(JSON.stringify(proposal))).toEqual(proposal);
  expect(proposalFromBody("not json")).toBeNull();
  expect(proposalFromBody(JSON.stringify({ claim: "x" }))).toBeNull();
});

test("threadItems keeps order, parses proposals, and degrades a broken proposal to text", () => {
  const items = threadItems([
    { id: 1, role: "judge", kind: "text", body: "Explain caching." },
    { id: 2, role: "you", kind: "text", body: "hot data" },
    { id: 3, role: "judge", kind: "system", body: "charted as sandbar" },
    { id: 4, role: "judge", kind: "reef_proposal", body: JSON.stringify(proposal) },
    { id: 5, role: "judge", kind: "reef_proposal", body: "{broken" },
  ]);
  expect(items.map((i) => [i.id, i.kind])).toEqual([[1, "text"], [2, "text"], [3, "system"], [4, "reef_proposal"], [5, "text"]]);
  expect(items[3].proposal).toEqual(proposal);
  expect(items[4].text).toBe("{broken");
});

test("paragraphs splits on blank lines and drops empties", () => {
  expect(paragraphs("one\n\ntwo\n \n\nthree\n")).toEqual(["one", "two", "three"]);
  expect(paragraphs("")).toEqual([]);
});
