// The command palette, pure: what opens it, what a command is, how typed words find and rank one, how the rows are
// grouped, and where the highlight goes. No DOM and no app state: palette.js gathers the commands and draws what this
// returns. Tested in tests/web/palette-model.test.js.
import { t } from "./i18n.js";
import { TABLES } from "./strings/index.js";
import { cheatSheet } from "./keys-model.js";
import { rowMarks } from "./outline-model.js";
import { stateLabel } from "./mode-model.js";

// ---- the key that opens it ----

/** Whether the browser runs on Apple's keyboard, where the command key is ⌘ and Ctrl is left to the text field. */
export function isMac(nav = globalThis.navigator) {
  return /Mac|iPhone|iPad|iPod/i.test(nav?.userAgentData?.platform ?? nav?.platform ?? "");
}

/** The letter a key event means: its own when it is a Latin letter, else the key's place on the board (a Zhuyin layout says "ㄜ" for K). */
function letterOf(e) {
  const key = String(e.key ?? "");
  if (/^[a-z]$/i.test(key)) return key.toLowerCase();
  return /^Key[A-Z]$/.test(e.code ?? "") ? e.code.slice(3).toLowerCase() : "";
}

/** ⌘K on a Mac, Ctrl+K elsewhere: the key that opens (and closes) the palette. Nothing else held with it. */
export function isPaletteKey(e, mac = isMac()) {
  if (letterOf(e) !== "k" || e.altKey || e.shiftKey) return false;
  return mac ? Boolean(e.metaKey) && !e.ctrlKey : Boolean(e.ctrlKey) && !e.metaKey;
}

/** The opening key as a hint for `tip()` or a row of `kbd`: "⌘K" or "Ctrl K". */
export function paletteKeys(mac = isMac()) {
  return mac ? "⌘K" : "Ctrl K";
}

// ---- shortcuts, read from the cheat sheet so the palette names the same keys ----

/**
 * The cheat sheet's rows by section and by their string key in `strings/keys-model.js`, read once as this module
 * loads: the sheet's labels were translated as its own module loaded, so they are matched in that same language.
 */
const SHORTCUTS = (() => {
  const sections = {
    everywhere: cheatSheet("outline")[0],
    outline: cheatSheet("outline")[1],
    map: cheatSheet("map")[1],
    pane: cheatSheet("pane")[1],
    board: cheatSheet("map", { board: true })[1],
    chart: cheatSheet("pane", { chart: true })[1],
  };
  const out = new Map();
  for (const [scope, section] of Object.entries(sections)) {
    for (const name of Object.keys(TABLES.keysModel.en)) {
      const label = t(`keysModel.${name}`);
      const row = section.keys.find(([, said]) => said === label);
      if (row) out.set(`${scope}:${name}`, row[0]);
    }
  }
  return out;
})();

/**
 * The key the cheat sheet gives an action, by the section it is listed in and its string key in
 * `strings/keys-model.js`: `shortcut("everywhere", "boardKey")` is "b". Null when the sheet has no such row.
 */
export function shortcut(scope, name) {
  return SHORTCUTS.get(`${scope}:${name}`) ?? null;
}

/**
 * The key to show on a command's row. A key that works everywhere always shows; one that belongs to a region (`where`:
 * "outline", "map", "pane") shows only when the reader opened the palette from that region, so a row never promises a
 * key that would have done something else from where they were.
 */
export function keysShown(command, region) {
  if (!command.keys) return null;
  return !command.where || command.where === region ? command.keys : null;
}

// ---- matching ----

/**
 * How well a typed word matched, best first. In the name: its start, the start of a word, inside a word, then
 * scattered letters. A word found whole outside the name (the detail beside it, a hidden keyword) ranks under every
 * whole match in the name but over scattered letters, which are a guess: "theme" is a theme's row before it is
 * "THE MEntor". A piece of a word outside the name is last.
 */
export const TIER = { prefix: 0, word: 1, substring: 2, otherWord: 3, scattered: 4, other: 5 };

const WORD_CHAR = /[\p{L}\p{N}]/u;
/** Scripts written without spaces: a word in one of them is found as a substring, never as scattered letters. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
/** Letters a reader abbreviates by skipping some: only these are matched scattered. */
const SPACED_WORD = /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Nd}]+$/u;

/**
 * Text folded for matching: lower case, full-width forms made plain. Always the same length as the original (a
 * character whose folded form is longer or shorter stays as it is), so a match's place is its place in the original.
 */
export function fold(text) {
  let out = "";
  for (const ch of String(text ?? "")) {
    const folded = ch.normalize("NFKC").toLowerCase();
    out += folded.length === ch.length ? folded : ch;
  }
  return out;
}

/** The words of a query, folded; any white space separates them. */
export function queryWords(query) {
  return fold(query).split(/\s+/u).filter(Boolean);
}

/** Whether a word begins at `i`: the start, after a space or a mark, or where spaced letters meet unspaced ones. */
function wordStart(text, i) {
  if (i === 0) return true;
  const prev = text[i - 1];
  if (!WORD_CHAR.test(prev)) return true;
  return UNSPACED.test(prev) !== UNSPACED.test(text[i]);
}

/** Single places as ranges, neighbours joined: [2, 3, 4, 7] → [[2, 5], [7, 8]]. */
function runsOf(places) {
  const out = [];
  for (const p of places) {
    const last = out.at(-1);
    if (last && last[1] === p) last[1] = p + 1;
    else out.push([p, p + 1]);
  }
  return out;
}

/**
 * A word's letters in order but not together, kept light so it finds abbreviations and not noise. Two ways only:
 * inside one word of the text, in the tightest run that holds them ("mtx" in "a MaTriX is a move"; three letters or
 * more, since any two letters are near each other somewhere), or as the first letters of successive words ("otb"
 * for "Open The Board", "nd" for "New Domain"). Letters strewn across several words are not a match: "theme" is not
 * "THE MEntor". Returns { ranges, span } or null.
 */
function scattered(text, word) {
  let best = null;
  for (let start = word.length >= 3 ? text.indexOf(word[0]) : -1; start >= 0; start = text.indexOf(word[0], start + 1)) {
    const places = [start];
    let at = start;
    for (let k = 1; k < word.length && at >= 0; k++) {
      at = text.indexOf(word[k], at + 1);
      if (at >= 0) places.push(at);
    }
    if (places.length < word.length) break; // a later start has even less text to find the rest in
    let oneWord = true; // the earliest letters from this start: if they leave its word, no others stay in it
    for (let i = start + 1; i <= at && oneWord; i++) oneWord = !wordStart(text, i);
    const span = at - start + 1;
    if (oneWord && (!best || span < best.span)) best = { places, span };
  }
  if (best) return { ranges: runsOf(best.places), span: best.span };
  const initials = [];
  let from = 0;
  for (const ch of word) {
    let at = text.indexOf(ch, from);
    while (at >= 0 && !wordStart(text, at)) at = text.indexOf(ch, at + 1);
    if (at < 0) return null;
    initials.push(at);
    from = at + 1;
  }
  return { ranges: runsOf(initials), span: initials.at(-1) - initials[0] + 1 };
}

/**
 * Where one folded word matches in folded text, and how well: { tier, ranges, span }, or null. The start of the text
 * beats the start of a word, which beats anywhere inside one, which beats scattered letters.
 */
export function matchWord(text, word) {
  if (!word) return null;
  const first = text.indexOf(word);
  const whole = (at, tier) => ({ tier, ranges: [[at, at + word.length]], span: word.length });
  if (first === 0) return whole(0, TIER.prefix);
  for (let at = first; at >= 0; at = text.indexOf(word, at + 1)) if (wordStart(text, at)) return whole(at, TIER.word);
  if (first > 0) return whole(first, TIER.substring);
  if (word.length < 2 || !SPACED_WORD.test(word)) return null;
  const loose = scattered(text, word);
  return loose ? { tier: TIER.scattered, ...loose } : null;
}

/** Ranges sorted and joined where they touch or overlap. */
export function mergeRanges(ranges) {
  const out = [];
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0] || x[1] - y[1])) {
    const last = out.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Text cut at its matched ranges, for drawing as text nodes: [{ text, hit }], empty pieces left out. */
export function markRuns(text, ranges = []) {
  const s = String(text ?? "");
  const out = [];
  let at = 0;
  for (const [a, b] of mergeRanges(ranges)) {
    const from = Math.max(at, Math.min(a, s.length));
    const to = Math.max(from, Math.min(b, s.length));
    if (from > at) out.push({ text: s.slice(at, from), hit: false });
    if (to > from) out.push({ text: s.slice(from, to), hit: true });
    at = to;
  }
  if (at < s.length) out.push({ text: s.slice(at), hit: false });
  return out;
}

/**
 * A command against the typed words: every word must match, in the name (best), else in the detail beside it or a
 * hidden keyword. Returns { score, loose, name, detail } (lower scores first; `name` and `detail` are the ranges to
 * mark), or null when a word matches nowhere.
 */
export function matchCommand(command, words) {
  const name = fold(command.name);
  const detail = fold(command.detail ?? "");
  const keywords = fold(command.keywords ?? "");
  const hit = { score: 0, loose: 0, name: [], detail: [] };
  for (const word of words) {
    const inName = matchWord(name, word);
    if (inName) {
      hit.score += inName.tier;
      if (inName.tier === TIER.scattered) hit.loose += inName.span;
      hit.name.push(...inName.ranges);
      continue;
    }
    // Outside the name a word must be there whole: scattered letters across a sentence of detail find anything.
    const inDetail = wholeIn(detail, word);
    const inKeywords = inDetail?.tier === TIER.otherWord ? null : wholeIn(keywords, word);
    const other = inKeywords && (!inDetail || inKeywords.tier < inDetail.tier) ? inKeywords : inDetail;
    if (!other) return null;
    hit.score += other.tier;
    if (other === inDetail) hit.detail.push(...other.ranges);
  }
  hit.name = mergeRanges(hit.name);
  hit.detail = mergeRanges(hit.detail);
  return hit;
}

function wholeIn(text, word) {
  const m = text ? matchWord(text, word) : null;
  if (!m || m.tier === TIER.scattered) return null;
  return { tier: m.tier === TIER.substring ? TIER.other : TIER.otherWord, ranges: m.ranges };
}

// ---- the rows ----

/** The groups, in the order they are listed when nothing is typed. */
export const GROUPS = ["here", "islands", "go", "domains", "appearance", "you"];
/** How many rows a typed query lists at most. */
export const RESULTS_MAX = 50;
/** How many islands the palette starts with, before anything is typed. */
export const NEARBY_MAX = 6;

/**
 * What the palette lists for a query. `commands` are `{ id, group, name, detail?, keywords?, start? }` in the order
 * they should be listed; `labels` names each group; `notes` puts a quiet line in a group (the islands still loading).
 * With nothing typed: every command but those with `start: false`, in their groups, in order. With words typed: the
 * commands that match them all, best first inside each group, and the group holding the best match first.
 * Returns { sections: [{ group, label, note, rows }], rows } where a row is { command, name, detail } (the ranges
 * to mark) and `rows` is every row in the order drawn, which is the order the highlight moves in.
 */
export function paletteSections(commands, query, { labels = {}, notes = {}, limit = RESULTS_MAX } = {}) {
  const words = queryWords(query);
  let found;
  if (words.length === 0) {
    found = commands.filter((c) => c.start !== false).map((command, order) => ({ command, name: [], detail: [], score: 0, loose: 0, order }));
  } else {
    found = [];
    commands.forEach((command, order) => {
      const hit = matchCommand(command, words);
      if (hit) found.push({ command, ...hit, order });
    });
    found.sort((a, b) => a.score - b.score || a.loose - b.loose || a.order - b.order);
    found = found.slice(0, limit);
  }
  const byGroup = new Map();
  for (const row of found) {
    if (!byGroup.has(row.command.group)) byGroup.set(row.command.group, []);
    byGroup.get(row.command.group).push(row);
  }
  const place = (group) => (GROUPS.includes(group) ? GROUPS.indexOf(group) : GROUPS.length);
  const groups = [...new Set([...byGroup.keys(), ...Object.keys(notes).filter((g) => notes[g])])];
  const best = (group) => (words.length && byGroup.has(group) ? byGroup.get(group)[0].score : Infinity);
  groups.sort((a, b) => (words.length ? cmp(best(a), best(b)) : 0) || place(a) - place(b));
  const sections = groups.map((group) => ({
    group,
    label: labels[group] ?? "",
    note: notes[group] || null,
    rows: (byGroup.get(group) ?? []).map(({ command, name, detail }) => ({ command, name, detail })),
  }));
  return { sections, rows: sections.flatMap((s) => s.rows) };
}

const cmp = (a, b) => (a === b ? 0 : a < b ? -1 : 1);

// ---- islands ----

/** Every island of an outline in one list, each parent before its islets: { node, slug, name, scale, parent } (`parent` is the name of the island it lies in, null at the top). */
export function flatIslands(islands, parent = null) {
  const out = [];
  for (const node of islands ?? []) {
    out.push({ node, slug: node.slug, name: node.name, scale: node.scale ?? null, parent });
    out.push(...flatIslands(node.children, node.name));
  }
  return out;
}

/**
 * The islands to offer before anything is typed, as slugs, nearest first and at most `cap`: the selected island's
 * own islets, then the other islands at the map's scale by their distance on the map from the selection (the
 * selection itself is left out: the reader is there). With nothing selected the harbour leads, then the rest by
 * their distance from it. `positions` is a Map slug → { x, y } for the islands the map has placed; without a
 * place an island keeps its outline order after the placed ones. A scale with no islands offers the top one's.
 */
export function nearbyIslands(flat, { selected = null, harbour = null, scale = null, positions = new Map(), cap = NEARBY_MAX } = {}) {
  let here = flat.filter((i) => i.scale === (scale ?? null));
  if (here.length === 0) here = flat.filter((i) => i.scale === null);
  const origin = here.find((i) => i.slug === selected) ?? here.find((i) => i.slug === harbour) ?? here.find((i) => i.node.harbour) ?? null;
  const from = origin ? positions.get(origin.slug) : null;
  const far = (i) => {
    if (i === origin) return -1;
    const p = positions.get(i.slug);
    return from && p ? Math.hypot(p.x - from.x, p.y - from.y) : Infinity;
  };
  const others = here
    .filter((i) => i.slug !== selected)
    .map((i, order) => ({ i, d: far(i), order }))
    .sort((a, b) => cmp(a.d, b.d) || a.order - b.order)
    .map((x) => x.i);
  const islets = selected ? flat.filter((i) => i.scale === selected) : [];
  return [...islets, ...others].slice(0, cap).map((i) => i.slug);
}

/** What an island's dot says, in words, in a lens: its verdict or how much of it is lit; in the mentor's, how much was explored. */
export function islandWords(node, lens = "judge") {
  const { total, unlocked, explored = 0 } = node.landmarks;
  if (lens === "mentor") return explored ? t("palette.explored", { explored, total }) : t("palette.unexplored");
  if (node.state !== "open") return stateLabel(node.state);
  return unlocked ? t("palette.openLit", { lit: unlocked, total }) : t("palette.open");
}

/**
 * An island as a command: its name, its dot (the outline's own classes), and beside it what the dot means and where
 * the island is (its sea when the map knows it, else the island it lies in). The slug's words are hidden keywords,
 * so an island named in another language is still found by its English ones. `near` is false for an island the
 * palette lists only once something is typed.
 */
export function islandCommand(entry, { lens = "judge", sea = null, near = true } = {}) {
  const where = sea ?? (entry.parent ? t("palette.inIsland", { name: entry.parent }) : null);
  const parts = [entry.node.harbour ? t("palette.harbour") : null, islandWords(entry.node, lens), where].filter(Boolean);
  return {
    id: `island:${entry.slug}`,
    group: "islands",
    name: entry.name,
    detail: parts.join(t("palette.partsJoin")),
    keywords: entry.slug.replaceAll("-", " "),
    dot: rowMarks(entry.node, lens).dot,
    slug: entry.slug,
    scale: entry.scale,
    start: near,
  };
}

// ---- moving ----

/**
 * Where the highlight goes for a key, as an index into the rows, or null when the key is not a move (or there is
 * nothing to move over). The arrows (and Ctrl+N / Ctrl+P) wrap round the ends; Page keys step `page` rows and stop
 * at the ends; Home and End go to them.
 */
export function moveActive(index, count, key, { page = 8, ctrl = false } = {}) {
  if (count <= 0) return null;
  const k = ctrl ? { n: "ArrowDown", p: "ArrowUp" }[String(key).toLowerCase()] : key;
  const at = index >= 0 && index < count ? index : -1;
  switch (k) {
    case "ArrowDown": return at < 0 ? 0 : (at + 1) % count;
    case "ArrowUp": return at < 0 ? count - 1 : (at - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    case "PageDown": return Math.min(count - 1, Math.max(0, at) + Math.max(1, page));
    case "PageUp": return Math.max(0, Math.max(0, at) - Math.max(1, page));
    default: return null;
  }
}
