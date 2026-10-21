import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase } from "../../src/core/db.ts";
import { requireDomain } from "../../src/core/repositories/domainRepository.ts";
import { requireIsland } from "../../src/core/repositories/islandRepository.ts";
import { addComment } from "../../src/core/repositories/commentRepository.ts";
import { addMessage } from "../../src/core/repositories/messageRepository.ts";
import { addCard } from "../../src/core/repositories/boardRepository.ts";
import { setLandmarks, exploreLandmark } from "../../src/core/repositories/landmarkRepository.ts";
import { proposeSketch } from "../../src/core/repositories/sketchRepository.ts";

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

test("comment mark-read refuses an id that is not a positive integer", () => {
  cli(["domain", "add", "--slug", "sd", "--name", "System Design"]);
  const r = cli(["comment", "mark-read", "--domain", "sd", "--id", "abc"]);
  expect(r.code).toBe(1);
  expect(r.json.error).toBe("--id takes positive integers, got abc");
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

test("board list prints an island's cards in order", () => {
  cli(["domain", "add", "--slug", "sd", "--name", "System Design"]);
  cli(["island", "add", "--domain", "sd", "--slug", "caching", "--name", "Caching"]);
  const db = openDatabase(dbPath);
  const d = requireDomain(db, "sd");
  const i = requireIsland(db, d.id, "caching");
  addCard(db, { domainId: d.id, islandId: i.id, kind: "diagram", title: "Read path", body: "flowchart TB\n  A --> B", author: "judge" });
  addCard(db, { domainId: d.id, islandId: i.id, kind: "note", title: "", body: "the cache is checked first", author: "you" });
  db.close();
  const shown = cli(["board", "list", "--domain", "sd", "--island", "caching"]);
  expect(shown.code).toBe(0);
  expect(shown.json.island).toBe("caching");
  expect(shown.json.cards.map((c: any) => [c.kind, c.author, c.title, c.body, c.lang])).toEqual([
    ["diagram", "judge", "Read path", "flowchart TB\n  A --> B", null],
    ["note", "you", "", "the cache is checked first", null],
  ]);
  const missing = cli(["board", "list", "--domain", "sd", "--island", "nope"]);
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
  expect(cli(["landmark", "add", "--domain", "sd", "--island", "caching", "--slug", "blank", "--name", "   "]).code).toBe(1);
});

test("harbour: set, show, snapshot, clear, unknown island", () => {
  cli(["domain", "add", "--slug", "sd", "--name", "System Design"]);
  cli(["island", "add", "--domain", "sd", "--slug", "caching", "--name", "Caching"]);
  cli(["island", "add", "--domain", "sd", "--slug", "databases", "--name", "Databases"]);
  expect(cli(["harbour", "show", "--domain", "sd"]).json).toEqual({ harbour: null, parent: null });
  const set = cli(["harbour", "set", "--domain", "sd", "--island", "caching"]);
  expect(set.code).toBe(0);
  expect(set.json).toMatchObject({ harbour: "caching", parent: null });
  expect(typeof set.json.version).toBe("number");
  expect(cli(["harbour", "set", "--domain", "sd", "--island", "databases"]).json).toMatchObject({ harbour: "databases", parent: null });
  expect(cli(["harbour", "show", "--domain", "sd"]).json).toEqual({ harbour: "databases", parent: null });
  expect(cli(["snapshot", "--domain", "sd"]).json.harbour).toBe("databases");
  expect(cli(["harbour", "clear", "--domain", "sd"]).json).toMatchObject({ cleared: 1 });
  expect(cli(["harbour", "show", "--domain", "sd"]).json).toEqual({ harbour: null, parent: null });
  const bad = cli(["harbour", "set", "--domain", "sd", "--island", "nope"]);
  expect(bad.code).toBe(1);
  expect(bad.json.valid).toEqual(["caching", "databases"]);
});

test("learner show and set round-trip the one note; more than 1000 characters is refused", () => {
  expect(cli(["learner", "show"]).json).toMatchObject({ note: "" });
  const set = cli(["learner", "set", "--note", "iOS engineer; I know memory management well"]);
  expect(set.code).toBe(0);
  expect(set.json.note).toBe("iOS engineer; I know memory management well");
  expect(cli(["learner", "show"]).json.note).toBe("iOS engineer; I know memory management well");
  const long = cli(["learner", "set", "--note", "x".repeat(1001)]);
  expect(long.code).toBe(1);
  expect(long.json).toEqual({ error: "note: a note is at most 1000 characters" });
});

test("thread show --mode reads one thread; landmark list reports exploredAt", () => {
  cli(["domain", "add", "--slug", "sd", "--name", "System Design"]);
  cli(["island", "add", "--domain", "sd", "--slug", "caching", "--name", "Caching"]);
  const db = openDatabase(dbPath);
  const d = requireDomain(db, "sd");
  const i = requireIsland(db, d.id, "caching");
  addMessage(db, { domainId: d.id, islandId: i.id, role: "judge", kind: "text", body: "Explain caching." });
  addMessage(db, { domainId: d.id, islandId: i.id, role: "mentor", kind: "text", body: "Caching is a pantry by the stove.", mode: "mentor" });
  setLandmarks(db, d.id, i.id, [{ slug: "eviction", name: "Eviction" }]);
  exploreLandmark(db, i.id, "eviction", "a pantry", null);
  db.close();
  const judge = cli(["thread", "show", "--domain", "sd", "--island", "caching"]);
  expect(judge.json).toMatchObject({ island: "caching", mode: "judge" });
  expect(judge.json.messages.map((m: any) => m.body)).toEqual(["Explain caching."]);
  const mentor = cli(["thread", "show", "--domain", "sd", "--island", "caching", "--mode", "mentor"]);
  expect(mentor.json).toMatchObject({ island: "caching", mode: "mentor" });
  expect(mentor.json.messages.map((m: any) => [m.role, m.body])).toEqual([["mentor", "Caching is a pantry by the stove."]]);
  expect(cli(["thread", "show", "--domain", "sd", "--island", "caching", "--mode", "tutor"]).code).toBe(1);
  const lm = cli(["landmark", "list", "--domain", "sd", "--island", "caching"]).json.landmarks[0];
  expect(lm).toMatchObject({ slug: "eviction", unlockedAt: null, exploredEvidence: "a pantry" });
  expect(lm.exploredAt).not.toBeNull();
});

test("thread show --mode cartographer reads a scale's thread; sketch list shows what the map's cartographer proposed", () => {
  cli(["domain", "add", "--slug", "sd", "--name", "System Design"]);
  cli(["island", "add", "--domain", "sd", "--slug", "caching", "--name", "Caching"]);
  const db = openDatabase(dbPath);
  const d = requireDomain(db, "sd");
  const caching = requireIsland(db, d.id, "caching");
  addMessage(db, { domainId: d.id, islandId: null, role: "you", kind: "text", body: "add queues", mode: "cartographer" });
  addMessage(db, { domainId: d.id, islandId: caching.id, role: "you", kind: "text", body: "sail closer", mode: "cartographer" });
  proposeSketch(db, d.id, null, { islands: [{ slug: "queues", name: "Queues", summary: "Buffers between producers and consumers.", landmarks: ["a", "b", "c", "d"].map((s) => ({ slug: s, name: s })) }] });
  db.close();

  const top = cli(["thread", "show", "--domain", "sd", "--mode", "cartographer"]);
  expect(top.json).toMatchObject({ island: null, mode: "cartographer" });
  expect(top.json.messages.map((m: any) => m.body)).toEqual(["add queues"]);
  expect(cli(["thread", "show", "--domain", "sd", "--island", "caching", "--mode", "cartographer"]).json.messages.map((m: any) => m.body)).toEqual(["sail closer"]);
  expect(cli(["thread", "show", "--domain", "sd", "--mode", "judge"]).code).toBe(1); // the judge's thread needs an island

  const sketches = cli(["sketch", "list", "--domain", "sd", "--pending"]).json.sketches;
  expect(sketches.map((s: any) => [s.status, s.parentIslandId, s.body.islands[0].slug])).toEqual([["pending", null, "queues"]]);
  expect(cli(["sketch", "list", "--domain", "sd", "--island", "caching"]).json.sketches).toEqual([]);
});

test("export writes one file the hosted app imports, and never overwrites", () => {
  cli(["domain", "add", "--slug", "wine", "--name", "Wine"]);
  const out = join(dir, "backup.sqlite");
  const made = cli(["export", "--out", out]);
  expect(made.code).toBe(0);
  expect(made.json).toEqual({ out, bytes: expect.any(Number) });
  const bytes = new Uint8Array(readFileSync(out));
  expect(new TextDecoder().decode(bytes.subarray(0, 15))).toBe("SQLite format 3");
  const copy = openDatabase(out);
  expect(requireDomain(copy, "wine").name).toBe("Wine");
  copy.close();
  const again = cli(["export", "--out", out]);
  expect(again.code).toBe(1);
  expect(again.json.error).toContain("already exists");
});

test("domain add --description stores it; domain update renames and changes or clears it", () => {
  const added = cli(["domain", "add", "--slug", "rn", "--name", "React Native", "--description", "From iOS."]);
  expect(added.json).toMatchObject({ slug: "rn", description: "From iOS.", provisional: 0 });
  expect(cli(["domain", "update", "--slug", "rn", "--description", "For an interview."]).json.description).toBe("For an interview.");
  expect(cli(["domain", "update", "--slug", "rn", "--name", "RN", "--description", ""]).json).toMatchObject({ name: "RN", description: null });
  expect(cli(["domain", "update", "--slug", "rn"]).code).toBe(1);
  expect(cli(["domain", "show", "--slug", "rn"]).json.description).toBeNull();
});

test("sea add, list, update, and remove: the reader's names on the water, from the terminal", () => {
  cli(["domain", "add", "--slug", "rn", "--name", "React Native"]);
  cli(["island", "add", "--domain", "rn", "--slug", "hooks", "--name", "Hooks"]);
  const made = cli(["sea", "add", "--domain", "rn", "--name", "The React side", "--x", "-200", "--y", "40"]);
  expect(made.json).toMatchObject({ name: "The React side", x: -200, y: 40, parentIslandId: null });
  const inner = cli(["sea", "add", "--domain", "rn", "--island", "hooks", "--name", "Inside", "--x", "0", "--y", "0"]);
  expect(inner.json.parentIslandId).not.toBeNull();
  expect(cli(["sea", "list", "--domain", "rn"]).json.seas.map((s: any) => s.name)).toEqual(["The React side"]);
  expect(cli(["sea", "list", "--domain", "rn", "--island", "hooks"]).json.seas.map((s: any) => s.name)).toEqual(["Inside"]);
  expect(cli(["sea", "update", "--domain", "rn", "--id", String(made.json.id), "--name", "React"]).json.name).toBe("React");
  expect(cli(["sea", "remove", "--domain", "rn", "--id", String(made.json.id)]).json).toEqual({ removed: made.json.id });
  expect(cli(["sea", "remove", "--domain", "rn", "--id", "999"]).code).toBe(1);
});
