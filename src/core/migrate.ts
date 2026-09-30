import type { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations/", import.meta.url));

/** Applies every unapplied migration in filename order. Returns the versions applied by this call. */
export function migrateDatabase(db: Database): string[] {
  db.exec(
    "create table if not exists schema_migrations (version text primary key, applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
  );
  const applied = new Set(
    db.query<{ version: string }, []>("select version from schema_migrations").all().map((r) => r.version),
  );
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    // Immediate: take the write lock first, then re-check, so a server and a CLI opening together
    // cannot both run the same migration.
    const ranNow = db.transaction(() => {
      if (db.query("select 1 from schema_migrations where version = ?").get(version)) return false;
      db.exec(sql);
      db.run("insert into schema_migrations (version) values (?)", [version]);
      return true;
    }).immediate();
    if (ranNow) ran.push(version);
  }
  return ran;
}
