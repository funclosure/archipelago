import type { Database } from "../sql.ts";
import { NotFoundError } from "../errors.ts";
import type { Domain } from "../types.ts";

const COLS = "id, slug, name, angle, created_at as createdAt";

/** Creates or renames a domain. An angle given replaces the stored one; an angle left out keeps it. */
export function upsertDomain(db: Database, input: { slug: string; name: string; angle?: string | null }): Domain {
  return db
    .query<Domain, { $slug: string; $name: string; $angle: string | null; $keep: number }>(
      `insert into domains (slug, name, angle) values ($slug, $name, $angle)
       on conflict(slug) do update set name = excluded.name, angle = case when $keep then domains.angle else excluded.angle end
       returning ${COLS}`,
    )
    .get({ $slug: input.slug, $name: input.name, $angle: input.angle ?? null, $keep: input.angle === undefined ? 1 : 0 })!;
}

/** Sets or (with null) clears a domain's angle. */
export function setDomainAngle(db: Database, slug: string, angle: string | null): Domain {
  requireDomain(db, slug);
  return db.query<Domain, [string | null, string]>(`update domains set angle = ? where slug = ? returning ${COLS}`).get(angle, slug)!;
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
