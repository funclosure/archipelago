// mdBlocks → DOM. Built with createElement and textContent only; never innerHTML.
import { THEMES, TOKEN_NAMES, storedTheme, mermaidVariables } from "./theme-model.js";
import { mdBlocks, inlineSegments, questionRuns } from "./thread.js";
import { codeElement } from "./code.js";

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

/** SVG markup → an element, without innerHTML. Null when the markup fails to parse. */
function svgNode(markup) {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  if (doc.getElementsByTagName("parsererror").length > 0 || doc.documentElement.nodeName === "parsererror") return null;
  for (const n of doc.querySelectorAll("script")) n.remove();
  for (const el of doc.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      if (attr.name.toLowerCase().startsWith("on")) el.removeAttribute(attr.name);
    }
  }
  return document.importNode(doc.documentElement, true);
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
  cap.textContent = "diagram";
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
  holder.textContent = "drawing a diagram…";
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

function appendInline(parent, segments) {
  for (const s of segments) {
    if (s.type === "text") {
      parent.append(s.text);
    } else {
      const e = document.createElement(s.type); // strong | em | code
      e.textContent = s.text;
      parent.append(e);
    }
  }
}

/** A question sentence the reader can click (or press Enter/Space on) to answer it directly. */
function askSpan(run, onQuestion) {
  const span = document.createElement("span");
  span.className = "ask";
  span.setAttribute("role", "button");
  span.tabIndex = 0;
  span.title = "answer this";
  appendInline(span, inlineSegments(run.text));
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

/** A paragraph line: plain inline segments, or sentence runs with questions wrapped when a handler is given. */
function appendLine(p, block, i, onQuestion) {
  if (!onQuestion) return appendInline(p, block.lines[i]);
  for (const run of questionRuns(block.raw[i])) {
    if (run.question) p.append(askSpan(run, onQuestion));
    else appendInline(p, inlineSegments(run.text));
  }
}

/** The rendered blocks of a markdown string, as a fragment ready to append. `onQuestion(text)` makes question sentences clickable. */
export function renderMarkdown(text, { onQuestion = null } = {}) {
  const frag = document.createDocumentFragment();
  for (const b of mdBlocks(text)) {
    if (b.type === "p") {
      const p = document.createElement("p");
      b.lines.forEach((_, i) => {
        if (i) p.append(document.createElement("br"));
        appendLine(p, b, i, onQuestion);
      });
      frag.append(p);
    } else if (b.type === "quote") {
      const bq = document.createElement("blockquote");
      for (const segments of b.lines) {
        const p = document.createElement("p");
        appendInline(p, segments);
        bq.append(p);
      }
      frag.append(bq);
    } else if (b.type === "h") {
      const h = document.createElement(`h${b.level}`);
      appendInline(h, b.segments);
      frag.append(h);
    } else if (b.type === "list") {
      const list = document.createElement(b.ordered ? "ol" : "ul");
      for (const item of b.items) {
        const li = document.createElement("li");
        appendInline(li, item);
        list.append(li);
      }
      frag.append(list);
    } else if (b.type === "code" && b.lang === "mermaid" && b.closed) {
      frag.append(diagramElement(b.text));
    } else if (b.type === "code" && b.lang === "mermaid") {
      frag.append(sourceBlock("drawing a diagram…"));
    } else if (b.type === "code") {
      frag.append(codeElement(b.lang, b.text, b.closed));
    }
  }
  return frag;
}
