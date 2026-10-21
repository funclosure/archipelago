// SQLite compiled to WebAssembly (`@sqlite.org/sqlite-wasm`) behind the `sql.ts` interface, so the repositories run
// on it unchanged: statements cached per SQL text, `$name` objects or positional values, rows keyed by their `as`
// aliases, `null` for no row, and transactions that become savepoints when one is already open, as in Bun.
import type { Database as WasmDatabase, PreparedStatement, Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import type { Changes, Database, SqlBindings, Statement } from "./sql.ts";

/** "SQLITE_CONSTRAINT_UNIQUE: sqlite3 result code 2067: UNIQUE constraint failed: …" reads as Bun's "UNIQUE constraint failed: …". */
const RESULT_CODE = /^SQLITE_[A-Z_]+: sqlite3 result code \d+: /;

function rethrow(error: unknown): never {
  if (error instanceof Error && RESULT_CODE.test(error.message)) {
    const plain = new Error(error.message.replace(RESULT_CODE, ""));
    plain.name = "SQLiteError";
    throw plain;
  }
  throw error;
}

const isNamed = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !(v instanceof Uint8Array) && !Array.isArray(v);

/** Booleans bind as 0/1, as in Bun. */
const value = (v: unknown) => (typeof v === "boolean" ? (v ? 1 : 0) : v);

function bind(stmt: PreparedStatement, params: SqlBindings[]): void {
  if (params.length === 0) return;
  if (params.length === 1 && isNamed(params[0])) {
    stmt.bind(Object.fromEntries(Object.entries(params[0]).map(([k, v]) => [k, value(v)])) as never);
  } else {
    stmt.bind(params.map(value) as never);
  }
}

export function wrapWasmDatabase(sqlite3: Sqlite3Static, db: WasmDatabase): Database {
  const cache = new Map<string, PreparedStatement>();
  let savepoints = 0;

  const changes = (): Changes => ({
    changes: Number(db.changes()),
    lastInsertRowid: Number(sqlite3.capi.sqlite3_last_insert_rowid(db.pointer!)),
  });

  /** Runs `use` on the statement with `params` bound, then resets it (bindings cleared) for the next call. */
  function using<T>(stmt: PreparedStatement, params: SqlBindings[], use: () => T): T {
    try {
      bind(stmt, params);
      return use();
    } catch (error) {
      rethrow(error);
    } finally {
      stmt.reset(true);
    }
  }

  function statement<R>(stmt: PreparedStatement): Statement<R, any[]> {
    const rows = () => {
      const out: R[] = [];
      while (stmt.step()) out.push(stmt.get({}) as R);
      return out;
    };
    return {
      all: (...params) => using(stmt, params, rows),
      get: (...params) => using(stmt, params, () => (stmt.step() ? (stmt.get({}) as R) : null)),
      run: (...params) => using(stmt, params, () => {
        while (stmt.step());
        return changes();
      }),
    };
  }

  function prepare(sql: string): PreparedStatement {
    try {
      return db.prepare(sql);
    } catch (error) {
      rethrow(error);
    }
  }

  const exec = (sql: string) => {
    try {
      db.exec(sql);
    } catch (error) {
      rethrow(error);
    }
  };

  const inTransaction = () => sqlite3.capi.sqlite3_get_autocommit(db.pointer!) === 0;

  /** One prepared statement per SQL text for the connection's life; finalized when it closes. */
  function cached<R>(sql: string) {
    let stmt = cache.get(sql);
    if (!stmt) cache.set(sql, (stmt = prepare(sql)));
    return statement<R>(stmt);
  }

  return {
    query: cached,
    // Bun's prepare skips its cache; here the connection lives as long as the worker, so caching is the cheaper choice.
    prepare: cached,
    run(sql: string, ...bindings: SqlBindings[][]) {
      const stmt = prepare(sql);
      try {
        return statement(stmt).run(...(bindings[0] ?? []));
      } finally {
        stmt.finalize();
      }
    },
    exec,
    transaction<A extends any[], T>(fn: (...args: A) => T) {
      const run = (begin: string) => (...args: A): T => {
        if (inTransaction()) {
          const name = `sp${++savepoints}`;
          exec(`savepoint ${name}`);
          try {
            const result = fn(...args);
            exec(`release ${name}`);
            return result;
          } catch (error) {
            exec(`rollback to ${name}`);
            exec(`release ${name}`);
            throw error;
          }
        }
        exec(begin);
        try {
          const result = fn(...args);
          exec("commit");
          return result;
        } catch (error) {
          if (inTransaction()) exec("rollback");
          throw error;
        }
      };
      return Object.assign(run("begin"), { immediate: run("begin immediate") });
    },
    close() {
      for (const stmt of cache.values()) stmt.finalize();
      cache.clear();
      db.close();
    },
  };
}
