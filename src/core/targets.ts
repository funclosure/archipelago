import type { Database } from "bun:sqlite";
import { ArchipelagoError } from "./errors.ts";
import { getIslandById, requireIsland } from "./repositories/islandRepository.ts";
import { requireStrait } from "./repositories/straitRepository.ts";
import type { CommentTargetType, Domain, VerdictTargetType } from "./types.ts";
import { parseTarget } from "./validators.ts";

export type ResolvedVerdictTarget = { targetType: VerdictTargetType; targetId: number; label: string };

/** `island:<slug>` or `strait:<a>~<b>` → row id, or NotFoundError with valid slugs. */
export function resolveVerdictTarget(db: Database, domainId: number, target: string): ResolvedVerdictTarget {
  const parsed = parseTarget(target);
  if (parsed.type === "island") {
    const island = requireIsland(db, domainId, parsed.slug);
    return { targetType: "island", targetId: island.id, label: `island:${island.slug}` };
  }
  const a = requireIsland(db, domainId, parsed.from);
  const b = requireIsland(db, domainId, parsed.to);
  const strait = requireStrait(db, a, b);
  // Label from the stored (from, to) order, not the caller's, so it matches formatTarget.
  const from = getIslandById(db, strait.fromIslandId)!;
  const to = getIslandById(db, strait.toIslandId)!;
  return { targetType: "strait", targetId: strait.id, label: `strait:${from.slug}~${to.slug}` };
}

/** Comment targets arrive as slugs from the page: island slug, `a~b`, or the domain slug. */
export function resolveCommentTarget(
  db: Database,
  domain: Domain,
  targetType: CommentTargetType,
  targetId: string,
): { targetType: CommentTargetType; targetId: number } {
  if (targetType === "domain") return { targetType, targetId: domain.id };
  if (targetType === "island") return { targetType, targetId: requireIsland(db, domain.id, targetId).id };
  const parts = targetId.split("~");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new ArchipelagoError(`strait targetId must be "<a>~<b>", got "${targetId}"`);
  }
  const [from, to] = parts;
  const a = requireIsland(db, domain.id, from);
  const b = requireIsland(db, domain.id, to);
  return { targetType, targetId: requireStrait(db, a, b).id };
}
