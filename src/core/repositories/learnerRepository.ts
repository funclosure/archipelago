import type { Database } from "bun:sqlite";
import type { Learner } from "../types.ts";

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
