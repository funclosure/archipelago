// Pure, DOM-free parts of a demo fence: its tag, the size limits, the theme tokens it is handed, and how the
// frame's reports are read. demo.js does the rest.

/** The fence tag that runs a demo. */
export const DEMO_LANG = "demo";

/** The longest body a demo may have; past it the fence shows as its source. */
export const DEMO_MAX = 8000;

export const DEMO_MIN_H = 80;
export const DEMO_MAX_H = 520;

/** The theme tokens a demo can use as `var(--name)`, so it looks like the page in every theme. */
export const DEMO_TOKENS = ["--text", "--text-2", "--muted", "--line", "--panel", "--panel-2", "--water", "--sea", "--lamp", "--reef", "--grass", "--snow", "--explore", "--font-text", "--font-mono"];

/** The frame's reported height, kept between the limits (a demo taller than the cap scrolls inside its frame). */
export function demoHeight(reported) {
  const h = Number(reported);
  if (!Number.isFinite(h)) return DEMO_MIN_H;
  return Math.max(DEMO_MIN_H, Math.min(DEMO_MAX_H, Math.ceil(h)));
}

/** A console line from the frame, cut to one readable line, or null when it is not one. */
export function logLine(data) {
  if (!data || typeof data.text !== "string") return null;
  const level = ["log", "info", "warn", "error"].includes(data.level) ? data.level : "log";
  const text = data.text.length > 400 ? `${data.text.slice(0, 400)}…` : data.text;
  return { level, text };
}
