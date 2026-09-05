# Code blocks: the judge writes code, the page colours it

**Date:** 2026-09-05
**Status:** implemented (plan: `docs/superpowers/plans/2026-09-05-code-blocks.md`)
**Builds on:** teacher's tools (`2026-09-04-teachers-tools-design.md`), contour (`2026-09-05-contour-design.md`)
**Reference:** Shuttle's `app/src/utils/shiki.ts` and `CodeBlock.tsx` (shiki 3, GitHub themes, languages on demand, plain text for an unknown language)

## Why

Victor: "one more skill that the teacher should have: not only rendering the flowchart, but code blocks with colours for different languages." Today the judge's protocol bans markdown except the mermaid fence, and the page paints any other fence as an uncoloured `pre`. A chart of iOS engineering or React Native needs code on the table: a snippet to predict, a bug to find, a line to write.

## Decisions

| Question | Decision |
|---|---|
| Highlighter | shiki 3 (as Shuttle), TextMate grammars, oniguruma engine; the wasm is served at `/vendor/onig.wasm`. The JavaScript regex engine was tried first and dropped end-of-line comments in swift and typescript. |
| Serving | The server bundles shiki once per process with `Bun.build` and serves it at `GET /vendor/shiki.js`. The page's own code stays unbundled. This is the one bundling exception and CLAUDE.md records it. |
| Colours | Contour's palette. The shiki theme only sorts tokens into six slots with sentinel colours; the real colours are CSS variables beside the palette tokens, so a later theme switch touches one stylesheet block. |
| Chrome | A caption naming the language and a `Copy` button. Long lines scroll sideways. |
| Languages | swift, objective-c, kotlin, typescript, tsx, javascript, json, bash, python, sql, yaml. Unknown languages render plain with the label still shown. |
| When the judge writes code | New protocol §9: one fence per reply, code or diagram, never both; 3–12 lines; a language tag; never in the opening turn. |

## The judge's protocol

`src/server/judge/PROTOCOL.md`:

- §2's exception becomes "no markdown (except one diagram or code fence, §7 and §9)".
- §7 gains "at most one fence per reply: a diagram or a code block, not both".
- New **§9 Code**: Write code when a concrete snippet discriminates faster than prose, in one of three shapes: *predict* ("what does this print?"), *find* ("where does this break under load?"), *fix* ("write the one line that makes this safe"). A fenced block with a language tag (`swift`, `objective-c`, `kotlin`, `typescript`, `tsx`, `javascript`, `json`, `bash`, `python`, `sql`, `yaml`), three to twelve lines, no comments that answer the question. One fence per reply, and not in a reply that draws. Never in the opening turn, never to show off an API the question does not need. One sentence before it says what to look at. The fence does not count toward the 120 words. The reader may answer in code; treat their fence as their words.

The stub judge (`src/server/judge/stub.ts`) answers a reader message containing `code` with a canned reply carrying a six-line Swift fence and a question, so the page can be checked without a login.

## Serving

`src/server/vendor/shiki-entry.js`:

```js
export { createHighlighterCore } from "shiki/core";
export { createOnigurumaEngine } from "shiki/engine/oniguruma";
export { default as swift } from "@shikijs/langs/swift";
// … objective-c, kotlin, typescript, tsx, javascript, json, bash, python, sql, yaml
```

`src/server/vendor.ts` exports `shikiBundle(): Promise<{ body: string; etag: string }>`: a module-level promise that runs `Bun.build({ entrypoints: [entry], target: "browser", format: "esm", minify: true })` once, hashes the output (`Bun.hash`, hex) for the ETag, and rejects with the build's messages if it fails. `routes.ts` serves `GET /vendor/shiki.js` with `Content-Type: text/javascript`, `Cache-Control: no-cache`, `ETag`, and answers `304` when `If-None-Match` matches. Measured: 29 ms to build, 1.0 MB output. A second route, `GET /vendor/onig.wasm`, serves the engine's wasm from `shiki/dist/onig.wasm` with `Content-Type: application/wasm` and `Cache-Control: no-cache`; the type matters, because the page hands the `fetch` response straight to the engine, which uses `WebAssembly.instantiateStreaming` when it is right.

`shiki` joins `dependencies` in `package.json`. `bun test` builds it once; the route test asserts the module exports `createHighlighterCore` and `createOnigurumaEngine`, and that the wasm route answers with `application/wasm`.

## Page

**`src/web/thread.js`**: the fence regex accepts hyphens (`/^\s*```([\w+-]*)/`) and the parser lowercases the tag.

**`src/web/code-model.js`** (pure, tested):

- `SLOTS = ["fg", "keyword", "string", "comment", "type", "number"]` and `SENTINELS`: slot *i* has colour `#00000<i+1>`.
- `contourTheme`: a shiki theme object named `contour` with those sentinels: default foreground → fg; `keyword`, `storage`, `keyword.operator` → keyword; `string`, `string.quoted`, `string.template` → string; `comment`, `punctuation.definition.comment` → comment, italic; `entity.name.type`, `entity.name.class`, `support.type`, `support.class`, `entity.name.function`, `support.function`, `variable.parameter` → type; `constant.numeric`, `constant.language`, `constant.character` → number.
- `resolveLang(tag)`: lowercases, maps our aliases (`swiftui` → `swift`, `objc`/`objective-c` → `objective-c`, `js` → `javascript`, `ts` → `typescript`, `sh`/`shell`/`zsh` → `bash`, `py` → `python`, `yml` → `yaml`, `jsonc` → `json`), then returns the name if it is in the bundled list, else `null`.
- `spansOf(tokenLines)`: shiki's `tokens` (array of lines of `{ content, color, fontStyle }`) → `[{ text, slot, italic }]` per line, colour compared lowercased, an unknown colour → `fg`.
- `labelOf(tag)`: the caption text, `swift` → `Swift`, `objective-c` → `Objective-C`, `typescript` → `TypeScript`, `tsx` → `TSX`, `javascript` → `JavaScript`, `json` → `JSON`, `bash` → `Bash`, `python` → `Python`, `sql` → `SQL`, `yaml` → `YAML`, `kotlin` → `Kotlin`; an unknown tag is shown as typed; no tag → `code`.

**`src/web/code.js`** (DOM):

- `loadHighlighter()`: `import("/vendor/shiki.js")` once; on resolve builds the highlighter with `await createHighlighterCore({ langs, themes: [contourTheme], engine: createOnigurumaEngine(fetch("/vendor/onig.wasm")) })`, then warms each grammar on `requestIdleCallback` (falling back to `setTimeout`) by tokenizing a three-line snippet per language, since the first real tokenize of a language costs about 150 ms. After the first load it calls `onReady` once so the pane re-renders — outside the `catch`, so a throw from the pane's render is not mistaken for a highlighter failure. A failed import or build warns to the console (`code highlighting unavailable:`) and leaves the page plain; a later call may try again.
- `codeElement(tag, text, closed)`: `<div class="codeblock">` with `<div class="cap">` holding the label and, when `navigator.clipboard` exists, a `Copy` button; then `<pre><code>` with one `<span class="tok-<slot>">` per token (italic tokens also get `tok-i`), lines joined by newline text nodes. Without a highlighter or with an unknown language, `code` holds the text as one node. Closed blocks cache their spans by `lang + "\n" + text` in a `Map` capped at 64 entries (oldest evicted); open blocks tokenize every frame.
- Copy writes the text; the button reads `Copied` for 1.5 s, then `Copy` again.

**`src/web/markdown.js`**: every non-mermaid `code` block goes through `codeElement`; the mermaid placeholder is untouched. `card.js` calls `onReady` to re-render the log once when the highlighter arrives.

**`src/web/styles.css`**: in `:root` beside the palette, `--code-fg: var(--text); --code-keyword: var(--lamp); --code-string: var(--sand-fill); --code-comment: var(--muted); --code-type: var(--snow); --code-number: var(--grass);`. `.codeblock` matches `.diagram` (water background, line border, 8px radius, 6px 0 8px margin); `.codeblock .cap` is the diagram caption with `display:flex; justify-content:space-between`; the button is 11px, muted, no border, lamp on hover; `pre` 12px `ui-monospace, Menlo, monospace`, `overflow-x:auto`, `white-space:pre`; `.tok-keyword { color: var(--code-keyword) }` and so on; `.tok-i { font-style: italic }`.

## Copy

- Caption: the language label from `labelOf`. Button: `Copy`, then `Copied`.
- Placeholder for an open fence: none; the text shows as it arrives.

## Tests

- `tests/server/routes.test.ts`: `/vendor/shiki.js` is served as JavaScript with an ETag; a matching `If-None-Match` gets 304; the body contains `createHighlighterCore` and `createOnigurumaEngine`; `/vendor/onig.wasm` is served as `application/wasm`.
- `tests/server/protocol.test.ts`: §9 exists and names the fence rule.
- `tests/server/stub.test.ts`: a reader message with `code` gets a reply with a `swift` fence.
- `tests/web/code-highlight.test.js`: a real oniguruma highlighter over one short sample per language; every token colour is a sentinel; the typescript and swift end-of-line comments come back whole and italic; json separates its key from its number.
- `tests/web/code-model.test.js`: `resolveLang` aliases and unknowns; `spansOf` maps sentinels to slots, unknown colours to `fg`, italics; `labelOf`.
- `tests/web/thread.test.js`: a `objective-c` tag survives; `Swift` lowercases.
- By hand against the stub: a Swift fence colours while streaming and after; `Copy` reads `Copied`; an unknown language shows plain with its label; a diagram still renders.

## Out of scope

- Line highlighting, wrap toggle, language picker, the reader editing code.
- Loading languages beyond the eleven on demand.
- The theme switch itself; only its seam.
