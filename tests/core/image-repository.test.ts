// The reader's images in the database: stored unattached, attached with the message that carries them, removed as a
// tombstone, pruned by age, swept when nobody attached them, and gone with their domain.
import { test, expect, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import type { Database } from "../../src/core/sql.ts";
import { openDatabase } from "../../src/core/db.ts";
import { upsertDomain, removeDomain } from "../../src/core/repositories/domainRepository.ts";
import { upsertIsland } from "../../src/core/repositories/islandRepository.ts";
import { addMessage } from "../../src/core/repositories/messageRepository.ts";
import {
  addImage, attachImages, compactDatabase, imageUsage, imagesByMessage, pruneImages, readImage, removeImages, withImages,
} from "../../src/core/repositories/imageRepository.ts";

const png = new Uint8Array(readFileSync(new URL("./fixtures/images/px.png", import.meta.url)));
const webp = new Uint8Array(readFileSync(new URL("./fixtures/images/px-lossy.webp", import.meta.url)));

let db: Database;
let domainId: number;
let other: number;
let islandId: number;
const version = () => db.query<{ version: number }, [number]>("select version from view_state where domain_id = ?").get(domainId)!.version;
const say = (body = "see this") => addMessage(db, { domainId, islandId, role: "you", kind: "text", body, mode: "mentor" });
const age = (id: number, days: number) => db.run(`update images set created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?) where id = ?`, [`-${days} days`, id]);

beforeEach(() => {
  db = openDatabase(":memory:");
  domainId = upsertDomain(db, { slug: "vim", name: "Vim" }).id;
  other = upsertDomain(db, { slug: "git", name: "Git" }).id;
  islandId = upsertIsland(db, { domainId, slug: "modes", name: "Modes" }).id;
});

test("an upload is stored by its own bytes, unattached, and read back whole", () => {
  const before = version();
  const ref = addImage(db, domainId, webp);
  expect(ref).toEqual({ id: ref.id, width: 7, height: 5, removed: false });
  expect(version()).toBe(before + 1);
  expect(readImage(db, domainId, ref.id)).toMatchObject({ id: ref.id, messageId: null, mediaType: "image/webp", width: 7, height: 5 });
  expect(readImage(db, domainId, ref.id).bytes).toEqual(webp);
  // Not another domain's to read.
  expect(() => readImage(db, other, ref.id)).toThrow("no image");
  expect(() => addImage(db, domainId, new TextEncoder().encode("<svg/>"))).toThrow("not an image");
});

test("images attach in order to the message that carries them; every id must be this domain's and free", () => {
  const [a, b, c] = [addImage(db, domainId, png), addImage(db, domainId, webp), addImage(db, other, png)];
  const m = say();
  expect(() => attachImages(db, domainId, m.id, [a.id, c.id])).toThrow("no image");
  expect(() => attachImages(db, domainId, m.id, [a.id, a.id])).toThrow("attached once");
  expect(() => attachImages(db, domainId, m.id, [1, 2, 3, 4, 5])).toThrow("at most 4");
  attachImages(db, domainId, m.id, [b.id, a.id]);
  expect(imagesByMessage(db, domainId).get(m.id)!.map((i) => i.id)).toEqual([b.id, a.id]);
  expect(() => attachImages(db, domainId, say().id, [a.id])).toThrow("already on a message");
  const thread = withImages(db, domainId, [m, say("no pictures")]);
  expect(thread.map((x) => x.images.length)).toEqual([2, 0]);
});

test("a failed attach inside a transaction stores no message either", () => {
  const before = db.query<{ n: number }, []>("select count(*) as n from messages").get()!.n;
  expect(() => db.transaction(() => attachImages(db, domainId, say().id, [999]))()).toThrow("no image 999");
  expect(db.query<{ n: number }, []>("select count(*) as n from messages").get()!.n).toBe(before);
});

test("removing an attached image leaves a tombstone; an unattached upload just goes", () => {
  const [a, b] = [addImage(db, domainId, png), addImage(db, domainId, webp)];
  const m = say();
  attachImages(db, domainId, m.id, [a.id]);
  expect(removeImages(db, domainId, [a.id, b.id])).toBe(2);
  expect(imagesByMessage(db, domainId).get(m.id)).toEqual([{ id: a.id, width: 7, height: 5, removed: true }]);
  expect(() => readImage(db, domainId, a.id)).toThrow("no image");
  expect(db.query<{ n: number }, [number]>("select count(*) as n from images where id = ?").get(b.id)!.n).toBe(0);
  expect(removeImages(db, domainId, [a.id])).toBe(0); // already removed: nothing to do
  expect(() => removeImages(db, domainId, [12345])).toThrow("no image 12345");
  expect(() => attachImages(db, domainId, say().id, [a.id])).toThrow(); // a tombstone is not offered again
});

test("usage counts what is there; prune removes by age, or every one, and says how much it freed", () => {
  const ids = [png, webp, png].map((bytes) => addImage(db, domainId, bytes).id);
  const m = say();
  attachImages(db, domainId, m.id, ids.slice(0, 2));
  age(ids[0]!, 40);
  age(ids[2]!, 40); // unattached and old: deleted, not a tombstone
  expect(imageUsage(db, domainId)).toEqual({ count: 3, bytes: png.length * 2 + webp.length, removed: 0 });
  expect(imageUsage(db, domainId, [30, 90]).older).toEqual({ "30": { count: 2, bytes: png.length * 2 }, "90": { count: 0, bytes: 0 } });
  expect(pruneImages(db, domainId, 30)).toEqual({ removed: 2, bytes: png.length * 2 });
  expect(imageUsage(db, domainId)).toEqual({ count: 1, bytes: webp.length, removed: 1 });
  expect(imagesByMessage(db, domainId).get(m.id)!.map((i) => i.removed)).toEqual([true, false]);
  expect(pruneImages(db, domainId, 30)).toEqual({ removed: 0, bytes: 0 });
  expect(pruneImages(db, domainId, null)).toEqual({ removed: 1, bytes: webp.length });
  expect(imageUsage(db, domainId)).toEqual({ count: 0, bytes: 0, removed: 2 });
  compactDatabase(db); // outside a transaction, it runs
});

test("an upload nobody attached within a day is swept by the next upload; attached ones stay", () => {
  const [stale, kept] = [addImage(db, domainId, png), addImage(db, domainId, png)];
  attachImages(db, domainId, say().id, [kept.id]);
  age(stale.id, 2);
  age(kept.id, 2);
  addImage(db, other, png);
  const left = db.query<{ id: number }, []>("select id from images order by id").all().map((r) => r.id);
  expect(left).not.toContain(stale.id);
  expect(left).toContain(kept.id);
});

test("a domain takes its images with it", () => {
  attachImages(db, domainId, say().id, [addImage(db, domainId, png).id]);
  addImage(db, domainId, webp);
  addImage(db, other, png);
  removeDomain(db, "vim");
  expect(db.query<{ domainId: number }, []>("select domain_id as domainId from images").all()).toEqual([{ domainId: other }]);
});

test("the table refuses a row that is half removed, or of a type it does not take", () => {
  expect(() => db.run("insert into images (domain_id, media_type, width, height, bytes, removed_at) values (?, 'image/png', 1, 1, x'00', 'now')", [domainId])).toThrow();
  expect(() => db.run("insert into images (domain_id, media_type, width, height) values (?, 'image/png', 1, 1)", [domainId])).toThrow();
  expect(() => db.run("insert into images (domain_id, media_type, width, height, bytes) values (?, 'image/svg+xml', 1, 1, x'00')", [domainId])).toThrow();
});
