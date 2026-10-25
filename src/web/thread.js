// Pure helpers for the island thread. No DOM.
import { t } from "./i18n.js";
import { stateLabel } from "./mode-model.js";
import { kindLabel } from "./board-model.js";

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

const EXPLORED_PREFIX = "landmark explored: ";

/** The landmark name carried by a mentor's `landmark explored: <name>` system line, or null. */
export function exploredFromSystem(body) {
  return typeof body === "string" && body.startsWith(EXPLORED_PREFIX) ? body.slice(EXPLORED_PREFIX.length) : null;
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
      const explored = exploredFromSystem(m.body);
      if (explored) return { id: m.id, role: m.role, kind: "explored", text: explored, proposal: null };
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
 * Prose lines get inline TeX as plain text (`texLite`) and full-width punctuation beside Chinese (`cjkPunctuation`); fences stay as written.
 */
export function mdBlocks(text) {
  const blocks = [];
  let para = [];
  let list = null;
  let fence = null;
  const flushPara = () => {
    if (para.length) blocks.push({ type: "p", lines: para.map(inlineSegments), raw: [...para] });
    para = [];
  };
  let quote = null;
  const flushQuote = () => {
    if (quote) blocks.push(quote);
    quote = null;
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
      flushQuote();
      fence = { type: "code", lang: f[1].toLowerCase(), text: "", closed: false };
      continue;
    }
    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) {
      flushPara();
      flushList();
      if (!quote) quote = { type: "quote", lines: [] };
      quote.lines.push(inlineSegments(prose(q[1].trim())));
      continue;
    }
    flushQuote();
    const h = line.match(/^(#{1,3})\s+(.+)/);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ type: "h", level: h[1].length, segments: inlineSegments(prose(h[2])) });
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
      list.items.push(inlineSegments(prose(li[3])));
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(prose(line.trim()));
  }
  flushPara();
  flushList();
  flushQuote();
  if (fence) blocks.push(fence);
  return blocks;
}

const CHARTED_PREFIX = "charted as "; // the server keeps its own copy: CHARTED_PREFIX in src/server/judge/tools.ts

/** Reader text messages after the last own-island "charted as" line: the judge's round, as the server counts it. */
export function roundOf(messages) {
  const last = messages.findLastIndex((m) => m.kind === "system" && m.body.startsWith(CHARTED_PREFIX));
  return messages.filter((m, i) => i > last && m.role === "you" && m.kind === "text").length;
}

/**
 * What the log renders: threadItems, with consecutive landmark items, and consecutive explored items, merged into one line, the
 * last "charted as" system line turned into a verdict card when the island has a verdict to show, and a model line before a
 * persona reply written by another model than the reply before it, above the lines its turn wrote first.
 */
export function logItems(messages, island) {
  const items = threadItems(messages);
  const modelOf = new Map(messages.map((m) => [m.id, m.model ?? null]));
  let lastModel; // undefined until the first persona reply: the thread's first model needs no line
  let lastCharted = -1;
  items.forEach((it, i) => {
    if (it.kind === "system" && it.text.startsWith(CHARTED_PREFIX)) lastCharted = i;
  });
  const out = [];
  items.forEach((it, i) => {
    if (it.kind === "landmark" || it.kind === "explored") {
      const prev = out[out.length - 1];
      if (prev && prev.kind === it.kind) prev.names.push(it.text);
      else out.push({ id: it.id, role: it.role, kind: it.kind, names: [it.text], text: it.text, proposal: null });
      return;
    }
    if (it.kind === "text" && it.role !== "you") {
      const model = modelOf.get(it.id) ?? null;
      if (lastModel !== undefined && model && model !== lastModel) {
        // Above the lines this turn wrote before its reply (a lit landmark, a reef): the new model wrote those too.
        let at = out.length;
        while (at > 0 && out[at - 1].role !== "you" && out[at - 1].kind !== "text") at--;
        out.splice(at, 0, { id: `model-${it.id}`, role: it.role, kind: "model", text: model, proposal: null });
      }
      lastModel = model;
    }
    if (i === lastCharted && island && island.verdict) {
      out.push({ ...it, kind: "verdict", verdict: island.verdict });
      return;
    }
    out.push(it);
  });
  return out;
}

/**
 * A line cut into sentences that join back to it exactly: after `.`, `!`, or `?` followed by whitespace or the end
 * (so 3.14 and e.g. stay whole), or after `。`, `！`, or `？` with any closing quote, which need no space.
 */
export function sentences(line) {
  const text = String(line);
  const out = [];
  const end = /[.!?]+(?=\s|$)\s*|[。！？]+[」』）"”]*\s*/g;
  let last = 0;
  for (const m of text.matchAll(end)) {
    const stop = m.index + m[0].length;
    if (stop > last) out.push(text.slice(last, stop));
    last = stop;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A paragraph line as sentence runs; a run that ends with `?` or `？` is a question the reader can answer directly. */
export function questionRuns(line) {
  return sentences(line).map((text) => ({ text, question: /[?？][」』）"”]*\s*$/.test(text) }));
}

/**
 * A paragraph's line split after its first sentence, `[lead, rest]`, so the page can let the rest step back;
 * `[line, ""]` when it is one sentence or the cut would fall inside **bold** or `code`.
 */
export function leadSplit(line) {
  const [lead, ...rest] = sentences(line);
  if (!rest.length || (lead.split("**").length - 1) % 2 || (lead.split("`").length - 1) % 2) return [String(line), ""];
  return [lead, rest.join("")];
}

const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/;
const FULL = { ",": "，", ":": "：", ";": "；", "?": "？", "!": "！" };

/** Half-width , : ; and ( ) beside Chinese characters, and ? ! after them, as full-width ，：；（）？！, outside `code`; Latin keeps its own. */
export function cjkPunctuation(line) {
  return String(line)
    .split(/(`[^`\n]+`)/)
    .map((part, i) => {
      if (i % 2 || !CJK.test(part)) return part;
      const near = (str, at, len) => CJK.test(str[at - 1] ?? "") || CJK.test(str[at + len] ?? "");
      return part
        .replace(/\(([^()\n]*)\)/g, (m, inner, at, str) => (near(str, at, m.length) ? `（${inner}）` : m))
        .replace(/ *([,:;]) */g, (m, p, at, str) => (near(str, at, m.length) && !/:\/\//.test(str.slice(at, at + 3)) ? FULL[p] : m))
        .replace(/ *([?!])(?![?!])/g, (m, p, at, str) => (CJK.test(str[at - 1] ?? "") ? FULL[p] : m));
    })
    .join("");
}

const PART_KEYS = { island: "partIslands", islands: "partIslands", strait: "partStraits", straits: "partStraits", update: "partUpdates", updates: "partUpdates", sea: "partSeas", seas: "partSeas" };

/** One part of a `sketch approved: …` line, in the page's language; a part it does not know stays as written. */
function sketchPart(part) {
  const named = part.match(/^named (.+)$/);
  if (named) return t("thread.partNamed", { name: named[1] });
  const harbour = part.match(/^harbour (.+)$/);
  if (harbour) return t("thread.partHarbour", { name: harbour[1] });
  const count = part.match(/^(\d+) (\w+)$/);
  if (count && PART_KEYS[count[2]]) return t(`thread.${PART_KEYS[count[2]]}`, { n: Number(count[1]) });
  return part;
}

/**
 * A system line as the page shows it, in the page's language. The server stores these lines in English with fixed
 * prefixes (they are data: the parsers above read them); this only changes how they read. A line it does not know
 * shows as stored.
 */
export function systemText(body) {
  if (typeof body !== "string") return body;
  let m = body.match(/^charted as (\w+)$/);
  if (m) return t("thread.chartedOwn", { state: stateLabel(m[1]) });
  m = body.match(/^(island|strait) (.+) charted as (\w+)$/);
  if (m) return t(m[1] === "island" ? "thread.chartedIsland" : "thread.chartedStrait", { target: m[2], state: stateLabel(m[3]) });
  m = body.match(/^board: (pinned|updated|removed) (?:"(.*)"|a (\w+))$/s);
  if (m) {
    const what = m[2] !== undefined ? t("thread.boardTitle", { title: m[2] }) : t("thread.boardKind", { kind: kindLabel(m[3]) });
    return t(`thread.board${m[1][0].toUpperCase()}${m[1].slice(1)}`, { what });
  }
  m = body.match(/^loose end( closed)?: (.*)$/s);
  if (m) return t(m[1] ? "thread.looseClosed" : "thread.looseOpened", { note: m[2] });
  if (body === "sketch discarded") return t("thread.sketchDiscarded");
  m = body.match(/^sketch approved: (.*)$/s);
  if (m) return t("thread.sketchApproved", { parts: m[1].split(", ").map(sketchPart).join(t("thread.partsJoin")) });
  return body;
}

const SUP = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", n: "ⁿ", i: "ⁱ", k: "ᵏ", "+": "⁺", "-": "⁻", "(": "⁽", ")": "⁾" };
const SUB = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉", i: "ᵢ", j: "ⱼ", k: "ₖ", n: "ₙ", "+": "₊", "-": "₋" };
const TEX = {
  cdot: "·", times: "×", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", to: "→", rightarrow: "→", infty: "∞",
  sum: "Σ", Theta: "Θ", Omega: "Ω", alpha: "α", beta: "β", lambda: "λ", epsilon: "ε", log: "log", ln: "ln", ldots: "…", dots: "…",
};
const script = (body, table) => ([...body].every((c) => c in table) ? [...body].map((c) => table[c]).join("") : null);

/** One `$…$` body as plain text: n^2 as n², \log n as log n, \sqrt{n} as √n; what it cannot say plainly keeps its ^ and _. */
function texText(body) {
  return body
    .replace(/\\sqrt\{([^{}]*)\}/g, "√$1")
    .replace(/\\(?:text|mathrm|mathit|operatorname)\{([^{}]*)\}/g, "$1")
    .replace(/\\([A-Za-z]+)/g, (m, name) => TEX[name] ?? name)
    .replace(/\^\{([^{}]*)\}|\^(\w)/g, (m, a, b) => script(a ?? b, SUP) ?? m)
    .replace(/_\{([^{}]*)\}|_(\w)/g, (m, a, b) => script(a ?? b, SUB) ?? m)
    .replace(/\\,|\\ /g, " ")
    .replace(/[{}]/g, "");
}

/**
 * Inline TeX (`$O(n^2)$`, which some models write though the page renders no math) as plain text, outside `code`.
 * Only a short body with no space at its edges, at least one math mark, and no word or $ on the outside counts,
 * so prices ($5 and $10) stay as written.
 */
export function texLite(line) {
  return String(line)
    .split(/(`[^`\n]+`)/)
    .map((part, i) =>
      i % 2 ? part : part.replace(/(?<![\w$\\])\$(?!\s)([^$\n]{1,80}?)(?<!\s)\$(?![\w$])/g, (m, body) => (/[\\^_{}()=<>+]|^[A-Za-z]$/.test(body) ? texText(body) : m)),
    )
    .join("");
}

/** A prose line as the page shows it. */
function prose(line) {
  return cjkPunctuation(texLite(line));
}
