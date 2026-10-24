import type { Database } from "../sql.ts";
import { z } from "zod";
import { ConflictError, NotFoundError } from "../errors.ts";
import { reefStatuses, type Message, type MessageKind, type MessageMode, type MessageRole, type ReefProposal, type ReefStatus } from "../types.ts";

const COLS = "id, domain_id as domainId, island_id as islandId, role, kind, body, mode, model, created_at as createdAt";

export type MessageInsert = {
  domainId: number;
  /** Null only for the cartographer at the domain's top scale. */
  islandId: number | null;
  role: MessageRole;
  kind: MessageKind;
  body: string;
  /** The thread: the judge's unless said otherwise. */
  mode?: MessageMode;
  /** The model that wrote a persona's reply; null otherwise. */
  model?: string | null;
};

const proposalSchema = z.object({
  target: z.string().min(1),
  claim: z.string().min(1),
  consequence: z.string().min(1),
  evidence: z.string().min(1),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  status: z.enum(reefStatuses),
});

export function addMessage(db: Database, input: MessageInsert): Message {
  return db
    .query<Message, Record<string, string | number | null>>(
      `insert into messages (domain_id, island_id, role, kind, body, mode, model)
       values ($domainId, $islandId, $role, $kind, $body, $mode, $model) returning ${COLS}`,
    )
    .get({
      $domainId: input.domainId, $islandId: input.islandId, $role: input.role, $kind: input.kind, $body: input.body,
      $mode: input.mode ?? "judge", $model: input.model ?? null,
    })!;
}

/** One thread of an island, in order: the judge's by default, the mentor's or the cartographer's (its islets) when asked. */
export function listMessages(db: Database, islandId: number, mode: MessageMode = "judge"): Message[] {
  return db.query<Message, [number, string]>(`select ${COLS} from messages where island_id = ? and mode = ? order by id`).all(islandId, mode);
}

/** The cartographer's thread at one scale: an island's islets, or the domain's top scale when `islandId` is null. */
export function listScaleMessages(db: Database, domainId: number, islandId: number | null): Message[] {
  return db
    .query<Message, [number, number | null]>(
      `select ${COLS} from messages where domain_id = ? and mode = 'cartographer' and coalesce(island_id, 0) = coalesce(?, 0) order by id`,
    )
    .all(domainId, islandId);
}

export function getMessage(db: Database, id: number): Message | null {
  return db.query<Message, [number]>(`select ${COLS} from messages where id = ?`).get(id) ?? null;
}

/** Message count per island id, for the given ids only. Islands with no thread are absent from the map. */
export function countMessages(db: Database, islandIds: number[]): Map<number, number> {
  const map = new Map<number, number>();
  if (islandIds.length === 0) return map;
  const placeholders = islandIds.map(() => "?").join(", ");
  const rows = db
    .query<{ islandId: number; n: number }, number[]>(
      `select island_id as islandId, count(*) as n from messages where island_id in (${placeholders}) group by island_id`,
    )
    .all(...islandIds);
  for (const row of rows) map.set(row.islandId, row.n);
  return map;
}

/** The parsed body of a `reef_proposal` message. Throws on any other shape. */
export function parseProposal(body: string): ReefProposal {
  return proposalSchema.parse(JSON.parse(body));
}

/**
 * Moves a pending proposal to `confirmed` or `disputed`. The one in-place update on this table;
 * `messages_au` bumps the version.
 */
export function setReefStatus(db: Database, id: number, status: ReefStatus): Message {
  const message = getMessage(db, id);
  if (!message) throw new NotFoundError(`no message ${id}`);
  if (message.kind !== "reef_proposal") throw new ConflictError(`message ${id} is not a reef proposal`);
  const proposal = parseProposal(message.body);
  if (proposal.status !== "pending") throw new ConflictError(`reef proposal ${id} is already ${proposal.status}`);
  const body = JSON.stringify({ ...proposal, status });
  return db.query<Message, [string, number]>(`update messages set body = ? where id = ? returning ${COLS}`).get(body, id)!;
}
