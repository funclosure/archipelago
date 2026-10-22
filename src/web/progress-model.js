// Pure: what the pane says while a persona works, before its words arrive. Tool names become plain steps, so the
// line reads "The cartographer is reading the chart", never "chart_context".
import { t } from "./i18n.js";
import { PERSONA_NAMES } from "./mode-model.js";

/** Each tool, as the step a reader would recognise. */
export const STEPS = {
  chart_context: t("progressModel.chartContext"),
  propose_sketch: t("progressModel.proposeSketch"),
  island_context: t("progressModel.islandContext"),
  set_landmarks: t("progressModel.setLandmarks"),
  unlock_landmark: t("progressModel.unlockLandmark"),
  mark_explored: t("progressModel.markExplored"),
  record_verdict: t("progressModel.recordVerdict"),
  propose_reef: t("progressModel.proposeReef"),
  ask_reader: t("progressModel.askReader"),
  board_write: t("progressModel.boardWrite"),
};

/** The step for a tool in flight; an unknown tool reads as its own words. */
export function stepPhrase(tool) {
  return STEPS[tool] ?? String(tool).replace(/_/g, " ");
}

// Callers that still pass a persona's English name ("the cartographer") get it in the page's language too.
const ENGLISH_NAMES = { "the keeper": "judge", "the mentor": "mentor", "the cartographer": "cartographer" };

/**
 * The pane's waiting line: "The Keeper is thinking", or the step in flight, "The Keeper is reading the island".
 * `who` is a persona's key (judge, mentor, cartographer) or its name. The whole sentence is one string, so each
 * language orders it its own way.
 */
export function thinkingLine(who, tool = null) {
  const key = PERSONA_NAMES[who] ? who : ENGLISH_NAMES[String(who).toLowerCase()];
  const name = key ? PERSONA_NAMES[key] : String(who);
  return t("progressModel.line", { who: name.charAt(0).toUpperCase() + name.slice(1), step: tool ? stepPhrase(tool) : t("progressModel.thinking") });
}
