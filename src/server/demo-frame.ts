// The demo frame's own CSP, sent by `archipelago serve` and written into the hosted `_headers`. The frame runs a
// persona's demo fence in a sandboxed iframe (`allow-scripts` only, so its origin is opaque): inline scripts and
// styles run, nothing else loads, nothing goes out, and only the page may embed it.
export const DEMO_FRAME_PATH = "/demo-frame.html";

export const DEMO_FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join("; ");
