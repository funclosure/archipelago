import { test, expect } from "bun:test";
import { sentences, leadSplit, cjkPunctuation, questionRuns, threadItems, proposalFromBody, landmarkFromSystem, exploredFromSystem, inlineSegments, mdBlocks, logItems, texLite, askFor, roundOf } from "../../src/web/thread.js";

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
    { type: "p", lines: [[{ type: "text", text: "one" }], [{ type: "text", text: "two" }]], raw: ["one", "two"] },
    { type: "p", lines: [[{ type: "text", text: "three" }]], raw: ["three"] },
  ]);
  expect(mdBlocks("")).toEqual([]);
});

test("mdBlocks parses headings, bullet and numbered lists, and fences, closed or not", () => {
  const blocks = mdBlocks("## Why\n- **first** point\n- second\n1. one\n2) two\n```\nlet x = 1;\n```\ntail");
  expect(blocks.map((b) => b.type)).toEqual(["h", "list", "list", "code", "p"]);
  expect(blocks[0]).toEqual({ type: "h", level: 2, segments: [{ type: "text", text: "Why" }] });
  expect(blocks[1]).toEqual({ type: "list", ordered: false, items: [[{ type: "strong", text: "first" }, { type: "text", text: " point" }], [{ type: "text", text: "second" }]] });
  expect(blocks[2]).toEqual({ type: "list", ordered: true, items: [[{ type: "text", text: "one" }], [{ type: "text", text: "two" }]] });
  expect(blocks[3]).toEqual({ type: "code", lang: "", text: "let x = 1;", closed: true });
  expect(mdBlocks("before\n```js\nstill open")).toEqual([
    { type: "p", lines: [[{ type: "text", text: "before" }]], raw: ["before"] },
    { type: "code", lang: "js", text: "still open", closed: false },
  ]);
  expect(mdBlocks("*emphasis* at the start is not a bullet")).toEqual([
    { type: "p", lines: [[{ type: "em", text: "emphasis" }, { type: "text", text: " at the start is not a bullet" }]], raw: ["*emphasis* at the start is not a bullet"] },
  ]);
});

test("a mermaid fence is a code block with its language, closed only once the fence ends", () => {
  expect(mdBlocks("```mermaid\nflowchart TB\n  A --> B\n```")).toEqual([{ type: "code", lang: "mermaid", text: "flowchart TB\n  A --> B", closed: true }]);
  expect(mdBlocks("```mermaid\nflowchart TB").at(-1)).toMatchObject({ lang: "mermaid", closed: false });
});

test("a fence tag keeps hyphens and is lowercased", () => {
  expect(mdBlocks("```objective-c\n@interface A\n```")[0]).toMatchObject({ lang: "objective-c", text: "@interface A", closed: true });
  expect(mdBlocks("```Swift\nlet x = 1")[0]).toMatchObject({ lang: "swift", closed: false });
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

test("askFor finds the ask attached to a message", () => {
  const asks = [{ id: 1, messageId: 7, options: ["a", "b"], picked: null }, { id: 2, messageId: 9, options: ["c", "d"], picked: "c" }];
  expect(askFor(asks, 9).id).toBe(2);
  expect(askFor(asks, 8)).toBeNull();
  expect(askFor([], 7)).toBeNull();
});

test("askFor returns the latest ask when more than one is attached to the same message", () => {
  const asks = [{ id: 1, messageId: 9, options: ["a", "b"], picked: null }, { id: 2, messageId: 9, options: ["c", "d"], picked: null }];
  expect(askFor(asks, 9).id).toBe(2);
});

test("questionRuns splits sentences and flags the ones that ask", () => {
  expect(questionRuns("You got the shape. Where does it break? Say more.")).toEqual([
    { text: "You got the shape. ", question: false },
    { text: "Where does it break? ", question: true },
    { text: "Say more.", question: false },
  ]);
  expect(questionRuns("What happens on rotation?")).toEqual([{ text: "What happens on rotation?", question: true }]);
  expect(questionRuns("no punctuation at all")).toEqual([{ text: "no punctuation at all", question: false }]);
  expect(questionRuns("Really?! Then what?")).toEqual([{ text: "Really?! ", question: false }, { text: "Then what?", question: true }]);
});

test("mdBlocks parses blockquotes and keeps raw paragraph lines", () => {
  expect(mdBlocks("> Where does it break?\n> second line\n\nIt breaks on rotation.")).toEqual([
    { type: "quote", lines: [[{ type: "text", text: "Where does it break?" }], [{ type: "text", text: "second line" }]] },
    { type: "p", lines: [[{ type: "text", text: "It breaks on rotation." }]], raw: ["It breaks on rotation."] },
  ]);
});

{
  const m = (role, kind, body) => ({ role, kind, body });
  test("roundOf counts every reader answer when nothing is charted", () => {
    expect(roundOf([m("you", "text", "a"), m("judge", "text", "q"), m("you", "text", "b")])).toBe(2);
  });
  test("roundOf restarts after a charted-as line", () => {
    expect(roundOf([m("you", "text", "a"), m("judge", "system", "charted as sandbar"), m("you", "text", "b")])).toBe(1);
  });
  test("roundOf ignores a strait's charted-as line", () => {
    expect(roundOf([m("you", "text", "a"), m("judge", "system", "strait a~b charted as settled"), m("you", "text", "b")])).toBe(2);
  });
}

test("a 'landmark explored' line becomes an explored item, merged with its neighbours and kept apart from lit lines", () => {
  expect(exploredFromSystem("landmark explored: Eviction")).toBe("Eviction");
  expect(exploredFromSystem("landmark lit: Eviction")).toBeNull();
  expect(threadItems([{ id: 1, role: "mentor", kind: "system", body: "landmark explored: Eviction" }])[0]).toMatchObject({ kind: "explored", text: "Eviction" });
  const items = logItems([
    { id: 1, role: "mentor", kind: "system", body: "landmark explored: Eviction" },
    { id: 2, role: "mentor", kind: "system", body: "landmark explored: Invalidation" },
    { id: 3, role: "mentor", kind: "text", body: "That's both." },
    { id: 4, role: "judge", kind: "system", body: "landmark lit: Eviction" },
  ], null);
  expect(items.map((i) => [i.kind, i.names ?? i.text])).toEqual([["explored", ["Eviction", "Invalidation"]], ["text", "That's both."], ["landmark", ["Eviction"]]]);
});

test("sentences join back to the line, keep decimals whole, and cut Chinese without spaces", () => {
  const line = "Pi is 3.14 here. Why? 你好嗎？很好。「對。」然後";
  expect(sentences(line)).toEqual(["Pi is 3.14 here. ", "Why? ", "你好嗎？", "很好。", "「對。」", "然後"]);
  expect(sentences(line).join("")).toBe(line);
  expect(sentences("")).toEqual([]);
});

test("questionRuns flags Chinese questions too, and drops nothing before a decimal point", () => {
  expect(questionRuns("Pi is 3.14 here. Why?").map((r) => r.text).join("")).toBe("Pi is 3.14 here. Why?");
  expect(questionRuns("先想一下。你會怎麼排索引？")).toEqual([
    { text: "先想一下。", question: false },
    { text: "你會怎麼排索引？", question: true },
  ]);
});

test("leadSplit cuts after the first sentence, never inside bold or code", () => {
  expect(leadSplit("First idea. Then more. And more.")).toEqual(["First idea. ", "Then more. And more."]);
  expect(leadSplit("方向是對的。不過只說了一半。")).toEqual(["方向是對的。", "不過只說了一半。"]);
  expect(leadSplit("One sentence only.")).toEqual(["One sentence only.", ""]);
  expect(leadSplit("**Bold. still bold** then.")).toEqual(["**Bold. still bold** then.", ""]);
});

test("cjkPunctuation makes , : ; ( ) beside Chinese full-width, and leaves Latin and code alone", () => {
  expect(cjkPunctuation("五個點:關聯式與 NoSQL,索引(B-tree 與 LSM tree)、以及;其他")).toBe("五個點：關聯式與 NoSQL，索引（B-tree 與 LSM tree）、以及；其他");
  expect(cjkPunctuation("Indexes: B-trees, LSM trees (both)")).toBe("Indexes: B-trees, LSM trees (both)");
  expect(cjkPunctuation("用 `a:b,c` 的寫法,然後")).toBe("用 `a:b,c` 的寫法，然後");
  expect(cjkPunctuation("下午12:30開始")).toBe("下午12:30開始");
  expect(cjkPunctuation("你會用哪個數字?為什麼?真的!")).toBe("你會用哪個數字？為什麼？真的！");
  expect(cjkPunctuation("用 40ms? 還是 p99?")).toBe("用 40ms? 還是 p99?");
});

test("logItems puts a model line before a reply whose model differs from the reply before it", () => {
  const messages = [
    { id: 1, role: "judge", kind: "text", body: "Old.", model: null },
    { id: 2, role: "you", kind: "text", body: "a", model: null },
    { id: 3, role: "judge", kind: "text", body: "New.", model: "gemini-3.8-flash" },
    { id: 4, role: "judge", kind: "system", body: "landmark lit: Hit ratio", model: null },
    { id: 5, role: "judge", kind: "text", body: "Same.", model: "gemini-3.8-flash" },
    { id: 6, role: "judge", kind: "text", body: "Back.", model: "claude-opus-5-5" },
  ];
  expect(logItems(messages, null).map((i) => (i.kind === "model" ? `model:${i.text}` : i.kind))).toEqual(["text", "text", "model:gemini-3.8-flash", "text", "landmark", "text", "model:claude-opus-5-5", "text"]);
  // the landmark the new model lit before its reply sits under its line
  const lit = [messages[0], messages[1], { id: 7, role: "judge", kind: "system", body: "landmark lit: Prefix sums", model: null }, messages[2]];
  expect(logItems(lit, null).map((i) => i.kind)).toEqual(["text", "text", "model", "landmark", "text"]);
  // a thread's first model needs no line, nor does a stub reply (no model)
  expect(logItems([{ id: 1, role: "mentor", kind: "text", body: "Hi.", model: "gemini-3.8-flash" }, { id: 2, role: "mentor", kind: "text", body: "Stub.", model: null }], null).map((i) => i.kind)).toEqual(["text", "text"]);
});

test("texLite writes inline TeX as plain text and leaves prices and code alone", () => {
  expect(texLite("Brute force checks all pairs in $O(n^2)$, a single $O(n)$ pass")).toBe("Brute force checks all pairs in O(n²), a single O(n) pass");
  expect(texLite("$O(n \\log n)$ and $10^9$ and $\\sqrt{n}$ and $a_i \\le S$ and $P_{k+1}$")).toBe("O(n log n) and 10⁹ and √n and aᵢ ≤ S and Pₖ₊₁");
  expect(texLite("$2^{\\text{depth}}$")).toBe("2^depth");
  expect(texLite("costs $5 and $10, or $5-$10")).toBe("costs $5 and $10, or $5-$10");
  expect(texLite("use `$O(n^2)$` literally")).toBe("use `$O(n^2)$` literally");
  expect(texLite("for each $x$ in A")).toBe("for each x in A");
  expect(mdBlocks("in $O(n)$ time")[0].raw).toEqual(["in O(n) time"]);
});
