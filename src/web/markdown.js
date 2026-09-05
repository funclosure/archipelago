// mdBlocks → DOM. Built with createElement and textContent only; never innerHTML.
import { mdBlocks } from "./thread.js";

const svgCache = new Map(); // diagram source → SVG markup; streaming re-renders never redraw
let mermaidReady = false;
let diagramSeq = 0;

function mermaidInit() {
  if (mermaidReady || typeof window === "undefined" || !window.mermaid) return Boolean(window.mermaid);
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

/** SVG markup → an element, without innerHTML. */
function svgElement(markup) {
  return new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
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
  if (svgCache.has(source)) {
    holder.append(svgElement(svgCache.get(source)));
    return box;
  }
  if (!mermaidInit()) {
    holder.append(sourceBlock(source));
    return box;
  }
  holder.textContent = "drawing a diagram…";
  window.mermaid
    .render(`diagram-${++diagramSeq}`, source)
    .then(({ svg }) => {
      svgCache.set(source, svg);
      holder.replaceChildren(svgElement(svg));
    })
    .catch(() => holder.replaceChildren(sourceBlock(source)));
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
