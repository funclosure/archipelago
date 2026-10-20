import { ArchipelagoError } from "../../core/errors.ts";
import type { MessageMode } from "../../core/types.ts";
import { stubRunner } from "./stub.ts";

export type JudgeEvent =
  | { type: "text"; text: string }
  | { type: "progress"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

export type JudgeTurn = {
  dbPath?: string;
  domain: string;
  /** The island; for the cartographer the scale, absent at the domain's top scale. */
  island?: string;
  /** Whose turn: the judge's (default), the mentor's, or the cartographer's. Picks the persona and the thread. */
  mode?: MessageMode;
  emit: (event: JudgeEvent) => void;
  /** Aborted when the turn times out or the reader disconnects; the SDK runner cancels on it, the stub ignores it. */
  signal?: AbortSignal;
};

/** Runs one judge turn on the stored thread. Emits text as it arrives and resolves with the whole reply. */
export type JudgeRunner = (turn: JudgeTurn) => Promise<string>;

export const JUDGE_KINDS = ["api", "sdk", "stub"] as const;
export type JudgeKind = (typeof JUDGE_KINDS)[number];

export const SDK_DEFAULT_MODEL = "claude-opus-5";
export const API_DEFAULT_MODEL = "claude-opus-5-5";

export function parseJudgeKind(raw: string, from: string): JudgeKind {
  if ((JUDGE_KINDS as readonly string[]).includes(raw)) return raw as JudgeKind;
  throw new ArchipelagoError(`${from} must be one of ${JUDGE_KINDS.join(", ")}, not "${raw}"`);
}

/** The judge when nothing names one: ARCHIPELAGO_JUDGE, then ARCHIPELAGO_STUB=1, then the API when a key is set, else the SDK. */
export function defaultJudge(env: Record<string, string | undefined> = process.env): JudgeKind {
  if (env.ARCHIPELAGO_JUDGE) return parseJudgeKind(env.ARCHIPELAGO_JUDGE, "ARCHIPELAGO_JUDGE");
  if (env.ARCHIPELAGO_STUB === "1") return "stub";
  return env.ANTHROPIC_API_KEY ? "api" : "sdk";
}

/** The model a judge runs on: ARCHIPELAGO_MODEL, else that runner's default. The stub has none. */
export function judgeModel(kind: JudgeKind, env: Record<string, string | undefined> = process.env): string | null {
  if (kind === "stub") return null;
  return env.ARCHIPELAGO_MODEL ?? (kind === "api" ? API_DEFAULT_MODEL : SDK_DEFAULT_MODEL);
}

/** The stub needs no login; the SDK and API runners are imported lazily so tests never load them. */
export function createRunner(kind: JudgeKind): JudgeRunner {
  if (kind === "stub") return stubRunner;
  if (kind === "sdk") return async (turn) => (await import("./sdk.ts")).sdkRunner(turn);
  let api: JudgeRunner | undefined; // one client for the server's life, made on the first turn
  return async (turn) => {
    if (!api) {
      const [{ createApiRunner }, { runTool }] = await Promise.all([import("./api.ts"), import("./tools.ts")]);
      api = createApiRunner({ toolbox: { context: (persona, deps) => persona.buildContext(deps), run: runTool } });
    }
    return api(turn);
  };
}
