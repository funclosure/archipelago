import type { Database } from "./sql.ts";
import { MIGRATIONS } from "./migrations/index.ts";

/** A migration whose first line is this runs with foreign keys off, so it can rebuild a table others reference. */
const FOREIGN_KEYS_OFF = "-- foreign_keys: off";

/** Applies every unapplied migration in order. Returns the versions applied by this call. */
export function migrateDatabase(db: Database): string[] {
  db.exec(
    "create table if not exists schema_migrations (version text primary key, applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
  );
  const applied = new Set(
    db.query<{ version: string }, []>("select version from schema_migrations").all().map((r) => r.version),
  );
  const ran: string[] = [];
  for (const { version, sql } of MIGRATIONS) {
    if (applied.has(version)) continue;
    // `pragma foreign_keys` is a no-op inside a transaction: switch it here, outside, and restore it after.
    const fkOff = sql.startsWith(FOREIGN_KEYS_OFF);
    const fkWas = db.query<{ foreign_keys: number }, []>("pragma foreign_keys").get()!.foreign_keys;
    if (fkOff) db.exec("pragma foreign_keys = off;");
    try {
      // Immediate: take the write lock first, then re-check, so a server and a CLI opening together
      // cannot both run the same migration.
      const ranNow = db.transaction(() => {
        if (db.query("select 1 from schema_migrations where version = ?").get(version)) return false;
        db.exec(sql);
        if (fkOff) {
          const broken = db.query("pragma foreign_key_check").all();
          if (broken.length) throw new Error(`${version} left ${broken.length} rows with a broken foreign key`);
        }
        db.run("insert into schema_migrations (version) values (?)", [version]);
        return true;
      }).immediate();
      if (ranNow) ran.push(version);
    } finally {
      if (fkOff) db.exec(`pragma foreign_keys = ${fkWas ? "on" : "off"};`);
    }
  }
  return ran;
}
