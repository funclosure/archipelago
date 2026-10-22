// The waiting line in a pane, before a persona's words arrive: the words shimmer and three dots pulse, so a long
// turn reads as work under way. The words come from progress-model.js.

/** A shimmering line with pulsing dots; the dots are decoration, the words are what a screen reader hears. */
export function thinkingEl(text) {
  const line = document.createElement("span");
  line.className = "thinking";
  const words = document.createElement("span");
  words.className = "words";
  words.textContent = text;
  const dots = document.createElement("span");
  dots.className = "dots";
  dots.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 3; i++) dots.append(document.createElement("i"));
  line.append(words, dots);
  return line;
}
