import { fileURLToPath } from "node:url";
import { openDatabase } from "../core/db.ts";
import { handleRequest, type ServerContext } from "./routes.ts";

export const DEFAULT_STATIC_ROOT = fileURLToPath(new URL("../web/", import.meta.url));

export type ServerOptions = { port?: number; host?: string; dbPath?: string; staticRoot?: string };

/** Migrates the database up front (a broken migration fails here, not on first request), then serves. */
export function startServer(options: ServerOptions = {}) {
  const ctx: ServerContext = { dbPath: options.dbPath, staticRoot: options.staticRoot ?? DEFAULT_STATIC_ROOT };
  openDatabase(ctx.dbPath).close();
  return Bun.serve({
    hostname: options.host ?? "127.0.0.1",
    port: options.port ?? 4480,
    idleTimeout: 120,
    fetch: (req) => handleRequest(req, ctx),
  });
}
