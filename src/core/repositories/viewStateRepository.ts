import type { Database } from "bun:sqlite";
import { NotFoundError } from "../errors.ts";
import type { ViewState } from "../types.ts";

const COLS = "domain_id as domainId, focus_island_id as focusIslandId, version";

export function getViewState(db: Database, domainId: number): ViewState {
  const row = db.query<ViewState, [number]>(`select ${COLS} from view_state where domain_id = ?`).get(domainId);
  if (!row) throw new NotFoundError(`no view_state for domain ${domainId}`);
  return row;
}

export function setFocus(db: Database, domainId: number, islandId: number | null): ViewState {
  db.run("update view_state set focus_island_id = ? where domain_id = ?", [islandId, domainId]);
  return getViewState(db, domainId);
}
