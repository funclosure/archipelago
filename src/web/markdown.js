// mdBlocks → DOM. Built with createElement and textContent only; never innerHTML.
import { mdBlocks } from "./thread.js";

const nodeCache = new Map(); // diagram source → parsed SVG node, cloned on repeat appends
const pending = new Map(); // diagram source → in-flight render promise, shared across frames
let mermaidReady = false;
let diagramSeq = 0;

function mermaidInit() {
  if (typeof window === "undefined" || !window.mermaid) return false;
  if (mermaidReady) return true;
  window.mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "dark",
    flowchart: { htmlLabels: false, useMaxWidth: false },
    sequence: { useMaxWidth: false },
    themeVariables: {
      background: "#1B3F5B", primaryColor: "#245069", primaryTextColor: "#FFFFFF", primaryBorderColor: "rgba(255,255,255,.3)",
      lineColor: "#F5C242", secondaryColor: "#163449", tertiaryColor: "#163449", noteBkgColor: "#245069", noteTextColor: "#FFFFFF",
      actorBkg: "#245069", actorBorder: "rgba(255,255,255,.3)", actorTextColor: "#FFFFFF", signalColor: "#F5C242", signalTextColor: "#FFFFFF",
      edgeLabelBackground: "#1B3F5B", fontFamily: "system-ui, sans-serif", fontSize: "13px",
    },
  });
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

/** A closed mermaid fence: rendered once per source, cached, with the source as the fallback. */
function diagramElement(source) {
  const box = document.createElement("div");
  box.className = "diagram";
  const cap = document.createElement("div");
  cap.className = "cap";
  cap.textContent = "diagram";
  box.append(cap);
  const holder = document.createElement("div");
  box.append(holder);
  if (nodeCache.has(source)) {
    holder.append(nodeCache.get(source).cloneNode(true));
    return box;
  }
  if (!mermaidInit()) {
    holder.append(sourceBlock(source));
    return box;
  }
  holder.textContent = "drawing a diagram…";
  let p = pending.get(source);
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
    pending.set(source, p);
  }
  p.then((svg) => {
    const node = svgNode(svg);
    if (!node) {
      holder.replaceChildren(sourceBlock(source));
      return;
    }
    nodeCache.set(source, node);
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

/** The rendered blocks of a markdown string, as a fragment ready to append. */
export function renderMarkdown(text) {
  const frag = document.createDocumentFragment();
  for (const b of mdBlocks(text)) {
    if (b.type === "p") {
      const p = document.createElement("p");
      b.lines.forEach((segments, i) => {
        if (i) p.append(document.createElement("br"));
        appendInline(p, segments);
      });
      frag.append(p);
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
    } else if (b.type === "code") {
      frag.append(sourceBlock(b.lang === "mermaid" ? "drawing a diagram…" : b.text));
    }
  }
  return frag;
}
