// Working on a demo with the mentor: it updates the card the reader pinned from its reply, and reads what the demo
// printed as the reader used it.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { DEMO_STEPS_MAX, DEMO_STEP_MAX, probeInputSchema } from "../../src/core/validators.ts";
import { boardWrite, islandContext } from "../../src/server/judge/tools.ts";
import { renderJudgeContext, renderMentorContext } from "../../src/server/judge/persona.ts";
import { startServer } from "../../src/server/index.ts";
import { parseSse } from "./sse.ts";

let dir: string;
let dbPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-demo-"));
  dbPath = join(dir, "test.sqlite");
  const db = openDatabase(dbPath);
  const domain = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  upsertIsland(db, { domainId: domain, slug: "caching", name: "Caching", sortOrder: 1 });
  db.close();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("demo steps are kept to the newest few and cut short", () => {
  const many = Array.from({ length: 30 }, (_, i) => ` step ${i} ${"x".repeat(300)}`);
  const parsed = probeInputSchema.parse({ domain: "sd", island: "caching", mode: "mentor", message: "hi", demoSteps: [...many, "  "] });
  expect(parsed.demoSteps).toHaveLength(DEMO_STEPS_MAX);
  expect(parsed.demoSteps![0]).toStartWith("step 10 ");
  expect(parsed.demoSteps!.every((s) => s.length <= DEMO_STEP_MAX)).toBe(true);
  expect(probeInputSchema.parse({ domain: "sd", island: "caching" }).demoSteps).toBeUndefined();
});

test("the mentor's context lists the demo's steps as the demo's words; the judge's never does", () => {
  const ctx = islandContext({ dbPath, domain: "sd", island: "caching", mode: "mentor", demoSteps: ["A → miss", "D → evicted A"] });
  const mentor = renderMentorContext(ctx);
  expect(mentor).toContain("The reader's steps in a demo since their last message");
  expect(mentor).toContain("- D → evicted A");
  expect(mentor).toContain("never evidence");
  expect(renderMentorContext(islandContext({ dbPath, domain: "sd", island: "caching", mode: "mentor" }))).not.toContain("steps in a demo");
  expect(renderJudgeContext({ ...ctx, mode: "judge" })).not.toContain("steps in a demo");
});

test("through the route: steps reach the mentor only, and a change lands on the pinned card", async () => {
  writeFileSync(join(dir, "index.html"), "<!doctype html>");
  const server = startServer({ port: 0, dbPath, staticRoot: dir, stub: true });
  const base = `http://127.0.0.1:${server.port}`;
  const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const probe = async (body: unknown) => parseSse(await (await post("/api/probe", body)).text());
    const said = (events: Awaited<ReturnType<typeof probe>>) => events.filter((e) => e.type === "text").map((e) => e.data.text).join("");
    await probe({ domain: "sd", island: "caching", mode: "mentor" });
    expect(said(await probe({ domain: "sd", island: "caching", mode: "mentor", message: "here is what I saw", demoSteps: ["put A", "evicted B"] }))).toContain('The demo printed "evicted B" last');
    // Without steps the stub has nothing to name, and the Keeper is never handed them.
    expect(said(await probe({ domain: "sd", island: "caching", mode: "mentor", message: "here is what I saw" }))).not.toContain("The demo printed");

    const pinned = await (await post("/api/board", { domain: "sd", island: "caching", op: "add", kind: "demo", body: "<p>cache.size > 3</p>", from: "mentor" })).json();
    const events = await probe({ domain: "sd", island: "caching", mode: "mentor", message: "please change it to hold four" });
    expect(events.some((e) => e.type === "progress" && e.data.message === "board_write")).toBe(true);
    const { cards } = await (await fetch(`${base}/api/board?domain=sd&island=caching`)).json();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: pinned.card.id, author: "you", forkedFrom: "mentor" });
    expect(cards[0].body).toContain("cache.size > 4");
    const thread = await (await fetch(`${base}/api/thread?domain=sd&island=caching&mode=mentor`)).json();
    expect(thread.messages.some((m: { kind: string; body: string }) => m.kind === "system" && m.body === "board: updated a demo")).toBe(true);
  } finally {
    server.stop(true);
  }
});

test("the reader moves a card; the order holds for new cards, and a move is never an edit", async () => {
  writeFileSync(join(dir, "index.html"), "<!doctype html>");
  const server = startServer({ port: 0, dbPath, staticRoot: dir, stub: true });
  const base = `http://127.0.0.1:${server.port}`;
  const post = async (body: unknown) => (await fetch(base + "/api/board", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: "sd", island: "caching", ...(body as object) }) }));
  const ids = async () => ((await (await fetch(`${base}/api/board?domain=sd&island=caching`)).json()).cards as { id: number; updatedAt: string }[]);
  try {
    const made: number[] = [];
    for (const body of ["one", "two", "three"]) made.push((await (await post({ op: "add", kind: "note", body })).json()).card.id);
    const [a, b, c] = made as [number, number, number];
    const before = await ids();
    const moved = await (await post({ op: "move", id: c, before: a })).json();
    expect(moved.cards.map((x: { id: number }) => x.id)).toEqual([c, a, b]);
    expect((await ids()).map((x) => x.id)).toEqual([c, a, b]);
    expect((await ids()).map((x) => x.updatedAt).sort()).toEqual(before.map((x) => x.updatedAt).sort()); // not an edit
    await post({ op: "move", id: c, before: null });
    expect((await ids()).map((x) => x.id)).toEqual([a, b, c]);
    await post({ op: "move", id: b, before: a });
    const d = (await (await post({ op: "add", kind: "note", body: "four" })).json()).card.id;
    expect((await ids()).map((x) => x.id)).toEqual([b, a, c, d]); // a new card lands at the end
    expect((await post({ op: "move", id: 9999, before: null })).status).toBe(404);
    expect((await post({ op: "move", id: a, before: 9999 })).status).toBe(404);
  } finally {
    server.stop(true);
  }
});

test("no persona's tool can move a card", () => {
  expect(() => boardWrite({ dbPath, domain: "sd", island: "caching" }, { op: "move", id: 1, before: null }, "mentor")).toThrow();
});
