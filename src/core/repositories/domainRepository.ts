import type { Database } from "../sql.ts";
import { ArchipelagoError, ConflictError, NotFoundError } from "../errors.ts";
import type { Domain } from "../types.ts";
import { kebab } from "../validators.ts";

const COLS = "id, slug, name, description, provisional, created_at as createdAt";

/** Creates or renames a domain. A description given replaces the stored one; one left out keeps it. */
export function upsertDomain(db: Database, input: { slug: string; name: string; description?: string | null }): Domain {
  return db
    .query<Domain, { $slug: string; $name: string; $description: string | null; $keep: number }>(
      `insert into domains (slug, name, description) values ($slug, $name, $description)
       on conflict(slug) do update set name = excluded.name, provisional = 0,
         description = case when $keep then domains.description else excluded.description end
       returning ${COLS}`,
    )
    .get({ $slug: input.slug, $name: input.name, $description: input.description ?? null, $keep: input.description === undefined ? 1 : 0 })!;
}

/** The name a domain made from a description carries until the cartographer names it: its first phrase, cut short. */
export function provisionalName(description: string): string {
  const first = description.trim().split(/[\n.;:!?]|,\s| — | - /)[0]!.trim() || description.trim();
  if (first.length <= 48) return first;
  const cut = first.slice(0, 48);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 20 ? cut.lastIndexOf(" ") : 48).trimEnd()}…`;
}

/**
 * A new domain from the page. With a name, that name and its slug (409 when taken). With only a description, a
 * provisional name from it and a free slug (`-2`, `-3`, … when taken); the first sketch names it properly.
 */
export function createDomain(db: Database, input: { name?: string; slug?: string; description?: string | null }): Domain {
  if (input.name) {
    const slug = input.slug ?? kebab(input.name);
    if (!slug) throw new ArchipelagoError("a domain name needs at least one letter or digit");
    if (getDomain(db, slug)) throw new ConflictError(`the domain ${slug} already exists`);
    return upsertDomain(db, { slug, name: input.name, description: input.description ?? null });
  }
  const name = provisionalName(input.description ?? "");
  const base = kebab(name).slice(0, 48).replace(/-+$/, "") || "domain";
  let slug = base;
  for (let n = 2; getDomain(db, slug); n++) slug = `${base}-${n}`;
  return db
    .query<Domain, [string, string, string | null]>(`insert into domains (slug, name, description, provisional) values (?, ?, ?, 1) returning ${COLS}`)
    .get(slug, name, input.description ?? null)!;
}

/** Changes a domain's name, description, or both; a name given here is the reader's, so it is no longer provisional. */
export function updateDomain(db: Database, slug: string, input: { name?: string; description?: string | null }): Domain {
  const d = requireDomain(db, slug);
  return db
    .query<Domain, [string, string | null, number, string]>(`update domains set name = ?, description = ?, provisional = ? where slug = ? returning ${COLS}`)
    .get(input.name ?? d.name, input.description === undefined ? d.description : input.description, input.name === undefined ? d.provisional : 0, slug)!;
}

/**
 * The cartographer's name for a domain, applied when its sketch is approved. A provisional domain also takes the
 * name's slug when it is free, so the URL and the terminal read like the name; a domain already named keeps its slug.
 */
export function nameDomain(db: Database, domainId: number, name: string): Domain {
  const d = db.query<Domain, [number]>(`select ${COLS} from domains where id = ?`).get(domainId)!;
  const wanted = kebab(name);
  const slug = d.provisional && wanted && !getDomain(db, wanted) ? wanted : d.slug;
  return db.query<Domain, [string, string, number]>(`update domains set name = ?, slug = ?, provisional = 0 where id = ? returning ${COLS}`).get(name, slug, domainId)!;
}

export function listDomains(db: Database): Domain[] {
  return db.query<Domain, []>(`select ${COLS} from domains order by slug`).all();
}

export function getDomain(db: Database, slug: string): Domain | null {
  return db.query<Domain, [string]>(`select ${COLS} from domains where slug = ?`).get(slug) ?? null;
}

export function requireDomain(db: Database, slug: string): Domain {
  const domain = getDomain(db, slug);
  if (!domain) {
    throw new NotFoundError(`no domain "${slug}"`, listDomains(db).map((d) => d.slug));
  }
  return domain;
}
