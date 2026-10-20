import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { getHarbour, getIsland, listIslands, upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { listLandmarks } from "../../src/core/repositories/landmarkRepository.ts";
import { listStraits, upsertStrait } from "../../src/core/repositories/straitRepository.ts";
import { listScaleMessages } from "../../src/core/repositories/messageRepository.ts";
import {
  approveSketch, attachSketch, discardSketch, listSketches, pendingSketch, proposeSketch, sketchFloor, validateSketch,
} from "../../src/core/repositories/sketchRepository.ts";
import { ConflictError } from "../../src/core/errors.ts";
import { addMessage } from "../../src/core/repositories/messageRepository.ts";

let db: Database;
let domainId: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
});

const marks = ["what", "why", "when", "limits"].map((slug) => ({ slug, name: slug }));
const island = (slug: string) => ({ slug, name: slug, summary: `about ${slug}`, landmarks: marks });
const top = (n: number, prefix = "") => Array.from({ length: n }, (_, i) => island(`${prefix}i${i + 1}`));

test("a first top-scale sketch adds 6–10 islands", () => {
  expect(() => validateSketch(db, domainId, null, { islands: top(5) })).toThrow("adds 6–10 islands, not 5");
  expect(() => validateSketch(db, domainId, null, { islands: top(11) })).toThrow();
  expect(validateSketch(db, domainId, null, { islands: top(6) }).islands).toHaveLength(6);
});

test("a first islet sketch adds 4–8; a later one at either scale has only a ceiling", () => {
  const parent = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  expect(() => validateSketch(db, domainId, parent.id, { islands: top(3, "c-") })).toThrow("adds 4–8 islands, not 3");
  expect(validateSketch(db, domainId, parent.id, { islands: top(4, "c-") }).islands).toHaveLength(4);
  // the top scale now has an island: one more is enough
  expect(validateSketch(db, domainId, null, { islands: [island("queues")] }).islands).toHaveLength(1);
});

test("slugs: unique in the domain, unique in the sketch, landmarks unique per island", () => {
  upsertIsland(db, { domainId, slug: "i1", name: "Taken" });
  expect(() => validateSketch(db, domainId, null, { islands: [island("i1")] })).toThrow(ConflictError);
  expect(() => validateSketch(db, domainId, null, { islands: [island("a"), island("a")] })).toThrow("appears twice");
  expect(() => validateSketch(db, domainId, null, { islands: [{ ...island("b"), landmarks: [...marks.slice(0, 3), marks[0]!] }] })).toThrow("landmark slugs must be unique");
});

test("straits join two islands at this scale, never themselves, never twice, never one that exists", () => {
  const a = upsertIsland(db, { domainId, slug: "a", name: "A" });
  const b = upsertIsland(db, { domainId, slug: "b", name: "B" });
  upsertIsland(db, { domainId, slug: "deep", name: "Deep", parentId: a.id });
  upsertStrait(db, { domainId, fromIslandId: a.id, toIslandId: b.id });
  expect(() => validateSketch(db, domainId, null, { straits: [{ from: "a", to: "deep" }] })).toThrow('"deep" is not an island at the top scale');
  expect(() => validateSketch(db, domainId, null, { straits: [{ from: "a", to: "a" }] })).toThrow("not \"a\" to itself");
  expect(() => validateSketch(db, domainId, null, { straits: [{ from: "b", to: "a" }] })).toThrow("the strait a~b already exists");
  expect(() => validateSketch(db, domainId, null, { islands: [island("c")], straits: [{ from: "a", to: "c" }, { from: "c", to: "a" }] })).toThrow("appears twice");
  expect(validateSketch(db, domainId, null, { islands: [island("c")], straits: [{ from: "c", to: "b" }] }).straits).toHaveLength(1);
});

test("harbour and updates name islands at this scale; an empty sketch is refused", () => {
  upsertIsland(db, { domainId, slug: "a", name: "A" });
  expect(() => validateSketch(db, domainId, null, { harbour: "nope" })).toThrow('the harbour "nope"');
  expect(() => validateSketch(db, domainId, null, { updates: [{ slug: "nope", name: "x" }] })).toThrow('"nope" is not an island already');
  expect(() => validateSketch(db, domainId, null, { updates: [{ slug: "a" }] })).toThrow("changes the name, the summary, or both");
  expect(() => validateSketch(db, domainId, null, {})).toThrow("a sketch proposes something");
  expect(validateSketch(db, domainId, null, { updates: [{ slug: "a", summary: "better" }], harbour: "a" }).updates).toHaveLength(1);
});

test("a new proposal supersedes the scale's pending one; scales are independent", () => {
  const first = proposeSketch(db, domainId, null, { islands: top(6) });
  const second = proposeSketch(db, domainId, null, { islands: top(7) });
  expect(pendingSketch(db, domainId, null)!.id).toBe(second.id);
  expect(listSketches(db, domainId, null).map((s) => [s.id, s.status])).toEqual([[first.id, "superseded"], [second.id, "pending"]]);
  const parent = upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  const islets = proposeSketch(db, domainId, parent.id, { islands: top(4, "c-") });
  expect(pendingSketch(db, domainId, parent.id)!.id).toBe(islets.id);
  expect(pendingSketch(db, domainId, null)!.id).toBe(second.id);
});

test("the database allows one pending sketch per scale", () => {
  proposeSketch(db, domainId, null, { islands: top(6) });
  expect(() => db.run("insert into sketches (domain_id, parent_island_id, body) values (?, null, '{}')", [domainId])).toThrow();
});

test("approve writes islands, landmarks, straits, harbour, and a system line, in one go", () => {
  const sketch = proposeSketch(db, domainId, null, {
    islands: top(6),
    straits: [{ from: "i1", to: "i2", name: "cache-aside" }, { from: "i2", to: "i3" }],
    harbour: "i1",
  });
  const out = approveSketch(db, domainId, sketch.id);
  expect(out).toMatchObject({ islands: 6, straits: 2, updates: 0, harbour: "i1" });
  expect(out.sketch.status).toBe("approved");
  const islands = listIslands(db, domainId, null);
  expect(islands.map((i) => [i.slug, i.sortOrder, i.x])).toEqual(top(6).map((t, i) => [t.slug, i + 1, null]));
  expect(listLandmarks(db, getIsland(db, domainId, "i1")!.id).map((l) => l.slug)).toEqual(["what", "why", "when", "limits"]);
  expect(listStraits(db, domainId, null)).toHaveLength(2);
  expect(getHarbour(db, domainId, null)!.slug).toBe("i1");
  expect(listScaleMessages(db, domainId, null).map((m) => [m.role, m.kind, m.body, m.islandId])).toEqual([
    ["cartographer", "system", "sketch approved: 6 islands, 2 straits, harbour i1", null],
  ]);
  expect(pendingSketch(db, domainId, null)).toBeNull();
});

test("approve applies updates to islands already there", () => {
  upsertIsland(db, { domainId, slug: "a", name: "A", summary: "old" });
  const sketch = proposeSketch(db, domainId, null, { updates: [{ slug: "a", name: "Alpha", summary: "new" }] });
  approveSketch(db, domainId, sketch.id);
  expect(getIsland(db, domainId, "a")).toMatchObject({ name: "Alpha", summary: "new" });
});

test("a slug taken since the proposal makes approval a conflict that writes nothing", () => {
  const sketch = proposeSketch(db, domainId, null, { islands: top(6) });
  upsertIsland(db, { domainId, slug: "i3", name: "From the terminal" });
  expect(() => approveSketch(db, domainId, sketch.id)).toThrow(ConflictError);
  expect(listIslands(db, domainId, null).map((i) => i.slug)).toEqual(["i3"]);
  expect(pendingSketch(db, domainId, null)!.id).toBe(sketch.id);
});

test("a decided sketch cannot be decided again", () => {
  const sketch = proposeSketch(db, domainId, null, { islands: top(6) });
  expect(discardSketch(db, domainId, sketch.id).status).toBe("discarded");
  expect(() => approveSketch(db, domainId, sketch.id)).toThrow("already discarded");
  expect(() => discardSketch(db, domainId, sketch.id)).toThrow(ConflictError);
});

test("attachSketch rides only a sketch proposed after the floor, at this scale, on the reply", () => {
  const floor = sketchFloor(db, domainId);
  const sketch = proposeSketch(db, domainId, null, { islands: top(6) });
  const reply = addMessage(db, { domainId, islandId: null, role: "cartographer", kind: "text", body: "Here.", mode: "cartographer" });
  attachSketch(db, domainId, null, reply.id, sketch.id); // a floor at the sketch's own id: not this turn's
  expect(pendingSketch(db, domainId, null)!.messageId).toBeNull();
  attachSketch(db, domainId, null, reply.id, floor);
  expect(pendingSketch(db, domainId, null)!.messageId).toBe(reply.id);
});
