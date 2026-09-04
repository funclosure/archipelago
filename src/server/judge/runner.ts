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
  emit: (event: JudgeEvent) => void;
};

/** Runs one judge turn on the stored thread. Emits text as it arrives and resolves with the whole reply. */
export type JudgeRunner = (turn: JudgeTurn) => Promise<string>;

/** The stub needs no login; the SDK runner is imported lazily so tests never load it. */
export function createRunner(stub: boolean): JudgeRunner {
  if (stub) return stubRunner;
  return async (turn) => (await import("./sdk.ts")).sdkRunner(turn);
}
