// The part of a SQLite connection the repositories use. `bun:sqlite`'s Database satisfies it as is; the hosted
// build's WebAssembly adapter (`sql-wasm.ts`) implements it. Repositories import `Database` from here, never
// from `bun:sqlite`, so the same code runs in Bun and in the browser's worker.

export type SqlValue = string | bigint | number | boolean | null | Uint8Array;
/** One positional value, or one object of `$name` bindings. */
export type SqlBindings = SqlValue | Record<string, SqlValue>;

export interface Changes {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface Statement<ReturnType = unknown, ParamsType extends SqlBindings[] = any[]> {
  all(...params: ParamsType): ReturnType[];
  get(...params: ParamsType): ReturnType | null;
  run(...params: ParamsType): Changes;
}

export interface Database {
  /** A statement, cached per SQL text. */
  query<ReturnType, ParamsType extends SqlBindings | SqlBindings[]>(sql: string): Statement<ReturnType, ParamsType extends any[] ? ParamsType : [ParamsType]>;
  /** A statement, not cached. */
  prepare<ReturnType, ParamsType extends SqlBindings | SqlBindings[]>(sql: string): Statement<ReturnType, ParamsType extends any[] ? ParamsType : [ParamsType]>;
  run<ParamsType extends SqlBindings[]>(sql: string, ...bindings: ParamsType[]): Changes;
  exec(sql: string): unknown;
  /** Wraps `fn` in a transaction (a savepoint when one is already open); `.immediate` takes the write lock first. */
  transaction<A extends any[], T>(fn: (...args: A) => T): ((...args: A) => T) & { immediate: (...args: A) => T };
  close(): void;
}
