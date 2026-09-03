import { test, expect } from "bun:test";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain, listDomains, getDomain, requireDomain } from "../../src/core/repositories/domainRepository.ts";
import { NotFoundError } from "../../src/core/errors.ts";

test("upsertDomain inserts then updates by slug", () => {
  const db = openDatabase(":memory:");
  const a = upsertDomain(db, { slug: "sd", name: "System Design" });
  const b = upsertDomain(db, { slug: "sd", name: "System Design (renamed)" });
  expect(b.id).toBe(a.id);
  expect(b.name).toBe("System Design (renamed)");
  expect(listDomains(db)).toHaveLength(1);
});

test("requireDomain lists valid slugs on miss", () => {
  const db = openDatabase(":memory:");
  upsertDomain(db, { slug: "sd", name: "System Design" });
  upsertDomain(db, { slug: "ios", name: "iOS" });
  expect(getDomain(db, "nope")).toBeNull();
  try {
    requireDomain(db, "nope");
    throw new Error("expected throw");
  } catch (e) {
    expect(e).toBeInstanceOf(NotFoundError);
    expect((e as NotFoundError).valid).toEqual(["ios", "sd"]);
  }
});
