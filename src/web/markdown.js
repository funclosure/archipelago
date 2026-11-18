// mdBlocks → DOM. Built with createElement and textContent only; never innerHTML.
import { THEMES, TOKEN_NAMES, storedTheme, mermaidVariables } from "./theme-model.js";
import { mdBlocks, inlineSegments, questionRuns, leadSplit, quoteSpans } from "./thread.js";
import { termRuns } from "./term-model.js";
import { mentionOf, mentionRuns } from "./mention-model.js";
import { codeElement } from "./code.js";
import { plotElement } from "./plot.js";
import { PLOT_LANGS } from "./plot-model.js";
import { demoElement } from "./demo.js";
import { DEMO_LANG } from "./demo-model.js";
import { pinButton } from "./pin.js";
import { watchWide, watchMore } from "./wide.js";
import { resolveLang } from "./code-model.js";
import { t } from "./i18n.js";
import { tip } from "./tip.js";
import { thinkingEl } from "./thinking.js";

const nodeCache = new Map(); // diagram source → parsed SVG node, cloned on repeat appends
const pending = new Map(); // diagram source → in-flight render promise, shared across frames
let mermaidReady = false;
let diagramSeq = 0;

function mermaidInit() {
  if (mermaidReady) return true;
  if (typeof window === "undefined" || !window.mermaid || typeof document === "undefined") return false;
  // Before theme.js has applied a theme (or when a fence renders first), read the tokens the page resolves now.
  const style = getComputedStyle(document.documentElement);
  const tokens = {};
  for (const n of TOKEN_NAMES) tokens[n] = style.getPropertyValue(n).trim();
  const id = storedTheme(document.documentElement.dataset.theme);
  return applyMermaidTheme(mermaidVariables(tokens, THEMES.find((t) => t.id === id)?.dark ?? true));
}

/** Re-initialises mermaid for a theme and forgets every rendered diagram, so the next append renders in the new colours. */
export function applyMermaidTheme(themeVariables) {
  if (typeof window === "undefined" || !window.mermaid) return false;
  window.mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    flowchart: { htmlLabels: false, useMaxWidth: false },
    sequence: { useMaxWidth: false },
    themeVariables,
  });
  nodeCache.clear();
  pending.clear();
  mermaidReady = true;
  return true;
}

/**
 * SVG markup → an element, without innerHTML. Null when there is no svg in it. Parsed as HTML, not XML: mermaid writes
 * a label's line break as `<br>` inside its foreignObject, which no XML parser accepts, so a strict parse lost every
 * diagram with a two-line label to its source.
 */
function svgNode(markup) {
  const doc = new DOMParser().parseFromString(markup, "text/html");
  const svg = doc.querySelector("svg");
  if (!svg) return null;
  for (const n of svg.querySelectorAll("script")) n.remove();
  for (const el of [svg, ...svg.querySelectorAll("*")]) {
    for (const attr of [...el.attributes]) {
      if (attr.name.toLowerCase().startsWith("on")) el.removeAttribute(attr.name);
    }
  }
  return document.importNode(svg, true);
}

function sourceBlock(text) {
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = text;
  pre.append(code);
  return pre;
}

/**
 * A diagram, plot or demo whose fence is still being written: a box like the one it will become, a shimmering line
 * saying what is being made, and the source so far running up through a window that fades at its top, the newest
 * line at its foot. The window keeps its height from the first line, so the box does not grow as the code comes.
 */
function buildingEl(label, source) {
  const box = document.createElement("div");
  box.className = "building";
  const cap = document.createElement("div");
  cap.className = "cap";
  cap.append(thinkingEl(label));
  const tail = document.createElement("div");
  tail.className = "tail";
  tail.setAttribute("aria-hidden", "true"); // the line above says what is happening; half-written code is not read out
  tail.append(sourceBlock(source));
  box.append(cap, tail);
  return box;
}

/** A closed mermaid fence: rendered once per source and cached, with the source as the fallback. `cache: false` for a live preview. */
export function diagramElement(source, { cache = true, pin = null } = {}) {
  const box = document.createElement("div");
  box.className = "diagram";
  const cap = document.createElement("div");
  cap.className = "cap";
  const label = document.createElement("span");
  label.textContent = t("markdown.diagram");
  cap.append(label);
  if (pin) cap.append(pinButton(pin, { kind: "diagram", body: source }));
  box.append(cap);
  const holder = document.createElement("div");
  box.append(holder);
  watchWide(box, holder); // a drawing wider than its box is drawn smaller, or scrolls and says so
  if (cache && nodeCache.has(source)) {
    holder.append(nodeCache.get(source).cloneNode(true));
    return box;
  }
  if (!mermaidInit()) {
    holder.append(sourceBlock(source));
    return box;
  }
  holder.replaceChildren(thinkingEl(t("markdown.drawingDiagram")));
  let p = cache ? pending.get(source) : undefined;
  if (!p) {
    p = window.mermaid
      .render(`diagram-${++diagramSeq}`, source)
      .then(({ svg }) => {
        pending.delete(source);
        return svg;
      })
      .catch((e) => {
        pending.delete(source);
        throw e;
      });
    if (cache) pending.set(source, p);
  }
  p.then((svg) => {
    const node = svgNode(svg);
    if (!node) {
      holder.replaceChildren(sourceBlock(source));
      return;
    }
    if (cache) nodeCache.set(source, node);
    holder.replaceChildren(node);
  }).catch(() => holder.replaceChildren(sourceBlock(source)));
  return box;
}

/** Text with the island's landmark words marked (`.term`, `data-lm` the landmark's slug, its name as the title). */
function appendTermed(parent, text, terms) {
  if (!terms) return parent.append(text);
  for (const run of termRuns(text, terms)) {
    if (!run.slug) {
      parent.append(run.text);
      continue;
    }
    const span = document.createElement("span");
    span.className = "term";
    span.dataset.lm = run.slug;
    span.textContent = run.text;
    tip(span, run.name);
    parent.append(span);
  }
}

/**
 * A place a reply names, as a quiet link (`.mention`): the name as written, a real address (so a new tab works), and
 * a tip that says where it is. `mentions` (from mentions.js) says where a target opens and how to go there.
 */
function mentionEl(text, target, mentions) {
  const a = document.createElement("a");
  a.className = "mention";
  a.href = mentions.href(target);
  a.textContent = text;
  tip(a, mentions.describe(target));
  a.addEventListener("click", (e) => mentions.open(target, e));
  return a;
}

/** Plain text with the places it names linked (`mentionRuns`) and the island's landmark words marked in the rest. */
function appendWords(parent, text, words) {
  if (!words.mentions) return appendTermed(parent, text, words.terms);
  for (const run of mentionRuns(text, words.mentions.index)) {
    if (run.target) parent.append(mentionEl(run.text, run.target, words.mentions));
    else appendTermed(parent, run.text, words.terms);
  }
}

/** `words`: `terms` (the island's landmark words, marked) and `mentions` (places a reply names, linked); either may be null. */
function appendInline(parent, segments, words = {}) {
  for (const s of segments) {
    if (s.type === "text") {
      appendWords(parent, s.text, words);
    } else {
      const e = document.createElement(s.type); // strong | em | code
      const target = s.type === "code" || !words.mentions ? null : mentionOf(words.mentions.index, s.text);
      if (s.type === "code") e.textContent = s.text;
      else if (target) e.append(mentionEl(s.text, target, words.mentions)); // a whole bold or italic name is the link
      else appendWords(e, s.text, words);
      parent.append(e);
    }
  }
}

/** A question sentence the reader can click (or press Enter/Space on) to answer it directly. No link inside: it is one control. */
function askSpan(run, onQuestion, words) {
  const span = document.createElement("span");
  span.className = "ask";
  span.setAttribute("role", "button");
  span.tabIndex = 0;
  appendInline(span, inlineSegments(run.text), { terms: words.terms });
  tip(span, t("markdown.answerThis"));
  const fire = () => onQuestion(run.text.trim());
  span.addEventListener("click", fire);
  span.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      fire();
    }
  });
  return span;
}

/** Prose: plain inline segments, or sentence runs with questions wrapped when a handler is given. */
function appendProse(parent, raw, onQuestion, words) {
  if (!onQuestion) return appendInline(parent, inlineSegments(raw), words);
  for (const run of questionRuns(raw)) {
    if (run.question) parent.append(askSpan(run, onQuestion, words));
    else appendInline(parent, inlineSegments(run.text), words);
  }
}

/** A paragraph's first line with its first sentence in `.lead` and the rest in `.rest`, which the stylesheet quiets. */
function appendLead(p, raw, onQuestion, words) {
  const [lead, rest] = leadSplit(raw);
  if (!rest) return appendProse(p, raw, onQuestion, words);
  const first = document.createElement("span");
  first.className = "lead";
  appendProse(first, lead, onQuestion, words);
  const after = document.createElement("span");
  after.className = "rest";
  appendProse(after, rest, onQuestion, words);
  p.append(first, after);
}

/**
 * A table (from `mdBlocks`) in its own box, which scrolls sideways when the table is wider than the column and fades
 * on the side that hides something (`watchMore`). A column's alignment is `data-align`, never an inline style.
 */
function tableElement(b, words) {
  const row = (cells, tag) => {
    const tr = document.createElement("tr");
    cells.forEach((segments, i) => {
      const cell = document.createElement(tag);
      if (tag === "th") cell.scope = "col";
      if (b.align[i]) cell.dataset.align = b.align[i];
      appendInline(cell, segments, words);
      tr.append(cell);
    });
    return tr;
  };
  const head = document.createElement("thead");
  head.append(row(b.head, "th"));
  const body = document.createElement("tbody");
  for (const cells of b.rows) body.append(row(cells, "td"));
  const table = document.createElement("table");
  table.append(head, body);
  const box = document.createElement("div");
  box.className = "md-table";
  box.append(table);
  watchMore(box);
  return box;
}

/** One parsed block (from `mdBlocks`) as its element, or null for a block that draws nothing. */
function blockEl(b, { onQuestion = null, lead = false, terms = null, mentions = null, pin = null } = {}) {
  const words = { terms, mentions };
  if (b.type === "p") {
    const p = document.createElement("p");
    if (lead) p.className = "led";
    b.raw.forEach((raw, i) => {
      if (i) p.append(document.createElement("br"));
      if (lead && i === 0) appendLead(p, raw, onQuestion, words);
      else if (lead) {
        const after = document.createElement("span");
        after.className = "rest";
        appendProse(after, raw, onQuestion, words);
        p.append(after);
      } else appendProse(p, raw, onQuestion, words);
    });
    return p;
  }
  if (b.type === "quote") {
    const bq = document.createElement("blockquote");
    for (const segments of b.lines) {
      const p = document.createElement("p");
      appendInline(p, segments, words);
      bq.append(p);
    }
    return bq;
  }
  if (b.type === "h") {
    const h = document.createElement(`h${b.level}`);
    appendInline(h, b.segments, words);
    return h;
  }
  if (b.type === "list") {
    const list = document.createElement(b.ordered ? "ol" : "ul");
    for (const item of b.items) {
      const li = document.createElement("li");
      appendInline(li, item, words);
      list.append(li);
    }
    return list;
  }
  if (b.type === "table") return tableElement(b, words);
  if (b.type === "code" && b.lang === "mermaid" && b.closed) {
    return diagramElement(b.text, { pin });
  }
  if (b.type === "code" && b.lang === "mermaid") {
    return buildingEl(t("markdown.drawingDiagram"), b.text);
  }
  if (b.type === "code" && PLOT_LANGS.has(b.lang) && b.closed) {
    return plotElement(b.text);
  }
  if (b.type === "code" && PLOT_LANGS.has(b.lang)) {
    return buildingEl(t("markdown.drawingPlot"), b.text);
  }
  if (b.type === "code" && b.lang === DEMO_LANG && b.closed) {
    return demoElement(b.text, { pin });
  }
  if (b.type === "code" && b.lang === DEMO_LANG) {
    return buildingEl(t("demo.building"), b.text);
  }
  if (b.type === "code") {
    return codeElement(b.lang, b.text, b.closed, { pin: b.closed ? pin : null, lang: resolveLang(b.lang) });
  }
  return null;
}

/**
 * The text's blocks as `{ sig, build }`, for a caller that redraws as the text grows (a streaming reply): `sig` is
 * the parsed block as a string, so with keep.js a block that has not changed keeps its element and only the one
 * being written is built again.
 */
export function markdownBlocks(text, options = {}) {
  return mdBlocks(text).map((b) => ({ sig: JSON.stringify(b), build: () => blockEl(b, options) ?? document.createComment("") }));
}

/** A message's text nodes that are its writer's own words: never a quoted line (the persona's question), a code block, or words already marked. */
function ownTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.data && !n.parentElement?.closest("blockquote, pre, mark.evidence")) out.push(n);
  }
  return out;
}

/**
 * Marks each quote where it stands in a reader's message: `mark.evidence` with its kind as a class (lit, explored,
 * reef, loose) and `data-lm` its key, so hovering the words lights the line and the landmark's chip. A quote may run
 * through bold words or over a line break, so it can take several marks; one the page cannot find draws nothing.
 */
function markQuotes(root, marks) {
  for (const m of marks) {
    const nodes = ownTextNodes(root);
    for (const span of quoteSpans(nodes.map((n) => n.data), m.quote)) {
      const part = span.start ? nodes[span.chunk].splitText(span.start) : nodes[span.chunk];
      if (span.end - span.start < part.data.length) part.splitText(span.end - span.start);
      const mark = document.createElement("mark");
      mark.className = `evidence ${m.kind}`;
      mark.dataset.lm = m.key;
      part.replaceWith(mark);
      mark.append(part);
    }
  }
}

/**
 * The rendered blocks of a markdown string, as a fragment ready to append. `onQuestion(text)` makes question
 * sentences clickable; `lead` marks each paragraph's first sentence so the line of thought can be skimmed; `terms`
 * (from `landmarkTerms`) marks the island's landmark words in prose, never in code; `mentions` (from mentions.js, for a
 * persona's reply) links the places it names, never inside a question the reader can click. `pin` (from card.js, for a persona's
 * reply) puts "pin to board" on each closed diagram, code, and demo fence. `marks` (from `evidenceMarks`, for a
 * reader's message) underlines the words a lit landmark, a reef or a loose end quotes.
 */
export function renderMarkdown(text, options = {}) {
  const frag = document.createDocumentFragment();
  for (const b of mdBlocks(text)) {
    const node = blockEl(b, options);
    if (node) frag.append(node);
  }
  if (options.marks?.length) markQuotes(frag, options.marks);
  return frag;
}
