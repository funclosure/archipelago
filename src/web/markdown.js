// mdBlocks → DOM. Built with createElement and textContent only; never innerHTML.
import { THEMES, TOKEN_NAMES, storedTheme, mermaidVariables } from "./theme-model.js";
import { mdBlocks, inlineSegments, questionRuns, leadSplit } from "./thread.js";
import { termRuns } from "./term-model.js";
import { codeElement } from "./code.js";
import { plotElement } from "./plot.js";
import { PLOT_LANGS } from "./plot-model.js";
import { t } from "./i18n.js";

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

/** A closed mermaid fence: rendered once per source and cached, with the source as the fallback. `cache: false` for a live preview. */
export function diagramElement(source, { cache = true } = {}) {
  const box = document.createElement("div");
  box.className = "diagram";
  const cap = document.createElement("div");
  cap.className = "cap";
  cap.textContent = t("markdown.diagram");
  box.append(cap);
  const holder = document.createElement("div");
  box.append(holder);
  if (cache && nodeCache.has(source)) {
    holder.append(nodeCache.get(source).cloneNode(true));
    return box;
  }
  if (!mermaidInit()) {
    holder.append(sourceBlock(source));
    return box;
  }
  holder.textContent = t("markdown.drawingDiagram");
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
    span.title = run.name;
    span.textContent = run.text;
    parent.append(span);
  }
}

function appendInline(parent, segments, terms = null) {
  for (const s of segments) {
    if (s.type === "text") {
      appendTermed(parent, s.text, terms);
    } else {
      const e = document.createElement(s.type); // strong | em | code
      if (s.type === "code") e.textContent = s.text;
      else appendTermed(e, s.text, terms);
      parent.append(e);
    }
  }
}

/** A question sentence the reader can click (or press Enter/Space on) to answer it directly. */
function askSpan(run, onQuestion, terms) {
  const span = document.createElement("span");
  span.className = "ask";
  span.setAttribute("role", "button");
  span.tabIndex = 0;
  span.title = t("markdown.answerThis");
  appendInline(span, inlineSegments(run.text), terms);
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
function appendProse(parent, raw, onQuestion, terms) {
  if (!onQuestion) return appendInline(parent, inlineSegments(raw), terms);
  for (const run of questionRuns(raw)) {
    if (run.question) parent.append(askSpan(run, onQuestion, terms));
    else appendInline(parent, inlineSegments(run.text), terms);
  }
}

/** A paragraph's first line with its first sentence in `.lead` and the rest in `.rest`, which the stylesheet quiets. */
function appendLead(p, raw, onQuestion, terms) {
  const [lead, rest] = leadSplit(raw);
  if (!rest) return appendProse(p, raw, onQuestion, terms);
  const first = document.createElement("span");
  first.className = "lead";
  appendProse(first, lead, onQuestion, terms);
  const after = document.createElement("span");
  after.className = "rest";
  appendProse(after, rest, onQuestion, terms);
  p.append(first, after);
}

/**
 * The rendered blocks of a markdown string, as a fragment ready to append. `onQuestion(text)` makes question
 * sentences clickable; `lead` marks each paragraph's first sentence so the line of thought can be skimmed; `terms`
 * (from `landmarkTerms`) marks the island's landmark words in prose, never in code.
 */
export function renderMarkdown(text, { onQuestion = null, lead = false, terms = null } = {}) {
  const frag = document.createDocumentFragment();
  for (const b of mdBlocks(text)) {
    if (b.type === "p") {
      const p = document.createElement("p");
      if (lead) p.className = "led";
      b.raw.forEach((raw, i) => {
        if (i) p.append(document.createElement("br"));
        if (lead && i === 0) appendLead(p, raw, onQuestion, terms);
        else if (lead) {
          const after = document.createElement("span");
          after.className = "rest";
          appendProse(after, raw, onQuestion, terms);
          p.append(after);
        } else appendProse(p, raw, onQuestion, terms);
      });
      frag.append(p);
    } else if (b.type === "quote") {
      const bq = document.createElement("blockquote");
      for (const segments of b.lines) {
        const p = document.createElement("p");
        appendInline(p, segments, terms);
        bq.append(p);
      }
      frag.append(bq);
    } else if (b.type === "h") {
      const h = document.createElement(`h${b.level}`);
      appendInline(h, b.segments, terms);
      frag.append(h);
    } else if (b.type === "list") {
      const list = document.createElement(b.ordered ? "ol" : "ul");
      for (const item of b.items) {
        const li = document.createElement("li");
        appendInline(li, item, terms);
        list.append(li);
      }
      frag.append(list);
    } else if (b.type === "code" && b.lang === "mermaid" && b.closed) {
      frag.append(diagramElement(b.text));
    } else if (b.type === "code" && b.lang === "mermaid") {
      frag.append(sourceBlock(t("markdown.drawingDiagram")));
    } else if (b.type === "code" && PLOT_LANGS.has(b.lang) && b.closed) {
      frag.append(plotElement(b.text));
    } else if (b.type === "code" && PLOT_LANGS.has(b.lang)) {
      frag.append(sourceBlock(t("markdown.drawingPlot")));
    } else if (b.type === "code") {
      frag.append(codeElement(b.lang, b.text, b.closed));
    }
  }
  return frag;
}
