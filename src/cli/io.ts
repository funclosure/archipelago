import { z } from "zod";
import { ArchipelagoError } from "../core/errors.ts";

export async function readStdinJson(): Promise<Record<string, unknown>> {
  const text = await Bun.stdin.text();
  if (!text.trim()) return {};
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ArchipelagoError("stdin JSON must be an object");
  }
  return parsed as Record<string, unknown>;
}

export function emit(value: unknown, forceCompact: boolean): void {
  const pretty = process.stdout.isTTY && !forceCompact;
  process.stdout.write(JSON.stringify(value, null, pretty ? 2 : 0) + "\n");
}

export function fail(error: unknown, forceCompact: boolean): never {
  let payload: unknown;
  if (error instanceof ArchipelagoError) payload = error.toJSON();
  else if (error instanceof z.ZodError) {
    payload = { error: error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
  } else if (error instanceof Error) payload = { error: error.message };
  else payload = { error: String(error) };
  emit(payload, forceCompact);
  process.exit(1);
}
