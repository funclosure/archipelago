// The reader's images (migration 0022). An upload is stored unattached; the route that stores the reader's message
// attaches it in the same transaction. Removing one keeps a tombstone (no bytes) so the thread keeps its order and a
// persona can say the image is gone; an upload never attached is simply deleted, after a day, on a later upload.
import type { Database } from "../sql.ts";
import { ArchipelagoError, ConflictError, NotFoundError } from "../errors.ts";
import { IMAGES_PER_MESSAGE, imageProblem, sniffImage, type ImageType } from "../images.ts";

/** What a thread says about one image: never its bytes. */
export type ImageRef = { id: number; width: number; height: number; removed: boolean };
/** A stored image with its bytes, for the route that serves it and the turn that shows it to a persona. */
export type StoredImage = { id: number; messageId: number | null; mediaType: ImageType; width: number; height: number; bytes: Uint8Array<ArrayBuffer> };

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

/** Stores an image, unattached, after checking its bytes; sweeps uploads nobody attached within a day. */
export function addImage(db: Database, domainId: number, bytes: Uint8Array): ImageRef {
  const problem = imageProblem(bytes);
  if (problem) throw new ArchipelagoError(problem);
  const info = sniffImage(bytes)!;
  return db.transaction(() => {
    db.run(`delete from images where message_id is null and created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')`);
    const row = db
      .query<{ id: number }, [number, string, number, number, Uint8Array]>(
        `insert into images (domain_id, media_type, width, height, bytes) values (?, ?, ?, ?, ?) returning id`,
      )
      .get(domainId, info.mediaType, info.width, info.height, bytes)!;
    return { id: row.id, width: info.width, height: info.height, removed: false };
  })();
}

/**
 * Attaches uploads to the reader message that carries them, in the order given. Every id must be this domain's, not
 * attached yet, and not removed; otherwise nothing is attached and the caller's transaction rolls the message back.
 */
export function attachImages(db: Database, domainId: number, messageId: number, ids: readonly number[]): void {
  if (ids.length > IMAGES_PER_MESSAGE) throw new ArchipelagoError(`at most ${IMAGES_PER_MESSAGE} images on a message`);
  if (new Set(ids).size !== ids.length) throw new ArchipelagoError("an image is attached once");
  // Every id is checked before any is written: all of them attach, or none.
  for (const id of ids) {
    const row = db.query<{ messageId: number | null; removed: number }, [number, number]>(
      `select message_id as messageId, removed_at is not null as removed from images where id = ? and domain_id = ?`,
    ).get(id, domainId);
    if (!row) throw new NotFoundError(`no image ${id} in this domain`);
    if (row.messageId !== null) throw new ConflictError(`image ${id} is already on a message`);
    if (row.removed) throw new ConflictError(`image ${id} was removed`);
  }
  db.transaction(() => ids.forEach((id, position) => db.run(`update images set message_id = ?, position = ? where id = ?`, [messageId, position, id])))();
}

/** The images on each of the domain's messages, in order, without their bytes. */
export function imagesByMessage(db: Database, domainId: number): Map<number, ImageRef[]> {
  const rows = db
    .query<{ id: number; messageId: number; width: number; height: number; removed: number }, [number]>(
      `select id, message_id as messageId, width, height, removed_at is not null as removed
       from images where domain_id = ? and message_id is not null order by message_id, position`,
    )
    .all(domainId);
  const out = new Map<number, ImageRef[]>();
  for (const r of rows) out.set(r.messageId, [...(out.get(r.messageId) ?? []), { id: r.id, width: r.width, height: r.height, removed: Boolean(r.removed) }]);
  return out;
}

/** Messages with their images (`images: []` when none), as a thread is served. */
export function withImages<M extends { id: number }>(db: Database, domainId: number, messages: M[]): (M & { images: ImageRef[] })[] {
  const byMessage = imagesByMessage(db, domainId);
  return messages.map((m) => ({ ...m, images: byMessage.get(m.id) ?? [] }));
}

/** One image with its bytes. A removed one, or one of another domain, is not found. */
export function readImage(db: Database, domainId: number, id: number): StoredImage {
  const row = db
    .query<StoredImage, [number, number]>(
      `select id, message_id as messageId, media_type as mediaType, width, height, bytes from images where id = ? and domain_id = ? and bytes is not null`,
    )
    .get(id, domainId);
  if (!row) throw new NotFoundError(`no image ${id} in this domain`);
  return { ...row, bytes: new Uint8Array(row.bytes) }; // a copy the caller owns, on its own buffer
}

/** Removes images: an attached one leaves a tombstone, an unattached upload goes. Returns how many were removed. */
export function removeImages(db: Database, domainId: number, ids: readonly number[]): number {
  return db.transaction(() => {
    let removed = 0;
    for (const id of new Set(ids)) {
      const row = db.query<{ messageId: number | null; removed: number }, [number, number]>(
        `select message_id as messageId, removed_at is not null as removed from images where id = ? and domain_id = ?`,
      ).get(id, domainId);
      if (!row) throw new NotFoundError(`no image ${id} in this domain`);
      if (row.removed) continue;
      if (row.messageId === null) db.run(`delete from images where id = ?`, [id]);
      else db.run(`update images set bytes = null, removed_at = ${NOW} where id = ?`, [id]);
      removed++;
    }
    return removed;
  })();
}

/** What the domain's images take: those still there, and how many the reader removed. */
export function imageUsage(db: Database, domainId: number): { count: number; bytes: number; removed: number } {
  return db
    .query<{ count: number; bytes: number; removed: number }, [number]>(
      `select count(bytes) as count, coalesce(sum(length(bytes)), 0) as bytes, count(removed_at) as removed from images where domain_id = ?`,
    )
    .get(domainId)!;
}

/**
 * Removes every image of the domain older than `olderThanDays` (null: every one), as the reader asked from Images…:
 * attached ones become tombstones, unattached uploads go. Returns how many, and the bytes they took.
 */
export function pruneImages(db: Database, domainId: number, olderThanDays: number | null): { removed: number; bytes: number } {
  const cutoff = olderThanDays === null ? null : `-${Math.max(0, Math.floor(olderThanDays))} days`;
  const where = `domain_id = ? and bytes is not null${cutoff ? ` and created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)` : ""}`;
  const params: (number | string)[] = cutoff ? [domainId, cutoff] : [domainId];
  return db.transaction(() => {
    const before = db.query<{ removed: number; bytes: number }, (number | string)[]>(
      `select count(*) as removed, coalesce(sum(length(bytes)), 0) as bytes from images where ${where}`,
    ).get(...params)!;
    db.run(`delete from images where message_id is null and ${where}`, params);
    db.run(`update images set bytes = null, removed_at = ${NOW} where ${where}`, params);
    return before;
  })();
}

/** Gives the space removed images held back to the file system. Outside any transaction; slow on a large file. */
export function compactDatabase(db: Database): void {
  db.exec("vacuum");
}
