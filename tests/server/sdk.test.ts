import { test, expect } from "bun:test";
import { describeSdkError, DEFAULT_MODEL } from "../../src/server/judge/sdk.ts";

test("SDK errors become one actionable sentence", () => {
  expect(describeSdkError("authentication_failed")).toContain("claude login");
  expect(describeSdkError("rate_limit")).toMatch(/rate-limited/);
  expect(describeSdkError("model_not_found")).toContain(DEFAULT_MODEL);
  expect(describeSdkError("error_max_turns")).toBe("The judge stopped: error_max_turns.");
  // what the SDK said, when the code alone says nothing
  expect(describeSdkError("unknown", "API Error: 400 Claude Code 2.1.260 does not support this model")).toBe("The judge stopped: API Error: 400 Claude Code 2.1.260 does not support this model");
});
