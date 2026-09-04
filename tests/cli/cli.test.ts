import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase } from "../../src/core/db.ts";
import { requireDomain } from "../../src/core/repositories/domainRepository.ts";
import { requireIsland } from "../../src/core/repositories/islandRepository.ts";
import { addComment } from "../../src/core/repositories/commentRepository.ts";
import { addMessage } from "../../src/core/repositories/messageRepository.ts";

const ROOT = resolve(import.meta.dir, "../..");
let dir: string;
let dbPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-"));
  dbPath = join(dir, "test.sqlite");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type Result = { code: number; json: any; stdout: string; stderr: string };
function cli(args: string[], stdin?: object): Result {
  const proc = Bun.spawnSync(["bun", "src/cli/index.ts", ...args], {
    cwd: ROOT,
    env: { ...process.env, ARCHIPELAGO_DB_PATH: dbPath },
    stdin: stdin ? new TextEncoder().encode(JSON.stringify(stdin)) : "ignore",
  });
  const out = proc.stdout.toString().trim();
  let json: any = null;
  try {
    json = out ? JSON.parse(out) : null;
  } catch {
    json = null;
  }
  return { code: proc.exitCode, json, stdout: out, stderr: proc.stderr.toString() };
}

test("round trip: domain → islands → strait → session → verdict → snapshot", () => {
  expect(cli(["domain", "add", "--slug", "sd", "--name", "System Design"]).json).toMatchObject({ slug: "sd" });
  expect(cli(["island", "add", "--domain", "sd", "--slug", "caching", "--name", "Caching", "--summary", "Hot data close."]).code).toBe(0);
  expect(cli(["island", "add", "--domain", "sd", "--slug", "databases", "--name", "Databases"]).code).toBe(0);
  const islet = cli(["island", "add", "--domain", "sd", "--slug", "cache-eviction", "--name", "Eviction", "--parent", "caching"]);
  expect(islet.json.parentId).not.toBeNull();
  expect(cli(["strait", "add", "--domain", "sd", "--from", "databases", "--to", "caching", "--name", "cache-aside"]).json).toMatchObject({ from: "caching", to: "databases" });

  const session = cli(["session", "start", "--domain", "sd"]).json;
  expect(session.endedAt).toBeNull();
  const verdict = cli([
    "verdict", "set", "--domain", "sd", "--target", "island:caching", "--state", "settled",
    "--confidence", "0.85", "--evidence", "cache-aside means the app populates on miss", "--rationale", "applied to a scenario",
  ]).json;
  expect(verdict).toMatchObject({ target: "island:caching", state: "settled", sessionId: session.id });

  const straitVerdict = cli([
    "verdict", "set", "--domain", "sd", "--target", "strait:caching~databases", "--state", "sandbar", "--confidence", "0.6", "--evidence", "roughly",
  ]).json;
  expect(straitVerdict.target).toBe("strait:caching~databases");

  const snap = cli(["snapshot", "--domain", "sd"]).json;
  expect(snap.islands.map((i: any) => i.slug)).toEqual(["caching", "databases"]);
  expect(snap.islands[0].verdict.state).toBe("settled");
  expect(snap.islands[0].hasChildren).toBe(true);
  expect(snap.straits[0].verdict.state).toBe("sandbar");
  expect(snap.nearestOpenWater).toEqual(["databases"]);

  const inner = cli(["snapshot", "--domain", "sd", "--scale", "caching"]).json;
  expect(inner.scale.path).toEqual([{ slug: "caching", name: "Caching" }]);
  expect(inner.islands.map((i: any) => i.slug)).toEqual(["cache-eviction"]);

  expect(cli(["verdict", "history", "--domain", "sd", "--target", "island:caching"]).json.history).toHaveLength(1);
  expect(cli(["island", "show", "--domain", "sd", "--slug", "caching"]).json).toMatchObject({ slug: "caching", children: ["cache-eviction"] });
  expect(cli(["island", "list", "--domain", "sd"]).json.islands.map((i: any) => i.slug)).toEqual(["caching", "databases"]);
  expect(cli(["island", "list", "--domain", "sd", "--parent", "caching"]).json.islands).toHaveLength(1);

  const ended = cli(["session", "end", "--domain", "sd", "--summary", "charted caching"]).json;
  expect(ended.summary).toBe("charted caching");
  expect(cli(["session", "show", "--domain", "sd"]).json.active).toBeNull();
});

test("focus and comments round trip", () => {
  cli(["domain", "add", "--slug", "sd", "--name", "System Design"]);
  cli(["island", "add", "--domain", "sd", "--slug", "caching", "--name", "Caching"]);
  expect(cli(["focus", "set", "--domain", "sd", "--island", "caching"]).json.focus).toBe("caching");
  expect(cli(["focus", "show", "--domain", "sd"]).json.focus).toBe("caching");
  expect(cli(["focus", "set", "--domain", "sd", "--clear"]).json.focus).toBeNull();

  const db = openDatabase(dbPath);
  const domain = requireDomain(db, "sd");
  const island = requireIsland(db, domain.id, "caching");
  addComment(db, { domainId: domain.id, targetType: "island", targetId: island.id, body: "", kind: "probe_me" });
  addComment(db, { domainId: domain.id, targetType: "island", targetId: island.id, body: "not a reef", kind: "dispute" });
  db.close();

  const unread = cli(["comment", "list", "--domain", "sd", "--unread"]).json.comments;
  expect(unread.map((c: any) => [c.kind, c.target])).toEqual([["probe_me", "island:caching"], ["dispute", "island:caching"]]);
  expect(cli(["comment", "mark-read", "--domain", "sd", "--id", String(unread[0].id)]).json.marked).toBe(1);
  expect(cli(["comment", "list", "--domain", "sd", "--unread"]).json.comments).toHaveLength(1);
  expect(cli(["comment", "mark-read", "--domain", "sd", "--all"]).json.marked).toBe(1);
  expect(cli(["comment", "list", "--domain", "sd"]).json.comments).toHaveLength(2);
});

test("errors carry valid slugs and exit 1", () => {
  cli(["domain", "add", "--slug", "sd", "--name", "System Design"]);
  cli(["island", "add", "--domain", "sd", "--slug", "caching", "--name", "Caching"]);
  const miss = cli(["verdict", "set", "--domain", "sd", "--target", "island:nope", "--state", "settled", "--confidence", "0.9", "--evidence", "q"]);
  expect(miss.code).toBe(1);
  expect(miss.json).toEqual({ error: 'no island "nope" in this domain', valid: ["caching"] });
  const badState = cli(["verdict", "set", "--domain", "sd", "--target", "island:caching", "--state", "open", "--confidence", "0.9", "--evidence", "q"]);
  expect(badState.code).toBe(1);
  expect(badState.json.error).toContain("state");
  cli(["island", "add", "--domain", "sd", "--slug", "cache-eviction", "--name", "Eviction", "--parent", "caching"]);
  const nonSibling = cli(["strait", "add", "--domain", "sd", "--from", "caching", "--to", "cache-eviction"]);
  expect(nonSibling.code).toBe(1);
  expect(nonSibling.json.error).toContain("siblings");
  expect(cli(["domain", "show", "--slug", "nope"]).json).toEqual({ error: 'no domain "nope"', valid: ["sd"] });
  const bogus = cli(["domain", "add", "--slug", "sd", "--name", "x", "--bogus"]);
  expect(bogus.code).toBe(1);
  expect(bogus.json.error).toContain("unknown option");
  const unknownCmd = cli(["sail"]);
  expect(unknownCmd.code).toBe(1);
  expect(unknownCmd.json.error).toContain("unknown command");
  const bare = cli([]);
  expect(bare.code).toBe(1);
  expect(bare.stdout).toContain("Usage:");
  const noSub = cli(["domain"]);
  expect(noSub.code).toBe(1);
  expect(noSub.stdout).toContain("Usage:");
  expect(unknownCmd.json.error).not.toContain("\n");
});

test("reparenting an island drops its straits, visibly and atomically", () => {
  cli(["domain", "add", "--slug", "sd", "--name", "System Design"]);
  cli(["island", "add", "--domain", "sd", "--slug", "caching", "--name", "Caching"]);
  cli(["island", "add", "--domain", "sd", "--slug", "databases", "--name", "Databases"]);
  cli(["strait", "add", "--domain", "sd", "--from", "caching", "--to", "databases"]);

  const moved = cli(["island", "add", "--domain", "sd", "--slug", "caching", "--name", "Caching", "--parent", "databases"]);
  expect(moved.code).toBe(0);
  expect(moved.json.moved).toEqual({ fromParentId: null, straitsDropped: 1 });
  expect(cli(["strait", "list", "--domain", "sd"]).json.straits).toEqual([]);
});

test("comment mark-read requires --id or --all", () => {
  cli(["domain", "add", "--slug", "sd", "--name", "System Design"]);
  const result = cli(["comment", "mark-read", "--domain", "sd"]);
  expect(result.code).toBe(1);
  expect(result.json.error).toContain("--all");
});

test("--stdin merges a JSON object under the flags", () => {
  cli(["domain", "add", "--slug", "sd", "--name", "System Design"]);
  const result = cli(["island", "add", "--domain", "sd", "--stdin"], { slug: "queues", name: "Queues", summary: "Async work." });
  expect(result.code).toBe(0);
  expect(result.json).toMatchObject({ slug: "queues", summary: "Async work." });
});

test("island update --x --y round-trips", () => {
  cli(["domain", "add", "--slug", "sd", "--name", "System Design"]);
  cli(["island", "add", "--domain", "sd", "--slug", "caching", "--name", "Caching"]);
  expect(cli(["island", "show", "--domain", "sd", "--slug", "caching"]).json).toMatchObject({ x: null, y: null });
  const updated = cli(["island", "update", "--domain", "sd", "--slug", "caching", "--x", "250", "--y", "750.5"]);
  expect(updated.code).toBe(0);
  expect(updated.json).toMatchObject({ x: 250, y: 750.5 });
  expect(cli(["island", "list", "--domain", "sd"]).json.islands[0]).toMatchObject({ x: 250, y: 750.5 });
  expect(cli(["island", "update", "--domain", "sd", "--slug", "caching", "--x", "1200"]).code).toBe(1);
});

test("thread show prints an island's messages in order", () => {
  cli(["domain", "add", "--slug", "sd", "--name", "System Design"]);
  cli(["island", "add", "--domain", "sd", "--slug", "caching", "--name", "Caching"]);
  const db = openDatabase(dbPath);
  const d = requireDomain(db, "sd");
  const i = requireIsland(db, d.id, "caching");
  addMessage(db, { domainId: d.id, islandId: i.id, role: "judge", kind: "text", body: "Explain caching." });
  addMessage(db, { domainId: d.id, islandId: i.id, role: "you", kind: "text", body: "hot data close to readers" });
  db.close();
  const shown = cli(["thread", "show", "--domain", "sd", "--island", "caching"]);
  expect(shown.code).toBe(0);
  expect(shown.json.island).toBe("caching");
  expect(shown.json.messages.map((m: any) => [m.role, m.body])).toEqual([["judge", "Explain caching."], ["you", "hot data close to readers"]]);
  const missing = cli(["thread", "show", "--domain", "sd", "--island", "nope"]);
  expect(missing.code).toBe(1);
  expect(missing.json).toEqual({ error: 'no island "nope" in this domain', valid: ["caching"] });
});

test("landmark add and list", () => {
  cli(["domain", "add", "--slug", "sd", "--name", "System Design"]);
  cli(["island", "add", "--domain", "sd", "--slug", "caching", "--name", "Caching"]);
  const a = cli(["landmark", "add", "--domain", "sd", "--island", "caching", "--slug", "invalidation", "--name", "Invalidation", "--order", "2"]);
  expect(a.code).toBe(0);
  expect(a.json).toMatchObject({ slug: "invalidation", name: "Invalidation", sortOrder: 2, unlockedAt: null });
  cli(["landmark", "add", "--domain", "sd", "--island", "caching", "--slug", "hit-ratio", "--name", "Hit ratio", "--order", "1"]);
  const list = cli(["landmark", "list", "--domain", "sd", "--island", "caching"]);
  expect(list.json.island).toBe("caching");
  expect(list.json.landmarks.map((l: any) => l.slug)).toEqual(["hit-ratio", "invalidation"]);
  expect(cli(["landmark", "add", "--domain", "sd", "--island", "nope", "--slug", "x", "--name", "X"]).json).toEqual({ error: 'no island "nope" in this domain', valid: ["caching"] });
  expect(cli(["landmark", "add", "--domain", "sd", "--island", "caching", "--slug", "Bad Slug", "--name", "X"]).code).toBe(1);
});
