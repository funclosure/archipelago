import type { Database } from "../sql.ts";
import type { Verdict, VerdictState, VerdictTargetType } from "../types.ts";

const COLS =
  "id, target_type as targetType, target_id as targetId, state, confidence, evidence, rationale, session_id as sessionId, created_at as createdAt";

export type VerdictInsert = {
  targetType: VerdictTargetType;
  targetId: number;
  state: VerdictState;
  confidence: number;
  evidence: string;
  rationale?: string | null;
  sessionId?: number | null;
};

export function addVerdict(db: Database, input: VerdictInsert): Verdict {
  return db
    .query<Verdict, Record<string, string | number | null>>(
      `insert into verdicts (target_type, target_id, state, confidence, evidence, rationale, session_id)
       values ($targetType, $targetId, $state, $confidence, $evidence, $rationale, $sessionId)
       returning ${COLS}`,
    )
    .get({
      $targetType: input.targetType,
      $targetId: input.targetId,
      $state: input.state,
      $confidence: input.confidence,
      $evidence: input.evidence,
      $rationale: input.rationale ?? null,
      $sessionId: input.sessionId ?? null,
    })!;
}

export function latestVerdict(db: Database, targetType: VerdictTargetType, targetId: number): Verdict | null {
  return (
    db
      .query<Verdict, [string, number]>(
        `select ${COLS} from verdicts where target_type = ? and target_id = ? order by id desc limit 1`,
      )
      .get(targetType, targetId) ?? null
  );
}

export function verdictHistory(db: Database, targetType: VerdictTargetType, targetId: number): Verdict[] {
  return db
    .query<Verdict, [string, number]>(`select ${COLS} from verdicts where target_type = ? and target_id = ? order by id desc`)
    .all(targetType, targetId);
}

/** Latest verdict per target, for the given ids only. Targets with no verdict are absent from the map. */
export function latestVerdicts(db: Database, targetType: VerdictTargetType, targetIds: number[]): Map<number, Verdict> {
  const map = new Map<number, Verdict>();
  if (targetIds.length === 0) return map;
  const wanted = new Set(targetIds);
  const rows = db
    .query<Verdict, [string]>(
      `select ${COLS} from verdicts
       where target_type = ? and id in (select max(id) from verdicts group by target_type, target_id)`,
    )
    .all(targetType);
  for (const row of rows) if (wanted.has(row.targetId)) map.set(row.targetId, row);
  return map;
}
