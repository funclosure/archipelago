// The page's words in each language. Every module keeps its own table in src/web/strings/<module>.js, shaped
// { en: { key: text }, "zh-TW": { key: text } }; `t("module.key", vars)` looks one up in the reader's language and
// falls back to English. A text is a string with `{name}` placeholders, or a function of the vars (plurals).
// The language is per browser (localStorage `lang`, like the theme): the reader's choice, else the browser's.
import { TABLES } from "./strings/index.js";

export const LANGUAGES = [
  { id: "en", name: "English" },
  { id: "zh-TW", name: "繁體中文" },
];

/** The language for a stored choice and the browser's list: a stored one wins, then any Chinese reads zh-TW, else English. */
export function pickLanguage(stored, browser = []) {
  if (LANGUAGES.some((l) => l.id === stored)) return stored;
  return browser.some((b) => /^zh\b/i.test(b)) ? "zh-TW" : "en";
}

function stored() {
  try {
    return localStorage.getItem("lang");
  } catch {
    return null; // storage blocked: the browser's language decides
  }
}

let lang = pickLanguage(stored(), globalThis.navigator?.languages ?? []);

export const language = () => lang;
/** Whether the reader picked the language, rather than the browser deciding it. */
export const languageChosen = () => stored() !== null;

/** Switches the language for this page (tests, previews); `setLanguage` also stores it. */
export function useLanguage(id) {
  lang = pickLanguage(id);
}

/** Stores the reader's choice; the page reloads to redraw every word in it. */
export function setLanguage(id) {
  try {
    localStorage.setItem("lang", id);
  } catch {
    // storage blocked: the choice lasts this page only
  }
  lang = pickLanguage(id);
}

/** The text for `key` ("module.key") in the page's language, with `{name}` filled from `vars`. */
export function t(key, vars = {}) {
  const dot = key.indexOf(".");
  const table = TABLES[key.slice(0, dot)];
  const k = key.slice(dot + 1);
  const text = table?.[lang]?.[k] ?? table?.en?.[k];
  if (text === undefined) return key;
  const s = typeof text === "function" ? text(vars) : text;
  return s.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}
