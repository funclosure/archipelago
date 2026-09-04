import { fileURLToPath } from "node:url";
import { openDatabase } from "../core/db.ts";
import { createRunner, type JudgeRunner } from "./judge/runner.ts";
import { handleRequest, type ServerContext } from "./routes.ts";

export const DEFAULT_STATIC_ROOT = fileURLToPath(new URL("../web/", import.meta.url));

export type ServerOptions = {
  port?: number;
  host?: string;
  dbPath?: string;
  staticRoot?: string;
  /** Run the judge without the Agent SDK (canned replies). Also `ARCHIPELAGO_STUB=1`. */
  stub?: boolean;
  /** Overrides the judge entirely; tests use it. */
  runner?: JudgeRunner;
};

/** Migrates the database up front (a broken migration fails here, not on first request), then serves. */
export function startServer(options: ServerOptions = {}) {
  const stub = options.stub ?? process.env.ARCHIPELAGO_STUB === "1";
  const ctx: ServerContext = {
    dbPath: options.dbPath,
    staticRoot: options.staticRoot ?? DEFAULT_STATIC_ROOT,
    runner: options.runner ?? createRunner(stub),
  };
  openDatabase(ctx.dbPath).close();
  return Bun.serve({
    hostname: options.host ?? "127.0.0.1",
    port: options.port ?? 4480,
    idleTimeout: 120,
    fetch: (req) => handleRequest(req, ctx),
  });
}
