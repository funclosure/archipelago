import { z } from "zod";
import { ArchipelagoError } from "./errors.ts";
import { commentKinds, commentTargetTypes, verdictStates } from "./types.ts";

export const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase letters, digits and hyphens");

/** A number, or a non-empty string coerced to one; "" is rejected instead of becoming 0. */
const numberInput = z.union([z.number(), z.string().trim().min(1, "expected a number")]).pipe(z.coerce.number());

/** A map coordinate in the 1000-unit world. */
const coordinate = numberInput.pipe(z.number().min(0).max(1000));

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

export const islandUpdateSchema = z
  .object({
    domain: slugSchema,
    slug: slugSchema,
    name: z.string().min(1).optional(),
    summary: z.string().optional(),
    order: numberInput.pipe(z.number().int()).optional(),
    x: coordinate.optional(),
    y: coordinate.optional(),
  })
  .refine((v) => (v.x === undefined) === (v.y === undefined), { message: "pass both --x and --y, or neither" });

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

export const positionsInputSchema = z.object({
  domain: slugSchema,
  positions: z.array(z.object({ island: slugSchema, x: coordinate, y: coordinate })).min(1).max(1000),
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

/** What the judge may write directly. A reef is never recorded here; it goes through a proposal. */
export const judgeVerdictInputSchema = z.object({
  target: z.string().min(1),
  state: z.enum(["sandbar", "settled", "mountainous"]),
  confidence: numberInput.pipe(z.number().min(0).max(1)),
  evidence: z.string().min(1),
  rationale: z.string().min(1),
});

export const reefProposalInputSchema = z.object({
  target: z.string().min(1),
  claim: z.string().min(1),
  consequence: z.string().min(1),
  evidence: z.string().min(1),
  confidence: numberInput.pipe(z.number().min(0).max(1)),
  rationale: z.string().min(1),
});

export const probeInputSchema = z.object({
  domain: slugSchema,
  island: slugSchema,
  message: z.string().trim().min(1).optional(),
  askId: numberInput.pipe(z.number().int().positive()).optional(),
});

export const askInputSchema = z.object({
  question: z.string().trim().min(1),
  options: z
    .array(z.string().trim().min(1))
    .min(2)
    .max(4)
    .refine((o) => new Set(o).size === o.length, { message: "options must be distinct" }),
});

export const reefAnswerInputSchema = z.object({
  domain: slugSchema,
  id: numberInput.pipe(z.number().int().positive()),
  answer: z.enum(["confirm", "dispute"]),
  note: z.string().trim().min(1).optional(),
});

export const landmarkInputSchema = z.object({
  domain: slugSchema,
  island: slugSchema,
  slug: slugSchema,
  name: z.string().trim().min(1),
  order: numberInput.pipe(z.number().int()).optional(),
});

export const landmarksInputSchema = z
  .object({
    items: z.array(z.object({ slug: slugSchema, name: z.string().trim().min(1) })).min(4).max(6),
  })
  .refine((v) => new Set(v.items.map((i) => i.slug)).size === v.items.length, { message: "landmark slugs must be unique" });

export const unlockInputSchema = z.object({
  slug: slugSchema,
  evidence: z.string().min(1),
});
