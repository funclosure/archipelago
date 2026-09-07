// The theme the page wears: stamped on <html>, stored per browser, pushed into the canvas palette and mermaid.
// Everything else reads tokens. `theme-model.js` is the registry; adding a theme never touches this file.
import { THEMES, PALETTE_TOKENS, TOKEN_NAMES, storedTheme, nextTheme, mermaidVariables } from "./theme-model.js";
import { setPalette } from "./draw.js";
import { applyMermaidTheme } from "./markdown.js";

const KEY = "theme";

export function currentTheme() {
  return storedTheme(document.documentElement.dataset.theme);
}

/** The named tokens as the page resolves them now, `{ "--sea": "#1B3F5B", … }`. */
export function readTokens(names = TOKEN_NAMES) {
  const style = getComputedStyle(document.documentElement);
  const out = {};
  for (const n of names) out[n] = style.getPropertyValue(n).trim();
  return out;
}

export function applyTheme(id) {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  try {
    localStorage.setItem(KEY, theme.id);
  } catch {
    /* storage unavailable */
  }
  const tokens = readTokens();
  const palette = {};
  for (const [k, name] of Object.entries(PALETTE_TOKENS)) palette[k] = tokens[name];
  setPalette(palette);
  applyMermaidTheme(mermaidVariables(tokens, theme.dark));
  document.dispatchEvent(new CustomEvent("theme", { detail: { id: theme.id } }));
}

export function cycleTheme() {
  applyTheme(nextTheme(currentTheme()));
}

/** Runs before the rest of the page installs: the stored choice, or the default. */
export function installTheme() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    /* storage unavailable */
  }
  applyTheme(storedTheme(raw));
}
