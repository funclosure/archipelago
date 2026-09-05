import { test, expect, beforeEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { addMessage } from "../../src/core/repositories/messageRepository.ts";
import { addAsk, listAsks, requireAsk, pickAsk, attachAsks, pendingAsk } from "../../src/core/repositories/askRepository.ts";
import { ConflictError, NotFoundError } from "../../src/core/errors.ts";

let db: Database;
let domainId: number;
let islandId: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  domainId = upsertDomain(db, { slug: "sd", name: "System Design" }).id;
  islandId = upsertIsland(db, { domainId, slug: "caching", name: "Caching" }).id;
});

test("an ask is stored unattached, attaches to the reply message, is picked once, and lists in order", () => {
  const a = addAsk(db, { domainId, islandId, question: "Which resource saturates first?", options: ["CPU", "Memory", "Disk"] });
  expect(a.options).toEqual(["CPU", "Memory", "Disk"]);
  expect(a.messageId).toBeNull();
  expect(a.picked).toBeNull();
  expect(pendingAsk(db, islandId)).toBeNull(); // not shown until it has a message
  const reply = addMessage(db, { domainId, islandId, role: "judge", kind: "text", body: "Before the next move: which resource saturates first?" });
  expect(attachAsks(db, islandId, reply.id)).toBe(1);
  expect(attachAsks(db, islandId, reply.id)).toBe(0);
  expect(pendingAsk(db, islandId)?.id).toBe(a.id);
  expect(requireAsk(db, domainId, a.id).messageId).toBe(reply.id);
  const picked = pickAsk(db, domainId, a.id, "Memory");
  expect(picked.picked).toBe("Memory");
  expect(picked.pickedAt).not.toBeNull();
  expect(pendingAsk(db, islandId)).toBeNull();
  expect(() => pickAsk(db, domainId, a.id, "CPU")).toThrow(ConflictError);
  expect(() => requireAsk(db, domainId, 999)).toThrow(NotFoundError);
  const other = upsertDomain(db, { slug: "other", name: "Other" }).id;
  expect(() => requireAsk(db, other, a.id)).toThrow(NotFoundError);
  const b = addAsk(db, { domainId, islandId, question: "Again?", options: ["x", "y"] });
  expect(listAsks(db, islandId).map((x) => x.id)).toEqual([a.id, b.id]);
});
