import type { Database } from "../sql.ts";
import { ArchipelagoError, ConflictError, NotFoundError } from "../errors.ts";
import { sketchBodySchema } from "../validators.ts";
import type { Sketch, SketchBody, SketchStatus } from "../types.ts";
import { getIsland, listIslands, listIslandSlugs, setHarbour, updateIsland, upsertIsland } from "./islandRepository.ts";
import { setLandmarks } from "./landmarkRepository.ts";
import { listStraits, upsertStrait } from "./straitRepository.ts";
import { addMessage } from "./messageRepository.ts";

const COLS =
  "id, domain_id as domainId, parent_island_id as parentIslandId, body, status, message_id as messageId, created_at as createdAt, decided_at as decidedAt";
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

type Row = Omit<Sketch, "body"> & { body: string };
const fromRow = (row: Row): Sketch => ({ ...row, body: JSON.parse(row.body) as SketchBody });

/** How many new islands a sketch may add at a scale: a first sketch has a floor, a later one only a ceiling. */
export const SKETCH_LIMITS: Record<"top" | "islets", Record<"first" | "more", readonly [number, number]>> = {
  top: { first: [6, 10], more: [0, 10] },
  islets: { first: [4, 8], more: [0, 8] },
};

/** `parent_island_id` matches null at the top scale. */
const scaleWhere = "domain_id = ? and coalesce(parent_island_id, 0) = coalesce(?, 0)";

/**
 * Parses a sketch and checks it against the map at its scale. Run when proposed and again when approved,
 * since the terminal may have written in between: a slug taken since is a ConflictError.
 */
export function validateSketch(db: Database, domainId: number, parentIslandId: number | null, input: unknown): SketchBody {
  const body = sketchBodySchema.parse(input) as SketchBody;
  const siblings = listIslands(db, domainId, parentIslandId);
  const [min, max] = SKETCH_LIMITS[parentIslandId === null ? "top" : "islets"][siblings.length === 0 ? "first" : "more"];
  const where = parentIslandId === null ? "at the top scale" : "among these islets";
  if (body.islands.length < min || body.islands.length > max) {
    throw new ArchipelagoError(`a sketch ${where} adds ${min === max ? min : `${min}–${max}`} islands, not ${body.islands.length}`);
  }

  const taken = new Set(listIslandSlugs(db, domainId));
  const fresh = new Set<string>();
  for (const island of body.islands) {
    if (taken.has(island.slug)) throw new ConflictError(`the slug "${island.slug}" is already an island in this domain`);
    if (fresh.has(island.slug)) throw new ArchipelagoError(`the slug "${island.slug}" appears twice in the sketch`);
    fresh.add(island.slug);
  }

  const atScale = new Set([...siblings.map((i) => i.slug), ...fresh]);
  const existing = new Set(
    listStraits(db, domainId, parentIslandId).map((s) => {
      const a = siblings.find((i) => i.id === s.fromIslandId)!.slug;
      const b = siblings.find((i) => i.id === s.toIslandId)!.slug;
      return [a, b].sort().join("~");
    }),
  );
  const proposed = new Set<string>();
  for (const strait of body.straits) {
    for (const end of [strait.from, strait.to]) {
      if (!atScale.has(end)) throw new ArchipelagoError(`strait ${strait.from}~${strait.to}: "${end}" is not an island ${where}`);
    }
    if (strait.from === strait.to) throw new ArchipelagoError(`a strait joins two different islands, not "${strait.from}" to itself`);
    const key = [strait.from, strait.to].sort().join("~");
    if (existing.has(key)) throw new ArchipelagoError(`the strait ${key} already exists`);
    if (proposed.has(key)) throw new ArchipelagoError(`the strait ${key} appears twice in the sketch`);
    proposed.add(key);
  }

  if (body.harbour !== undefined && !atScale.has(body.harbour)) throw new ArchipelagoError(`the harbour "${body.harbour}" is not an island ${where}`);
  const siblingSlugs = new Set(siblings.map((i) => i.slug));
  for (const update of body.updates) {
    if (!siblingSlugs.has(update.slug)) throw new ArchipelagoError(`update: "${update.slug}" is not an island already ${where}`);
  }
  return body;
}

/** The scale's pending sketch, if any. */
export function pendingSketch(db: Database, domainId: number, parentIslandId: number | null): Sketch | null {
  const row = db.query<Row, [number, number | null]>(`select ${COLS} from sketches where ${scaleWhere} and status = 'pending'`).get(domainId, parentIslandId);
  return row ? fromRow(row) : null;
}

/** Every sketch at a scale, oldest first; or across the domain when `parentIslandId` is undefined. */
export function listSketches(db: Database, domainId: number, parentIslandId?: number | null): Sketch[] {
  const rows =
    parentIslandId === undefined
      ? db.query<Row, [number]>(`select ${COLS} from sketches where domain_id = ? order by id`).all(domainId)
      : db.query<Row, [number, number | null]>(`select ${COLS} from sketches where ${scaleWhere} order by id`).all(domainId, parentIslandId);
  return rows.map(fromRow);
}

export function requireSketch(db: Database, domainId: number, id: number): Sketch {
  const row = db.query<Row, [number, number]>(`select ${COLS} from sketches where id = ? and domain_id = ?`).get(id, domainId);
  if (!row) throw new NotFoundError(`no sketch ${id} in this domain`);
  return fromRow(row);
}

function setStatus(db: Database, id: number, status: SketchStatus): Sketch {
  return fromRow(db.query<Row, [string, number]>(`update sketches set status = ?, decided_at = ${NOW} where id = ? returning ${COLS}`).get(status, id)!);
}

/** Records a validated sketch as the scale's pending one; the one it replaces is superseded. */
export function proposeSketch(db: Database, domainId: number, parentIslandId: number | null, input: unknown): Sketch {
  return db.transaction(() => {
    const body = validateSketch(db, domainId, parentIslandId, input);
    const previous = pendingSketch(db, domainId, parentIslandId);
    if (previous) setStatus(db, previous.id, "superseded");
    return fromRow(
      db
        .query<Row, [number, number | null, string]>(`insert into sketches (domain_id, parent_island_id, body) values (?, ?, ?) returning ${COLS}`)
        .get(domainId, parentIslandId, JSON.stringify(body))!,
    );
  })();
}

/** Rides the pending sketch proposed this turn (id above `floor`) on the reply that presented it. */
export function attachSketch(db: Database, domainId: number, parentIslandId: number | null, messageId: number, floor: number): void {
  db.run(`update sketches set message_id = ? where ${scaleWhere} and status = 'pending' and message_id is null and id > ?`, [
    messageId, domainId, parentIslandId, floor,
  ]);
}

/** The highest sketch id in the domain, so a turn can tell its own sketch from an earlier one. */
export function sketchFloor(db: Database, domainId: number): number {
  return db.query<{ id: number | null }, [number]>("select max(id) as id from sketches where domain_id = ?").get(domainId)!.id ?? 0;
}

function requirePending(db: Database, domainId: number, id: number): Sketch {
  const sketch = requireSketch(db, domainId, id);
  if (sketch.status !== "pending") throw new ConflictError(`sketch ${id} is already ${sketch.status}`);
  return sketch;
}

export function discardSketch(db: Database, domainId: number, id: number): Sketch {
  return db.transaction(() => setStatus(db, requirePending(db, domainId, id).id, "discarded"))();
}

export type ApprovedSketch = { sketch: Sketch; islands: number; straits: number; updates: number; harbour: string | null };

/**
 * Writes a pending sketch to the map in one transaction, through the repositories the CLI uses, and records
 * the system line in the scale's cartographer thread. Re-validated first: anything taken since is a 409.
 */
export function approveSketch(db: Database, domainId: number, id: number): ApprovedSketch {
  return db.transaction(() => {
    const sketch = requirePending(db, domainId, id);
    const body = validateSketch(db, domainId, sketch.parentIslandId, sketch.body);
    const order = listIslands(db, domainId, sketch.parentIslandId).length;
    body.islands.forEach((island, i) => {
      const row = upsertIsland(db, { domainId, slug: island.slug, name: island.name, summary: island.summary, parentId: sketch.parentIslandId, sortOrder: order + i + 1 });
      setLandmarks(db, domainId, row.id, island.landmarks);
    });
    for (const strait of body.straits) {
      const from = getIsland(db, domainId, strait.from)!;
      const to = getIsland(db, domainId, strait.to)!;
      upsertStrait(db, { domainId, fromIslandId: from.id, toIslandId: to.id, name: strait.name ?? null });
    }
    for (const update of body.updates) updateIsland(db, domainId, update.slug, { name: update.name, summary: update.summary });
    if (body.harbour !== undefined) setHarbour(db, domainId, body.harbour);
    const approved = setStatus(db, sketch.id, "approved");
    const parts = [
      body.islands.length && `${body.islands.length} ${body.islands.length === 1 ? "island" : "islands"}`,
      body.straits.length && `${body.straits.length} ${body.straits.length === 1 ? "strait" : "straits"}`,
      body.updates.length && `${body.updates.length} ${body.updates.length === 1 ? "update" : "updates"}`,
      body.harbour !== undefined && `harbour ${body.harbour}`,
    ].filter(Boolean);
    addMessage(db, { domainId, islandId: sketch.parentIslandId, role: "cartographer", kind: "system", body: `sketch approved: ${parts.join(", ")}`, mode: "cartographer" });
    return { sketch: approved, islands: body.islands.length, straits: body.straits.length, updates: body.updates.length, harbour: body.harbour ?? null };
  })();
}
