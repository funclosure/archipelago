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
  island: string;
  /** Whose turn: the judge's (default) or the mentor's. Picks the persona and the thread. */
  mode?: MessageMode;
  emit: (event: JudgeEvent) => void;
  /** Aborted when the turn times out or the reader disconnects; the SDK runner cancels on it, the stub ignores it. */
  signal?: AbortSignal;
};

/** Runs one judge turn on the stored thread. Emits text as it arrives and resolves with the whole reply. */
export type JudgeRunner = (turn: JudgeTurn) => Promise<string>;

/** The stub needs no login; the SDK runner is imported lazily so tests never load it. */
export function createRunner(stub: boolean): JudgeRunner {
  if (stub) return stubRunner;
  return async (turn) => (await import("./sdk.ts")).sdkRunner(turn);
}
