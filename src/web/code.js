// Code fences in the log: shiki tokens → one span per token, coloured by --code-<slot> in styles.css.
// The highlighter arrives by dynamic import of the server's bundle and its oniguruma wasm
// (/vendor/onig.wasm), so building it is async; until it lands, and for languages it lacks, the
// block is plain text under the same caption. A failed load warns and leaves the page plain.
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
    .then(async (m) => {
      const grammars = [m.swift, m.objectiveC, m.kotlin, m.typescript, m.tsx, m.javascript, m.json, m.bash, m.python, m.sql, m.yaml];
      highlighter = await m.createHighlighterCore({
        langs: grammars,
        themes: [contourTheme],
        engine: m.createOnigurumaEngine(fetch("/vendor/onig.wasm")),
      });
      warm();
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
  fillCode(code, tag, text, closed);
  pre.append(code);
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
