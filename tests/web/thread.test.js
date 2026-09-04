import { test, expect } from "bun:test";
import { threadItems, proposalFromBody, landmarkFromSystem, inlineSegments, mdBlocks, logItems } from "../../src/web/thread.js";

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

test("a 'landmark lit' system message becomes a landmark item; other system lines stay system", () => {
  expect(landmarkFromSystem("landmark lit: Hit ratio")).toBe("Hit ratio");
  expect(landmarkFromSystem("charted as settled")).toBeNull();
  const items = threadItems([
    { id: 1, role: "judge", kind: "system", body: "landmark lit: Hit ratio" },
    { id: 2, role: "judge", kind: "system", body: "charted as settled" },
  ]);
  expect(items.map((i) => [i.kind, i.text])).toEqual([["landmark", "Hit ratio"], ["system", "charted as settled"]]);
});

test("inlineSegments renders strong, em, and code, and leaves unmatched markers literal", () => {
  expect(inlineSegments("plain")).toEqual([{ type: "text", text: "plain" }]);
  expect(inlineSegments("**1. Bottleneck analysis first.** Look at CPU")).toEqual([
    { type: "strong", text: "1. Bottleneck analysis first." },
    { type: "text", text: " Look at CPU" },
  ]);
  expect(inlineSegments("that charts *transactions* and _contention_ via `cache-aside`")).toEqual([
    { type: "text", text: "that charts " },
    { type: "em", text: "transactions" },
    { type: "text", text: " and " },
    { type: "em", text: "contention" },
    { type: "text", text: " via " },
    { type: "code", text: "cache-aside" },
  ]);
  expect(inlineSegments("an **unclosed marker")).toEqual([{ type: "text", text: "an **unclosed marker" }]);
  expect(inlineSegments("2 * 3 * 4 and snake_case_name")).toEqual([{ type: "text", text: "2 * 3 * 4 and snake_case_name" }]);
  expect(inlineSegments("")).toEqual([]);
});

test("mdBlocks splits paragraphs on blank lines and keeps single newlines as line breaks", () => {
  expect(mdBlocks("one\ntwo\n\nthree\n")).toEqual([
    { type: "p", lines: [[{ type: "text", text: "one" }], [{ type: "text", text: "two" }]] },
    { type: "p", lines: [[{ type: "text", text: "three" }]] },
  ]);
  expect(mdBlocks("")).toEqual([]);
});

test("mdBlocks parses headings, bullet and numbered lists, and fences, closed or not", () => {
  const blocks = mdBlocks("## Why\n- **first** point\n- second\n1. one\n2) two\n```\nlet x = 1;\n```\ntail");
  expect(blocks.map((b) => b.type)).toEqual(["h", "list", "list", "code", "p"]);
  expect(blocks[0]).toEqual({ type: "h", level: 2, segments: [{ type: "text", text: "Why" }] });
  expect(blocks[1]).toEqual({ type: "list", ordered: false, items: [[{ type: "strong", text: "first" }, { type: "text", text: " point" }], [{ type: "text", text: "second" }]] });
  expect(blocks[2]).toEqual({ type: "list", ordered: true, items: [[{ type: "text", text: "one" }], [{ type: "text", text: "two" }]] });
  expect(blocks[3]).toEqual({ type: "code", text: "let x = 1;" });
  expect(mdBlocks("before\n```js\nstill open")).toEqual([
    { type: "p", lines: [[{ type: "text", text: "before" }]] },
    { type: "code", text: "still open" },
  ]);
  expect(mdBlocks("*emphasis* at the start is not a bullet")).toEqual([
    { type: "p", lines: [[{ type: "em", text: "emphasis" }, { type: "text", text: " at the start is not a bullet" }]] },
  ]);
});

test("mdBlocks never loses text on partial input", () => {
  const full = "Measuring first is the **right instinct**, and you named it.\n\n- one\n- tw";
  for (let i = 0; i <= full.length; i++) {
    const text = full.slice(0, i);
    const flat = mdBlocks(text)
      .flatMap((b) => (b.type === "p" ? b.lines.flat() : b.type === "list" ? b.items.flat() : b.type === "h" ? b.segments : [{ type: "text", text: b.text }]))
      .map((s) => s.text)
      .join("");
    // markers and structure characters are the only things allowed to disappear
    expect(flat.replace(/[*_`#\-\s]/g, "")).toBe(text.replace(/[*_`#\-\s]/g, ""));
  }
});

test("logItems merges consecutive lit lines and turns only the last 'charted as' line into a verdict card", () => {
  const verdict = { state: "settled", confidence: 0.82, evidence: "e", rationale: "r", at: "2026-09-04T10:00:00Z" };
  const messages = [
    { id: 1, role: "judge", kind: "text", body: "Explain." },
    { id: 2, role: "you", kind: "text", body: "answer" },
    { id: 3, role: "judge", kind: "system", body: "landmark lit: Statelessness" },
    { id: 4, role: "judge", kind: "system", body: "landmark lit: Bottleneck analysis" },
    { id: 5, role: "judge", kind: "system", body: "charted as sandbar" },
    { id: 6, role: "judge", kind: "system", body: "landmark lit: Elasticity" },
    { id: 7, role: "judge", kind: "text", body: "Reply." },
    { id: 8, role: "judge", kind: "system", body: "charted as settled" },
  ];
  const items = logItems(messages, { verdict });
  expect(items.map((i) => i.kind)).toEqual(["text", "text", "landmark", "system", "landmark", "text", "verdict"]);
  expect(items[2].names).toEqual(["Statelessness", "Bottleneck analysis"]);
  expect(items[3].text).toBe("charted as sandbar");
  expect(items[4].names).toEqual(["Elasticity"]);
  expect(items[6].verdict).toBe(verdict);
  // without a verdict on the island the line stays a system line
  expect(logItems(messages, { verdict: null }).map((i) => i.kind)).toEqual(["text", "text", "landmark", "system", "landmark", "text", "system"]);
});
