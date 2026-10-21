import type { Database } from "../sql.ts";
import { NotFoundError } from "../errors.ts";
import type { Session } from "../types.ts";

const COLS = "id, domain_id as domainId, started_at as startedAt, ended_at as endedAt, summary";

export function activeSession(db: Database, domainId: number): Session | null {
  return (
    db
      .query<Session, [number]>(`select ${COLS} from sessions where domain_id = ? and ended_at is null order by id desc limit 1`)
      .get(domainId) ?? null
  );
}

export function startSession(db: Database, domainId: number): Session {
  const open = activeSession(db, domainId);
  if (open) return open;
  return db.query<Session, [number]>(`insert into sessions (domain_id) values (?) returning ${COLS}`).get(domainId)!;
}

export function endSession(db: Database, domainId: number, summary: string): Session {
  const open = activeSession(db, domainId);
  if (!open) throw new NotFoundError("no open session for this domain");
  return db
    .query<Session, [string, number]>(
      `update sessions set ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), summary = ? where id = ? returning ${COLS}`,
    )
    .get(summary, open.id)!;
}

export function listSessions(db: Database, domainId: number): Session[] {
  return db.query<Session, [number]>(`select ${COLS} from sessions where domain_id = ? order by id desc`).all(domainId);
}
