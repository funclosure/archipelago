// The themes the page can wear. A theme is one entry here plus one `:root[data-theme="<id>"]` block in styles.css
// (tests/web/theme-tokens.test.js checks the block covers every colour token). The first entry is the default.
// The user picks; the system setting is never read.
export const THEMES = [
  { id: "night", name: "Night", dark: true },
  { id: "ink", name: "Ink", dark: true },
  { id: "tide", name: "Tide", dark: true },
  { id: "chart", name: "Paper chart", dark: false },
];
export const DEFAULT_THEME = THEMES[0].id;
/** The canvas palette's names → the tokens they are read from (six-digit hex in every theme). */
export const PALETTE_TOKENS = { sea: "--sea", line: "--line-1", lamp: "--lamp", reef: "--reef", sand: "--sand-fill", grass: "--grass", snow: "--snow", explore: "--explore" };
/** Mermaid's colour variables → the tokens they are read from. */
export const MERMAID_TOKENS = {
  background: "--sea", primaryColor: "--panel-2", primaryTextColor: "--text", primaryBorderColor: "--line-03", lineColor: "--lamp",
  secondaryColor: "--panel", tertiaryColor: "--panel", noteBkgColor: "--panel-2", noteTextColor: "--text",
  actorBkg: "--panel-2", actorBorder: "--line-03", actorTextColor: "--text", signalColor: "--lamp", signalTextColor: "--text", edgeLabelBackground: "--sea",
};
export const TOKEN_NAMES = [...new Set([...Object.values(PALETTE_TOKENS), ...Object.values(MERMAID_TOKENS)])];

export function isTheme(id) {
  return THEMES.some((t) => t.id === id);
}
export function storedTheme(raw) {
  return isTheme(raw) ? raw : DEFAULT_THEME;
}
export function nextTheme(id) {
  const i = THEMES.findIndex((t) => t.id === id);
  return THEMES[(i + 1) % THEMES.length].id; // unknown: -1 + 1 = 0, the first
}
/** Mermaid's `themeVariables` for the `base` theme, from tokens read off the page (`{ "--sea": "#…", … }`). */
export function mermaidVariables(tokens, dark) {
  const out = { darkMode: Boolean(dark), fontFamily: "system-ui, sans-serif", fontSize: "13px" };
  for (const [k, name] of Object.entries(MERMAID_TOKENS)) out[k] = tokens[name];
  return out;
}
