# Ask back: the Keeper's questions are the shortcut

**Date:** 2026-09-06
**Status:** implemented inline (small slice, no plan)
**Builds on:** chart-and-log (`2026-09-04-chart-and-log-design.md`), teacher's tools (`2026-09-04-teachers-tools-design.md`)

## Why

Victor, after his first real sitting on App architecture (charted sandbar): "the response that the Keeper answered, if it's a clear question in that sentence, it should be clickable, and it ports a shortcut to the answer field: `> {the question to reply}`."

## Decisions

| Question | Decision |
|---|---|
| What counts as a question | In a Keeper message, a sentence that ends with `?`. Sentences are split on `.`, `!`, `?` followed by whitespace or the end of the line. Only paragraphs are scanned; not code, diagrams, headings, or lists. |
| What a click does | Puts `> <the question>` on its own line at the top of the answer box (above any draft), focuses the box with the caret at the end, and never adds the same quote twice. In reef mode (dispute box) the same thing happens to the objection draft. |
| How the quote renders | The markdown parser learns blockquotes: lines starting with `> ` become a `quote` block, drawn as a quiet indented line. The Keeper reads it as a quoted line in the reader's words, which the protocol already treats as the reader's words. |
| Whose messages | Only the Keeper's (`role: "judge"`), stored and streaming. Reader messages are never scanned. |
| Look | A question run is a `<span class="ask" role="button" tabindex="0">` with a dotted underline in the line colour; lamp on hover; title `answer this`. Enter or Space on it acts like a click. |

## Code

- `src/web/thread.js`: `questionRuns(line) → [{ text, question }]` (pure, tested). Paragraph blocks carry `raw: string[]` beside `lines`. Blockquote block `{ type: "quote", lines: segments[][] }`.
- `src/web/markdown.js`: `renderMarkdown(text, { onQuestion } = {})`. With `onQuestion`, paragraph lines are rendered from `raw` through `questionRuns`, question runs wrapped in the `ask` span. Quote blocks render as `<blockquote>` with one `<p>` per line.
- `src/web/card.js`: `quoteIntoAnswer(question)` edits `thread.draft` (or `thread.disputeDraft` in reef mode), re-renders, focuses the box at the end. Judge items and the live element pass `{ onQuestion: quoteIntoAnswer }`.
- `src/web/styles.css`: `.ask`, `.msg blockquote`.

## Tests

- `tests/web/thread.test.js`: `questionRuns` splits sentences and flags the `?` ones (including a question mid-line and a trailing fragment); `mdBlocks` yields `quote` blocks for `> ` lines and `raw` on paragraphs.
- By hand against the stub: the stub's replies end in a question; clicking it fills `> …` in the box and focuses it; a second click does not duplicate; the sent message shows the quote as a blockquote; Enter on a focused question span works.

## Out of scope

- Detecting questions in lists or headings. Multiple-question replies get one span per question, which is enough.
- A keyboard shortcut that picks "the last question" without the mouse (candidate for the pane's key table later).
