import { test, expect } from "bun:test";
import { parseTarget, verdictInputSchema, islandInputSchema } from "../../src/core/validators.ts";
import { ArchipelagoError, NotFoundError } from "../../src/core/errors.ts";

test("parseTarget reads island and strait targets", () => {
  expect(parseTarget("island:caching")).toEqual({ type: "island", slug: "caching" });
  expect(parseTarget("strait:caching~databases")).toEqual({ type: "strait", from: "caching", to: "databases" });
});

test("parseTarget rejects malformed targets", () => {
  expect(() => parseTarget("caching")).toThrow(ArchipelagoError);
  expect(() => parseTarget("strait:caching")).toThrow(ArchipelagoError);
  expect(() => parseTarget("reef:caching")).toThrow(ArchipelagoError);
});

test("verdict input rejects unknown states and out-of-range confidence", () => {
  const base = { domain: "sd", target: "island:caching", evidence: "quote" };
  expect(verdictInputSchema.safeParse({ ...base, state: "settled", confidence: 0.8 }).success).toBe(true);
  expect(verdictInputSchema.safeParse({ ...base, state: "open", confidence: 0.8 }).success).toBe(false);
  expect(verdictInputSchema.safeParse({ ...base, state: "reef", confidence: 1.2 }).success).toBe(false);
  expect(verdictInputSchema.safeParse({ ...base, state: "reef", confidence: "0.7" }).success).toBe(true);
});

test("island slugs are lowercase kebab", () => {
  expect(islandInputSchema.safeParse({ domain: "sd", slug: "Caching", name: "Caching" }).success).toBe(false);
  expect(islandInputSchema.safeParse({ domain: "sd", slug: "cache-invalidation", name: "x" }).success).toBe(true);
});

test("errors serialise to { error, valid }", () => {
  expect(new NotFoundError("no island x", ["a", "b"]).toJSON()).toEqual({ error: "no island x", valid: ["a", "b"] });
  expect(new ArchipelagoError("plain").toJSON()).toEqual({ error: "plain" });
});
