import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { addComment, listComments, markCommentsRead } from "../../src/core/repositories/commentRepository.ts";

let db: Database;
let domainId: number;
let islandId: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  islandId = upsertIsland(db, { domainId, slug: "caching", name: "Caching" }).id;
});

test("unread lifecycle", () => {
  const a = addComment(db, { domainId, targetType: "island", targetId: islandId, body: "", kind: "probe_me" });
  const b = addComment(db, { domainId, targetType: "island", targetId: islandId, body: "not a reef", kind: "dispute" });
  expect(listComments(db, domainId, { unreadOnly: true }).map((c) => c.id)).toEqual([a.id, b.id]);
  expect(markCommentsRead(db, domainId, [a.id])).toBe(1);
  expect(listComments(db, domainId, { unreadOnly: true }).map((c) => c.id)).toEqual([b.id]);
  expect(markCommentsRead(db, domainId, "all")).toBe(1);
  expect(listComments(db, domainId, { unreadOnly: true })).toHaveLength(0);
  expect(listComments(db, domainId, { unreadOnly: false })).toHaveLength(2);
  expect(listComments(db, domainId, { unreadOnly: false })[0]!.readAt).not.toBeNull();
});
