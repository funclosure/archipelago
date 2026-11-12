// A map as one JSON file: a domain's structure (its islands at every scale, their landmarks, straits, seas and where
// the reader put them), with nothing of the reader's own in it: no conversation, verdict, lit or explored landmark,
// loose end, board, or harbour. It is what a reader shares, and what another program can write for the app to import.
import { z } from "zod";
import type { Database } from "./sql.ts";
import { ArchipelagoError } from "./errors.ts";
import type { Domain, Island } from "./types.ts";
import { COORDINATE_MAX, DESCRIPTION_MAX, SEA_NAME_MAX, kebab, slugSchema, termsSchema } from "./validators.ts";
import { getDomain, requireDomain, upsertDomain } from "./repositories/domainRepository.ts";
import { listIslands, setIslandPositions, upsertIsland } from "./repositories/islandRepository.ts";
import { listLandmarks, setLandmarks } from "./repositories/landmarkRepository.ts";
import { listStraits, upsertStrait } from "./repositories/straitRepository.ts";
import { addSea, listSeas } from "./repositories/seaRepository.ts";

/** The file's version, in its `archipelago` field. A file with a later one is refused. */
export const MAP_FILE_VERSION = 1;
/** Islands inside islands: the top scale is 1. */
export const MAP_DEPTH_MAX = 4;
/** Every island of a file, at every scale. */
export const MAP_ISLANDS_MAX = 300;
/** Islands at one scale: a map is read at a glance. */
export const MAP_SCALE_MAX = 16;
export const MAP_LANDMARKS_MAX = 8;

const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((t) => !/[\r\n\u2028\u2029]/.test(t), { message: "must be one line" });
const coordinate = z.number().min(-COORDINATE_MAX).max(COORDINATE_MAX);

const landmark = z.object({ slug: slugSchema, name: oneLine(120), terms: termsSchema.optional() });
const strait = z.object({ from: slugSchema, to: slugSchema, name: oneLine(120).optional() });
/** A sea is where the reader put its name (`x`, `y`), or over the islands it groups, for the page to place. */
const sea = z
  .object({ name: oneLine(SEA_NAME_MAX), x: coordinate.optional(), y: coordinate.optional(), islands: z.array(slugSchema).min(1).max(MAP_SCALE_MAX).optional() })
  .refine((s) => (s.x !== undefined && s.y !== undefined) || s.islands !== undefined, { message: "a sea is at x and y, or over islands" });

export type MapLandmark = z.infer<typeof landmark>;
export type MapStrait = z.infer<typeof strait>;
export type MapSea = z.infer<typeof sea>;
export type MapIsland = {
  slug: string;
  name: string;
  summary?: string;
  x?: number;
  y?: number;
  landmarks?: MapLandmark[];
  /** The scale inside this island: its islets, and the straits and seas among them. */
  islets?: MapIsland[];
  straits?: MapStrait[];
  seas?: MapSea[];
};
export type MapFile = { archipelago: number; name: string; slug?: string; description?: string; language?: string; /** Who made it: a credit shown in the gallery, kept by no domain. */ by?: string; islands: MapIsland[]; straits?: MapStrait[]; seas?: MapSea[] };

const island: z.ZodType<MapIsland> = z.lazy(() =>
  z
    .object({
      slug: slugSchema,
      name: oneLine(120),
      summary: oneLine(400).optional(),
      x: coordinate.optional(),
      y: coordinate.optional(),
      landmarks: z.array(landmark).max(MAP_LANDMARKS_MAX).optional(),
      islets: z.array(island).max(MAP_SCALE_MAX).optional(),
      straits: z.array(strait).max(60).optional(),
      seas: z.array(sea).max(8).optional(),
    })
    .refine((i) => (i.x === undefined) === (i.y === undefined), { message: "an island has both x and y, or neither" }),
);

export const mapFileSchema = z.object({
  archipelago: z.number().int().min(1),
  name: oneLine(80),
  slug: slugSchema.optional(),
  description: z.string().trim().max(DESCRIPTION_MAX).optional(),
  language: z.string().trim().max(20).optional(),
  by: oneLine(80).optional(),
  islands: z.array(island).min(1).max(MAP_SCALE_MAX),
  straits: z.array(strait).max(60).optional(),
  seas: z.array(sea).max(8).optional(),
});

type Scale = { islands: MapIsland[]; straits?: MapStrait[]; seas?: MapSea[] };
const scaleOf = (i: MapIsland): Scale => ({ islands: i.islets ?? [], straits: i.straits, seas: i.seas });

/**
 * Reads a map file and checks what its shape alone cannot say: slugs unique across the whole map, every strait
 * between two different islands of its own scale, every sea over islands of its own scale, and the map no deeper or
 * larger than a reader could chart. The message names the place, since the writer is often another program.
 */
export function parseMapFile(input: unknown): MapFile {
  const parsed = mapFileSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new ArchipelagoError(`not a map file: ${issue.path.join(".") || "the file"}: ${issue.message}`);
  }
  const file = parsed.data;
  if (file.archipelago > MAP_FILE_VERSION) throw new ArchipelagoError(`this map file is version ${file.archipelago}; this Archipelago reads up to ${MAP_FILE_VERSION}`);
  const seen = new Set<string>();
  let count = 0;
  const check = (scale: Scale, where: string, depth: number) => {
    if (depth > MAP_DEPTH_MAX) throw new ArchipelagoError(`not a map file: ${where} is more than ${MAP_DEPTH_MAX} scales deep`);
    const here = new Set(scale.islands.map((i) => i.slug));
    for (const i of scale.islands) {
      if (seen.has(i.slug)) throw new ArchipelagoError(`not a map file: the slug "${i.slug}" is used twice; every island's slug is unique in a map`);
      seen.add(i.slug);
      if (++count > MAP_ISLANDS_MAX) throw new ArchipelagoError(`not a map file: more than ${MAP_ISLANDS_MAX} islands`);
      const marks = (i.landmarks ?? []).map((l) => l.slug);
      if (new Set(marks).size !== marks.length) throw new ArchipelagoError(`not a map file: ${i.slug} has two landmarks with one slug`);
    }
    const joined = new Set<string>();
    for (const s of scale.straits ?? []) {
      for (const end of [s.from, s.to]) if (!here.has(end)) throw new ArchipelagoError(`not a map file: the strait ${s.from} to ${s.to} names "${end}", which is not an island of ${where}; straits join islands of one scale`);
      if (s.from === s.to) throw new ArchipelagoError(`not a map file: a strait joins two different islands, got "${s.from}" twice`);
      const key = [s.from, s.to].sort().join(" ");
      if (joined.has(key)) throw new ArchipelagoError(`not a map file: the strait ${s.from} to ${s.to} is listed twice`);
      joined.add(key);
    }
    for (const s of scale.seas ?? []) {
      for (const slug of s.islands ?? []) if (!here.has(slug)) throw new ArchipelagoError(`not a map file: the sea "${s.name}" names "${slug}", which is not an island of ${where}`);
    }
    for (const i of scale.islands) {
      const inner = scaleOf(i);
      if (inner.islands.length) check(inner, i.slug, depth + 1);
      else if (inner.straits?.length || inner.seas?.length) throw new ArchipelagoError(`not a map file: ${i.slug} has straits or seas but no islets`);
    }
  };
  check(file, "the top scale", 1);
  return file;
}

/** The domain as a map file: structure and the reader's arrangement, nothing they said or were told. */
export function exportMap(db: Database, slug: string): MapFile {
  const domain = requireDomain(db, slug);
  const scale = (parent: Island | null): Scale => {
    const here = listIslands(db, domain.id, parent?.id ?? null);
    const slugOf = new Map(here.map((i) => [i.id, i.slug]));
    const islands = here.map((i): MapIsland => {
      const landmarks = listLandmarks(db, i.id).map((l): MapLandmark => ({ slug: l.slug, name: l.name, ...(l.terms?.length ? { terms: l.terms } : {}) }));
      const inner = scale(i);
      return {
        slug: i.slug,
        name: i.name,
        ...(i.summary ? { summary: i.summary.replace(/\s+/g, " ").trim() } : {}),
        ...(i.x !== null && i.y !== null ? { x: i.x, y: i.y } : {}),
        ...(landmarks.length ? { landmarks } : {}),
        ...(inner.islands.length ? { islets: inner.islands } : {}),
        ...(inner.straits?.length ? { straits: inner.straits } : {}),
        ...(inner.seas?.length ? { seas: inner.seas } : {}),
      };
    });
    const straits = here.length ? listStraits(db, domain.id, parent?.id ?? null).map((s): MapStrait => ({ from: slugOf.get(s.fromIslandId)!, to: slugOf.get(s.toIslandId)!, ...(s.name ? { name: s.name } : {}) })) : [];
    const seas = listSeas(db, domain.id, parent?.id ?? null).flatMap((s): MapSea[] =>
      s.x !== null && s.y !== null ? [{ name: s.name, x: s.x, y: s.y }] : s.anchor?.length ? [{ name: s.name, islands: s.anchor }] : [],
    );
    return { islands, straits, seas };
  };
  const top = scale(null);
  return {
    archipelago: MAP_FILE_VERSION,
    name: domain.name,
    slug: domain.slug,
    ...(domain.description ? { description: domain.description } : {}),
    islands: top.islands,
    ...(top.straits?.length ? { straits: top.straits } : {}),
    ...(top.seas?.length ? { seas: top.seas } : {}),
  };
}

export type ImportedMap = { domain: Domain; islands: number; straits: number; seas: number };

/**
 * A new domain from a map file, written whole or not at all. The domain takes the file's slug, or its name's, with
 * `-2`, `-3`, … when that is taken: importing never touches a domain that is already there.
 */
export function importMap(db: Database, input: unknown): ImportedMap {
  const file = parseMapFile(input);
  return db.transaction(() => {
    const base = (file.slug ?? kebab(file.name)).slice(0, 60).replace(/-+$/, "") || "map";
    let slug = base;
    for (let n = 2; getDomain(db, slug); n++) slug = `${base}-${n}`;
    const domain = upsertDomain(db, { slug, name: file.name, description: file.description || null });
    const tally = { islands: 0, straits: 0, seas: 0 };
    const write = (scale: Scale, parentId: number | null) => {
      const ids = new Map<string, number>();
      scale.islands.forEach((i, n) => {
        const row = upsertIsland(db, { domainId: domain.id, slug: i.slug, name: i.name, summary: i.summary ?? null, parentId, sortOrder: n + 1 });
        ids.set(i.slug, row.id);
        tally.islands++;
        if (i.landmarks?.length) setLandmarks(db, domain.id, row.id, i.landmarks);
      });
      const placed = scale.islands.flatMap((i) => (i.x !== undefined && i.y !== undefined ? [{ slug: i.slug, x: i.x, y: i.y }] : []));
      if (placed.length) setIslandPositions(db, domain.id, placed);
      for (const s of scale.straits ?? []) {
        upsertStrait(db, { domainId: domain.id, fromIslandId: ids.get(s.from)!, toIslandId: ids.get(s.to)!, name: s.name ?? null });
        tally.straits++;
      }
      for (const s of scale.seas ?? []) {
        if (s.x !== undefined && s.y !== undefined) addSea(db, { domainId: domain.id, parentIslandId: parentId, name: s.name, x: s.x, y: s.y });
        else addSea(db, { domainId: domain.id, parentIslandId: parentId, name: s.name, anchor: s.islands! });
        tally.seas++;
      }
      for (const i of scale.islands) if (i.islets?.length) write(scaleOf(i), ids.get(i.slug)!);
    };
    write(file, null);
    return { domain, ...tally };
  })();
}
