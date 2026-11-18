// Pure parts of a paced reply (`pace.js`): how fast the words that have arrived are shown, and where a reveal may
// stop. A model's text comes in bursts (a word, then a whole paragraph); shown as it arrives, a long reply lurches.
// Paced, it runs on at about the speed it comes in, a word at a time, never stopping inside a word or on a mark that
// would show as itself and then turn into something else (a bare `-` before its list item, a table's header row
// before its delimiter row, `**` before the words it makes bold).
import { hasPipe, openMark, tableAlign, tableCells } from "./thread.js";

/** The slowest the words come while more of the reply is on its way, in characters a second. */
export const PACE_MIN_CPS = 45;
/** The fastest they come, however much is waiting: a burst still reads as words arriving, not as a page landing. */
export const PACE_MAX_CPS = 900;
/** How far behind what has arrived the words run: what waits is shown at this time constant, in seconds. */
export const PACE_LAG_S = 0.6;
/** Once the whole reply is in, the rest comes at least this fast, so the end never crawls. */
export const PACE_END_CPS = 360;
/** A word longer than this (a long address, an identifier) may be shown in parts rather than wait for its end. */
export const WORD_MAX = 40;

/**
 * Where the reveal stands `dt` milliseconds later: `pos` (characters, fractional) moves toward `total` at a speed
 * that grows with what is waiting, so a burst is shown quickly at first and the pace settles as it drains. `done`:
 * the whole reply has arrived.
 */
export function paceAdvance(pos, total, dt, done) {
  if (pos >= total) return total;
  const waiting = total - pos;
  const cps = Math.min(PACE_MAX_CPS, Math.max(done ? PACE_END_CPS : PACE_MIN_CPS, waiting / PACE_LAG_S));
  return Math.min(total, pos + (cps * Math.max(0, dt)) / 1000);
}

// Chinese, Japanese and Korean run on without spaces: each character is a word.
const WIDE = /[⺀-⿿　-〿぀-鿿가-힯豈-﫿＀-￯]/u;
const SPACE = /\s/u;

/** Whether a reveal may stop before character `p`: at whitespace, or beside a wide character. */
function boundary(text, p) {
  if (p <= 0) return true;
  const a = text[p - 1];
  const b = text[p];
  return b === undefined || SPACE.test(b) || WIDE.test(a) || WIDE.test(b);
}

/** The nearest place at or before `n` a reveal may stop. */
function backTo(text, n) {
  for (let p = n; p > Math.max(0, n - WORD_MAX); p--) if (p < text.length && boundary(text, p)) return p;
  return Math.max(0, n - WORD_MAX);
}

/**
 * Where to cut `text` near `n` so no word is shown in part: the end of the word `n` falls in. A word still
 * arriving (no space after it yet) waits for its end, unless the reply is whole.
 */
export function wordCut(text, n, done) {
  const len = text.length;
  const at = Math.max(0, Math.min(len, Math.floor(n)));
  if (at >= len) {
    const last = text[len - 1] ?? "";
    return done || SPACE.test(last) || WIDE.test(last) ? len : backTo(text, len);
  }
  for (let p = at; p <= Math.min(len, at + WORD_MAX); p++) {
    if (p === len) return done ? len : backTo(text, at);
    if (boundary(text, p)) return p;
  }
  return at; // a very long word: shown in parts
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

/** How much of `text` is shown once the reveal stands at `pos`: it only ever grows as `pos` and the text do. */
export function revealCut(text, pos, done) {
  return settleCut(text, wordCut(text, pos, done), done);
}

/**
 * The part of `text` to draw once the reveal stands at `pos`: whole words only, held back where a mark would draw as
 * something it is not yet, and with an inline mark left open at its end closed (`**bold wo` draws as **bold wo**, as
 * it will when its end arrives). The whole text, as it is, once everything is shown.
 */
export function revealed(text, pos, done) {
  const source = String(text ?? "");
  if (done && pos >= source.length) return source;
  const cut = revealCut(source, pos, done);
  const shown = source.slice(0, cut);
  if (cut >= source.length && done) return shown;
  const start = shown.lastIndexOf("\n") + 1;
  const line = shown.slice(start);
  if (FENCE.test(line) || insideFence(shown, start)) return shown; // code is shown as it is written
  return shown + openMark(line);
}
