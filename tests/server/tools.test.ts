import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { upsertStrait } from "../../src/core/repositories/straitRepository.ts";
import { addVerdict, latestVerdict } from "../../src/core/repositories/verdictRepository.ts";
import { addMessage, listMessages, parseProposal } from "../../src/core/repositories/messageRepository.ts";
import { startSession } from "../../src/core/repositories/sessionRepository.ts";
import { renderContext, renderThreadPrompt } from "../../src/server/judge/context.ts";
import { islandContext, recordVerdict, proposeReef, systemLine } from "../../src/server/judge/tools.ts";

let dir: string;
let dbPath: string;
let ids: { domain: number; caching: number; databases: number; eviction: number };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-judge-"));
  dbPath = join(dir, "test.sqlite");
  const db = openDatabase(dbPath);
  const domain = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  const caching = upsertIsland(db, { domainId: domain, slug: "caching", name: "Caching", summary: "Hot data close.", sortOrder: 1 }).id;
  const databases = upsertIsland(db, { domainId: domain, slug: "databases", name: "Databases", sortOrder: 2 }).id;
  const eviction = upsertIsland(db, { domainId: domain, slug: "cache-eviction", name: "Eviction", parentId: caching }).id;
  upsertStrait(db, { domainId: domain, fromIslandId: databases, toIslandId: caching, name: "cache-aside" });
  addVerdict(db, { targetType: "island", targetId: databases, state: "settled", confidence: 0.9, evidence: "rows and indexes" });
  startSession(db, domain);
  db.close();
  ids = { domain, caching, databases, eviction };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const deps = () => ({ dbPath, domain: "sd", island: "caching" });

test("islandContext gathers the island, islets, straits, open water, pending reefs, and the thread", () => {
  const db = openDatabase(dbPath);
  addMessage(db, { domainId: ids.domain, islandId: ids.caching, role: "judge", kind: "text", body: "Explain caching." });
  db.close();
  const ctx = islandContext(deps());
  expect(ctx.island).toEqual({ slug: "caching", name: "Caching", summary: "Hot data close.", path: ["caching"] });
  expect(ctx.verdict).toBeNull();
  expect(ctx.islets).toEqual([{ slug: "cache-eviction", name: "Eviction", state: null }]);
  expect(ctx.straits).toEqual([
    { target: "strait:caching~databases", name: "cache-aside", neighbour: { slug: "databases", name: "Databases", state: "settled" }, state: null },
  ]);
  expect(ctx.nearestOpenWater).toEqual(["caching"]);
  expect(ctx.pendingReefs).toEqual([]);
  expect(ctx.thread.map((m) => m.body)).toEqual(["Explain caching."]);
  const text = renderContext(ctx);
  expect(text).toContain("Caching");
  expect(text).toContain("strait:caching~databases");
  expect(text).toContain("cache-eviction");
});

test("renderThreadPrompt opens an empty thread and replays a full one", () => {
  expect(renderThreadPrompt([])).toBe("Open the probe on this island.");
  const db = openDatabase(dbPath);
  const a = addMessage(db, { domainId: ids.domain, islandId: ids.caching, role: "judge", kind: "text", body: "Explain caching." });
  const b = addMessage(db, { domainId: ids.domain, islandId: ids.caching, role: "you", kind: "text", body: "hot data" });
  const c = addMessage(db, { domainId: ids.domain, islandId: ids.caching, role: "judge", kind: "system", body: "charted as sandbar" });
  const d = addMessage(db, {
    domainId: ids.domain, islandId: ids.caching, role: "judge", kind: "reef_proposal",
    body: JSON.stringify({ target: "island:caching", claim: "never stale", consequence: "stale prices", evidence: "q", confidence: 0.7, rationale: "r", status: "pending" }),
  });
  db.close();
  const prompt = renderThreadPrompt([a, b, c, d]);
  expect(prompt.split("\n")).toEqual([
    "Judge: Explain caching.",
    "Reader: hot data",
    "[map] charted as sandbar",
    `[reef proposal #${d.id}, pending] never stale — stale prices`,
    "",
    "Continue as the judge.",
  ]);
});

test("recordVerdict writes the verdict, a system line on this thread, and refuses a reef", () => {
  const out = recordVerdict(deps(), { target: "island:caching", state: "settled", confidence: "0.85", evidence: "the app checks the cache first", rationale: "applied it" });
  expect(out.target).toBe("island:caching");
  expect(out.verdict).toMatchObject({ state: "settled", confidence: 0.85 });
  expect(out.verdict.sessionId).not.toBeNull();
  const db = openDatabase(dbPath);
  expect(latestVerdict(db, "island", ids.caching)?.state).toBe("settled");
  expect(listMessages(db, ids.caching).map((m) => [m.role, m.kind, m.body])).toEqual([["judge", "system", "charted as settled"]]);
  db.close();

  const strait = recordVerdict(deps(), { target: "strait:databases~caching", state: "sandbar", confidence: 0.6, evidence: "reads vs writes", rationale: "missed invalidation" });
  expect(strait.target).toBe("strait:caching~databases");
  const db2 = openDatabase(dbPath);
  expect(listMessages(db2, ids.caching).at(-1)?.body).toBe("strait caching~databases charted as sandbar");
  db2.close();

  expect(() => recordVerdict(deps(), { target: "island:caching", state: "reef", confidence: 0.9, evidence: "x", rationale: "y" })).toThrow(/state/);
  expect(() => recordVerdict(deps(), { target: "island:nope", state: "settled", confidence: 0.9, evidence: "x", rationale: "y" })).toThrow(/no island/);
  expect(() => recordVerdict(deps(), { target: "island:caching", state: "settled", confidence: 0.9, evidence: "", rationale: "y" })).toThrow();
});

test("proposeReef stores a pending proposal and writes no verdict", () => {
  const out = proposeReef(deps(), { target: "island:caching", claim: "caches never go stale", consequence: "a price change never shows", evidence: "the cache is always right", confidence: 0.8, rationale: "confident and wrong" });
  expect(out.target).toBe("island:caching");
  const db = openDatabase(dbPath);
  expect(latestVerdict(db, "island", ids.caching)).toBeNull();
  const messages = listMessages(db, ids.caching);
  expect(messages).toHaveLength(1);
  expect(messages[0]!.id).toBe(out.id);
  expect(messages[0]).toMatchObject({ role: "judge", kind: "reef_proposal" });
  expect(parseProposal(messages[0]!.body)).toMatchObject({ target: "island:caching", claim: "caches never go stale", status: "pending" });
  db.close();
  expect(islandContext(deps()).pendingReefs.map((p) => p.id)).toEqual([out.id]);
  expect(() => proposeReef(deps(), { target: "island:nope", claim: "c", consequence: "c", evidence: "e", confidence: 0.5, rationale: "r" })).toThrow(/no island/);
});

test("systemLine names the target unless it is this thread's island", () => {
  expect(systemLine("island:caching", "settled", "caching")).toBe("charted as settled");
  expect(systemLine("island:databases", "sandbar", "caching")).toBe("island databases charted as sandbar");
  expect(systemLine("strait:caching~databases", "reef", "caching")).toBe("strait caching~databases charted as reef");
});
