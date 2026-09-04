import { test, expect } from "bun:test";
import { parseSseBuffer } from "../../src/web/stream.js";

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
