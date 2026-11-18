// Pure parts of a streaming reply's reveal (`reveal.js`): what of the text that has arrived may be drawn, and when
// each word drawn for the first time fades in. A model's text comes in bursts (a word, then a whole paragraph). Each
// arrival is drawn at once, where it will stay, so nothing reflows word by word; its words fade in over a moment, one
// a little after the other, so a paragraph that lands at once still reads as written (after Microsoft's
// SwiftStreamingMarkdown). Nothing is drawn that would show as itself and then turn into something else: a word in
// part, a bare `-` before its list item, a table's header row before its delimiter row, `**` before the words it
// makes bold.
import { hasPipe, openMark, tableAlign, tableCells } from "./thread.js";

/** How long one word takes to fade in, in milliseconds (`--t-fade` in styles.css, which a test holds equal). */
export const FADE_MS = 500;
/** Between one new word starting to fade and the next, within what arrived together. */
export const FADE_STEP_MS = 12;
/** A burst's words all start within this, however many: a long one sweeps in, it does not crawl. */
export const FADE_SPREAD_MS = 360;
/** New words start at most this long after they are drawn, however much is still fading in before them. */
export const FADE_LAG_MS = 400;
/** A word longer than this (a long address, an identifier) may be shown in parts rather than wait for its end. */
export const WORD_MAX = 40;

// Chinese, Japanese and Korean run on without spaces: each character is a word.
const WIDE = /[⺀-⿿　-〿぀-鿿가-힯豈-﫿＀-￯]/u;
const SPACE = /\s/u;

/** Whether a word may end before character `p`: at whitespace, or beside a wide character. */
function boundary(text, p) {
  if (p <= 0) return true;
  const a = text[p - 1];
  const b = text[p];
  return b === undefined || SPACE.test(b) || WIDE.test(a) || WIDE.test(b);
}

/**
 * Where what has arrived may be cut so no word shows in part: the end of the last whole word. A word still arriving
 * (no space after it yet) waits for its end, unless the reply is whole; one longer than `WORD_MAX` is shown in parts.
 */
export function wordEnd(text, done) {
  const len = text.length;
  if (done || !len || WIDE.test(text[len - 1])) return len;
  if (SPACE.test(text[len - 1])) {
    let p = len;
    while (p > 0 && SPACE.test(text[p - 1])) p--;
    return p; // the space after a word is drawn with the word after it, so the cut never steps back over it
  }
  for (let p = len - 1; p > Math.max(0, len - WORD_MAX); p--) if (boundary(text, p)) return p;
  return Math.max(0, len - WORD_MAX);
}

const FENCE = /^\s*```/;
const MARK_ONLY = /^\s*(?:#{1,6}|[-*+]|\d+[.)]|>)\s*$/;
// A table's header starts with a pipe in what a model writes; a line that only has one further on reads as prose
// until it does, and holding it back then would take words off the screen.
const ROW = /^\s*\|/;

/** Whether the line starting at `start` lies inside a code fence opened above it. */
function insideFence(text, start) {
  let open = false;
  for (const line of text.slice(0, start).split("\n")) if (FENCE.test(line)) open = !open;
  return open;
}

/**
 * Pulls a cut back where the line it ends in would draw as something it is not: a line holding only a list,
 * heading or quote mark (it would show as a paragraph of one character), a fence's opening line before it is whole,
 * or a row of pipes that may be a table's header before the line after it says whether it is. A header whose
 * delimiter row has arrived goes out with that row, which draws nothing of its own.
 */
function settleCut(text, cut, done) {
  const start = text.lastIndexOf("\n", cut - 1) + 1;
  if (start >= cut || insideFence(text, start)) return cut;
  const shown = text.slice(start, cut);
  const end = text.indexOf("\n", start);
  const whole = end === -1 ? (done ? text.slice(start) : null) : text.slice(start, end);
  if (MARK_ONLY.test(shown)) return start;
  if (FENCE.test(shown)) return whole === null ? start : start + whole.length;
  if (!ROW.test(shown)) return cut;
  const above = start > 0 ? text.slice(text.lastIndexOf("\n", start - 2) + 1, start - 1) : "";
  if (above.trim() && hasPipe(above)) return cut; // a row of a table already shown: its cells fill in as they come
  if (whole === null) return start; // a header, perhaps: not before it is whole
  if (end === -1) return cut; // the reply's last line, and the reply is whole: no delimiter row comes
  const nextEnd = text.indexOf("\n", end + 1);
  const next = nextEnd === -1 ? (done ? text.slice(end + 1) : null) : text.slice(end + 1, nextEnd);
  if (next === null) return start; // the line that decides has not arrived
  const align = tableAlign(next);
  if (align && align.length === tableCells(whole).length) return Math.max(cut, end + 1 + next.length);
  return cut; // a line of prose that has a pipe in it
}

/** How much of what has arrived may be drawn: it only ever grows as the text does. */
export function shownCut(text, done) {
  return settleCut(text, wordEnd(text, done), done);
}

/**
 * The part of what has arrived to draw: whole words only, held back where a mark would draw as something it is not
 * yet, and with an inline mark left open at its end closed (`**bold wo` draws as **bold wo**, as it will when its end
 * arrives). The whole text, as it is, once the reply is whole.
 */
export function revealed(text, done) {
  const source = String(text ?? "");
  if (done) return source;
  const shown = source.slice(0, shownCut(source, false));
  const start = shown.lastIndexOf("\n") + 1;
  const line = shown.slice(start);
  if (FENCE.test(line) || insideFence(shown, start)) return shown; // code is shown as it is written
  return shown + openMark(line);
}

/** The words of `text` from `from` to `to`, as `[start, end)` pairs; whitespace is no word, a wide character is one. */
export function wordsIn(text, from, to) {
  const out = [];
  let start = -1;
  for (let p = from; p <= to; p++) {
    if (start >= 0 && (p === to || boundary(text, p))) {
      out.push([start, p]);
      start = -1;
    }
    if (p < to && start < 0 && !SPACE.test(text[p])) start = p;
  }
  return out;
}

/**
 * One block of a reply drawn again, now showing `text` (its words as the page shows them) at `now`. `prev` is its
 * record from the last time (`{ text, words }`), `wave` when the next new word may start. What it showed before keeps
 * its timing as far as the two texts agree; the words after that are new and start one after another from the wave
 * on, so a burst that spans several blocks sweeps down through them. Returns the block's record, keeping only the
 * words still fading (`{ from, to, start }`, offsets into `text`), and where the wave now stands.
 */
export function arrive(prev, text, now, wave = now) {
  const old = prev?.text ?? "";
  const most = Math.min(old.length, text.length);
  let same = 0;
  while (same < most && old[same] === text[same]) same++;
  const kept = (prev?.words ?? []).filter((w) => w.to <= same && w.start + FADE_MS > now);
  const fresh = wordsIn(text, same, text.length);
  if (!fresh.length) return { record: { text, words: kept }, wave };
  const base = Math.min(Math.max(wave, now), now + FADE_LAG_MS);
  const step = Math.min(FADE_STEP_MS, FADE_SPREAD_MS / fresh.length);
  const words = [...kept, ...fresh.map(([from, to], i) => ({ from, to, start: base + i * step }))];
  return { record: { text, words }, wave: base + fresh.length * step };
}
