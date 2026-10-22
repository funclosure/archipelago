// Pure, DOM-free: the two modes, the one stored per domain, and what the page calls them.
// A mode is both a lens on the map and who answers in the pane. PROTOCOL and code say judge; the page says the Keeper.
import { t } from "./i18n.js";

export const MODES = ["judge", "mentor"];
export const DEFAULT_MODE = MODES[0];
/** Who answers, as a sentence names them; the cartographer is here too, for the waiting line in its pane. */
export const PERSONA_NAMES = {
  judge: t("modeModel.personaJudge"),
  mentor: t("modeModel.personaMentor"),
  cartographer: t("modeModel.personaCartographer"),
};
/** The strip switch's two segments: the name, and in two or three words what it does with you. */
export const MODE_LABELS = { judge: t("modeModel.labelJudge"), mentor: t("modeModel.labelMentor") };
export const MODE_ROLES = { judge: t("modeModel.roleJudge"), mentor: t("modeModel.roleMentor") };
/** The switch's hint card, and the segments' tooltips: what each mode does and what the map shows in it. */
export const MODE_HINTS = { judge: t("modeModel.hintJudge"), mentor: t("modeModel.hintMentor") };

const STATE_KEYS = { sandbar: "stateSandbar", settled: "stateSettled", mountainous: "stateMountainous", reef: "stateReef" };

/** A verdict state as the page says it; an unknown state reads as itself. */
export function stateLabel(state) {
  return STATE_KEYS[state] ? t(`modeModel.${STATE_KEYS[state]}`) : String(state);
}

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
    return explored ? { cls: "pill explore", text: t("modeModel.pillExplored", { explored, total }) } : { cls: "pill open", text: t("modeModel.pillOpen") };
  }
  const v = island.verdict;
  if (v) return { cls: `pill${v.state === "reef" ? " reef" : ""}`, text: t("modeModel.pillVerdict", { state: stateLabel(v.state), pct: pct(v.confidence) }) };
  return { cls: "pill open", text: t(island.children?.total ? "modeModel.pillOpenIslets" : "modeModel.pillOpen") };
}
