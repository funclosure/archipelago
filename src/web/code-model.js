// Pure, DOM-free: what the highlighter knows about languages and how its tokens become spans.
// The colours live in styles.css as --code-<slot>; here every slot is a sentinel hex shiki hands back.

export const SLOTS = ["fg", "keyword", "string", "comment", "type", "number"];
export const SENTINELS = SLOTS.map((_, i) => `#00000${i + 1}`);
const slotOf = new Map(SENTINELS.map((hex, i) => [hex, SLOTS[i]]));

/** The eleven bundled grammars (see src/server/vendor/shiki-entry.js). */
export const LANGS = ["swift", "objective-c", "kotlin", "typescript", "tsx", "javascript", "json", "bash", "python", "sql", "yaml"];

const ALIASES = {
  swiftui: "swift", objc: "objective-c", js: "javascript", ts: "typescript",
  sh: "bash", shell: "bash", zsh: "bash", py: "python", yml: "yaml", jsonc: "json",
};

const LABELS = {
  swift: "Swift", "objective-c": "Objective-C", kotlin: "Kotlin", typescript: "TypeScript", tsx: "TSX",
  javascript: "JavaScript", json: "JSON", bash: "Bash", python: "Python", sql: "SQL", yaml: "YAML",
};

/** A shiki theme whose colours are sentinels: one per slot. */
export const contourTheme = {
  name: "contour",
  type: "dark",
  colors: {},
  settings: [
    { settings: { foreground: SENTINELS[0], background: "#000000" } },
    { scope: ["keyword", "storage", "keyword.operator"], settings: { foreground: SENTINELS[1] } },
    { scope: ["string", "string.quoted", "string.template"], settings: { foreground: SENTINELS[2] } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: SENTINELS[3], fontStyle: "italic" } },
    {
      scope: ["entity.name.type", "entity.name.class", "support.type", "support.class", "entity.name.function", "support.function", "variable.parameter"],
      settings: { foreground: SENTINELS[4] },
    },
    { scope: ["constant.numeric", "constant.language", "constant.character"], settings: { foreground: SENTINELS[5] } },
  ],
};

/** The bundled language a fence tag means, or null. */
export function resolveLang(tag) {
  const t = String(tag ?? "").toLowerCase();
  const name = ALIASES[t] ?? t;
  return LANGS.includes(name) ? name : null;
}

/** The caption for a fence tag. */
export function labelOf(tag) {
  const t = String(tag ?? "");
  if (!t) return "code";
  const lang = resolveLang(t);
  return lang ? LABELS[lang] : t;
}

/** shiki token lines → span lines of { text, slot, italic }. */
export function spansOf(tokenLines) {
  return tokenLines.map((line) =>
    line.map((t) => ({
      text: t.content,
      slot: slotOf.get(String(t.color ?? "").toLowerCase()) ?? "fg",
      italic: ((t.fontStyle ?? 0) & 1) === 1,
    })),
  );
}
