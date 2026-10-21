import type { Database } from "../sql.ts";
import type { Learner } from "../types.ts";
import { listLandmarksByIsland } from "./landmarkRepository.ts";
import { parseProposal } from "./messageRepository.ts";

const COLS = "note, updated_at as updatedAt";
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** The one learner row (migration 0008 creates it). */
export function getLearner(db: Database): Learner {
  return db.query<Learner, []>(`select ${COLS} from learner where id = 1`).get()!;
}

/** Replaces the note. `learner_au` bumps every domain's version: the note is global. */
export function setLearnerNote(db: Database, note: string): Learner {
  return db.query<Learner, [string]>(`update learner set note = ?, updated_at = ${NOW} where id = 1 returning ${COLS}`).get(note)!;
}

/** How many islands of solid ground the mentor is shown. */
export const GROUND_MAX = 40;

export type GroundItem = { domain: string; island: string; slug: string; summary: string | null; state: "settled" | "mountainous"; lit: string[] };

/**
 * The reader's solid ground in every domain: islands whose latest verdict is settled or mountainous,
 * mountainous first, then the newest verdict first; each with the names of its lit landmarks.
 */
export function learnerGround(db: Database, limit = GROUND_MAX): GroundItem[] {
  const rows = db
    .query<Omit<GroundItem, "lit"> & { islandId: number }, [number]>(
      `select d.name as domain, i.name as island, i.slug as slug, i.summary as summary, v.state as state, i.id as islandId
       from verdicts v
       join islands i on i.id = v.target_id
       join domains d on d.id = i.domain_id
       where v.target_type = 'island'
         and v.id in (select max(id) from verdicts where target_type = 'island' group by target_id)
         and v.state in ('settled', 'mountainous')
       order by case v.state when 'mountainous' then 0 else 1 end, v.id desc
       limit ?`,
    )
    .all(limit);
  const landmarks = listLandmarksByIsland(db, rows.map((r) => r.islandId));
  return rows.map(({ islandId, ...r }) => ({
    ...r,
    lit: (landmarks.get(islandId) ?? []).filter((l) => l.unlockedAt !== null).map((l) => l.name),
  }));
}

export type ReefClaim = { domain: string; island: string; claim: string };

/** The claim of every confirmed reef, in every domain, oldest first: what the mentor must never build an analogy on. */
export function confirmedReefClaims(db: Database): ReefClaim[] {
  const rows = db
    .query<{ domain: string; island: string; body: string }, []>(
      `select d.name as domain, i.name as island, m.body as body
       from messages m
       join islands i on i.id = m.island_id
       join domains d on d.id = m.domain_id
       where m.kind = 'reef_proposal'
       order by m.id`,
    )
    .all();
  return rows.flatMap((r) => {
    try {
      const p = parseProposal(r.body);
      return p.status === "confirmed" ? [{ domain: r.domain, island: r.island, claim: p.claim }] : [];
    } catch {
      return []; // a body that is not a proposal is no claim
    }
  });
}
