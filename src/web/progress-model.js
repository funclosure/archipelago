// Pure: what the pane says while a persona works, before its words arrive. Tool names become plain steps, so the
// line reads "The cartographer is reading the chart", never "chart_context".

/** Each tool, as the step a reader would recognise. */
export const STEPS = {
  chart_context: "reading the chart",
  propose_sketch: "drawing the sketch",
  island_context: "reading the island",
  set_landmarks: "setting the landmarks",
  unlock_landmark: "lighting a landmark",
  mark_explored: "marking what you explored",
  record_verdict: "recording a verdict",
  propose_reef: "marking a reef",
  ask_reader: "writing a question",
  board_write: "pinning to the board",
};

/** The step for a tool in flight; an unknown tool reads as its own words. */
export function stepPhrase(tool) {
  return STEPS[tool] ?? String(tool).replace(/_/g, " ");
}

/** The pane's waiting line: "The Keeper is thinking", or the step in flight, "The Keeper is reading the island". */
export function thinkingLine(who, tool = null) {
  const name = who.charAt(0).toUpperCase() + who.slice(1);
  return `${name} is ${tool ? stepPhrase(tool) : "thinking"}`;
}
