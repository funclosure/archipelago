// The map file on the page, the pure parts: the prompt another AI is given to write one, reading what it wrote back
// out of a paste, and the name a downloaded map is saved under. The file's rules are src/core/map-file.ts.

/** A whole, valid map file, shortened to two islands: the prompt shows it, and a test imports it. */
export const PROMPT_EXAMPLE = {
  archipelago: 1,
  name: "Caching",
  description: "Caching for backend engineers, to reason about it in design reviews.",
  islands: [
    {
      slug: "eviction",
      name: "Eviction",
      summary: "What leaves a full cache, and how the choice shapes the hit rate.",
      harbour: true,
      landmarks: [
        { slug: "lru", name: "Least recently used", terms: ["LRU", "recency"] },
        { slug: "lfu", name: "Least frequently used", terms: ["LFU", "frequency"] },
        { slug: "ttl", name: "Expiry by age", terms: ["TTL", "expiry"] },
        { slug: "working-set", name: "The working set and cache size" },
      ],
    },
    {
      slug: "invalidation",
      name: "Invalidation",
      summary: "Knowing when a stored answer is no longer true.",
      landmarks: [
        { slug: "write-through", name: "Write-through and write-behind" },
        { slug: "cache-aside", name: "Cache-aside" },
        { slug: "stale-reads", name: "Stale reads and how long they last" },
        { slug: "versioned-keys", name: "Versioned keys" },
      ],
    },
  ],
  straits: [{ from: "eviction", to: "invalidation", name: "An expired entry is both" }],
  seas: [{ name: "Keeping it right", islands: ["eviction", "invalidation"] }],
};

const LANGUAGE_LINE = {
  en: "Write names and summaries in the language of the subject line above.",
  "zh-TW": "Write every name, summary and term in Traditional Chinese as used in Taiwan (never Simplified), keeping an English technical term where the field uses it. Slugs stay ASCII.",
};

/**
 * The prompt a reader gives another AI (a chat model or a coding agent) to write a map file. `subject` is the
 * reader's own description when they wrote one. English, since a model reads it; `language` is the page's.
 */
export function agentPrompt({ subject = "", language = "en" } = {}) {
  const about = subject.trim() || "<say the subject here, where you are coming from, and what it is for>";
  return `Make a map for Archipelago (https://archipelago.school), a tool that charts a subject as islands a learner explores one at a time.

The subject: ${about}

Reply with one JSON object and nothing else. If you can write files, save it as <name>.archipelago.json instead. This example shows the shape, shortened to two islands:

${JSON.stringify(PROMPT_EXAMPLE, null, 2)}

Rules:
- "archipelago" is 1. "name" is the subject in a few words; "description" is one or two sentences on what the map is for.
- 6 to 10 islands at the top: the parts of the subject a learner would study separately, in a sensible order to learn them. Each has a short "name", a one-line "summary" of what it covers, and 4 to 6 "landmarks": the ideas someone must be able to explain before they can say they understand that island.
- Mark the one island a newcomer should start from with "harbour": true (usually the first). A scale of islets may mark its own.
- A landmark may carry "terms": 2 to 5 words a teacher would use when talking about it.
- "straits" join two islands that depend on or shed light on each other, named for what connects them. One or two per island is plenty. Both ends are top-level islands; never join an island to itself.
- "seas" are 2 to 4 names that group the islands. Every island belongs to exactly one sea.
- A large island may have "islets" (4 to 8, the same shape as islands, with landmarks) and its own "straits" among those islets. Leave islets out unless depth was asked for.
- Every "slug" is lowercase ASCII letters, digits and hyphens. Island and islet slugs are unique across the whole map; landmark slugs are unique within their island.
- Every name, summary and term is a single line. ${LANGUAGE_LINE[language] ?? LANGUAGE_LINE.en}
- No positions, no other fields, no comments, no trailing commas.`;
}

/**
 * The map file in what was pasted: models wrap JSON in a code fence or a sentence, so this takes the outermost
 * braces. Returns the parsed object, or null when there is no JSON object in the text.
 */
export function mapFromText(text) {
  const from = text.indexOf("{");
  const to = text.lastIndexOf("}");
  if (from === -1 || to <= from) return null;
  try {
    const parsed = JSON.parse(text.slice(from, to + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The name a domain's map is downloaded under. */
export const mapFileName = (slug) => `${slug}.archipelago.json`;
