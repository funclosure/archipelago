import { test, expect } from "bun:test";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { getViewState } from "../../src/core/repositories/viewStateRepository.ts";
import { getLearner, setLearnerNote } from "../../src/core/repositories/learnerRepository.ts";

test("the learner note starts empty, is set in place, and each write bumps every domain", () => {
  const db = openDatabase(":memory:");
  const a = upsertDomain(db, { slug: "a", name: "A" }).id;
  const b = upsertDomain(db, { slug: "b", name: "B" }).id;
  const empty = getLearner(db);
  expect(empty.note).toBe("");
  const set = setLearnerNote(db, "iOS engineer; memory management is solid");
  expect(set.note).toBe("iOS engineer; memory management is solid");
  expect(set.updatedAt >= empty.updatedAt).toBe(true);
  expect(getLearner(db).note).toBe("iOS engineer; memory management is solid");
  expect([getViewState(db, a).version, getViewState(db, b).version]).toEqual([1, 1]);
});
