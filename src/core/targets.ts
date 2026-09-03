import type { Database } from "bun:sqlite";
import { ArchipelagoError } from "./errors.ts";
import { requireIsland } from "./repositories/islandRepository.ts";
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
  return { targetType: "strait", targetId: strait.id, label: `strait:${a.slug}~${b.slug}` };
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
  const [from, to] = targetId.split("~");
  if (!from || !to) throw new ArchipelagoError(`strait targetId must be "<a>~<b>", got "${targetId}"`);
  const a = requireIsland(db, domain.id, from);
  const b = requireIsland(db, domain.id, to);
  return { targetType, targetId: requireStrait(db, a, b).id };
}
