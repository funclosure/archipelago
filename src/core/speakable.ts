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

const SUPERSCRIPT: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "ⁿ": "n", "ᵏ": "k" };

/** Words for the signs a reply uses, per language; English words where a Chinese reader says them in English too. */
const WORDS = {
  en: { of: "of", at: "at", squared: "squared", cubed: "cubed", toThe: "to the", root: "root", times: "times", plus: "plus", minus: "minus", over: "over",
    "→": "to", "←": "from", "⇒": "implies", "↔": "and back", "≤": "at most", "≥": "at least", "≠": "is not", "≈": "about", "×": "times" },
  zh: { of: "of", at: "的第", squared: "平方", cubed: "立方", toThe: "的", root: "根號", times: "乘", plus: "加", minus: "減", over: "除以",
    "→": "到", "←": "來自", "⇒": "所以", "↔": "來回", "≤": "小於等於", "≥": "大於等於", "≠": "不等於", "≈": "大約", "×": "乘" },
};

/** The math inside a bound or an index, said aloud: n² is "n squared", 2^n "2 to the n", n·m "n times m". */
function sayMath(math: string, w: (typeof WORDS)["en"]): string {
  return math
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹ⁿᵏ]+/g, (sup) => `^${[...sup].map((c) => SUPERSCRIPT[c]).join("")}`)
    .replace(/\^\s*\(?\s*2\s*\)?(?![\w(])/g, ` ${w.squared}`)
    .replace(/\^\s*\(?\s*3\s*\)?(?![\w(])/g, ` ${w.cubed}`)
    .replace(/\^\s*\(?([^()\s]+)\)?/g, ` ${w.toThe} $1`)
    .replace(/√\s*/g, `${w.root} `)
    .replace(/\s*[*·×]\s*/g, ` ${w.times} `)
    .replace(/\s*\+\s*/g, ` ${w.plus} `)
    .replace(/(?<=\w)\s*-\s*(?=\w)/g, ` ${w.minus} `)
    .replace(/\s*\/\s*/g, ` ${w.over} `)
    .replace(/\s+/g, " ")
    .trim();
}

/** Notation said in words, for the voice only (the page keeps the text as written): O(n log n) is "O of n log n",
 *  a[i] "a at i", and the arrows and comparisons are words. A voice reads O(1) as "O 1" otherwise. */
export function spoken(text: string, language: "en" | "zh"): string {
  const w = WORDS[language];
  return text
    .replace(/(?<![\w])([OΘΩ])\s*\(((?:[^()]|\([^()]*\))+)\)/g, (_, o: string, inner: string) => ` ${o} ${w.of} ${sayMath(inner, w)} `)
    .replace(/\b([A-Za-z_]\w*)\[([^\]\[]+)\]/g, (_, name: string, index: string) =>
      language === "zh" ? ` ${name} ${w.at} ${sayMath(index, w)} 個 ` : ` ${name} ${w.at} ${sayMath(index, w)} `)
    .replace(/(?<=\w)[²³]/g, (sup) => ` ${sup === "²" ? w.squared : w.cubed}`)
    .replace(/[→←⇒↔≤≥≠≈]|(?<=\d\s?)×(?=\s?\d)/g, (sign) => ` ${w[sign as keyof typeof w]} `)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.;:!?，。；：！？])/g, "$1")
    .replace(/^ +| +$/gm, "");
}

/** The text as the voice should get it: notation in words, then respelled where the language's map says so. */
export function forVoice(text: string, language: "en" | "zh"): string {
  return PRONUNCIATIONS[language].reduce((t, [from, to]) => t.replace(from, to), spoken(text, language));
}
