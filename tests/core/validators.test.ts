import { test, expect } from "bun:test";
import { parseTarget, verdictInputSchema, islandInputSchema, positionsInputSchema, islandUpdateSchema } from "../../src/core/validators.ts";
import { ArchipelagoError, NotFoundError } from "../../src/core/errors.ts";

test("parseTarget reads island and strait targets", () => {
  expect(parseTarget("island:caching")).toEqual({ type: "island", slug: "caching" });
  expect(parseTarget("strait:caching~databases")).toEqual({ type: "strait", from: "caching", to: "databases" });
});

test("parseTarget rejects malformed targets", () => {
  expect(() => parseTarget("caching")).toThrow(ArchipelagoError);
  expect(() => parseTarget("strait:caching")).toThrow(ArchipelagoError);
  expect(() => parseTarget("reef:caching")).toThrow(ArchipelagoError);
  expect(() => parseTarget("island:foo:bar")).toThrow(ArchipelagoError);
  expect(() => parseTarget("strait:a~b~c")).toThrow(ArchipelagoError);
});

test("verdict input rejects unknown states and out-of-range confidence", () => {
  const base = { domain: "sd", target: "island:caching", evidence: "quote" };
  expect(verdictInputSchema.safeParse({ ...base, state: "settled", confidence: 0.8 }).success).toBe(true);
  expect(verdictInputSchema.safeParse({ ...base, state: "open", confidence: 0.8 }).success).toBe(false);
  expect(verdictInputSchema.safeParse({ ...base, state: "reef", confidence: 1.2 }).success).toBe(false);
  expect(verdictInputSchema.safeParse({ ...base, state: "reef", confidence: "0.7" }).success).toBe(true);
  expect(verdictInputSchema.safeParse({ ...base, state: "reef", confidence: "" }).success).toBe(false);
});

test("island slugs are lowercase kebab", () => {
  expect(islandInputSchema.safeParse({ domain: "sd", slug: "Caching", name: "Caching" }).success).toBe(false);
  expect(islandInputSchema.safeParse({ domain: "sd", slug: "cache-invalidation", name: "x" }).success).toBe(true);
});

test("errors serialise to { error, valid }", () => {
  expect(new NotFoundError("no island x", ["a", "b"]).toJSON()).toEqual({ error: "no island x", valid: ["a", "b"] });
  expect(new ArchipelagoError("plain").toJSON()).toEqual({ error: "plain" });
});

test("positions are any finite numbers within COORDINATE_MAX, and never empty", () => {
  const ok = positionsInputSchema.safeParse({ domain: "sd", positions: [{ island: "caching", x: "12.5", y: 999 }] });
  expect(ok.success).toBe(true);
  expect(ok.data!.positions[0]).toEqual({ island: "caching", x: 12.5, y: 999 });
  expect(positionsInputSchema.safeParse({ domain: "sd", positions: [] }).success).toBe(false);
  // the sea has no edge: off the old 1000-unit square is fine
  expect(positionsInputSchema.safeParse({ domain: "sd", positions: [{ island: "caching", x: 1001, y: -250 }] }).success).toBe(true);
  expect(positionsInputSchema.safeParse({ domain: "sd", positions: [{ island: "caching", x: -1_000_001, y: 0 }] }).success).toBe(false);
  expect(positionsInputSchema.safeParse({ domain: "sd", positions: [{ island: "caching", x: "", y: 0 }] }).success).toBe(false);
  expect(positionsInputSchema.safeParse({ domain: "sd", positions: [{ island: "Caching", x: 1, y: 0 }] }).success).toBe(false);
  expect(islandUpdateSchema.safeParse({ domain: "sd", slug: "caching", x: "40", y: "10" }).success).toBe(true);
  expect(islandUpdateSchema.safeParse({ domain: "sd", slug: "caching", x: -40, y: 2000 }).success).toBe(true);
  expect(islandUpdateSchema.safeParse({ domain: "sd", slug: "caching", x: 0, y: 2_000_000 }).success).toBe(false);
  expect(positionsInputSchema.safeParse({
    domain: "sd",
    positions: Array.from({ length: 1001 }, (_, i) => ({ island: `island-${i}`, x: 0, y: 0 })),
  }).success).toBe(false);
});

test("island update needs both --x and --y, or neither", () => {
  expect(islandUpdateSchema.safeParse({ domain: "sd", slug: "caching", x: 10 }).success).toBe(false);
  expect(islandUpdateSchema.safeParse({ domain: "sd", slug: "caching", y: 10 }).success).toBe(false);
  expect(islandUpdateSchema.safeParse({ domain: "sd", slug: "caching", x: 10, y: 20 }).success).toBe(true);
  expect(islandUpdateSchema.safeParse({ domain: "sd", slug: "caching" }).success).toBe(true);
});
