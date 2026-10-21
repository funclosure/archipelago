// Pure, DOM-free: the two modes, the one stored per domain, and what the page calls them.
// A mode is both a lens on the map and who answers in the pane. PROTOCOL and code say judge; the page says the Keeper.

export const MODES = ["judge", "mentor"];
export const DEFAULT_MODE = MODES[0];
export const PERSONA_NAMES = { judge: "the Keeper", mentor: "the mentor" };
/** The strip switch's two segments: the name, and in two or three words what it does with you. */
export const MODE_LABELS = { judge: "Keeper", mentor: "Mentor" };
export const MODE_ROLES = { judge: "asks and grades", mentor: "explains, no grades" };
/** The switch's hint card, and the segments' tooltips: what each mode does and what the map shows in it. */
export const MODE_HINTS = {
  judge: "The Keeper asks you questions and charts what you show: lit landmarks and a verdict per island. The map shows what you have demonstrated.",
  mentor: "The mentor explains, answers your questions, and never grades. The map shows the landmarks you explored together; nothing here becomes a verdict.",
};

/** The localStorage key for a domain's mode. */
export const modeKey = (domain) => `mode:${domain}`;

export function storedMode(raw) {
  return MODES.includes(raw) ? raw : DEFAULT_MODE;
}

export function nextMode(mode) {
  return mode === "mentor" ? "judge" : "mentor";
}

const pct = (v) => `${Math.round(v * 100)}%`;

/**
 * The first pill in the pane's head. The Keeper's lens names the verdict; the mentor's names only what
 * was explored, so a verdict never shows in the mentor's lens and nothing explored is open water.
 */
export function headPill(island, lens) {
  if (lens === "mentor") {
    const { total, explored = 0 } = island.landmarks ?? { total: 0 };
    return explored ? { cls: "pill explore", text: `explored · ${explored} of ${total}` } : { cls: "pill open", text: "open water" };
  }
  const v = island.verdict;
  if (v) return { cls: `pill${v.state === "reef" ? " reef" : ""}`, text: `${v.state} · ${pct(v.confidence)}` };
  return { cls: "pill open", text: island.children?.total ? "open water · islets below" : "open water" };
}
