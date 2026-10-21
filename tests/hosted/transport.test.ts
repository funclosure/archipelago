// The hosted transport end to end in Bun: the page's `transport.js` (hosted mode) talking to `handler.ts` through a
// stand-in Worker that passes messages both ways, on a real database and runners scripted per test.
import { test, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { createHandler, type PageMessage, type WorkerMessage } from "../../src/hosted/handler.ts";
import type { ApiContext } from "../../src/server/api-routes.ts";
import { stubRunner } from "../../src/server/judge/stub.ts";
import type { JudgeRunner } from "../../src/server/judge/runner.ts";

let dir: string;
let ctx: ApiContext;

/** What `new Worker("/worker.js")` gives the page in these tests: the handler, over message events. */
class FakeWorker extends EventTarget {
  private onMessage = createHandler(() => ctx, (message: WorkerMessage) => {
    queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: structuredClone(message) })));
  });
  postMessage(message: PageMessage) {
    void this.onMessage(structuredClone(message));
  }
}

let request: (path: string, init?: RequestInit) => Promise<Response>;
let streamPost: (url: string, body: unknown, onEvent: (e: { type: string; data: any }) => void, signal?: AbortSignal) => Promise<void>;

beforeAll(async () => {
  (globalThis as any).ARCHIPELAGO_HOSTED = true;
  (globalThis as any).Worker = FakeWorker;
  // @ts-ignore: plain JS modules of the page
  ({ request } = await import("../../src/web/transport.js"));
  // @ts-ignore
  ({ streamPost } = await import("../../src/web/stream.js"));
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "archipelago-hosted-"));
  const dbPath = join(dir, "test.sqlite");
  const db = openDatabase(dbPath);
  const domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  upsertIsland(db, { domainId, slug: "caching", name: "Caching" });
  db.close();
  ctx = { dbPath, runner: stubRunner, turnTimeoutMs: 5_000 };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("a JSON route answers with its status, headers, and body", async () => {
  const res = await request("/api/domains");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toStartWith("application/json");
  expect((await res.json()).domains.map((d: any) => d.slug)).toEqual(["sd"]);
  const missing = await request("/api/snapshot?domain=nope");
  expect(missing.status).toBe(404);
  const made = await request("/api/domains", json({ name: "Wine" }));
  expect((await made.json()).domain.slug).toBe("wine");
});

test("a turn streams its events to done through streamPost, and the reply is stored", async () => {
  const types: string[] = [];
  await streamPost("/api/probe", { domain: "sd", island: "caching" }, (e) => types.push(e.type));
  expect(types.at(-1)).toBe("done");
  expect(types).toContain("text");
  const thread = await (await request("/api/thread?domain=sd&island=caching")).json();
  expect(thread.messages.some((m: any) => m.role === "judge")).toBe(true);
});

test("aborting mid-turn stops the runner, keeps no reply, and frees the island", async () => {
  let aborted = false;
  let started!: () => void;
  const running = new Promise<void>((resolve) => (started = resolve));
  ctx.runner = (({ signal, emit }) =>
    new Promise<string>((_resolve, reject) => {
      emit({ type: "progress", message: "thinking" } as any);
      started();
      signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("aborted"));
      });
    })) as JudgeRunner;
  const client = new AbortController();
  const turn = streamPost("/api/probe", { domain: "sd", island: "caching" }, () => {}, client.signal);
  await running;
  client.abort();
  const error = await turn.catch((e: any) => e);
  expect(error.aborted).toBe(true);
  for (let i = 0; i < 50 && !aborted; i++) await Bun.sleep(10);
  expect(aborted).toBe(true);
  const thread = await (await request("/api/thread?domain=sd&island=caching")).json();
  expect(thread.messages.filter((m: any) => m.role === "judge")).toEqual([]);
  ctx.runner = stubRunner;
  for (let i = 0; i < 100; i++) {
    const again = await request("/api/probe", json({ domain: "sd", island: "caching" }));
    if (again.status !== 409) {
      expect(again.status).toBe(200);
      await again.body?.cancel();
      break;
    }
    await Bun.sleep(20);
  }
});

test("a second turn on the same island while one runs is a 409", async () => {
  let finish!: (reply: string) => void;
  ctx.runner = (() => new Promise<string>((resolve) => (finish = resolve))) as JudgeRunner;
  const first = streamPost("/api/probe", { domain: "sd", island: "caching" }, () => {});
  for (let i = 0; i < 50 && !finish; i++) await Bun.sleep(10);
  const second = await request("/api/probe", json({ domain: "sd", island: "caching" }));
  expect(second.status).toBe(409);
  finish("done");
  await first;
});
