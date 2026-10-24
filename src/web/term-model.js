// Pure, DOM-free: which words in a reply belong to the island's landmarks. Each landmark carries the words a reply
// uses for it (`terms`, from set_landmarks or the sketch); a landmark from before terms gets words from its name.

const LATIN = /^[A-Za-z0-9]/;
const SEPARATORS = /\s*(?:[:：,，、;；/&()（）]|\bvs\.?(?=\s)|\band\b|\bor\b|與|和|及)\s*/i;

/** One fragment's singular: "B-trees" → "B-tree", "queries" → "query", "indexes" → "index"; "class" stays. */
function singular(word) {
  if (/ies$/i.test(word)) return word.slice(0, -3) + "y";
  if (/(x|ch|sh)es$/i.test(word)) return word.slice(0, -2);
  if (/[^s]s$/i.test(word) && word.length > 3) return word.slice(0, -1);
  return word;
}

/**
 * Words a reply might use for a landmark that has no terms, from its name: the name cut at separators
 * ("Indexes: B-trees vs LSM trees" → "Index", "B-tree", "LSM tree"), each made singular, plus any acronym inside
 * a longer fragment ("NoSQL families" → "NoSQL"). Fragments too short to mean anything are dropped.
 */
export function deriveTerms(name) {
  const out = [];
  for (const raw of String(name).split(SEPARATORS)) {
    const part = raw.trim();
    if (!part || (LATIN.test(part) ? part.length < 3 : part.length < 2)) continue;
    out.push(singular(part));
    if (part.includes(" ")) {
      for (const word of part.split(/\s+/)) if (/[A-Z].*[A-Z]|^[A-Z]{2,}/.test(word) && word !== part) out.push(word);
    }
  }
  return [...new Set(out)];
}

/** Every landmark's words as `{ term, slug, name }`, longest first so "LSM tree" wins over "tree"; a word claimed twice stays with the first landmark. */
export function landmarkTerms(items = []) {
  const seen = new Set();
  const out = [];
  for (const l of items) {
    for (const term of l.terms?.length ? l.terms : deriveTerms(l.name)) {
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ term, slug: l.slug, name: l.name });
    }
  }
  return out.sort((a, b) => b.term.length - a.term.length);
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A Latin term matches as a whole word (with a plural ending); a Chinese term anywhere. */
const pattern = ({ term }) => (LATIN.test(term) ? `(?<![A-Za-z0-9])${escape(term)}(?:e?s)?(?![A-Za-z0-9])` : escape(term));

/**
 * Text cut into runs: plain `{ text }`, or `{ text, slug, name }` where a landmark's word appears. The runs join back
 * to the text exactly. Matching ignores case.
 */
export function termRuns(text, terms) {
  const s = String(text);
  if (!terms?.length || !s) return s ? [{ text: s }] : [];
  const re = new RegExp(terms.map(pattern).join("|"), "gi");
  const runs = [];
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (!m[0]) continue;
    const hit = terms.find((t) => new RegExp(`^(?:${pattern(t)})$`, "i").test(m[0]));
    if (m.index > last) runs.push({ text: s.slice(last, m.index) });
    runs.push({ text: m[0], slug: hit.slug, name: hit.name });
    last = m.index + m[0].length;
  }
  if (last < s.length) runs.push({ text: s.slice(last) });
  return runs;
}
