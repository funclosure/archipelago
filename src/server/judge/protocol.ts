import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PROTOCOL_PATH = fileURLToPath(new URL("./PROTOCOL.md", import.meta.url));

/** The judge's system prompt, read fresh on every turn so edits apply without a restart. */
export function readProtocol(): string {
  return readFileSync(PROTOCOL_PATH, "utf8");
}
