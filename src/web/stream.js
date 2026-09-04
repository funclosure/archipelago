// Server-sent events over a POST. The parser is pure; streamPost is the only fetch.

/** Splits a growing SSE text buffer into complete events and the leftover partial frame. */
export function parseSseBuffer(buffer) {
  const events = [];
  let idx;
  while ((idx = buffer.indexOf("\n\n")) !== -1) {
    const frame = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    let type = "message";
    const dataLines = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
      // ':' comment lines (keep-alives) are ignored
    }
    if (dataLines.length === 0) continue;
    const raw = dataLines.join("\n");
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
    events.push({ type, data });
  }
  return { events, rest: buffer };
}

/** POSTs JSON and calls onEvent({ type, data }) for each SSE event as it arrives. Resolves when the stream ends. */
export async function streamPost(url, body, onEvent) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    let message = `request failed (${res.status})`;
    try {
      const json = await res.json();
      if (json && json.error) message = json.error;
    } catch {
      // not JSON; keep the status message
    }
    onEvent({ type: "error", data: { type: "error", message } });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseBuffer(buffer);
    buffer = rest;
    for (const e of events) onEvent(e);
  }
}
