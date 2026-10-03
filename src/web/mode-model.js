// Pure, DOM-free: the two modes, the one stored per domain, and what the page calls them.
// A mode is both a lens on the map and who answers in the pane. PROTOCOL and code say judge; the page says the Keeper.

export const MODES = ["judge", "mentor"];
export const DEFAULT_MODE = MODES[0];
export const PERSONA_NAMES = { judge: "the Keeper", mentor: "the mentor" };
/** The strip switch's two segments. */
export const MODE_LABELS = { judge: "Keeper", mentor: "Mentor" };
export const MODE_HINTS = {
  judge: "What you have demonstrated: verdicts and lit landmarks. The Keeper answers in the pane.",
  mentor: "Where you have explored: landmarks you engaged with the mentor, no verdicts. The mentor answers in the pane.",
};

/** The localStorage key for a domain's mode. */
export const modeKey = (domain) => `mode:${domain}`;

export function storedMode(raw) {
  return MODES.includes(raw) ? raw : DEFAULT_MODE;
}

export function nextMode(mode) {
  return mode === "mentor" ? "judge" : "mentor";
}
