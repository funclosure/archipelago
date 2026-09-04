/** Splits a finished SSE body into events. Mirrors src/web/stream.js, kept separate so tsc does not need allowJs. */
export function parseSse(text: string): { type: string; data: any }[] {
  const events: { type: string; data: any }[] = [];
  for (const frame of text.split("\n\n")) {
    let type = "message";
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length === 0) continue;
    const raw = data.join("\n");
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
    events.push({ type, data: parsed });
  }
  return events;
}
