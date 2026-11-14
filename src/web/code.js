// Code fences in the log and on the board: shiki tokens → one span per token, coloured by --code-<slot> in styles.css.
// The highlighter arrives by dynamic import of the server's bundle and its oniguruma wasm
// (/vendor/onig.wasm), so building it is async; until it lands, and for languages it lacks, the
// block is plain text under the same caption. A failed load warns and leaves the page plain.
import { LANGS, contourTheme, resolveLang, labelOf, spansOf } from "./code-model.js";
import { t } from "./i18n.js";
import { pinButton } from "./pin.js";
import { icon } from "./icons.js";
import { tip } from "./tip.js";
import { watchMore } from "./wide.js";

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
    .then(async (m) => {
      const grammars = [m.swift, m.objectiveC, m.kotlin, m.typescript, m.tsx, m.javascript, m.json, m.bash, m.python, m.sql, m.yaml, m.html];
      highlighter = await m.createHighlighterCore({
        langs: grammars,
        themes: [contourTheme],
        engine: m.createOnigurumaEngine(fetch("/vendor/onig.wasm")),
      });
      warm();
      colourWaiting();
      return true;
    })
    .catch((error) => {
      console.warn("code highlighting unavailable:", error);
      loading = null; // the page stays plain; a later call may try again
      return false;
    });
  // Outside the catch: a throw from onReady() is the page's bug, not a highlighter failure.
  loading.then((ready) => {
    if (ready) onReady();
  });
}

// Blocks drawn plain before the highlighter arrived. The log and the board keep an element whose content has not
// changed (keep.js), so nothing would draw these again: they are coloured where they stand, once.
let waiting = [];
const WAITING_MAX = 500; // a highlighter that never arrives must not grow this for ever
function colourWaiting() {
  const blocks = waiting;
  waiting = [];
  // Only a block still showing the text it was given: an editor's mirror may have moved on.
  for (const { code, tag, text, closed } of blocks) if (code.textContent === text) fillCode(code, tag, text, closed);
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

/** Copy for a block of code: one quiet icon that turns to a tick for a moment once the text is on the clipboard. */
export function copyButton(text) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn sm quiet icon copy";
  let timer = 0;
  const draw = (done) => {
    b.replaceChildren(icon(done ? "check" : "copy", { size: 14 }));
    b.setAttribute("aria-label", t(done ? "code.copied" : "code.copy"));
    tip(b, t(done ? "code.copied" : "code.copy"));
  };
  draw(false);
  b.addEventListener("click", () => {
    navigator.clipboard.writeText(text).then(() => {
      draw(true);
      clearTimeout(timer);
      timer = setTimeout(() => draw(false), COPIED_MS);
    }).catch(() => {});
  });
  return b;
}

/** Whether this browser lets the page write to the clipboard (not over plain http to another host). */
export const canCopy = () => typeof navigator !== "undefined" && Boolean(navigator.clipboard);

/**
 * A code fence as a block: caption (label, Pin, Copy), then pre > code with a span per token. `cap: false` leaves
 * the caption out, for a board card, whose own caption names the language and carries Copy (`copyButton`).
 */
export function codeElement(tag, text, closed, { pin = null, lang = null, cap: captioned = true } = {}) {
  const box = document.createElement("div");
  box.className = "codeblock";
  if (captioned) {
    const cap = document.createElement("div");
    cap.className = "cap";
    const label = document.createElement("span");
    label.textContent = labelOf(tag);
    cap.append(label);
    const acts = document.createElement("span");
    acts.className = "acts";
    if (pin) acts.append(pinButton(pin, { kind: "code", body: text, lang }));
    if (canCopy()) acts.append(copyButton(text));
    cap.append(acts);
    box.append(cap);
  }
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  fillCode(code, tag, text, closed);
  pre.append(code);
  if (closed) watchMore(pre); // a long line scrolls the block sideways; the side that hides something fades
  box.append(pre);
  return box;
}

/** Fills `code` with one span per token, or plain text when the language is unknown or the highlighter is not ready. */
export function fillCode(code, tag, text, closed) {
  const lang = resolveLang(tag);
  const lines = highlighter && lang ? tokenize(lang, text, closed) : null;
  code.replaceChildren();
  if (!lines) {
    code.textContent = text;
    if (!highlighter && lang && waiting.length < WAITING_MAX) waiting.push({ code, tag, text, closed });
    return;
  }
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
