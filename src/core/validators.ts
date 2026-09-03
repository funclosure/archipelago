import { z } from "zod";
import { ArchipelagoError } from "./errors.ts";
import { commentKinds, commentTargetTypes, verdictStates } from "./types.ts";

export const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase letters, digits and hyphens");

export const domainInputSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1),
});

export const islandInputSchema = z.object({
  domain: slugSchema,
  slug: slugSchema,
  name: z.string().min(1),
  summary: z.string().optional(),
  parent: slugSchema.optional(),
  order: z.coerce.number().int().optional(),
});

export const islandUpdateSchema = z.object({
  domain: slugSchema,
  slug: slugSchema,
  name: z.string().min(1).optional(),
  summary: z.string().optional(),
  order: z.coerce.number().int().optional(),
});

export const straitInputSchema = z.object({
  domain: slugSchema,
  from: slugSchema,
  to: slugSchema,
  name: z.string().optional(),
  summary: z.string().optional(),
});

export const verdictInputSchema = z.object({
  domain: slugSchema,
  target: z.string().min(1),
  state: z.enum(verdictStates),
  confidence: z.coerce.number().min(0).max(1),
  evidence: z.string().min(1),
  rationale: z.string().optional(),
});

export const commentInputSchema = z.object({
  domain: slugSchema,
  targetType: z.enum(commentTargetTypes),
  /** island slug, `a~b` strait pair, or the domain slug */
  targetId: z.string().min(1),
  body: z.string().default(""),
  kind: z.enum(commentKinds),
});

export const focusInputSchema = z.object({
  domain: slugSchema,
  island: slugSchema.nullable(),
});

export const sessionEndInputSchema = z.object({
  domain: slugSchema,
  summary: z.string().min(1),
});

export type ParsedTarget = { type: "island"; slug: string } | { type: "strait"; from: string; to: string };

/** `island:<slug>` or `strait:<a>~<b>`. */
export function parseTarget(target: string): ParsedTarget {
  const [type, rest] = target.split(":", 2);
  if (type === "island" && rest && slugSchema.safeParse(rest).success) {
    return { type: "island", slug: rest };
  }
  if (type === "strait" && rest) {
    const [from, to] = rest.split("~");
    if (from && to && slugSchema.safeParse(from).success && slugSchema.safeParse(to).success) {
      return { type: "strait", from, to };
    }
  }
  throw new ArchipelagoError(`target must be island:<slug> or strait:<a>~<b>, got "${target}"`);
}
