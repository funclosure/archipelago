// Pure helpers for the island thread. No DOM.

/** The parsed body of a reef proposal, or null when the body is not one. */
export function proposalFromBody(body) {
  try {
    const p = JSON.parse(body);
    if (p && typeof p === "object" && typeof p.claim === "string" && typeof p.consequence === "string" && typeof p.status === "string") return p;
    return null;
  } catch {
    return null;
  }
}

const LANDMARK_PREFIX = "landmark lit: ";

/** The landmark name carried by a `landmark lit: <name>` system line, or null. */
export function landmarkFromSystem(body) {
  return typeof body === "string" && body.startsWith(LANDMARK_PREFIX) ? body.slice(LANDMARK_PREFIX.length) : null;
}

/** The latest ask attached to a message, matched by messageId, or null. */
export function askFor(asks, messageId) {
  return asks.filter((a) => a.messageId === messageId).at(-1) ?? null;
}

/** Stored messages → items the card renders. A proposal that fails to parse renders as plain text. */
export function threadItems(messages) {
  return messages.map((m) => {
    if (m.kind === "system") {
      const name = landmarkFromSystem(m.body);
      if (name) return { id: m.id, role: m.role, kind: "landmark", text: name, proposal: null };
    }
    if (m.kind === "reef_proposal") {
      const proposal = proposalFromBody(m.body);
      if (proposal) return { id: m.id, role: m.role, kind: "reef_proposal", text: "", proposal };
      return { id: m.id, role: m.role, kind: "text", text: m.body, proposal: null };
    }
    return { id: m.id, role: m.role, kind: m.kind, text: m.body, proposal: null };
  });
}

// Inline markdown. Strong and em require non-space content at both ends, so "2 * 3 * 4" stays literal;
// underscores need a non-word character on the outside, so snake_case stays literal. No nesting.
const INLINE = /\*\*(\S(?:[^*\n]*?\S)?)\*\*|`([^`\n]+)`|(?<![\w*])\*(\S(?:[^*\n]*?\S)?)\*(?![\w*])|(?<!\w)_(\S(?:[^_\n]*?\S)?)_(?!\w)/g;

/** Inline markdown → segments: **strong**, *em* or _em_, `code`. Unmatched markers stay literal text. */
export function inlineSegments(text) {
  const out = [];
  let last = 0;
  let m;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ type: "strong", text: m[1] });
    else if (m[2] !== undefined) out.push({ type: "code", text: m[2] });
    else out.push({ type: "em", text: m[3] ?? m[4] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

/**
 * Block markdown, line by line, forgiving of half-written input: paragraphs (single newlines kept as
 * line breaks), #–### headings, -, *, or + bullets, 1. or 1) items, ``` fences (unclosed at the end still counts).
 */
export function mdBlocks(text) {
  const blocks = [];
  let para = [];
  let list = null;
  let fence = null;
  const flushPara = () => {
    if (para.length) blocks.push({ type: "p", lines: para.map(inlineSegments) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of String(text).split("\n")) {
    const line = raw.trimEnd();
    if (fence) {
      if (/^\s*```/.test(line)) {
        fence.closed = true;
        blocks.push(fence);
        fence = null;
      } else fence.text += (fence.text ? "\n" : "") + raw;
      continue;
    }
    const f = line.match(/^\s*```([\w+-]*)/);
    if (f) {
      flushPara();
      flushList();
      fence = { type: "code", lang: f[1].toLowerCase(), text: "", closed: false };
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.+)/);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ type: "h", level: h[1].length, segments: inlineSegments(h[2]) });
      continue;
    }
    const li = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)/);
    if (li) {
      flushPara();
      const ordered = li[2] !== undefined;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { type: "list", ordered, items: [] };
      }
      list.items.push(inlineSegments(li[3]));
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  if (fence) blocks.push(fence);
  return blocks;
}

const CHARTED_PREFIX = "charted as ";

/**
 * What the log renders: threadItems, with consecutive landmark items merged into one lit line and the
 * last "charted as" system line turned into a verdict card when the island has a verdict to show.
 */
export function logItems(messages, island) {
  const items = threadItems(messages);
  let lastCharted = -1;
  items.forEach((it, i) => {
    if (it.kind === "system" && it.text.startsWith(CHARTED_PREFIX)) lastCharted = i;
  });
  const out = [];
  items.forEach((it, i) => {
    if (it.kind === "landmark") {
      const prev = out[out.length - 1];
      if (prev && prev.kind === "landmark") prev.names.push(it.text);
      else out.push({ id: it.id, role: it.role, kind: "landmark", names: [it.text], text: it.text, proposal: null });
      return;
    }
    if (i === lastCharted && island && island.verdict) {
      out.push({ ...it, kind: "verdict", verdict: island.verdict });
      return;
    }
    out.push(it);
  });
  return out;
}
