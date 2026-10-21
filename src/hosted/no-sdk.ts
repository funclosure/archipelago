// The hosted build's `src/server/judge/sdk.ts`: the Agent SDK needs Claude Code, which a browser does not have.
import type { JudgeRunner } from "../server/judge/runner.ts";

export const sdkRunner: JudgeRunner = async () => {
  throw new Error("the Claude Code runner is not available in the browser");
};
