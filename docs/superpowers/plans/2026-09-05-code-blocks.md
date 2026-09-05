# Code Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The judge writes fenced code in its replies under a protocol rule, and the page colours it with shiki in Contour's palette, with a language caption and a Copy button.

**Architecture:** The server bundles shiki once per process with `Bun.build` and serves it at `/vendor/shiki.js` with an ETag. The page imports it dynamically; a pure module (`code-model.js`) holds the alias table, the sentinel theme, and the token-to-span mapping, and a DOM module (`code.js`) owns the highlighter, the cache, and the block element. Colours are CSS variables beside the palette tokens. The protocol gains §9 Code; the stub judge writes a canned Swift fence.

**Tech Stack:** Bun, `Bun.build`, shiki 3 (`shiki/core`, `shiki/engine/javascript`, `@shikijs/langs/*`), plain ES modules on the page, `bun test`.

**Spec:** `docs/superpowers/specs/2026-09-05-code-blocks-design.md`

## Global Constraints

- Tests run with `bun test` only (never vitest). Typecheck with `bunx tsc --noEmit`.
- The page has no framework, no bundler, no `innerHTML`. Every DOM node is built with `createElement`/`textContent`/`append`.
- The page's own files stay unbundled. The only bundled artifact is the vendor file `/vendor/shiki.js`, built in-process by `Bun.build` from `src/server/vendor/shiki-entry.js`; CLAUDE.md records this exception.
- Languages, exactly these eleven and no on-demand loading: `swift`, `objective-c`, `kotlin`, `typescript`, `tsx`, `javascript`, `json`, `bash`, `python`, `sql`, `yaml`.
- Slots, in order: `fg`, `keyword`, `string`, `comment`, `type`, `number`. Slot *i* (0-based) has sentinel colour `#00000<i+1>` (`#000001` … `#000006`). CSS variables `--code-fg: var(--text); --code-keyword: var(--lamp); --code-string: var(--sand-fill); --code-comment: var(--muted); --code-type: var(--snow); --code-number: var(--grass);` in `:root` beside the palette.
- Aliases: `swiftui`→`swift`, `objc`→`objective-c`, `js`→`javascript`, `ts`→`typescript`, `sh`/`shell`/`zsh`→`bash`, `py`→`python`, `yml`→`yaml`, `jsonc`→`json`. Unknown language: plain text, caption still shown.
- Labels: `swift`→`Swift`, `objective-c`→`Objective-C`, `kotlin`→`Kotlin`, `typescript`→`TypeScript`, `tsx`→`TSX`, `javascript`→`JavaScript`, `json`→`JSON`, `bash`→`Bash`, `python`→`Python`, `sql`→`SQL`, `yaml`→`YAML`; an unknown tag is shown as typed; an empty tag is `code`.
- Copy: button text `Copy`, then `Copied` for 1.5 s. The button exists only when `navigator.clipboard` exists.
- Closed blocks cache their spans by `lang + "\n" + text` in a Map capped at 64 entries, oldest evicted. Open blocks tokenize every frame.
- Protocol §9 rule, verbatim values: three shapes *predict*, *find*, *fix*; three to twelve lines; one fence per reply, code or diagram, never both; never in the opening turn; the fence does not count toward the 120 words.
- Stub: a reader message containing `code` gets a reply with a six-line `swift` fence and a question.
- Commit trailers on every commit:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CRzNtnhqVcygozGdKkfExq
  ```

---

## File structure

| File | Responsibility |
|---|---|
| `src/server/vendor/shiki-entry.js` (new) | The bundle entry: re-exports shiki's core, the JS engine, and the eleven grammars. |
| `src/server/vendor.ts` (new) | `shikiBundle()`: builds the entry once per process, returns `{ body, etag }`. |
| `src/server/routes.ts` | `GET /vendor/shiki.js` beside the mermaid route: ETag, 304. |
| `src/server/judge/PROTOCOL.md` | §2 exception, §7 one-fence line, new §9 Code. |
| `src/server/judge/stub.ts` | Canned Swift fence on a message containing `code`. |
| `src/web/thread.js` | Fence tag accepts hyphens and is lowercased. |
| `src/web/code-model.js` (new, pure) | `SLOTS`, `SENTINELS`, `LANGS`, `contourTheme`, `resolveLang`, `labelOf`, `spansOf`. |
| `src/web/code.js` (new, DOM) | `loadHighlighter(onReady)`, `codeElement(tag, text, closed)`, the span cache, Copy. |
| `src/web/markdown.js` | Non-mermaid fences go through `codeElement`. |
| `src/web/card.js` | `installCard` calls `loadHighlighter(() => render())`. |
| `src/web/styles.css` | `--code-*` tokens, `.codeblock`, `.tok-*`. |
| `CLAUDE.md` | The bundling exception and the code-block conventions. |
| Tests | `tests/server/routes.test.ts`, `tests/server/protocol.test.ts`, `tests/server/stub.test.ts`, `tests/web/code-model.test.js`, `tests/web/thread.test.js`. |

---

### Task 1: The shiki vendor bundle and its route

**Files:**
- Modify: `package.json` (dependency)
- Create: `src/server/vendor/shiki-entry.js`
- Create: `src/server/vendor.ts`
- Modify: `src/server/routes.ts:25-49`
- Test: `tests/server/routes.test.ts` (after the mermaid test, line 371)

**Interfaces:**
- Produces: `shikiBundle(): Promise<{ body: string; etag: string }>` in `src/server/vendor.ts`; the route `GET /vendor/shiki.js`. The bundle's ESM exports: `createHighlighterCoreSync`, `createJavaScriptRegexEngine`, and one grammar per language named `swift`, `objectiveC`, `kotlin`, `typescript`, `tsx`, `javascript`, `json`, `bash`, `python`, `sql`, `yaml`. Task 4 imports these.

- [ ] **Step 1: Add the dependency**

Run from the project root:

```bash
bun add shiki@^3
```

Expected: `package.json` gains `"shiki": "^3.x"` under `dependencies`; `node_modules/@shikijs/langs/dist/swift.mjs` exists.

- [ ] **Step 2: Write the failing route test**

Append to `tests/server/routes.test.ts` after the mermaid test:

```ts
test("shiki is bundled and served from the vendor route with an ETag", async () => {
  const r = await fetch(`${base}/vendor/shiki.js`);
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toContain("javascript");
  const etag = r.headers.get("etag");
  expect(etag).toMatch(/^"[0-9a-f]+"$/);
  const body = await r.text();
  expect(body.length).toBeGreaterThan(500000);
  expect(body).toContain("createHighlighterCoreSync");
  const again = await fetch(`${base}/vendor/shiki.js`, { headers: { "if-none-match": etag! } });
  expect(again.status).toBe(304);
  expect(await again.text()).toBe("");
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `bun test tests/server/routes.test.ts -t "shiki"`
Expected: FAIL, status 404 (the static handler finds no file).

- [ ] **Step 4: Write the entry file**

Create `src/server/vendor/shiki-entry.js`:

```js
// The one bundled artifact the page loads: shiki's sync core, its JavaScript regex engine, and the
// eleven grammars the judge may use. Built once per process by `shikiBundle()` and served at
// /vendor/shiki.js. Add a language here and in `LANGS` in src/web/code-model.js together.
export { createHighlighterCoreSync } from "shiki/core";
export { createJavaScriptRegexEngine } from "shiki/engine/javascript";
export { default as swift } from "@shikijs/langs/swift";
export { default as objectiveC } from "@shikijs/langs/objective-c";
export { default as kotlin } from "@shikijs/langs/kotlin";
export { default as typescript } from "@shikijs/langs/typescript";
export { default as tsx } from "@shikijs/langs/tsx";
export { default as javascript } from "@shikijs/langs/javascript";
export { default as json } from "@shikijs/langs/json";
export { default as bash } from "@shikijs/langs/bash";
export { default as python } from "@shikijs/langs/python";
export { default as sql } from "@shikijs/langs/sql";
export { default as yaml } from "@shikijs/langs/yaml";
```

- [ ] **Step 5: Write the bundler**

Create `src/server/vendor.ts`:

```ts
import { fileURLToPath } from "node:url";

const ENTRY = fileURLToPath(new URL("./vendor/shiki-entry.js", import.meta.url));

export type VendorBundle = { body: string; etag: string };

let bundle: Promise<VendorBundle> | null = null;

/**
 * shiki, bundled once per process from `src/server/vendor/shiki-entry.js`. The page has no bundler;
 * shiki's ESM uses bare specifiers across seven packages, so this is the one place the server builds
 * anything. A failed build rejects with the bundler's messages and is retried on the next request.
 */
export function shikiBundle(): Promise<VendorBundle> {
  if (!bundle) {
    bundle = build().catch((error) => {
      bundle = null;
      throw error;
    });
  }
  return bundle;
}

async function build(): Promise<VendorBundle> {
  const result = await Bun.build({ entrypoints: [ENTRY], target: "browser", format: "esm", minify: true });
  if (!result.success || result.outputs.length === 0) {
    throw new Error(`shiki bundle failed: ${result.logs.map((l) => l.message).join("; ")}`);
  }
  const body = await result.outputs[0].text();
  return { body, etag: `"${Bun.hash(body).toString(16)}"` };
}
```

- [ ] **Step 6: Serve it**

In `src/server/routes.ts`, add the import beside the others at the top:

```ts
import { shikiBundle } from "./vendor.ts";
```

Replace the mermaid block in `handleRequest`:

```ts
    if (route === "GET /vendor/mermaid.js") {
      return new Response(Bun.file(MERMAID_PATH), { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" } });
    }
```

with:

```ts
    if (route === "GET /vendor/mermaid.js") {
      return new Response(Bun.file(MERMAID_PATH), { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" } });
    }
    if (route === "GET /vendor/shiki.js") {
      const { body, etag } = await shikiBundle();
      const headers = { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", ETag: etag };
      if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
      return new Response(body, { headers });
    }
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `bun test tests/server/routes.test.ts && bunx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock src/server/vendor/shiki-entry.js src/server/vendor.ts src/server/routes.ts tests/server/routes.test.ts
git commit -m "feat(server): bundle shiki once per process and serve it at /vendor/shiki.js with an ETag

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CRzNtnhqVcygozGdKkfExq"
```

(`bun.lock` is the lockfile name if `bun add` wrote one; use `bun.lockb` if that is what exists. `git status` shows which.)

---

### Task 2: Protocol §9 Code and the stub's canned fence

**Files:**
- Modify: `src/server/judge/PROTOCOL.md` (§2 line 38, §7 line 74, new §9 after §8)
- Modify: `src/server/judge/stub.ts:62-68`
- Modify: `CLAUDE.md:48`
- Test: `tests/server/protocol.test.ts`, `tests/server/stub.test.ts`

**Interfaces:**
- Produces: nothing code-facing. The stub's fence is what the hand check in Task 4 uses: send the message `show me code`.

- [ ] **Step 1: Write the failing tests**

In `tests/server/protocol.test.ts`, add `"## 9. Code"` to the list of words in the existing test, and add a second test:

```ts
test("§9 sets the code rule: three shapes, three to twelve lines, one fence per reply, never in the opening", () => {
  const text = readProtocol();
  const nine = text.slice(text.indexOf("## 9. Code"));
  for (const word of ["predict", "find", "fix", "three to twelve lines", "not both", "Never in the opening turn"]) expect(nine).toContain(word);
  expect(text).toContain("except one diagram or code fence");
});
```

Append to `tests/server/stub.test.ts`:

```ts
test("a message containing 'code' gets a reply with a six-line swift fence", async () => {
  await turn();
  const { reply } = await turn("show me code");
  const fence = /```swift\n([\s\S]*?)\n```/.exec(reply);
  expect(fence).not.toBeNull();
  expect(fence![1].split("\n")).toHaveLength(6);
  expect(reply.trim().endsWith("?")).toBe(true);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test tests/server/protocol.test.ts tests/server/stub.test.ts`
Expected: the two new tests FAIL (`## 9. Code` missing; no fence in the stub reply).

- [ ] **Step 3: Amend the protocol**

In `src/server/judge/PROTOCOL.md`, in §2, replace `no markdown (except a diagram fence, §7)` with `no markdown (except one diagram or code fence, §7 and §9)`.

In §7, replace the last sentence `The §2 ban on markdown does not apply to this one fence.` with `The §2 ban on markdown does not apply to this one fence. At most one fence per reply: a diagram or a code block, not both.`

After §8 append:

```markdown
## 9. Code

Write code when a concrete snippet discriminates faster than prose, in one of three shapes: **predict** ("what does this print?"), **find** ("where does this break under load?"), **fix** ("write the one line that makes this safe"). A fenced block with a language tag (`swift`, `objective-c`, `kotlin`, `typescript`, `tsx`, `javascript`, `json`, `bash`, `python`, `sql`, `yaml`), three to twelve lines, no comments that give the answer away. One fence per reply, a code block or a diagram, not both. Never in the opening turn, never to show an API the question does not need. One sentence before it says what to look at. The fence does not count toward the 120 words of §2. The reader may answer in code; treat their fence as their words about the island.
```

- [ ] **Step 4: Teach the stub**

In `src/server/judge/stub.ts`, before the `// A second answer that matched none of the keywords above gets a canned ask, once.` comment, add:

```ts
  if (text.includes("code")) {
    const snippet = [
      "final class Cache<Key: Hashable> {",
      "  private var store: [Key: Int] = [:]",
      "  func get(_ key: Key) -> Int? { store[key] }",
      "  func set(_ key: Key, _ value: Int) { store[key] = value }",
      "  var count: Int { store.count }",
      "}",
    ].join("\n");
    return say(`Look at how this cache is read and written from two threads.\n\n\`\`\`swift\n${snippet}\n\`\`\`\n\nWhere does it break?`);
  }
```

Update the doc comment's list of keywords: after `"reef" → propose_reef ·` add `"code" → a canned swift fence ·`.

- [ ] **Step 5: Record the convention**

In `CLAUDE.md`, line 48, after `never innerHTML.` insert: `shiki is the one bundled artifact: `Bun.build` runs once per process from `src/server/vendor/shiki-entry.js` and serves `/vendor/shiki.js` with an ETag; the page renders fences as spans per token (`code.js`), colours live in `--code-*` variables, and the judge's code rule is PROTOCOL §9 (one fence per reply, code or diagram).`

Also in the judge tools bullet (line 45, `The judge writes only through its six tools`), nothing changes: code is a fence, not a tool.

- [ ] **Step 6: Run the tests**

Run: `bun test tests/server/protocol.test.ts tests/server/stub.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/judge/PROTOCOL.md src/server/judge/stub.ts CLAUDE.md tests/server/protocol.test.ts tests/server/stub.test.ts
git commit -m "feat(judge): §9 Code, one fence per reply; the stub writes a canned swift fence

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CRzNtnhqVcygozGdKkfExq"
```

---

### Task 3: The fence tag and the pure code model

**Files:**
- Modify: `src/web/thread.js:91-95`
- Create: `src/web/code-model.js`
- Test: `tests/web/thread.test.js`, `tests/web/code-model.test.js` (new)

**Interfaces:**
- Produces, from `src/web/code-model.js`:
  - `SLOTS: string[]` = `["fg","keyword","string","comment","type","number"]`
  - `SENTINELS: string[]` = `["#000001", …, "#000006"]`
  - `LANGS: string[]` the eleven language names
  - `contourTheme: object` a shiki theme named `contour`
  - `resolveLang(tag: string): string | null`
  - `labelOf(tag: string): string`
  - `spansOf(tokenLines: {content:string,color?:string,fontStyle?:number}[][]): {text:string,slot:string,italic:boolean}[][]`
- `mdBlocks` code blocks now carry `lang` lowercased, hyphens allowed.

- [ ] **Step 1: Write the failing tests**

Add to `tests/web/thread.test.js`:

```js
test("a fence tag keeps hyphens and is lowercased", () => {
  expect(mdBlocks("```objective-c\n@interface A\n```")[0]).toMatchObject({ lang: "objective-c", text: "@interface A", closed: true });
  expect(mdBlocks("```Swift\nlet x = 1")[0]).toMatchObject({ lang: "swift", closed: false });
});
```

Create `tests/web/code-model.test.js`:

```js
import { test, expect } from "bun:test";
import { SLOTS, SENTINELS, LANGS, contourTheme, resolveLang, labelOf, spansOf } from "../../src/web/code-model.js";

test("slots and sentinels line up", () => {
  expect(SLOTS).toEqual(["fg", "keyword", "string", "comment", "type", "number"]);
  expect(SENTINELS).toEqual(["#000001", "#000002", "#000003", "#000004", "#000005", "#000006"]);
  expect(LANGS).toHaveLength(11);
  expect(contourTheme.name).toBe("contour");
  expect(contourTheme.settings[0].settings.foreground).toBe("#000001");
});

test("resolveLang maps aliases, lowercases, and returns null for the unknown", () => {
  expect(resolveLang("swift")).toBe("swift");
  expect(resolveLang("SwiftUI")).toBe("swift");
  expect(resolveLang("objc")).toBe("objective-c");
  expect(resolveLang("objective-c")).toBe("objective-c");
  expect(resolveLang("ts")).toBe("typescript");
  expect(resolveLang("js")).toBe("javascript");
  expect(resolveLang("zsh")).toBe("bash");
  expect(resolveLang("py")).toBe("python");
  expect(resolveLang("yml")).toBe("yaml");
  expect(resolveLang("jsonc")).toBe("json");
  expect(resolveLang("cobol")).toBeNull();
  expect(resolveLang("")).toBeNull();
  expect(resolveLang("mermaid")).toBeNull();
});

test("labelOf names known languages, echoes unknown tags, and says code for none", () => {
  expect(labelOf("swift")).toBe("Swift");
  expect(labelOf("objc")).toBe("Objective-C");
  expect(labelOf("tsx")).toBe("TSX");
  expect(labelOf("yml")).toBe("YAML");
  expect(labelOf("cobol")).toBe("cobol");
  expect(labelOf("")).toBe("code");
});

test("spansOf maps sentinel colours to slots, unknown colours to fg, and italic font style", () => {
  const lines = [
    [{ content: "// hi", color: "#000004", fontStyle: 1 }, { content: "final", color: "#000002", fontStyle: 0 }],
    [{ content: "42", color: "#000006" }, { content: "?", color: "#ABCDEF" }, { content: "x" }],
  ];
  expect(spansOf(lines)).toEqual([
    [{ text: "// hi", slot: "comment", italic: true }, { text: "final", slot: "keyword", italic: false }],
    [{ text: "42", slot: "number", italic: false }, { text: "?", slot: "fg", italic: false }, { text: "x", slot: "fg", italic: false }],
  ]);
  expect(spansOf([[{ content: "A", color: "#000005" }]])[0][0].slot).toBe("type");
  expect(spansOf([[{ content: "A", color: "#000005".toUpperCase() }]])[0][0].slot).toBe("type");
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `bun test tests/web/thread.test.js tests/web/code-model.test.js`
Expected: the thread test FAILS (`lang: "objective"`); the code-model file fails to import.

- [ ] **Step 3: Fix the fence tag**

In `src/web/thread.js`, replace:

```js
    const f = line.match(/^\s*```(\w*)/);
    if (f) {
      flushPara();
      flushList();
      fence = { type: "code", lang: f[1], text: "", closed: false };
      continue;
    }
```

with:

```js
    const f = line.match(/^\s*```([\w+-]*)/);
    if (f) {
      flushPara();
      flushList();
      fence = { type: "code", lang: f[1].toLowerCase(), text: "", closed: false };
      continue;
    }
```

- [ ] **Step 4: Write the model**

Create `src/web/code-model.js`:

```js
// Pure, DOM-free: what the highlighter knows about languages and how its tokens become spans.
// The colours live in styles.css as --code-<slot>; here every slot is a sentinel hex shiki hands back.

export const SLOTS = ["fg", "keyword", "string", "comment", "type", "number"];
export const SENTINELS = SLOTS.map((_, i) => `#00000${i + 1}`);
const slotOf = new Map(SENTINELS.map((hex, i) => [hex, SLOTS[i]]));

/** The eleven bundled grammars (see src/server/vendor/shiki-entry.js). */
export const LANGS = ["swift", "objective-c", "kotlin", "typescript", "tsx", "javascript", "json", "bash", "python", "sql", "yaml"];

const ALIASES = {
  swiftui: "swift", objc: "objective-c", js: "javascript", ts: "typescript",
  sh: "bash", shell: "bash", zsh: "bash", py: "python", yml: "yaml", jsonc: "json",
};

const LABELS = {
  swift: "Swift", "objective-c": "Objective-C", kotlin: "Kotlin", typescript: "TypeScript", tsx: "TSX",
  javascript: "JavaScript", json: "JSON", bash: "Bash", python: "Python", sql: "SQL", yaml: "YAML",
};

/** A shiki theme whose colours are sentinels: one per slot. */
export const contourTheme = {
  name: "contour",
  type: "dark",
  colors: {},
  settings: [
    { settings: { foreground: SENTINELS[0], background: "#000000" } },
    { scope: ["keyword", "storage", "keyword.operator"], settings: { foreground: SENTINELS[1] } },
    { scope: ["string", "string.quoted", "string.template"], settings: { foreground: SENTINELS[2] } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: SENTINELS[3], fontStyle: "italic" } },
    {
      scope: ["entity.name.type", "entity.name.class", "support.type", "support.class", "entity.name.function", "support.function", "variable.parameter"],
      settings: { foreground: SENTINELS[4] },
    },
    { scope: ["constant.numeric", "constant.language", "constant.character"], settings: { foreground: SENTINELS[5] } },
  ],
};

/** The bundled language a fence tag means, or null. */
export function resolveLang(tag) {
  const t = String(tag ?? "").toLowerCase();
  const name = ALIASES[t] ?? t;
  return LANGS.includes(name) ? name : null;
}

/** The caption for a fence tag. */
export function labelOf(tag) {
  const t = String(tag ?? "");
  if (!t) return "code";
  const lang = resolveLang(t);
  return lang ? LABELS[lang] : t;
}

/** shiki token lines → span lines of { text, slot, italic }. */
export function spansOf(tokenLines) {
  return tokenLines.map((line) =>
    line.map((t) => ({
      text: t.content,
      slot: slotOf.get(String(t.color ?? "").toLowerCase()) ?? "fg",
      italic: ((t.fontStyle ?? 0) & 1) === 1,
    })),
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `bun test tests/web/`
Expected: PASS (the existing fence tests still hold: `lang: "js"`, `lang: ""`, `lang: "mermaid"`).

- [ ] **Step 6: Commit**

```bash
git add src/web/thread.js src/web/code-model.js tests/web/thread.test.js tests/web/code-model.test.js
git commit -m "feat(web): fence tags keep hyphens; the code model with aliases, labels, the sentinel theme, and spans

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CRzNtnhqVcygozGdKkfExq"
```

---

### Task 4: The code block on the page

**Files:**
- Create: `src/web/code.js`
- Modify: `src/web/markdown.js:126-129` (the two `code` branches)
- Modify: `src/web/card.js:41-53` (`installCard`)
- Modify: `src/web/styles.css` (`:root` tokens; after the `.diagram` rules)
- Test: by hand against the stub (no unit test: DOM).

**Interfaces:**
- Consumes: from Task 1's bundle, `createHighlighterCoreSync`, `createJavaScriptRegexEngine`, and the grammar exports `swift, objectiveC, kotlin, typescript, tsx, javascript, json, bash, python, sql, yaml`; from Task 3, `contourTheme`, `resolveLang`, `labelOf`, `spansOf`, `LANGS`.
- Produces: `loadHighlighter(onReady: () => void): void` and `codeElement(tag: string, text: string, closed: boolean): HTMLElement`.

- [ ] **Step 1: Write the DOM module**

Create `src/web/code.js`:

```js
// Code fences in the log: shiki tokens → one span per token, coloured by --code-<slot> in styles.css.
// The highlighter arrives by dynamic import of the server's bundle; until then, and for languages it
// lacks, the block is plain text under the same caption.
import { LANGS, contourTheme, resolveLang, labelOf, spansOf } from "./code-model.js";

const CACHE_MAX = 64;
const COPIED_MS = 1500;
const WARM = {
  swift: "final class A<T: Hashable> {\n  let n = 1 // a\n  func f(_ x: T) -> Int? { n }\n}",
  "objective-c": "@interface A : NSObject\n- (NSInteger)count; // a\n@end",
  kotlin: "class A(val n: Int = 1) {\n  fun f(x: String): Int? = n // a\n}",
  typescript: "export function f<T>(x: T): number {\n  const n = 1; // a\n  return n;\n}",
  tsx: "const A = ({ n }: { n: number }) => (\n  <div>{n /* a */}</div>\n);",
  javascript: "export function f(x) {\n  const n = 1; // a\n  return `${x}${n}`;\n}",
  json: "{\n  \"a\": [1, true, null],\n  \"b\": \"c\"\n}",
  bash: "for f in *.log; do\n  grep -c ERROR \"$f\" # a\ndone",
  python: "def f(x: int) -> int:\n    n = 1  # a\n    return n",
  sql: "select a, count(*) from t\nwhere b = 'c' -- a\ngroup by a;",
  yaml: "a: 1 # a\nb:\n  - c\n  - \"d\"",
};

let highlighter = null;
let loading = null;
const cache = new Map(); // `${lang}\n${text}` → span lines, closed blocks only

/** Imports the bundle once, builds the highlighter, warms the grammars, and calls onReady once. */
export function loadHighlighter(onReady) {
  if (highlighter || loading) return;
  loading = import("/vendor/shiki.js")
    .then((m) => {
      const grammars = [m.swift, m.objectiveC, m.kotlin, m.typescript, m.tsx, m.javascript, m.json, m.bash, m.python, m.sql, m.yaml];
      highlighter = m.createHighlighterCoreSync({ langs: grammars, themes: [contourTheme], engine: m.createJavaScriptRegexEngine({ forgiving: true }) });
      warm();
      onReady();
    })
    .catch(() => {
      loading = null; // the page stays plain; a later call may try again
    });
}

/** The first tokenize of a language compiles its grammar (~150 ms); do it off the critical path. */
function warm() {
  const idle = typeof requestIdleCallback === "function" ? requestIdleCallback : (fn) => setTimeout(fn, 50);
  const queue = [...LANGS];
  const step = () => {
    const lang = queue.shift();
    if (!lang) return;
    try {
      highlighter.codeToTokens(WARM[lang] ?? "", { lang, theme: "contour" });
    } catch {}
    idle(step);
  };
  idle(step);
}

function tokenize(lang, text, closed) {
  const key = `${lang}\n${text}`;
  if (closed && cache.has(key)) return cache.get(key);
  let lines;
  try {
    lines = spansOf(highlighter.codeToTokens(text, { lang, theme: "contour" }).tokens);
  } catch {
    return null;
  }
  if (closed) {
    cache.set(key, lines);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  return lines;
}

function copyButton(text) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "copy";
  b.textContent = "Copy";
  let timer = 0;
  b.addEventListener("click", () => {
    navigator.clipboard.writeText(text).then(() => {
      b.textContent = "Copied";
      clearTimeout(timer);
      timer = setTimeout(() => (b.textContent = "Copy"), COPIED_MS);
    }).catch(() => {});
  });
  return b;
}

/** A code fence as a block: caption (label, Copy), then pre > code with a span per token. */
export function codeElement(tag, text, closed) {
  const box = document.createElement("div");
  box.className = "codeblock";
  const cap = document.createElement("div");
  cap.className = "cap";
  const label = document.createElement("span");
  label.textContent = labelOf(tag);
  cap.append(label);
  if (typeof navigator !== "undefined" && navigator.clipboard) cap.append(copyButton(text));
  box.append(cap);
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  const lang = resolveLang(tag);
  const lines = highlighter && lang ? tokenize(lang, text, closed) : null;
  if (!lines) {
    code.textContent = text;
  } else {
    lines.forEach((line, i) => {
      if (i) code.append("\n");
      for (const s of line) {
        const span = document.createElement("span");
        span.className = s.italic ? `tok-${s.slot} tok-i` : `tok-${s.slot}`;
        span.textContent = s.text;
        code.append(span);
      }
    });
  }
  pre.append(code);
  box.append(pre);
  return box;
}
```

- [ ] **Step 2: Route fences through it**

In `src/web/markdown.js`, add the import at the top:

```js
import { codeElement } from "./code.js";
```

Replace the last two branches of `renderMarkdown`:

```js
    } else if (b.type === "code" && b.lang === "mermaid" && b.closed) {
      frag.append(diagramElement(b.text));
    } else if (b.type === "code") {
      frag.append(sourceBlock(b.lang === "mermaid" ? "drawing a diagram…" : b.text));
    }
```

with:

```js
    } else if (b.type === "code" && b.lang === "mermaid" && b.closed) {
      frag.append(diagramElement(b.text));
    } else if (b.type === "code" && b.lang === "mermaid") {
      frag.append(sourceBlock("drawing a diagram…"));
    } else if (b.type === "code") {
      frag.append(codeElement(b.lang, b.text, b.closed));
    }
```

`sourceBlock` stays: the diagram fallback still uses it.

- [ ] **Step 3: Re-render once when the highlighter lands**

In `src/web/card.js`, add the import beside `renderMarkdown`:

```js
import { loadHighlighter } from "./code.js";
```

In `installCard`, after the line `app.listeners.add(() => render());`, add:

```js
  loadHighlighter(() => render());
```

- [ ] **Step 4: Style it**

In `src/web/styles.css`, inside `:root` after the `--panel …` line, add:

```css
  /* code slots; a theme switch changes these six and nothing in the highlighter */
  --code-fg: var(--text); --code-keyword: var(--lamp); --code-string: var(--sand-fill);
  --code-comment: var(--muted); --code-type: var(--snow); --code-number: var(--grass);
```

After the `.diagram .cap` rule, add:

```css
/* ---- code blocks ---- */
.codeblock { margin: 6px 0 8px; padding: 8px 10px 10px; background: var(--water); border: 1px solid var(--line); border-radius: 8px; }
.codeblock .cap { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin-bottom: 6px; }
.codeblock .copy { font: inherit; letter-spacing: inherit; text-transform: inherit; color: var(--muted); background: none; border: 0; padding: 0; cursor: pointer; }
.codeblock .copy:hover { color: var(--lamp); }
.codeblock .copy:focus-visible { outline: 1px solid var(--lamp); outline-offset: 2px; }
.msg .codeblock pre { margin: 0; padding: 0; background: none; overflow-x: auto; white-space: pre; font-size: 12px; line-height: 1.5; }
.msg .codeblock code { color: var(--code-fg); }
.tok-keyword { color: var(--code-keyword); }
.tok-string { color: var(--code-string); }
.tok-comment { color: var(--code-comment); }
.tok-type { color: var(--code-type); }
.tok-number { color: var(--code-number); }
.tok-i { font-style: italic; }
```

(`.msg pre` at line 74 sets padding and background; the `.msg .codeblock pre` rule above is more specific and zeroes them, so the block's own box provides the frame.)

- [ ] **Step 5: Whole suite and typecheck**

Run: `bun test && bunx tsc --noEmit`
Expected: all pass.

- [ ] **Step 6: Check by hand against the stub**

```bash
export ARCHIPELAGO_DB_PATH=/private/tmp/claude-501/-Users-victor-Documents-Workspace-Projects-archipelago/759c61ba-0625-4713-9e08-e04a92562ef6/scratchpad/code-blocks.sqlite
bun run src/cli/index.ts domain add --slug cb --name "Code Blocks"
bun run src/cli/index.ts island add --domain cb --slug caching --name Caching --summary "Hot data near its readers." --order 1
bun run src/cli/index.ts serve --stub --port 4499 --no-open --domain cb
```

(`ARCHIPELAGO_DB_PATH` is how `src/core/db.ts` picks the database; the scratch file keeps the real charts untouched.)

Open `http://127.0.0.1:4499/?domain=cb`, select the island, press Make landfall, then send `show me code`. Confirm:
1. The reply shows a block captioned `SWIFT` with `Copy` at the right; `final`, `class`, `func`, `var` are lamp; `Cache`, `Hashable`, `Int` are snow; `[:]` and `store` are the text colour.
2. While the stub's reply streams, the fence colours as it arrives (the stub emits once, so also paste a reader message with an open fence: ```` ```typescript ```` then a line, and see it coloured in the log after send).
3. `Copy` reads `Copied` for a moment and the clipboard holds the six lines.
4. A reader message with ```` ```cobol ```` renders plain under the caption `cobol`.
5. Send `unlock shape` twice so the stub asks; then a message with a ```` ```mermaid ```` fence still draws a diagram.
6. In the network panel, `/vendor/shiki.js` is 200 once, then 304 on reload.

- [ ] **Step 7: Commit**

```bash
git add src/web/code.js src/web/markdown.js src/web/card.js src/web/styles.css
git commit -m "feat(web): code blocks coloured by shiki in the Contour palette, with a language caption and Copy

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CRzNtnhqVcygozGdKkfExq"
```

---

## Self-review

- **Spec coverage:** protocol §2/§7/§9 and stub → Task 2; entry, `shikiBundle`, route, ETag, 304, dependency → Task 1; fence regex, `code-model.js` (slots, sentinels, theme, aliases, labels, spans) → Task 3; `code.js` (load, warm, cache 64, Copy 1.5 s, plain fallback), `markdown.js`, `card.js` re-render, CSS tokens → Task 4; CLAUDE.md → Task 2. Tests named in the spec all appear. Hand check → Task 4 Step 6.
- **Placeholders:** none. The hand-check step names the exact messages to send.
- **Type consistency:** the bundle export `objectiveC` is used identically in Task 1 and Task 4; `resolveLang`/`labelOf`/`spansOf`/`contourTheme`/`LANGS` match between Task 3 and Task 4; `loadHighlighter(onReady)` and `codeElement(tag, text, closed)` match between `code.js`, `markdown.js`, and `card.js`.
