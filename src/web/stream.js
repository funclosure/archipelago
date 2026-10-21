// Server-sent events over a POST. The parser is pure; streamPost is the only request.
import { request } from "./transport.js";

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

/** The error as an Error, with `aborted` set when the caller's signal stopped the request. */
function markAborted(error, signal) {
  const e = error instanceof Error ? error : new Error(String(error));
  if (signal?.aborted || e.name === "AbortError") e.aborted = true;
  return e;
}

/**
 * POSTs JSON and calls onEvent({ type, data }) for each SSE event as it arrives. Resolves when the stream ends.
 * Throws when the server refused the request (nothing was stored), and throws with `midStream` set when the
 * connection broke after the stream opened (the message may be stored). Aborting `signal` stops it, and
 * the error then carries `aborted`; the server takes the closed connection as a stop and keeps no reply.
 */
export async function streamPost(url, body, onEvent, signal) {
  let res;
  try {
    res = await request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (error) {
    throw markAborted(error, signal);
  }
  if (!res.ok || !res.body) {
    let message = `request failed (${res.status})`;
    try {
      const json = await res.json();
      if (json && json.error) message = json.error;
    } catch {
      // not JSON; keep the status message
    }
    throw new Error(message);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseBuffer(buffer);
      buffer = rest;
      for (const e of events) onEvent(e);
    }
  } catch (error) {
    const broken = markAborted(error, signal);
    broken.midStream = true;
    throw broken;
  }
  buffer += decoder.decode(); // flush any bytes the decoder held back mid-character
  const { events } = parseSseBuffer(buffer);
  for (const e of events) onEvent(e);
}
