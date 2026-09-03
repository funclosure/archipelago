import { z } from "zod";
import { ArchipelagoError } from "./errors.ts";
import { commentKinds, commentTargetTypes, verdictStates } from "./types.ts";

export const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase letters, digits and hyphens");

/** A number, or a non-empty string coerced to one; "" is rejected instead of becoming 0. */
const numberInput = z.union([z.number(), z.string().trim().min(1, "expected a number")]).pipe(z.coerce.number());

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
  order: numberInput.pipe(z.number().int()).optional(),
});

export const islandUpdateSchema = z.object({
  domain: slugSchema,
  slug: slugSchema,
  name: z.string().min(1).optional(),
  summary: z.string().optional(),
  order: numberInput.pipe(z.number().int()).optional(),
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
  confidence: numberInput.pipe(z.number().min(0).max(1)),
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
  const colon = target.indexOf(":");
  const type = colon === -1 ? target : target.slice(0, colon);
  const rest = colon === -1 ? "" : target.slice(colon + 1);
  if (type === "island" && slugSchema.safeParse(rest).success) {
    return { type: "island", slug: rest };
  }
  if (type === "strait") {
    const parts = rest.split("~");
    if (parts.length === 2 && parts.every((p) => slugSchema.safeParse(p).success)) {
      return { type: "strait", from: parts[0]!, to: parts[1]! };
    }
  }
  throw new ArchipelagoError(`target must be island:<slug> or strait:<a>~<b>, got "${target}"`);
}
