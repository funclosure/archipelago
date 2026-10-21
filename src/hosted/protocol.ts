// The hosted build's `src/server/judge/protocol.ts`: the protocols bundled as text, since a worker has no files.
import PROTOCOL from "../server/judge/PROTOCOL.md" with { type: "text" };
import MENTOR from "../server/judge/MENTOR.md" with { type: "text" };
import CARTOGRAPHER from "../server/judge/CARTOGRAPHER.md" with { type: "text" };

export type ProtocolSource = { protocolFile: string };

const TEXT: Record<string, string> = { "PROTOCOL.md": PROTOCOL, "MENTOR.md": MENTOR, "CARTOGRAPHER.md": CARTOGRAPHER };

export function readProtocol(persona: ProtocolSource = { protocolFile: "PROTOCOL.md" }): string {
  const text = TEXT[persona.protocolFile];
  if (text === undefined) throw new Error(`no bundled protocol ${persona.protocolFile}`);
  return text;
}
