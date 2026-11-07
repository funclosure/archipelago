// What a persona's reply sounds like read aloud: the prose only. Fences (code, diagrams, plots, demos) are for the
// eye, markdown marks are dropped, and a few words are respelled for the voice so the page keeps the real spelling.

/** The most characters one reading sends; a longer reply is cut at the last sentence end before it. */
export const VOICE_MAX = 5000;

/** Words the voice says wrong, respelled for it only, per language (`八哥` for `巴哥`, say). Add as they turn up. */
export const PRONUNCIATIONS: Record<"en" | "zh", [RegExp, string][]> = {
  en: [],
  zh: [],
};

const CJK = /[㐀-鿿豈-﫿]/g;
const LETTER = /[\p{L}]/gu;

/** `zh` when Chinese characters make up a fifth of the letters, else `en`: the language the voice is told to read. */
export function speechLanguage(text: string): "en" | "zh" {
  const cjk = text.match(CJK)?.length ?? 0;
  const letters = text.match(LETTER)?.length ?? 0;
  return letters > 0 && cjk / letters >= 0.2 ? "zh" : "en";
}

/** The reply's prose, plain, at most `VOICE_MAX` characters; empty when nothing in it is prose. */
export function speakableText(body: string): string {
  const prose = body
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?(?:^\1[ \t]*$|(?![\s\S]))/gm, "\n") // fences, closed or running to the end
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links keep their words
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*:?-*:?[ \t]*\n?/gm, "") // table rules
    .replace(/\|/g, " ")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(?<![\w*])[*_](?!\s)(.+?)(?<!\s)[*_](?![\w*])/g, "$1")
    .replace(/^[-*_]{3,}\s*$/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (prose.length <= VOICE_MAX) return prose;
  const cut = prose.slice(0, VOICE_MAX);
  const end = Math.max(...[". ", "? ", "! ", "。", "？", "！", "\n"].map((s) => cut.lastIndexOf(s)));
  return (end > VOICE_MAX / 2 ? cut.slice(0, end + 1) : cut).trim();
}

/** The text as the voice should get it: respelled where the language's map says so. */
export function forVoice(text: string, language: "en" | "zh"): string {
  return PRONUNCIATIONS[language].reduce((t, [from, to]) => t.replace(from, to), text);
}
