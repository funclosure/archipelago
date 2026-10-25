// `bun run conformance [--judge api|openai|stub] [--models a,b] [--json file] [--verbose]`: a fixed script of
// persona turns, run on a throwaway database through the real route (`handleApiRequest`), against whichever model the
// environment names (as `archipelago serve --judge …` reads it), then checked against the protocols' hard rules. It
// spends real money on a real model: thirteen turns per model. A FAIL is a rule the page depends on (a tool call
// that went wrong, a slug in the reply, TeX, the wrong language, two questions); a WARN is judgement the protocol
// asks for but a good model may skip on a given turn (proposing the reef). The exit code is 1 when anything failed.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/core/db.ts";
import { createDomain, upsertDomain } from "../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../src/core/repositories/islandRepository.ts";
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
  mode: "judge" | "mentor" | "cartographer";
  island?: string; // absent with the cartographer: the domain's top scale
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
  /** The island a point_to must name (FAIL otherwise, when one was called or required). */
  point?: string;
  /** Words of which the reply should carry at least one (WARN otherwise): the probe went where an open loose end is. */
  about?: string[];
};

// ---- pure checks (tests/server/conformance.test.ts) ----

/** The reply without fenced blocks or inline code: rules about prose never look inside code. */
export function prose(reply: string): string {
  return reply.replace(/```[\s\S]*?(```|$)/g, " ").replace(/`[^`\n]*`/g, " ");
}

export function questionMarks(reply: string): number {
  return (prose(reply).replace(/https?:\/\/\S+/g, " ").match(/[?？]/g) ?? []).length;
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
  /** Islands this turn's pointers name. */
  pointed?: string[];
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
  const firstWrite = seen.tools.findIndex((t) => t !== "island_context" && t !== "chart_context");
  for (const name of turn.forbid ?? []) {
    const at = seen.tools.indexOf(name);
    if (at !== -1 && (name !== "island_context" || firstWrite === -1 || at < firstWrite)) out.push({ level: "warn", say: `called ${name}${name === "island_context" ? " before its first write" : ""}` });
  }
  for (const r of seen.refused) out.push({ level: "fail", say: `tool refused: ${r}` });
  for (const q of seen.quotes) if (!q.verbatim) out.push({ level: "fail", say: `${q.what}: evidence is not a verbatim quote` });
  out.push(languageCheck(seen.reply, turn.lang));
  const marks = questionMarks(seen.reply);
  const most = turn.questions ?? 1;
  if (marks > most) out.push({ level: "fail", say: `${marks} question marks (at most ${most})` });
  if (turn.mode !== "cartographer" && marks === 0 && !seen.decided) out.push({ level: "warn", say: "no question" });
  const leaked = leakedSlugs(seen.reply, seen.slugs);
  if (leaked.length) out.push({ level: "fail", say: `slugs in the reply: ${leaked.join(", ")}` });
  if (hasTex(seen.reply)) out.push({ level: "fail", say: "TeX in the reply" });
  if (turn.lang === "zh") {
    const simp = simplified(seen.reply);
    if (simp.length) out.push({ level: "fail", say: `Simplified characters: ${simp.join("")}` });
  }
  if (turn.point && (seen.tools.includes("point_to") || turn.require?.includes("point_to")) && !(seen.pointed ?? []).includes(turn.point)) {
    out.push({ level: "fail", say: `pointed at ${(seen.pointed ?? []).join(", ") || "nothing"}, not ${turn.point}` });
  }
  if (turn.about && !turn.about.some((w) => prose(seen.reply).toLowerCase().includes(w.toLowerCase()))) out.push({ level: "warn", say: `did not touch ${turn.about.join(" / ")}` });
  if (turn.decided && !seen.decided) out.push({ level: "fail", say: "no verdict or reef by the fourth answer" });
  return out;
}

export const worst = (checks: Check[]): Level => (checks.some((c) => c.level === "fail") ? "fail" : checks.some((c) => c.level === "warn") ? "warn" : "pass");

// ---- the script ----

/** The reader's page is in Traditional Chinese; one domain is charted, one is new. */
export const DOMAIN = "sd";
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
  { id: "cartographer: first sketch", mode: "cartographer", domain: FRESH, lang: "zh", require: ["propose_sketch"], questions: 2 },
];

/** A fresh database: a zh-TW page, System Design with a charted Caching and an empty Indexes, and a new domain. */
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
  read.close();
  const started = Date.now();
  const res = await handleApiRequest(
    new Request("http://127.0.0.1/api/probe", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1" },
      body: JSON.stringify({ domain: turn.domain, mode: turn.mode, ...(turn.island ? { island: turn.island } : {}), ...(turn.message ? { message: turn.message } : {}) }),
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
    if (!turn.island) return { seen: { reply, tools, error: failed, slugs: [], quotes: [], refused, decided: false }, ms };
    const island = db.query("select i.id from islands i join domains d on d.id = i.domain_id where d.slug = ? and i.slug = ?").get(turn.domain, turn.island) as Row;
    const landmarks = db.query("select slug, evidence, message_id as mid, explored_evidence as xev, explored_message_id as xmid from landmarks where island_id = ?").all(island.id) as Row[];
    const said = new Map((db.query("select id, body from messages where island_id = ? and role = 'you'").all(island.id) as Row[]).map((m) => [m.id, m.body as string]));
    const quotes: Observed["quotes"] = [];
    for (const l of landmarks) {
      if (l.evidence && l.mid > before) quotes.push({ what: `lit ${l.slug}`, verbatim: (said.get(l.mid) ?? "").includes(l.evidence) });
      if (l.xev && l.xmid > before) quotes.push({ what: `explored ${l.slug}`, verbatim: (said.get(l.xmid) ?? "").includes(l.xev) });
    }
    const pointed = (db.query("select t.slug from pointers p join islands t on t.id = p.target_island_id where p.island_id = ? and p.message_id > ?").all(island.id, before) as Row[]).map((r) => r.slug as string);
    const islandSlugs = (db.query("select i.slug from islands i join domains d on d.id = i.domain_id where d.slug = ?").all(turn.domain) as Row[]).map((r) => r.slug as string);
    const verdict = db.query("select 1 from verdicts where target_type = 'island' and target_id = ? limit 1").get(island.id);
    const reef = db.query("select 1 from messages where island_id = ? and kind = 'reef_proposal' limit 1").get(island.id);
    return { seen: { reply, tools, error: failed, slugs: [...landmarks.map((l) => l.slug), ...islandSlugs], quotes, refused, decided: Boolean(verdict || reef), pointed }, ms };
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
