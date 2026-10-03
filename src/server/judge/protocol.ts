import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** What readProtocol needs of a persona: the file, beside this one, that holds its rules. */
export type ProtocolSource = { protocolFile: string };

const JUDGE: ProtocolSource = { protocolFile: "PROTOCOL.md" };

/** A persona's system prompt (the judge's by default), read fresh on every turn so edits apply without a restart. */
export function readProtocol(persona: ProtocolSource = JUDGE): string {
  return readFileSync(fileURLToPath(new URL(`./${persona.protocolFile}`, import.meta.url)), "utf8");
}
