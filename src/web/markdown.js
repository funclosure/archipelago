// mdBlocks → DOM. Built with createElement and textContent only; never innerHTML.
import { mdBlocks } from "./thread.js";

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
    } else if (b.type === "code") {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = b.text;
      pre.append(code);
      frag.append(pre);
    }
  }
  return frag;
}
