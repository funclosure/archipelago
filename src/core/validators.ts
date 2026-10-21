import { z } from "zod";
import { ArchipelagoError } from "./errors.ts";
import { boardKinds, codeLangs, commentKinds, commentTargetTypes, messageModes, verdictStates } from "./types.ts";

export const slugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase letters, digits and hyphens");

/** A number, or a non-empty string coerced to one; "" is rejected instead of becoming 0. */
const numberInput = z.union([z.number(), z.string().trim().min(1, "expected a number")]).pipe(z.coerce.number());

/** A map coordinate in world units. The sea has no edge; the bound only keeps a runaway value out of the database. */
export const COORDINATE_MAX = 1_000_000;
const coordinate = numberInput.pipe(z.number().min(-COORDINATE_MAX).max(COORDINATE_MAX));

/** A domain's description, the reader's words on what they want to chart and why: a paragraph at most. Empty means none. */
export const DESCRIPTION_MAX = 500;
const descriptionSchema = z
  .string()
  .trim()
  .max(DESCRIPTION_MAX, `a description is at most ${DESCRIPTION_MAX} characters`)
  .transform((a) => a || null);

export const domainInputSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1),
  description: descriptionSchema.optional(),
});

const domainName = z.string().pipe(z.string().trim().min(1, "a name cannot be empty").max(80)).refine((n) => !/[\r\n]/.test(n), { message: "a name is one line" });

/** A change to a domain from the page or the terminal: its name, its description (null or "" clears it), or both. */
/** A sea's name: one line, the reader's words. */
export const SEA_NAME_MAX = 40;
const seaName = z.string().pipe(z.string().trim().min(1, "a sea needs a name").max(SEA_NAME_MAX)).refine((n) => !/[\r\n]/.test(n), { message: "a sea's name is one line" });
const seaId = numberInput.pipe(z.number().int().positive());
/** POST /api/seas: add one at a scale (`island` = the scale, absent = the top), rename or move one, or remove one. */
export const seaWriteSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), domain: slugSchema, island: slugSchema.optional(), name: seaName, x: coordinate, y: coordinate }),
  z.object({ op: z.literal("update"), domain: slugSchema, id: seaId, name: seaName.optional(), x: coordinate.optional(), y: coordinate.optional() })
    .refine((u) => u.name !== undefined || (u.x !== undefined && u.y !== undefined), { message: "an update renames the sea, or moves it with both x and y" }),
  z.object({ op: z.literal("remove"), domain: slugSchema, id: seaId }),
]);

export const domainUpdateSchema = z
  .object({ domain: slugSchema, name: domainName.optional(), description: z.union([descriptionSchema, z.null()]).optional() })
  .refine((u) => u.name !== undefined || u.description !== undefined, { message: "an update changes the name, the description, or both" });

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

export const probeInputSchema = z
  .object({
    domain: slugSchema,
    /** The island; for the cartographer, the scale, and absent at the domain's top scale. */
    island: slugSchema.optional(),
    /** Whose turn: the judge's (default), the mentor's, or the cartographer's. */
    mode: z.enum(messageModes).default("judge"),
    message: z.string().trim().min(1).optional(),
    askId: numberInput.pipe(z.number().int().positive()).optional(),
  })
  .refine((v) => v.mode === "cartographer" || v.island !== undefined, { message: "island is required", path: ["island"] });

export const askInputSchema = z.object({
  question: z.string().trim().min(1),
  options: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .refine((o) => !/\n/.test(o), { message: "an option cannot contain a newline" }),
    )
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

const cardId = numberInput.pipe(z.number().int().positive());
const cardTitle = z
  .string()
  .trim()
  .min(1)
  .refine((t) => !/[\r\n\u2028\u2029]/.test(t), { message: "a title is one line" });
/** Not trimmed: code and diagrams keep their whitespace. */
const cardBody = z.string().refine((b) => b.trim().length > 0, { message: "a body cannot be empty" });
const cardLang = z.enum(codeLangs).nullable().optional();

const boardAdd = z.object({ op: z.literal("add"), kind: z.enum(boardKinds), title: cardTitle.optional(), body: cardBody, lang: cardLang });
const boardUpdate = z.object({ op: z.literal("update"), id: cardId, title: cardTitle.optional(), body: cardBody.optional(), lang: cardLang });
const boardRemove = z.object({ op: z.literal("remove"), id: cardId });
const needsAField = (v: { op: string; title?: string; body?: string; lang?: string | null }) =>
  v.op !== "update" || v.title !== undefined || v.body !== undefined || v.lang !== undefined;
const NEEDS_A_FIELD = { message: "an update needs a title, a body, or a lang" };

/** What the judge's board_write tool and the reader's POST /api/board both accept. */
export const boardWriteInputSchema = z.discriminatedUnion("op", [boardAdd, boardUpdate, boardRemove]).refine(needsAField, NEEDS_A_FIELD);
export type BoardWriteInput = z.infer<typeof boardWriteInputSchema>;

const boardScope = { domain: slugSchema, island: slugSchema };
export const boardPostInputSchema = z
  .discriminatedUnion("op", [boardAdd.extend(boardScope), boardUpdate.extend(boardScope), boardRemove.extend(boardScope)])
  .refine(needsAField, NEEDS_A_FIELD);

/** Which thread: the judge's or the mentor's. */
export const modeSchema = z.enum(messageModes);

/** The learner note's cap. The mentor's context slices to it as well, so an older, longer row cannot grow the prompt. */
export const NOTE_MAX = 1000;
export const learnerInputSchema = z.object({
  note: z.string().trim().max(NOTE_MAX, `a note is at most ${NOTE_MAX} characters`),
});

const oneLine = z
  .string()
  .trim()
  .min(1)
  .refine((t) => !/[\r\n\u2028\u2029]/.test(t), { message: "must be one line" });
const landmarkItems = z
  .array(z.object({ slug: slugSchema, name: oneLine }))
  .min(4)
  .max(6)
  .refine((items) => new Set(items.map((i) => i.slug)).size === items.length, { message: "landmark slugs must be unique" });

/** A sketch's shape. The rules that depend on the map (counts per scale, slugs taken) are checked by the repository. */
export const sketchBodySchema = z
  .object({
    islands: z.array(z.object({ slug: slugSchema, name: oneLine, summary: oneLine, landmarks: landmarkItems })).max(10).default([]),
    straits: z.array(z.object({ from: slugSchema, to: slugSchema, name: oneLine.optional() })).max(40).default([]),
    harbour: slugSchema.optional(),
    /** The domain's name, from the cartographer's first sketch of a provisionally named domain. Top scale only. */
    name: domainName.optional(),
    updates: z
      .array(
        z
          .object({ slug: slugSchema, name: oneLine.optional(), summary: oneLine.optional() })
          .refine((u) => u.name !== undefined || u.summary !== undefined, { message: "an update changes the name, the summary, or both" }),
      )
      .max(20)
      .default([]),
  })
  .refine((b) => b.islands.length + b.straits.length + b.updates.length > 0 || b.harbour !== undefined || b.name !== undefined, { message: "a sketch proposes something" });

/** A new domain from the page: the slug defaults to the name in kebab case. */
/** A new domain from the page: a description, a name, or both. With no name, the domain starts under a provisional one. */
export const domainCreateSchema = z
  .object({ name: domainName.optional(), slug: slugSchema.optional(), description: descriptionSchema.optional() })
  .refine((d) => d.name !== undefined || Boolean(d.description), { message: "say what you want to chart" });

export const sketchDecisionSchema = z.object({
  domain: slugSchema,
  island: slugSchema.optional(),
  sketchId: numberInput.pipe(z.number().int().positive()),
  action: z.enum(["approve", "discard"]),
});

/** A name in lowercase kebab case, as a slug: letters and digits only, runs of anything else become one hyphen. */
export function kebab(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
