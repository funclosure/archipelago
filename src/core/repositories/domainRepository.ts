import type { Database } from "../sql.ts";
import { NotFoundError } from "../errors.ts";
import type { Domain } from "../types.ts";

const COLS = "id, slug, name, created_at as createdAt";

export function upsertDomain(db: Database, input: { slug: string; name: string }): Domain {
  return db
    .query<Domain, { $slug: string; $name: string }>(
      `insert into domains (slug, name) values ($slug, $name)
       on conflict(slug) do update set name = excluded.name
       returning ${COLS}`,
    )
    .get({ $slug: input.slug, $name: input.name })!;
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
