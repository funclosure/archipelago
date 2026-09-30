import { test, expect } from "bun:test";
import { parseSseBuffer, streamPost } from "../../src/web/stream.js";

test("parses complete frames and keeps the partial tail", () => {
  const text = 'event: text\ndata: {"type":"text","text":"Hel"}\n\n: ping\n\nevent: done\ndata: {"type":"done"}\n\nevent: text\ndata: {"ty';
  const { events, rest } = parseSseBuffer(text);
  expect(events).toEqual([
    { type: "text", data: { type: "text", text: "Hel" } },
    { type: "done", data: { type: "done" } },
  ]);
  expect(rest).toBe('event: text\ndata: {"ty');
});

test("joins multi-line data, tolerates missing event names and non-JSON data", () => {
  const { events, rest } = parseSseBuffer("data: line one\ndata: line two\n\nevent: error\ndata: plain\n\n");
  expect(events).toEqual([
    { type: "message", data: "line one\nline two" },
    { type: "error", data: "plain" },
  ]);
  expect(rest).toBe("");
});

test("a refused request throws the server's error, so the caller can give the draft back", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "a turn is already running for this island" }), { status: 409 });
  try {
    const events = [];
    await expect(streamPost("/api/probe", {}, (e) => events.push(e))).rejects.toThrow("a turn is already running for this island");
    expect(events).toEqual([]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a stream that breaks after opening throws marked midStream", async () => {
  const realFetch = globalThis.fetch;
  let pulls = 0;
  const body = new ReadableStream({
    pull(c) {
      // error() discards queued chunks, so the break comes on the second read, after the first was delivered
      if (pulls++ === 0) c.enqueue(new TextEncoder().encode('event: text\ndata: {"type":"text","text":"Hi"}\n\n'));
      else c.error(new Error("connection reset"));
    },
  });
  globalThis.fetch = async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  try {
    const events = [];
    const error = await streamPost("/api/probe", {}, (e) => events.push(e)).catch((e) => e);
    expect(error.midStream).toBe(true);
    expect(events.map((e) => e.type)).toEqual(["text"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
