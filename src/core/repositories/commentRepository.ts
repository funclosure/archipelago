import type { Database } from "bun:sqlite";
import type { Comment, CommentKind, CommentTargetType } from "../types.ts";

const COLS =
  "id, domain_id as domainId, target_type as targetType, target_id as targetId, body, kind, read_at as readAt, created_at as createdAt";
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export type CommentInsert = {
  domainId: number;
  targetType: CommentTargetType;
  targetId: number;
  body: string;
  kind: CommentKind;
};

export function addComment(db: Database, input: CommentInsert): Comment {
  return db
    .query<Comment, Record<string, string | number>>(
      `insert into comments (domain_id, target_type, target_id, body, kind)
       values ($domainId, $targetType, $targetId, $body, $kind) returning ${COLS}`,
    )
    .get({
      $domainId: input.domainId,
      $targetType: input.targetType,
      $targetId: input.targetId,
      $body: input.body,
      $kind: input.kind,
    })!;
}

export function listComments(db: Database, domainId: number, options: { unreadOnly: boolean }): Comment[] {
  const where = options.unreadOnly ? "domain_id = ? and read_at is null" : "domain_id = ?";
  return db.query<Comment, [number]>(`select ${COLS} from comments where ${where} order by id`).all(domainId);
}

/** Marks the given comments (or every unread one) as read. Returns the number of rows changed. */
export function markCommentsRead(db: Database, domainId: number, ids: number[] | "all"): number {
  if (ids === "all") {
    const count = db
      .query<{ count: number }, [number]>(`select count(*) as count from comments where domain_id = ? and read_at is null`)
      .get(domainId)!.count;
    db.run(`update comments set read_at = ${NOW} where domain_id = ? and read_at is null`, [domainId]);
    return count;
  }
  let changed = 0;
  for (const id of ids) {
    const exists = db
      .query<{ count: number }, [number, number]>(`select count(*) as count from comments where domain_id = ? and id = ? and read_at is null`)
      .get(domainId, id)!.count;
    if (exists > 0) {
      db.run(`update comments set read_at = ${NOW} where domain_id = ? and id = ? and read_at is null`, [domainId, id]);
      changed += 1;
    }
  }
  return changed;
}
