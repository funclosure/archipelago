// `bun run conformance [--judge api|openai|stub] [--models a,b] [--json file] [--verbose]`: a fixed script of
// persona turns, run on a throwaway database through the real route (`handleApiRequest`), against whichever model the
// environment names (as `archipelago serve --judge …` reads it), then checked against the protocols' hard rules. It
// spends real money on a real model: eighteen turns per model. A FAIL is a rule the page depends on (a tool call
// that went wrong, a slug in the reply, TeX, the wrong language, two questions); a WARN is judgement the protocol
// asks for but a good model may skip on a given turn (proposing the reef). The exit code is 1 when anything failed.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/core/db.ts";
import { createDomain, upsertDomain } from "../src/core/repositories/domainRepository.ts";
import { setHarbour, upsertIsland } from "../src/core/repositories/islandRepository.ts";
import { upsertStrait } from "../src/core/repositories/straitRepository.ts";
import { setLandmarks } from "../src/core/repositories/landmarkRepository.ts";
import { setLearnerLanguage } from "../src/core/repositories/learnerRepository.ts";
import { handleApiRequest } from "../src/server/api-routes.ts";
import type { ToolBox } from "../src/server/judge/loop.ts";
import { defaultJudge, judgeModel, parseJudgeKind, type JudgeKind, type JudgeRunner } from "../src/server/judge/runner.ts";
import { stubRunner } from "../src/server/judge/stub.ts";
import { runTool } from "../src/server/judge/tools.ts";

export type Level = "pass" | "warn" | "fail";
export type Check = { level: Level; say: string };
type Lang = "zh" | "en";

/** One scripted turn and what it must show. `require` tools FAIL when missing, `hope` tools WARN. */
export type Turn = {
  id: string;
  mode: "judge" | "mentor" | "cartographer" | "guide";
  island?: string; // absent with the cartographer (the domain's top scale) and the guide (the whole domain)
  domain: string;
  message?: string;
  lang: Lang;
  require?: string[];
  hope?: string[];
  forbid?: string[];
  /** Most question marks the reply may carry. */
  questions?: number;
  /** The island must have a verdict or a pending reef after this turn (the fourth answer decides). */
  decided?: boolean;
  /** The island a point_to or suggest_island must name (FAIL otherwise, when one was called or required). */
  point?: string;
  /** The lens the guide's card to `point` must sail in, and whether it carries the reader's message (FAIL otherwise). */
  lens?: "judge" | "mentor";
  carry?: boolean;
  /** GUIDE §5: about 80 words at most, and no fence, heading, or list (WARN otherwise). */
  short?: boolean;
  /** Words of which the reply should carry at least one (WARN otherwise): the probe went where an open loose end is. */
  about?: string[];
  /** Images the reader attaches to this message: files in scripts/fixtures/. */
  images?: string[];
  /** The turn may light no landmark and decide nothing (FAIL otherwise): an image is never evidence. */
  lightsNothing?: boolean;
};

// ---- pure checks (tests/server/conformance.test.ts) ----

/** The reply without fenced blocks or inline code: rules about prose never look inside code. */
export function prose(reply: string): string {
  return reply.replace(/```[\s\S]*?(```|$)/g, " ").replace(/`[^`\n]*`/g, " ");
}

/**
 * The questions a reply asks. A full-width ？ always ends one (Chinese runs the next sentence on without a space). A
 * half-width ? does when it ends a word and what follows is a space, the end, or closing punctuation; one with a space
 * before it, or running into more text (`= ? AND`, `(?, ?)` in SQL quoted without backticks, a URL's query), is not.
 */
export function questionMarks(reply: string): number {
  return (prose(reply).replace(/https?:\/\/\S+/g, " ").match(/？+|(?<=\S)\?+(?=$|[\s」』）)"'”’*_!！])/gu) ?? []).length;
}

/** The share of CJK characters among CJK characters and Latin letters, outside code. */
export function cjkShare(reply: string): number {
  const text = prose(reply);
  const cjk = (text.match(/[㐀-鿿]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return cjk + latin === 0 ? 0 : cjk / (cjk + latin);
}

/** Chinese replies keep English technical terms, so the bar is a share, not purity. */
export function languageCheck(reply: string, lang: Lang): Check {
  const share = cjkShare(reply);
  const pct = `${Math.round(share * 100)}% CJK`;
  if (lang === "zh") return share >= 0.3 ? { level: "pass", say: `Chinese (${pct})` } : { level: "fail", say: `expected Chinese, got ${pct}` };
  return share <= 0.05 ? { level: "pass", say: `English (${pct})` } : { level: "fail", say: `expected English, got ${pct}` };
}

/** Slugs are for tools only. A one-word slug is an ordinary word, so only hyphenated ones are looked for. */
export function leakedSlugs(reply: string, slugs: string[]): string[] {
  const text = prose(reply);
  return slugs.filter((s) => s.includes("-") && new RegExp(`(^|[^\\w-])${s.replace(/[-]/g, "\\-")}($|[^\\w-])`).test(text));
}

export function hasTex(reply: string): boolean {
  const text = prose(reply);
  return /(?<![\w$\\])\$(?!\s)[^$\n]{1,80}?(?<!\s)\$(?![\w$])/.test(text) || /\\(frac|sqrt|cdot|times|log|le|ge|text)\b/.test(text);
}

/** About how many words a reply runs to: Latin words, and Chinese at two characters a word. */
export function wordCount(reply: string): number {
  const text = prose(reply);
  const latin = (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length;
  const cjk = (text.match(/[㐀-鿿]/g) ?? []).length;
  return latin + Math.round(cjk / 2);
}

/** Lens names a Chinese reply must not use: the page calls them 守塔人 and 領航員 (GUIDE's Language section). */
export function offNames(reply: string): string[] {
  return [...new Set(prose(reply).match(/Keeper|[Mm]entor|導師/g) ?? [])];
}

/** "About 80 words" (GUIDE §5), with room for the about. */
export const SHORT_WORDS = 100;

/** Simplified characters that never appear in Traditional text: a reply on a zh-TW page must not drift. */
export function simplified(reply: string): string[] {
  return [...new Set(prose(reply).match(/[这说为们发时会过还对没现进开关样点问题么]/g) ?? [])];
}

export type Observed = {
  reply: string;
  tools: string[];
  error: string | null;
  /** Landmark slugs on the island (for the leak check), quotes the turn wrote and whether each is verbatim. */
  slugs: string[];
  quotes: { what: string; verbatim: boolean }[];
  /** Tool calls the toolbox refused (a JSON error result): the model sent something the rules turn away. */
  refused: string[];
  decided: boolean;
  /** This turn's pointers: the island each names, the lens (the guide's only), and whether it carries the question. */
  pointers?: { island: string; lens: string | null; carried: boolean }[];
  /** Landmarks this turn lit, and whether it wrote a verdict or proposed a reef. */
  lit?: string[];
  decidedNow?: boolean;
};

export function checkTurn(turn: Turn, seen: Observed): Check[] {
  const out: Check[] = [];
  if (seen.error) return [{ level: "fail", say: `turn failed: ${seen.error}` }];
  if (!seen.reply.trim()) out.push({ level: "fail", say: "empty reply" });
  for (const name of turn.require ?? []) {
    if (!seen.tools.includes(name)) out.push({ level: "fail", say: `did not call ${name}` });
  }
  for (const name of turn.hope ?? []) {
    if (!seen.tools.includes(name)) out.push({ level: "warn", say: `did not call ${name}` });
  }
  // A context tool repeats what the turn was given; calling one before the first write is the waste the protocols name.
  const reads = ["island_context", "chart_context", "guide_context"];
  const firstWrite = seen.tools.findIndex((t) => !reads.includes(t));
  for (const name of turn.forbid ?? []) {
    const at = seen.tools.indexOf(name);
    const read = reads.includes(name);
    if (at !== -1 && (!read || firstWrite === -1 || at < firstWrite)) out.push({ level: "warn", say: `called ${name}${read ? " before its first write" : ""}` });
  }
  for (const r of seen.refused) out.push({ level: "fail", say: `tool refused: ${r}` });
  for (const q of seen.quotes) if (!q.verbatim) out.push({ level: "fail", say: `${q.what}: evidence is not a verbatim quote` });
  out.push(languageCheck(seen.reply, turn.lang));
  const marks = questionMarks(seen.reply);
  const most = turn.questions ?? 1;
  if (marks > most) out.push({ level: "fail", say: `${marks} question marks (at most ${most})` });
  // The guide either asks where the reader stands or points; a pointing turn needs no question.
  const pointed = seen.pointers ?? [];
  if (turn.mode !== "cartographer" && marks === 0 && !seen.decided && !(turn.mode === "guide" && pointed.length)) out.push({ level: "warn", say: "no question" });
  const leaked = leakedSlugs(seen.reply, seen.slugs);
  if (leaked.length) out.push({ level: "fail", say: `slugs in the reply: ${leaked.join(", ")}` });
  if (hasTex(seen.reply)) out.push({ level: "fail", say: "TeX in the reply" });
  if (turn.lang === "zh") {
    const simp = simplified(seen.reply);
    if (simp.length) out.push({ level: "fail", say: `Simplified characters: ${simp.join("")}` });
  }
  const pointing = ["point_to", "suggest_island"].some((t) => seen.tools.includes(t) || turn.require?.includes(t));
  const card = pointed.find((p) => p.island === turn.point);
  if (turn.point && pointing && !card) out.push({ level: "fail", say: `pointed at ${pointed.map((p) => p.island).join(", ") || "nothing"}, not ${turn.point}` });
  if (card && turn.lens && card.lens !== turn.lens) out.push({ level: "fail", say: `sailed with ${card.lens === "judge" ? "the Keeper" : "the mentor"}, not ${turn.lens === "judge" ? "the Keeper" : "the mentor"}` });
  if (card && turn.carry !== undefined && card.carried !== turn.carry) out.push({ level: "fail", say: turn.carry ? "did not carry the reader's question" : "carried a message that is no question about the island" });
  if (turn.about && !turn.about.some((w) => prose(seen.reply).toLowerCase().includes(w.toLowerCase()))) out.push({ level: "warn", say: `did not touch ${turn.about.join(" / ")}` });
  if (turn.decided && !seen.decided) out.push({ level: "fail", say: "no verdict or reef by the fourth answer" });
  if (turn.mode === "guide" && turn.lang === "zh") {
    const off = offNames(seen.reply);
    if (off.length) out.push({ level: "fail", say: `lenses not named as the page names them: ${off.join(", ")}` });
  }
  if (turn.short) {
    const words = wordCount(seen.reply);
    if (words > SHORT_WORDS) out.push({ level: "warn", say: `${words} words (about 80 at most)` });
    if (seen.reply.includes("```")) out.push({ level: "warn", say: "a fence in the reply" });
    if (/^\s*#{1,6}\s/m.test(seen.reply)) out.push({ level: "warn", say: "a heading in the reply" });
    if (/^\s*([-*+]|\d+[.)])\s/m.test(seen.reply)) out.push({ level: "warn", say: "a list in the reply" });
  }
  if (turn.lightsNothing) {
    if (seen.lit?.length) out.push({ level: "fail", say: `lit ${seen.lit.join(", ")} from an image` });
    if (seen.decidedNow) out.push({ level: "fail", say: "decided from an image" });
  }
  return out;
}

export const worst = (checks: Check[]): Level => (checks.some((c) => c.level === "fail") ? "fail" : checks.some((c) => c.level === "warn") ? "warn" : "pass");

// ---- the script ----

/** The reader's page is in Traditional Chinese; two domains are charted, one is new. */
export const DOMAIN = "sd";
/** The guide's domain: five islands with summaries and a harbour, nothing started. */
export const GUIDE = "web";
/** Stands for the new domain's slug, which `createDomain` makes from the description. */
export const FRESH = "<new domain>";
export const SCRIPT: Turn[] = [
  { id: "judge: opening, no landmarks", mode: "judge", domain: DOMAIN, island: "indexes", lang: "zh", require: ["set_landmarks"], forbid: ["island_context"] },
  { id: "judge: opening", mode: "judge", domain: DOMAIN, island: "caching", lang: "zh", forbid: ["island_context", "set_landmarks"] },
  {
    id: "judge: answer in English", mode: "judge", domain: DOMAIN, island: "caching", lang: "en", require: ["unlock_landmark"],
    message: "Hit ratio is hits divided by total lookups. When the working set grows past the cache size, the ratio drops, because LRU keeps evicting entries that get requested again soon after.",
  },
  {
    id: "judge: a confident wrong claim", mode: "judge", domain: DOMAIN, island: "caching", lang: "en", hope: ["propose_reef"],
    message: "Invalidation never matters if the TTL is long enough: a longer TTL always keeps the cached data fresher.",
  },
  {
    id: "judge: answer in Chinese", mode: "judge", domain: DOMAIN, island: "caching", lang: "zh",
    message: "快取雪崩是很多請求同時 miss 同一個熱門 key，全部打到資料庫；可以用互斥鎖只讓一個請求去重建，其他請求等它寫回快取。",
  },
  {
    id: "judge: fourth answer decides", mode: "judge", domain: DOMAIN, island: "caching", lang: "zh", decided: true,
    message: "淘汰策略方面，LRU 遇到掃描型的工作負載會把熱資料擠掉，所以有時候要改用 LFU，或是分段的 LRU 讓新進來的資料先待在試用區。",
  },
  { id: "mentor: opening", mode: "mentor", domain: DOMAIN, island: "caching", lang: "zh", forbid: ["island_context"], questions: 2 },
  {
    id: "mentor: reader explores", mode: "mentor", domain: DOMAIN, island: "caching", lang: "zh", require: ["mark_explored"], questions: 2,
    message: "所以淘汰策略就像 NSCache 在記憶體壓力下自動丟掉東西嗎？那 LRU 跟 LFU 在實務上差在哪裡？",
  },
  {
    id: "mentor: reader is confused", mode: "mentor", domain: DOMAIN, island: "caching", lang: "zh", require: ["loose_end"], questions: 2,
    message: "快取失效這塊我一直搞不太懂。我以為只要把 TTL 設得夠短，讀到的資料就不可能是舊的，這樣理解對嗎？",
  },
  {
    id: "mentor: a question for another island", mode: "mentor", domain: DOMAIN, island: "caching", lang: "zh", require: ["point_to"], point: "indexes", questions: 2,
    message: "順便問一下，建資料庫的複合索引時，欄位順序要怎麼決定比較好？",
  },
  {
    id: "judge: probes the loose end", mode: "judge", domain: DOMAIN, island: "caching", lang: "zh", about: ["失效", "invalidation", "TTL", "舊", "stale", "過期", "修改", "更新", "異動", "一致"],
    message: "我想再多練習一下快取，再給我一題吧。",
  },
  {
    id: "judge: answer clears it", mode: "judge", domain: DOMAIN, island: "caching", lang: "zh", hope: ["loose_end"],
    message: "TTL 只決定資料最多可以舊多久，不保證新鮮；資料庫寫入成功後要主動刪掉快取裡的那個 key，下一次讀取 miss 才會從資料庫拿到新值。",
  },
  {
    // An image alone, on Indexes, whose opening question is still unanswered: the Keeper reads it, lights nothing,
    // and asks for the words (in the page's language, since the message has none).
    id: "judge: an answer as an image alone", mode: "judge", domain: DOMAIN, island: "indexes", lang: "zh", images: ["b-tree-lookup.png"], lightsNothing: true,
  },
  // The guide, on a domain the reader has not started: it asks where they stand, sends a newcomer to the harbour with
  // the mentor, someone who wants to check what they know to the Keeper, and a question to where it lives, carried.
  { id: "guide: opening", mode: "guide", domain: GUIDE, lang: "zh", forbid: ["guide_context", "suggest_island"], short: true },
  {
    id: "guide: a newcomer", mode: "guide", domain: GUIDE, lang: "zh", require: ["suggest_island"], forbid: ["guide_context"], point: "url-to-page", lens: "mentor", carry: false, short: true,
    message: "網路這塊我幾乎沒碰過，平常只寫 App 的畫面。想從頭開始，把整個流程搞懂。",
  },
  {
    id: "guide: to check what they know, in English", mode: "guide", domain: GUIDE, lang: "en", require: ["suggest_island"], forbid: ["guide_context"], point: "http-caching", lens: "judge", carry: false, short: true,
    message: "Actually, I set Cache-Control and ETag headers at work every week. I'd rather find out whether I really understand HTTP caching than start from zero.",
  },
  {
    id: "guide: a question about the subject", mode: "guide", domain: GUIDE, lang: "zh", require: ["suggest_island"], forbid: ["guide_context"], point: "dns-resolution", lens: "mentor", carry: true, short: true,
    message: "對了，DNS 查詢為什麼大多走 UDP，而不是 TCP？",
  },
  { id: "cartographer: first sketch", mode: "cartographer", domain: FRESH, lang: "zh", require: ["propose_sketch"], questions: 2 },
];

/** The guide's domain, in the map's order: slug, name, summary, landmark names. The first is the harbour. */
const WEB: [string, string, string, string[]][] = [
  ["url-to-page", "從網址到網頁", "輸入網址、按下 Enter 之後的整趟旅程：查名稱、建連線、送請求、收回應、畫出畫面。", ["整體流程", "請求與回應", "瀏覽器渲染"]],
  ["dns-resolution", "DNS 解析", "網域名稱怎麼變成 IP 位址：遞迴查詢、各層快取與 TTL，以及查詢為什麼多半走 UDP。", ["遞迴解析", "DNS 快取", "UDP 與 TCP"]],
  ["tcp-connections", "TCP 連線", "可靠的位元組串流：三次握手、重傳、流量控制與壅塞控制。", ["三次握手", "重傳", "壅塞控制"]],
  ["tls-handshake", "TLS 與 HTTPS", "憑證、金鑰交換，以及加密怎麼保護一條連線。", ["憑證鏈", "金鑰交換", "對稱加密"]],
  ["http-caching", "HTTP 快取", "Cache-Control、ETag 與條件請求：瀏覽器和 CDN 怎麼重用一個回應。", ["Cache-Control", "條件請求", "CDN"]],
];
const WEB_STRAITS: [string, string][] = [["url-to-page", "dns-resolution"], ["dns-resolution", "tcp-connections"], ["tcp-connections", "tls-handshake"], ["url-to-page", "http-caching"]];

/**
 * A fresh database: a zh-TW page, System Design with a charted Caching and an empty Indexes, the guide's networking
 * domain, and a new domain.
 */
export function seed(dbPath: string): { fresh: string } {
  const db = openDatabase(dbPath);
  setLearnerLanguage(db, "zh-TW");
  const sd = upsertDomain(db, { slug: DOMAIN, name: "系統設計", description: "準備資深工程師的系統設計面試。我寫了十年 iOS，後端經驗比較少。" });
  const caching = upsertIsland(db, { domainId: sd.id, slug: "caching", name: "快取" });
  upsertIsland(db, { domainId: sd.id, slug: "indexes", name: "資料庫索引" });
  setLandmarks(db, sd.id, caching.id, [
    { slug: "hit-ratio", name: "命中率", terms: ["命中率", "hit ratio"] },
    { slug: "eviction-policy", name: "淘汰策略", terms: ["淘汰", "eviction", "LRU"] },
    { slug: "cache-invalidation", name: "快取失效", terms: ["失效", "invalidation", "TTL"] },
    { slug: "cache-stampede", name: "快取雪崩", terms: ["雪崩", "stampede"] },
  ]);
  const web = upsertDomain(db, { slug: GUIDE, name: "網頁背後的網路", description: "想搞懂在瀏覽器輸入網址、按下 Enter 之後，到底發生了什麼。" });
  const ids = new Map<string, number>();
  WEB.forEach(([slug, name, summary, marks], at) => {
    const island = upsertIsland(db, { domainId: web.id, slug, name, summary, sortOrder: at });
    ids.set(slug, island.id);
    setLandmarks(db, web.id, island.id, marks.map((m, n) => ({ slug: `${slug}-${n + 1}`, name: m })));
  });
  setHarbour(db, web.id, WEB[0]![0]);
  for (const [a, b] of WEB_STRAITS) upsertStrait(db, { domainId: web.id, fromIslandId: ids.get(a)!, toIslandId: ids.get(b)! });
  const fresh = createDomain(db, { description: "I want to understand how a compiler turns source code into machine code, from parsing to register allocation." });
  db.close();
  return { fresh: fresh.slug };
}

type Row = Record<string, any>;

/** Tool calls the toolbox answered with an error during the current turn. */
const refusals: string[] = [];

/** The toolbox every runner gets, noting each call it refuses: the protocol sent the model one way and it went another. */
const toolbox: ToolBox = {
  context: (persona, deps) => persona.buildContext(deps),
  run: (persona, deps, name, input) => {
    const result = runTool(persona, deps, name, input);
    const text = result.content.map((c) => c.text).join("");
    let error: unknown = null;
    try {
      error = (JSON.parse(text) as { error?: unknown }).error ?? null;
    } catch {}
    if (result.isError || error) refusals.push(`${name}: ${String(error ?? text).slice(0, 160)}`);
    return result;
  },
};

/** Like `createRunner`, with the noting toolbox; the model comes from the environment as the server reads it. */
async function runnerFor(kind: JudgeKind): Promise<JudgeRunner> {
  if (kind === "stub") return stubRunner;
  if (kind === "openai") {
    const { createChatRunner, chatSettingsFromEnv } = await import("../src/server/judge/openai.ts");
    return createChatRunner({ ...chatSettingsFromEnv(), toolbox });
  }
  if (kind === "api") return (await import("../src/server/judge/api.ts")).createApiRunner({ toolbox });
  throw new Error("the conformance check runs on api, openai, or stub; the sdk runner has its own tool loop");
}

async function runTurn(dbPath: string, ctx: Parameters<typeof handleApiRequest>[1], turn: Turn): Promise<{ seen: Observed; ms: number }> {
  refusals.length = 0;
  const read = openDatabase(dbPath);
  const before = (read.query("select coalesce(max(id), 0) as m from messages").get() as Row).m as number;
  const verdictsBefore = (read.query("select coalesce(max(id), 0) as m from verdicts").get() as Row).m as number;
  read.close();
  // The reader's images go up first, as the page sends them, then ride on the message.
  const images: number[] = [];
  for (const file of turn.images ?? []) {
    const data = readFileSync(new URL(`./fixtures/${file}`, import.meta.url)).toString("base64");
    const up = await handleApiRequest(
      new Request("http://127.0.0.1/api/images", { method: "POST", headers: { "content-type": "application/json", host: "127.0.0.1" }, body: JSON.stringify({ domain: turn.domain, data }) }),
      ctx,
    );
    if (!up.ok) throw new Error(`could not upload ${file}: ${await up.text()}`);
    images.push(((await up.json()) as { image: { id: number } }).image.id);
  }
  const started = Date.now();
  const res = await handleApiRequest(
    new Request("http://127.0.0.1/api/probe", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1" },
      body: JSON.stringify({ domain: turn.domain, mode: turn.mode, ...(turn.island ? { island: turn.island } : {}), ...(turn.message ? { message: turn.message } : {}), ...(images.length ? { images } : {}) }),
    }),
    ctx,
  );
  const body = await res.text();
  const ms = Date.now() - started;
  const events = body.split("\n\n").flatMap((frame) => {
    const type = /^event: (.*)$/m.exec(frame)?.[1];
    const data = /^data: (.*)$/m.exec(frame)?.[1];
    return type && data ? [{ type, data: JSON.parse(data) }] : [];
  });
  const tools = events.filter((e) => e.type === "progress").map((e) => String(e.data.message));
  const failed = events.find((e) => e.type === "error")?.data.message ?? (res.ok ? null : `HTTP ${res.status}: ${body.slice(0, 200)}`);

  const db = openDatabase(dbPath);
  try {
    const fresh = db.query("select id, role, kind, body from messages where id > ? order by id").all(before) as Row[];
    const reply = fresh.filter((m) => m.role !== "you" && m.kind === "text").map((m) => m.body).join("\n\n");
    const refused = refusals.splice(0);
    if (turn.mode === "guide") {
      const islandSlugs = (db.query("select i.slug from islands i join domains d on d.id = i.domain_id where d.slug = ?").all(turn.domain) as Row[]).map((r) => r.slug as string);
      const pointers = (
        db.query("select t.slug as island, p.lens, p.question from pointers p join islands t on t.id = p.target_island_id join domains d on d.id = p.domain_id where d.slug = ? and p.island_id is null and p.message_id > ? order by p.id").all(turn.domain, before) as Row[]
      ).map((r) => ({ island: r.island as string, lens: (r.lens as string | null) ?? null, carried: r.question != null }));
      return { seen: { reply, tools, error: failed, slugs: islandSlugs, quotes: [], refused, decided: false, pointers }, ms };
    }
    if (!turn.island) return { seen: { reply, tools, error: failed, slugs: [], quotes: [], refused, decided: false }, ms };
    const island = db.query("select i.id from islands i join domains d on d.id = i.domain_id where d.slug = ? and i.slug = ?").get(turn.domain, turn.island) as Row;
    const landmarks = db.query("select slug, evidence, message_id as mid, explored_evidence as xev, explored_message_id as xmid from landmarks where island_id = ?").all(island.id) as Row[];
    const said = new Map((db.query("select id, body from messages where island_id = ? and role = 'you'").all(island.id) as Row[]).map((m) => [m.id, m.body as string]));
    const quotes: Observed["quotes"] = [];
    for (const l of landmarks) {
      if (l.evidence && l.mid > before) quotes.push({ what: `lit ${l.slug}`, verbatim: (said.get(l.mid) ?? "").includes(l.evidence) });
      if (l.xev && l.xmid > before) quotes.push({ what: `explored ${l.slug}`, verbatim: (said.get(l.xmid) ?? "").includes(l.xev) });
    }
    const pointers = (db.query("select t.slug, p.question from pointers p join islands t on t.id = p.target_island_id where p.island_id = ? and p.message_id > ?").all(island.id, before) as Row[]).map((r) => ({ island: r.slug as string, lens: null, carried: r.question != null }));
    const islandSlugs = (db.query("select i.slug from islands i join domains d on d.id = i.domain_id where d.slug = ?").all(turn.domain) as Row[]).map((r) => r.slug as string);
    const verdict = db.query("select 1 from verdicts where target_type = 'island' and target_id = ? limit 1").get(island.id);
    const reef = db.query("select 1 from messages where island_id = ? and kind = 'reef_proposal' limit 1").get(island.id);
    const lit = landmarks.filter((l) => l.evidence && l.mid > before).map((l) => l.slug as string);
    const decidedNow = Boolean(
      db.query("select 1 from verdicts where target_type = 'island' and target_id = ? and id > ? limit 1").get(island.id, verdictsBefore) ||
        db.query("select 1 from messages where island_id = ? and kind = 'reef_proposal' and id > ? limit 1").get(island.id, before),
    );
    return { seen: { reply, tools, error: failed, slugs: [...landmarks.map((l) => l.slug), ...islandSlugs], quotes, refused, decided: Boolean(verdict || reef), pointers, lit, decidedNow }, ms };
  } finally {
    db.close();
  }
}

export type Result = { model: string | null; turns: { id: string; ms: number; tools: string[]; checks: Check[]; reply: string }[] };

/** Runs the whole script on one model, each model on its own fresh database. */
export async function runScript(kind: JudgeKind, dir: string, log: (line: string) => void = () => {}): Promise<Result> {
  const model = judgeModel(kind);
  const dbPath = join(dir, `${(model ?? kind).replace(/[^\w.-]+/g, "_")}.sqlite`);
  const { fresh } = seed(dbPath);
  const ctx = { dbPath, runner: await runnerFor(kind), turnTimeoutMs: 300_000, model: () => model };
  const result: Result = { model, turns: [] };
  for (const turn of SCRIPT) {
    const { seen, ms } = await runTurn(dbPath, ctx, turn.domain === FRESH ? { ...turn, domain: fresh } : turn);
    const checks = checkTurn(turn, seen);
    result.turns.push({ id: turn.id, ms, tools: seen.tools, checks, reply: seen.reply });
    log(`  ${mark(worst(checks))} ${turn.id} · ${(ms / 1000).toFixed(1)} s · ${seen.tools.join(", ") || "no tools"}`);
    for (const c of checks) if (c.level !== "pass") log(`      ${c.level}: ${c.say}`);
  }
  return result;
}

const mark = (level: Level) => ({ pass: "✓", warn: "!", fail: "✗" })[level];

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args[at + 1];
  };
  const kind = flag("--judge") ? parseJudgeKind(flag("--judge")!, "--judge") : defaultJudge();
  const models = flag("--models")?.split(",").map((m) => m.trim()).filter(Boolean) ?? [undefined];
  const verbose = args.includes("--verbose");
  const dir = mkdtempSync(join(tmpdir(), "archipelago-conformance-"));
  const results: Result[] = [];
  for (const model of models) {
    if (model) process.env.ARCHIPELAGO_MODEL = model;
    console.log(`${kind} · ${judgeModel(kind) ?? "stub"}`);
    const result = await runScript(kind, dir, console.log);
    if (verbose) for (const t of result.turns) console.log(`\n--- ${t.id}\n${t.reply}`);
    results.push(result);
  }
  console.log("\nsummary");
  for (const r of results) {
    const levels = r.turns.map((t) => worst(t.checks));
    const count = (l: Level) => levels.filter((x) => x === l).length;
    const secs = r.turns.reduce((s, t) => s + t.ms, 0) / 1000;
    console.log(`  ${mark(count("fail") ? "fail" : count("warn") ? "warn" : "pass")} ${r.model ?? "stub"}: ${count("pass")} pass, ${count("warn")} warn, ${count("fail")} fail · ${secs.toFixed(0)} s`);
  }
  const out = flag("--json");
  if (out) writeFileSync(out, JSON.stringify(results, null, 2));
  // Each model's database holds its whole conversation: `ARCHIPELAGO_DB_PATH=<file> archipelago serve` shows it.
  console.log(`\nconversations: ${dir}`);
  process.exit(results.some((r) => r.turns.some((t) => worst(t.checks) === "fail")) ? 1 : 0);
}
