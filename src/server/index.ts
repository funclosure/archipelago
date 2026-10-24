import { fileURLToPath } from "node:url";
import { openDatabase } from "../core/db.ts";
import { createRunner, defaultJudge, judgeModel, type JudgeKind, type JudgeRunner } from "./judge/runner.ts";
import { handleRequest, JUDGE_TURN_TIMEOUT_MS, type ServerContext } from "./routes.ts";

export const DEFAULT_STATIC_ROOT = fileURLToPath(new URL("../web/", import.meta.url));

export type ServerOptions = {
  port?: number;
  host?: string;
  dbPath?: string;
  staticRoot?: string;
  /** Which judge runs the turns; by default `defaultJudge()` (ARCHIPELAGO_JUDGE, then the API when a key is set, else the SDK). */
  judge?: JudgeKind;
  /** The same as `judge: "stub"`: canned replies, no login. Also `ARCHIPELAGO_STUB=1`. */
  stub?: boolean;
  /** Overrides the judge entirely; tests use it. */
  runner?: JudgeRunner;
  /** The model to name for `runner`; otherwise the judge's own (`judgeModel`). */
  model?: string | null;
  /** How long one judge turn may run. Defaults to `ARCHIPELAGO_TURN_TIMEOUT_MS`, else 180 s. */
  turnTimeoutMs?: number;
};

/** A positive integer of milliseconds from the environment, or the built-in default. */
function envTurnTimeoutMs(): number {
  const raw = process.env.ARCHIPELAGO_TURN_TIMEOUT_MS;
  if (raw === undefined) return JUDGE_TURN_TIMEOUT_MS;
  const ms = Number(raw);
  return Number.isInteger(ms) && ms > 0 ? ms : JUDGE_TURN_TIMEOUT_MS;
}

/** Migrates the database up front (a broken migration fails here, not on first request), then serves. */
export function startServer(options: ServerOptions = {}) {
  const judge = options.judge ?? (options.stub ? "stub" : defaultJudge());
  const model = options.model !== undefined ? options.model : options.runner ? null : judgeModel(judge);
  const ctx: ServerContext = {
    dbPath: options.dbPath,
    staticRoot: options.staticRoot ?? DEFAULT_STATIC_ROOT,
    runner: options.runner ?? createRunner(judge),
    turnTimeoutMs: options.turnTimeoutMs ?? envTurnTimeoutMs(),
    model: () => model,
  };
  openDatabase(ctx.dbPath).close();
  return Bun.serve({
    hostname: options.host ?? "127.0.0.1",
    port: options.port ?? 4480,
    idleTimeout: 120,
    fetch: (req) => handleRequest(req, ctx),
  });
}
