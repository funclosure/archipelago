// Pure, DOM-free: which names in a persona's reply are places on the reader's charts (an island in this domain or in
// another, or another domain), so the page can link them quietly (`mentions.js`). An island's name is often an
// everyday word ("Caching", "Frames"), so only a name the reply sets apart counts: a whole bold or italic span, or a
// name followed by the word island, islet or domain (島 or 領域 in Chinese). Nothing links to the island the reply is
// about or the domain it is in, nor to a name those share, since a reply names its own island all the time.

const fold = (s) => String(s).normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LATIN_START = /^[A-Za-z0-9]/;
const LATIN_END = /[A-Za-z0-9]$/;
const QUOTE_OPEN = /^[「『“‘"'《〈]+/u;
const QUOTE_CLOSE = /[」』”’"'》〉]+$/u;
const KIND_WORD = /(?:\s+(?:island|islet|domain)s?|\s*(?:島嶼|島|領域|领域))$/iu;
const DOMAIN_WORD = /(?:domain|領域|领域)s?$/iu;

/** An emphasis span's words as a place's name: quotes and a trailing "island", "islet", "domain" (島, 島嶼, 領域) taken off. */
export function bareName(text) {
  return String(text).trim().replace(KIND_WORD, "").replace(QUOTE_OPEN, "").replace(QUOTE_CLOSE, "").trim();
}

/** Of the islands that share a name, the one it means: this domain's first, then the only one, then the only one on solid ground; else none. */
function pick(list) {
  const near = list.filter((t) => t.near);
  const pool = near.length ? near : list;
  if (pool.length === 1) return pool[0];
  const ground = pool.filter((t) => t.state === "settled" || t.state === "mountainous");
  return ground.length === 1 ? ground[0] : null;
}

/** A name in prose, as a pattern: a Latin name whole (never inside a longer word), a Chinese one anywhere; any run of spaces in it matches any other. */
const alternative = (name) =>
  `${LATIN_START.test(name) ? "(?<![A-Za-z0-9])" : ""}${name.split(/\s+/).map(escape).join("\\s+")}${LATIN_END.test(name) ? "(?![A-Za-z0-9])" : ""}`;

/** What must follow a name in prose for it to count (a closing quote may come first), captured to tell an island from a domain. */
const FOLLOWED = `(?=[」』”’"'》〉]?(\\s+(?:island|islet|domain)s?(?![A-Za-z0-9])|\\s*(?:島|領域|领域)))`;

/**
 * The places a reply read on `here` ({ domain, island }: the island null in the cartographer's or the guide's pane)
 * may name, from `GET /api/places` (`{ domains: [{ slug, name }], islands: [{ domain, slug, name, scale, state }] }`).
 * Each target is `{ kind: "island" | "domain", domain, domainName, name, near }` (`near`: in this domain), an island's
 * also with `slug`, `scale` (its parent's slug, null at the top) and `state`.
 */
export function mentionIndex(places, here) {
  const domains = places?.domains ?? [];
  const islands = places?.islands ?? [];
  const domainName = new Map(domains.map((d) => [d.slug, d.name]));
  const own = new Set([domainName.get(here.domain), islands.find((i) => i.domain === here.domain && i.slug === here.island)?.name].filter(Boolean).map(fold));
  const byName = new Map();
  for (const i of islands) {
    const key = fold(i.name);
    if (!key || own.has(key)) continue;
    const target = { kind: "island", domain: i.domain, domainName: domainName.get(i.domain) ?? i.domain, slug: i.slug, name: i.name, scale: i.scale ?? null, state: i.state ?? null, near: i.domain === here.domain };
    byName.set(key, [...(byName.get(key) ?? []), target]);
  }
  const islandOf = new Map();
  for (const [key, list] of byName) {
    const target = pick(list);
    if (target) islandOf.set(key, target);
  }
  const domainOf = new Map();
  for (const d of domains) {
    const key = fold(d.name);
    if (key && !own.has(key) && d.slug !== here.domain) domainOf.set(key, { kind: "domain", domain: d.slug, domainName: d.name, name: d.name, near: false });
  }
  const names = [...new Set([...islandOf.values(), ...domainOf.values()].map((t) => t.name.trim()))].sort((a, b) => b.length - a.length);
  const pattern = names.length ? new RegExp(`(?:${names.map(alternative).join("|")})${FOLLOWED}`, "giu") : null;
  return { islands: islandOf, domains: domainOf, pattern };
}

/** A name as a target: an island first, unless the words that came with it say domain. */
function lookup(index, name, domainFirst) {
  const key = fold(name);
  return (domainFirst ? index.domains.get(key) ?? index.islands.get(key) : index.islands.get(key) ?? index.domains.get(key)) ?? null;
}

/** The place a whole bold or italic span names ("Scalability", "*Scalability island*", "「快取」"), or null. */
export function mentionOf(index, text) {
  if (!index) return null;
  return lookup(index, text, false) ?? lookup(index, bareName(text), DOMAIN_WORD.test(String(text).trim()));
}

/**
 * Plain text cut into runs: `{ text }`, or `{ text, target }` where a place's name is followed by island, islet or
 * domain ("your Scalability island", "「快取」島"); the link is the name alone. The runs join back to the text exactly.
 */
export function mentionRuns(text, index) {
  const s = String(text);
  if (!s) return [];
  if (!index?.pattern) return [{ text: s }];
  const runs = [];
  let last = 0;
  for (const m of s.matchAll(index.pattern)) {
    const target = lookup(index, m[0], DOMAIN_WORD.test(m[1].trim()));
    if (!target) continue;
    if (m.index > last) runs.push({ text: s.slice(last, m.index) });
    runs.push({ text: m[0], target });
    last = m.index + m[0].length;
  }
  if (last < s.length) runs.push({ text: s.slice(last) });
  return runs;
}

/** What the index links, as a string: a reply is drawn again only when this changes, not with every verdict elsewhere. */
export function mentionSig(index) {
  if (!index) return "";
  return JSON.stringify([[...index.islands].map(([k, t]) => [k, t.domain, t.slug, t.scale]), [...index.domains].map(([k, t]) => [k, t.domain])]);
}

/** Where a target opens as an address: the domain, and for an island its scale and itself (`app.js` selects it on load). */
export function mentionHref(target) {
  const params = new URLSearchParams({ domain: target.domain });
  if (target.kind === "island") {
    if (target.scale) params.set("scale", target.scale);
    params.set("island", target.slug);
  }
  return `/?${params}`;
}
