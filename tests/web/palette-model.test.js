import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GROUPS, NEARBY_MAX, RESULTS_MAX, TIER,
  flatIslands, fold, isMac, isPaletteKey, islandCommand, islandWords, keysShown, markRuns, matchCommand, matchWord, mergeRanges,
  moveActive, nearbyIslands, paletteKeys, paletteSections, queryWords, shortcut,
} from "../../src/web/palette-model.js";
import { cheatSheet } from "../../src/web/keys-model.js";
import { useLanguage } from "../../src/web/i18n.js";

const key = (over) => ({ key: "k", code: "KeyK", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });

describe("the key that opens the palette", () => {
  test("⌘K on a Mac, Ctrl+K elsewhere, and nothing else held", () => {
    expect(isPaletteKey(key({ metaKey: true }), true)).toBe(true);
    expect(isPaletteKey(key({ ctrlKey: true }), true)).toBe(false); // Ctrl+K in a Mac text field cuts to the line's end
    expect(isPaletteKey(key({ ctrlKey: true }), false)).toBe(true);
    expect(isPaletteKey(key({ metaKey: true }), false)).toBe(false);
    expect(isPaletteKey(key({ metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(isPaletteKey(key({ metaKey: true, altKey: true }), true)).toBe(false);
    expect(isPaletteKey(key({ metaKey: true, ctrlKey: true }), true)).toBe(false);
    expect(isPaletteKey(key({}), true)).toBe(false);
    expect(isPaletteKey(key({ key: "j", code: "KeyJ", metaKey: true }), true)).toBe(false);
  });

  test("a capital K counts, and a layout that types no Latin letter is read by the key's place", () => {
    expect(isPaletteKey(key({ key: "K", metaKey: true }), true)).toBe(true);
    expect(isPaletteKey(key({ key: "ㄜ", code: "KeyK", metaKey: true }), true)).toBe(true); // Zhuyin
    expect(isPaletteKey(key({ key: "t", code: "KeyK", metaKey: true }), true)).toBe(false); // Dvorak: the letter typed wins
    expect(isPaletteKey(key({ key: "Process", code: "", metaKey: true }), true)).toBe(false);
  });

  test("the platform and the hint", () => {
    expect(isMac({ platform: "MacIntel" })).toBe(true);
    expect(isMac({ userAgentData: { platform: "macOS" }, platform: "" })).toBe(true);
    expect(isMac({ platform: "iPhone" })).toBe(true);
    expect(isMac({ platform: "Win32" })).toBe(false);
    expect(isMac({ platform: "Linux x86_64" })).toBe(false);
    expect(isMac(null)).toBe(false);
    expect(isMac({})).toBe(false);
    expect(paletteKeys(true)).toBe("⌘K");
    expect(paletteKeys(false)).toBe("Ctrl K");
  });
});

describe("shortcuts come from the cheat sheet", () => {
  test("each named action has the sheet's key", () => {
    expect(shortcut("everywhere", "boardKey")).toBe("b");
    expect(shortcut("everywhere", "mode")).toBe("m");
    expect(shortcut("everywhere", "theme")).toBe("t");
    expect(shortcut("everywhere", "outlineKey")).toBe("[");
    expect(shortcut("everywhere", "keys")).toBe("?");
    expect(shortcut("everywhere", "answer")).toBe("/");
    expect(shortcut("outline", "newDomain")).toBe("n");
    expect(shortcut("map", "home")).toBe("0");
    expect(shortcut("pane", "landfall")).toBe("l");
    expect(shortcut("pane", "note")).toBe("n");
  });

  test("every key the palette shows is a row of the sheet it names, so the two cannot drift", () => {
    const all = (section) => section.keys.map(([k]) => k);
    expect(all(cheatSheet("outline")[0])).toContain(shortcut("everywhere", "boardKey"));
    expect(all(cheatSheet("map")[1])).toContain(shortcut("map", "home"));
    expect(all(cheatSheet("pane")[1])).toContain(shortcut("pane", "landfall"));
  });

  test("an action the sheet does not list, or a section that does not exist, has no key", () => {
    expect(shortcut("everywhere", "home")).toBeNull(); // home is the map's
    expect(shortcut("map", "nope")).toBeNull();
    expect(shortcut("nowhere", "home")).toBeNull();
  });

  test("the same key in Chinese: the lookup follows the page's language", () => {
    useLanguage("zh-TW");
    try {
      expect(shortcut("everywhere", "boardKey")).toBe("b");
      expect(shortcut("pane", "note")).toBe("n");
    } finally {
      useLanguage("en");
    }
  });

  test("a region's key shows only when the palette was opened from that region", () => {
    const everywhere = { keys: "b" };
    const inPane = { keys: "n", where: "pane" };
    expect(keysShown(everywhere, "map")).toBe("b");
    expect(keysShown(everywhere, "board")).toBe("b");
    expect(keysShown(inPane, "pane")).toBe("n");
    expect(keysShown(inPane, "outline")).toBeNull(); // there, n is New domain
    expect(keysShown(inPane, "chart")).toBeNull();
    expect(keysShown({ where: "pane" }, "pane")).toBeNull();
    expect(keysShown({ keys: null }, "pane")).toBeNull();
  });
});

describe("folding and words", () => {
  test("fold lowers case and keeps every character's place", () => {
    expect(fold("A Matrix")).toBe("a matrix");
    expect(fold("ＡＢＣ１")).toBe("abc1"); // full-width forms, as a Chinese input method types them
    expect(fold("New domain…")).toBe("new domain…"); // the ellipsis would fold to three dots: it stays
    expect(fold("New domain…").length).toBe("New domain…".length);
    expect(fold("İstanbul").length).toBe("İstanbul".length);
    expect(fold("矩陣是一種移動")).toBe("矩陣是一種移動");
    expect(fold(null)).toBe("");
  });

  test("queryWords splits on any white space and drops empties", () => {
    expect(queryWords("  Open  the\tBoard ")).toEqual(["open", "the", "board"]);
    expect(queryWords("矩陣　移動")).toEqual(["矩陣", "移動"]); // an ideographic space
    expect(queryWords("   ")).toEqual([]);
    expect(queryWords("")).toEqual([]);
  });
});

describe("matchWord", () => {
  const name = fold("A matrix is a move");

  test("a prefix of the text is best", () => {
    expect(matchWord(name, "a")).toEqual({ tier: TIER.prefix, ranges: [[0, 1]], span: 1 });
    expect(matchWord(name, "a mat")).toEqual({ tier: TIER.prefix, ranges: [[0, 5]], span: 5 });
  });

  test("then the start of a word, wherever the first one is", () => {
    expect(matchWord(name, "matrix")).toEqual({ tier: TIER.word, ranges: [[2, 8]], span: 6 });
    expect(matchWord(name, "mo")).toEqual({ tier: TIER.word, ranges: [[14, 16]], span: 2 });
    // "is" is inside "matrix" first, but it also starts a word: the word wins and is what gets marked
    expect(matchWord(fold("this is it"), "is")).toEqual({ tier: TIER.word, ranges: [[5, 7]], span: 2 });
    expect(matchWord(fold("Vectors: arrows you can add"), "arrows").tier).toBe(TIER.word); // after a mark
    expect(matchWord(fold("read-right-to-left"), "left").tier).toBe(TIER.word); // after a hyphen
  });

  test("then inside a word", () => {
    expect(matchWord(name, "trix")).toEqual({ tier: TIER.substring, ranges: [[4, 8]], span: 4 });
    expect(matchWord(name, "ove")).toEqual({ tier: TIER.substring, ranges: [[15, 18]], span: 3 });
  });

  test("then scattered letters in order: mtx finds a matrix", () => {
    const m = matchWord(name, "mtx");
    expect(m.tier).toBe(TIER.scattered);
    expect(m.ranges).toEqual([[2, 3], [4, 5], [7, 8]]);
    expect(m.span).toBe(6);
    expect(matchWord(fold("Keyboard shortcuts"), "kbd").tier).toBe(TIER.scattered);
    expect(matchWord(fold("The cartographer"), "crtgr").tier).toBe(TIER.scattered);
    expect(TIER.prefix).toBeLessThan(TIER.word);
    expect(TIER.word).toBeLessThan(TIER.substring);
    expect(TIER.substring).toBeLessThan(TIER.scattered);
  });

  test("scattered letters stay inside one word, in its tightest run, and neighbours are marked as one", () => {
    // the first d is in "edit", but only "domain" holds d, m and n
    expect(matchWord(fold("Edit this domain"), "dmn")).toEqual({ tier: TIER.scattered, ranges: [[10, 11], [12, 13], [15, 16]], span: 6 });
    expect(matchWord(fold("matrix"), "mtrx").ranges).toEqual([[0, 1], [2, 4], [5, 6]]);
    expect(matchWord(fold("banana"), "ana")).toEqual({ tier: TIER.substring, ranges: [[1, 4]], span: 3 }); // together: not scattered at all
    expect(matchWord(fold("a-b-xc abxc"), "abc")).toEqual({ tier: TIER.scattered, ranges: [[7, 9], [10, 11]], span: 4 });
    expect(matchWord(fold("axxbxc abxc"), "abc").ranges).toEqual([[7, 9], [10, 11]]); // the tighter of two words
  });

  test("letters strewn across several words are not a match", () => {
    expect(matchWord(fold("Switch to the mentor"), "theme")).toBeNull(); // THE MEntor
    expect(matchWord(fold("The move that does nothing"), "theme")).toBeNull(); // THE MovE
    expect(matchWord(fold("Linear algebra"), "lalg")).toBeNull(); // typed as two words, "l alg", it is found
    expect(matchWord(fold("read-right-to-left"), "rgt")).not.toBeNull(); // inside "right"
    expect(matchWord(fold("read-right-to-left"), "rdl")).toBeNull();
  });

  test("the first letters of words count as scattered, however far apart", () => {
    const m = matchWord(fold("Open the board"), "otb");
    expect(m.tier).toBe(TIER.scattered);
    expect(m.ranges).toEqual([[0, 1], [5, 6], [9, 10]]);
    expect(matchWord(fold("Not sure where to begin? Ask the mentor"), "nsw").tier).toBe(TIER.scattered);
    expect(matchWord(fold("New domain…"), "nd")).toEqual({ tier: TIER.scattered, ranges: [[0, 1], [4, 5]], span: 5 });
  });

  test("two letters match scattered only as initials: any two letters are near each other somewhere", () => {
    expect(matchWord(fold("Switch to the mentor"), "mo")).toBeNull(); // MentOr
    expect(matchWord(fold("Switch to the mentor"), "tm").tier).toBe(TIER.scattered); // To … Mentor
  });

  test("letters too far apart, out of order, or missing do not match", () => {
    expect(matchWord(fold("Stretching and combining"), "sea")).toBeNull(); // s…e……a: no abbreviation of this
    expect(matchWord(name, "xtm")).toBeNull();
    expect(matchWord(name, "matrixx")).toBeNull();
    expect(matchWord(name, "q")).toBeNull();
    expect(matchWord(name, "")).toBeNull();
    expect(matchWord("", "a")).toBeNull();
  });

  test("Chinese matches by substring only: at the start, or anywhere, never scattered", () => {
    const zh = fold("矩陣是一種移動");
    expect(matchWord(zh, "矩陣")).toEqual({ tier: TIER.prefix, ranges: [[0, 2]], span: 2 });
    expect(matchWord(zh, "移動")).toEqual({ tier: TIER.substring, ranges: [[5, 7]], span: 2 });
    expect(matchWord(zh, "矩動")).toBeNull(); // in order, but not together
    expect(matchWord(zh, "陣")).toEqual({ tier: TIER.substring, ranges: [[1, 2]], span: 1 });
    expect(matchWord(fold("かなとカナ"), "カナ").tier).toBe(TIER.substring);
  });

  test("where Latin meets Chinese a word starts", () => {
    expect(matchWord(fold("學React的人"), "react").tier).toBe(TIER.word);
    expect(matchWord(fold("React入門"), "入門").tier).toBe(TIER.word);
    expect(matchWord(fold("矩陣 matrix"), "matrix").tier).toBe(TIER.word);
  });

  test("a digit or a mixed word is still found whole", () => {
    expect(matchWord(fold("Round 2 of 4"), "2").tier).toBe(TIER.word);
    expect(matchWord(fold("gemini-3.8-flash"), "3.8").tier).toBe(TIER.word);
    expect(matchWord(fold("gemini-3.8-flash"), "g3f")).not.toBeNull(); // initials across hyphens
  });
});

describe("marks", () => {
  test("mergeRanges sorts and joins what touches or overlaps", () => {
    expect(mergeRanges([[5, 7], [0, 2], [2, 4], [6, 9]])).toEqual([[0, 4], [5, 9]]);
    expect(mergeRanges([])).toEqual([]);
    expect(mergeRanges([[3, 4]])).toEqual([[3, 4]]);
  });

  test("mergeRanges leaves its input alone", () => {
    const given = [[5, 7], [0, 2]];
    mergeRanges(given);
    expect(given).toEqual([[5, 7], [0, 2]]);
  });

  test("markRuns cuts the text at its ranges and leaves out empty pieces", () => {
    expect(markRuns("A matrix is a move", [[2, 3], [4, 5], [7, 8]])).toEqual([
      { text: "A ", hit: false }, { text: "m", hit: true }, { text: "a", hit: false }, { text: "t", hit: true },
      { text: "ri", hit: false }, { text: "x", hit: true }, { text: " is a move", hit: false },
    ]);
    expect(markRuns("board", [[0, 5]])).toEqual([{ text: "board", hit: true }]);
    expect(markRuns("board", [])).toEqual([{ text: "board", hit: false }]);
    expect(markRuns("board")).toEqual([{ text: "board", hit: false }]);
    expect(markRuns("", [[0, 2]])).toEqual([]);
  });

  test("markRuns never loses a character, whatever the ranges", () => {
    const text = "Doing one move after another";
    for (const ranges of [[[0, 3], [2, 9]], [[25, 99]], [[-4, 2]], [[7, 7]], [[10, 4]], [[3, 5], [3, 5], [4, 6]]]) {
      expect(markRuns(text, ranges).map((r) => r.text).join("")).toBe(text);
    }
  });
});

describe("matchCommand", () => {
  const board = { name: "Open the board", keywords: "cards pins" };
  const island = { name: "A matrix is a move", detail: "mountainous · MOVES", keywords: "a matrix is a move" };

  test("every typed word must match", () => {
    expect(matchCommand(board, ["open", "board"])).not.toBeNull();
    expect(matchCommand(board, ["open", "zebra"])).toBeNull();
    expect(matchCommand(board, [])).toEqual({ score: 0, loose: 0, name: [], detail: [] });
  });

  test("the score adds each word's tier, and the name's ranges are merged for marking", () => {
    expect(matchCommand(board, ["open"])).toEqual({ score: TIER.prefix, loose: 0, name: [[0, 4]], detail: [] });
    expect(matchCommand(board, ["board"])).toEqual({ score: TIER.word, loose: 0, name: [[9, 14]], detail: [] });
    expect(matchCommand(board, ["board", "open"])).toEqual({ score: TIER.prefix + TIER.word, loose: 0, name: [[0, 4], [9, 14]], detail: [] });
    expect(matchCommand(board, ["oar"]).score).toBe(TIER.substring);
    const loose = matchCommand(island, ["mtx"]);
    expect(loose.score).toBe(TIER.scattered);
    expect(loose.loose).toBe(6);
  });

  test("a word found only in the detail or a keyword ranks below any whole match in the name", () => {
    const inDetail = matchCommand(island, ["mountainous"]);
    expect(inDetail).toEqual({ score: TIER.otherWord, loose: 0, name: [], detail: [[0, 11]] });
    expect(matchCommand(island, ["tain"]).score).toBe(TIER.other);
    const inKeywords = matchCommand(board, ["pins"]);
    expect(inKeywords).toEqual({ score: TIER.otherWord, loose: 0, name: [], detail: [] }); // hidden: nothing to mark
    expect(TIER.otherWord).toBeGreaterThan(TIER.substring);
    expect(TIER.other).toBeGreaterThan(TIER.scattered);
  });

  test("outside the name a word must be there whole: no scattered letters across a sentence of detail", () => {
    expect(matchCommand({ name: "Ink", detail: "Theme", keywords: "appearance colour dark light" }, ["tme"])).toBeNull();
    expect(matchCommand({ name: "Ink", detail: "Theme", keywords: "appearance colour dark light" }, ["dark"])).not.toBeNull();
  });

  test("the better of detail and keyword is taken, and the detail is marked only when it is the one", () => {
    const c = { name: "Ink", detail: "a dark theme", keywords: "dark" };
    expect(matchCommand(c, ["dark"])).toEqual({ score: TIER.otherWord, loose: 0, name: [], detail: [[2, 6]] });
    const k = { name: "Ink", detail: "undarkened", keywords: "dark" };
    expect(matchCommand(k, ["dark"])).toEqual({ score: TIER.otherWord, loose: 0, name: [], detail: [] });
  });

  test("case and width do not matter", () => {
    expect(matchCommand(board, queryWords("OPEN"))).not.toBeNull();
    expect(matchCommand(board, queryWords("ｏｐｅｎ"))).not.toBeNull();
    expect(matchCommand({ name: "繁體中文", detail: "Language" }, queryWords("LANG")).score).toBe(TIER.otherWord);
  });

  test("a command with only a name is fine", () => {
    expect(matchCommand({ name: "About you" }, ["you"]).score).toBe(TIER.word);
    expect(matchCommand({ name: "About you" }, ["me"])).toBeNull();
  });
});

const cmd = (id, group, name, extra = {}) => ({ id, group, name, ...extra });
const COMMANDS = [
  cmd("lens", "here", "Switch to the mentor", { detail: "explains, no grades" }),
  cmd("island:vectors", "islands", "Vectors: arrows you can add", { detail: "harbour · settled" }),
  cmd("island:matrix", "islands", "A matrix is a move", { detail: "mountainous" }),
  cmd("island:undoing", "islands", "Undoing a move", { detail: "open water", start: false }),
  cmd("island:nothing", "islands", "The move that does nothing", { detail: "settled · in Undoing a move", start: false }),
  cmd("home", "go", "Fit the map", { keywords: "home centre" }),
  cmd("shortcuts", "go", "Keyboard shortcuts"),
  cmd("new-domain", "domains", "New domain…"),
  cmd("theme:ink", "appearance", "Ink", { detail: "Theme" }),
  cmd("theme:moonlight", "appearance", "Moonlight", { detail: "Theme" }),
  cmd("about", "you", "About you"),
];
const LABELS = { here: "This map", islands: "Islands", go: "Go to", domains: "Domains", appearance: "Appearance", you: "You" };
const ids = (view) => view.rows.map((r) => r.command.id);
const groups = (view) => view.sections.map((s) => s.group);

describe("paletteSections", () => {
  test("with nothing typed: every group in its order, without the islands kept for a search", () => {
    const view = paletteSections(COMMANDS, "", { labels: LABELS });
    expect(groups(view)).toEqual(["here", "islands", "go", "domains", "appearance", "you"]);
    expect(groups(view)).toEqual(GROUPS);
    expect(ids(view)).toEqual(["lens", "island:vectors", "island:matrix", "home", "shortcuts", "new-domain", "theme:ink", "theme:moonlight", "about"]);
    expect(view.sections[1].label).toBe("Islands");
    expect(view.rows.every((r) => r.name.length === 0 && r.detail.length === 0)).toBe(true);
    expect(paletteSections(COMMANDS, "   ", { labels: LABELS }).rows.length).toBe(view.rows.length);
  });

  test("the flat rows are the sections' rows in the order drawn", () => {
    for (const query of ["", "mo", "a"]) {
      const view = paletteSections(COMMANDS, query, { labels: LABELS });
      expect(view.rows).toEqual(view.sections.flatMap((s) => s.rows));
    }
  });

  test("groups keep their order even when the commands arrive mixed", () => {
    const view = paletteSections([COMMANDS[10], COMMANDS[5], COMMANDS[0], COMMANDS[6]], "", { labels: LABELS });
    expect(groups(view)).toEqual(["here", "go", "you"]);
    expect(ids(view)).toEqual(["lens", "home", "shortcuts", "about"]);
  });

  test("typing finds islands at any scale, the ones kept back included", () => {
    const view = paletteSections(COMMANDS, "move", { labels: LABELS });
    expect(ids(view)).toEqual(["island:matrix", "island:undoing", "island:nothing"]);
    expect(view.rows[0].name).toEqual([[14, 18]]);
  });

  test("a prefix ranks above a word start, above a substring, above scattered letters", () => {
    const list = [
      cmd("none", "go", "Mentor"), // m and o, but two letters apart are no match
      cmd("substring", "go", "Remove a card"),
      cmd("word", "go", "A matrix is a move"),
      cmd("prefix", "go", "Moonlight"),
    ];
    expect(ids(paletteSections(list, "mo"))).toEqual(["prefix", "word", "substring"]);
    const loose = [cmd("scattered", "go", "A matrix"), cmd("substring", "go", "Smtx"), cmd("word", "go", "The mtx"), cmd("prefix", "go", "Mtx one")];
    expect(ids(paletteSections(loose, "mtx"))).toEqual(["prefix", "word", "substring", "scattered"]);
  });

  test("among scattered matches the tighter one is first; otherwise the given order holds", () => {
    const list = [cmd("wide", "go", "Multiplex"), cmd("tight", "go", "A matrix")];
    expect(ids(paletteSections(list, "mtx"))).toEqual(["tight", "wide"]);
    const same = [cmd("b", "go", "Move b"), cmd("a", "go", "Move a")];
    expect(ids(paletteSections(same, "move"))).toEqual(["b", "a"]);
  });

  test("the group holding the best match comes first; equal groups keep their usual order", () => {
    const view = paletteSections(COMMANDS, "mo", { labels: LABELS });
    // "Moonlight" is a prefix (appearance); the islands only have word starts; "mentor" holds no "mo" together
    expect(groups(view)).toEqual(["appearance", "islands"]);
    expect(ids(view)).toEqual(["theme:moonlight", "island:matrix", "island:undoing", "island:nothing"]);
    const tie = paletteSections(COMMANDS, "a", { labels: LABELS });
    expect(groups(tie).slice(0, 2)).toEqual(["islands", "you"]); // both hold a prefix: islands are listed before you
  });

  test("a word in the detail finds a row, below every match in a name", () => {
    const view = paletteSections(COMMANDS, "theme", { labels: LABELS });
    // the themes by their detail, and nothing else: not THE MEntor, not THE MovE that does nothing
    expect(ids(view)).toEqual(["theme:ink", "theme:moonlight"]);
    expect(view.rows[0].detail).toEqual([[0, 5]]);
    const mixed = paletteSections([cmd("x", "go", "Ink", { detail: "Theme" }), cmd("y", "go", "Next theme")], "theme");
    expect(ids(mixed)).toEqual(["y", "x"]);
    // a whole word beside the name is above scattered letters inside one
    const guess = paletteSections([cmd("z", "go", "Thermometer"), cmd("x", "go", "Ink", { detail: "Theme" })], "theme");
    expect(ids(guess)).toEqual(["x", "z"]);
  });

  test("a hidden keyword finds a row and marks nothing", () => {
    const view = paletteSections(COMMANDS, "home", { labels: LABELS });
    expect(ids(view)).toEqual(["home"]);
    expect(view.rows[0]).toEqual({ command: COMMANDS[5], name: [], detail: [] });
  });

  test("every word must match, in any order", () => {
    expect(ids(paletteSections(COMMANDS, "move matrix", { labels: LABELS }))).toEqual(["island:matrix"]);
    expect(ids(paletteSections(COMMANDS, "matrix settled", { labels: LABELS }))).toEqual([]);
    expect(ids(paletteSections(COMMANDS, "nothing settled", { labels: LABELS }))).toEqual(["island:nothing"]);
  });

  test("nothing found: no sections and no rows, so there is nothing to run", () => {
    const view = paletteSections(COMMANDS, "zzzz", { labels: LABELS });
    expect(view).toEqual({ sections: [], rows: [] });
  });

  test("a note stands in a group with no rows yet (the islands still loading), typed or not", () => {
    const none = COMMANDS.filter((c) => c.group !== "islands");
    const idle = paletteSections(none, "", { labels: LABELS, notes: { islands: "The islands are still loading…" } });
    expect(groups(idle)).toEqual(["here", "islands", "go", "domains", "appearance", "you"]);
    expect(idle.sections[1]).toEqual({ group: "islands", label: "Islands", note: "The islands are still loading…", rows: [] });
    const typing = paletteSections(none, "ink", { labels: LABELS, notes: { islands: "The islands are still loading…" } });
    expect(groups(typing)).toEqual(["appearance", "islands"]); // what matched first, then the note
    const nothing = paletteSections(none, "zzzz", { labels: LABELS, notes: { islands: "The islands are still loading…" } });
    expect(groups(nothing)).toEqual(["islands"]);
    expect(nothing.rows).toEqual([]);
    expect(paletteSections(COMMANDS, "", { labels: LABELS, notes: { islands: null } }).sections[1].note).toBeNull();
  });

  test("a typed query lists at most the limit, best first", () => {
    const many = Array.from({ length: 80 }, (_, i) => cmd(`i${i}`, "islands", `The island ${i}`));
    many.push(cmd("best", "go", "Island"));
    const view = paletteSections(many, "is");
    expect(view.rows.length).toBe(RESULTS_MAX);
    expect(ids(view)[0]).toBe("best"); // listed last, matched best: the cut never drops it
    expect(paletteSections(many, "is", { limit: 3 }).rows.length).toBe(3);
    expect(paletteSections(many, "").rows.length).toBe(81); // nothing typed: the caller decides what starts
  });

  test("a group it does not know is listed after the known ones, and a missing label is empty", () => {
    const view = paletteSections([cmd("x", "extra", "Extra"), cmd("about", "you", "About you")], "");
    expect(groups(view)).toEqual(["you", "extra"]);
    expect(view.sections[0].label).toBe("");
  });

  test("Chinese: a substring of the name, with the match marked", () => {
    const zh = [cmd("island:a", "islands", "矩陣是一種移動"), cmd("island:b", "islands", "向量：可以相加的箭頭"), cmd("board", "here", "打開白板")];
    const view = paletteSections(zh, "移動");
    expect(ids(view)).toEqual(["island:a"]);
    expect(view.rows[0].name).toEqual([[5, 7]]);
    expect(ids(paletteSections(zh, "白板"))).toEqual(["board"]);
    expect(ids(paletteSections(zh, "矩 動"))).toEqual(["island:a"]); // two words, each a substring
    expect(ids(paletteSections(zh, "矩動"))).toEqual([]); // one word, not together
  });
});

const lm = (total = 3, unlocked = 0, explored = 0) => ({ total, unlocked, explored });
const node = (slug, name, extra = {}, children = []) => ({ slug, name, state: "open", landmarks: lm(), harbour: false, scale: null, children, ...extra });
const TREE = [
  node("vectors", "Vectors: arrows you can add", { state: "settled", landmarks: lm(3, 3), harbour: true }),
  node("stretching", "Stretching and combining", { state: "sandbar", landmarks: lm(3, 1) }),
  node("matrix", "A matrix is a move", { state: "mountainous", landmarks: lm(3, 3, 2) }),
  node("doing", "Doing one move after another", { landmarks: lm(3, 2) }),
  node("area", "Area and the determinant", { state: "reef" }),
  node("directions", "Directions that stay put"),
  node("undoing", "Undoing a move", {}, [
    node("nothing", "The move that does nothing", { scale: "undoing", state: "settled", harbour: true }),
    node("turn", "Undoing a turn", { scale: "undoing" }),
    node("stretch", "Undoing a stretch", { scale: "undoing", state: "sandbar" }),
  ]),
];

describe("islands", () => {
  const flat = flatIslands(TREE);

  test("flatIslands lists every island, each parent before its islets, with where it lies", () => {
    expect(flat.map((i) => i.slug)).toEqual(["vectors", "stretching", "matrix", "doing", "area", "directions", "undoing", "nothing", "turn", "stretch"]);
    expect(flat[0]).toEqual({ node: TREE[0], slug: "vectors", name: "Vectors: arrows you can add", scale: null, parent: null });
    expect(flat[7].parent).toBe("Undoing a move");
    expect(flat[7].scale).toBe("undoing");
    expect(flatIslands(undefined)).toEqual([]);
    expect(flatIslands([])).toEqual([]);
  });

  test("with nothing selected the harbour leads, then the rest in the outline's order, capped", () => {
    expect(nearbyIslands(flat, { harbour: "vectors" })).toEqual(["vectors", "stretching", "matrix", "doing", "area", "directions"]);
    expect(nearbyIslands(flat, { harbour: "vectors" }).length).toBe(NEARBY_MAX);
    expect(nearbyIslands(flat, { harbour: "matrix", cap: 3 })).toEqual(["matrix", "vectors", "stretching"]);
    // no harbour named: the island flagged as one
    expect(nearbyIslands(flat, { cap: 2 })).toEqual(["vectors", "stretching"]);
  });

  test("with an island selected: the others by their distance on the map, the selection left out", () => {
    const positions = new Map([["vectors", { x: 0, y: 0 }], ["stretching", { x: 100, y: 0 }], ["matrix", { x: 300, y: 0 }], ["doing", { x: 310, y: 10 }], ["area", { x: 900, y: 0 }]]);
    const near = nearbyIslands(flat, { selected: "matrix", harbour: "vectors", positions });
    expect(near).toEqual(["doing", "stretching", "vectors", "area", "directions", "undoing"]); // the unplaced two last, in order
    expect(near).not.toContain("matrix");
  });

  test("the selected island's own islets come first", () => {
    const positions = new Map([["undoing", { x: 0, y: 0 }], ["directions", { x: 10, y: 0 }], ["vectors", { x: 500, y: 0 }]]);
    expect(nearbyIslands(flat, { selected: "undoing", positions })).toEqual(["nothing", "turn", "stretch", "directions", "vectors", "stretching"]);
  });

  test("at another scale the islands there are the near ones", () => {
    expect(nearbyIslands(flat, { scale: "undoing", harbour: "nothing" })).toEqual(["nothing", "turn", "stretch"]);
    expect(nearbyIslands(flat, { scale: "undoing", selected: "turn", harbour: "nothing" })).toEqual(["nothing", "stretch"]);
  });

  test("a scale with no islands yet offers the top one's; no islands at all offers none", () => {
    expect(nearbyIslands(flat, { scale: "matrix", cap: 2 })).toEqual(["vectors", "stretching"]);
    expect(nearbyIslands([], { harbour: "x" })).toEqual([]);
  });

  test("islandWords: the verdict, or how much is lit; in the mentor's lens how much was explored", () => {
    expect(islandWords(TREE[0])).toBe("settled");
    expect(islandWords(TREE[4])).toBe("reef");
    expect(islandWords(TREE[3])).toBe("open water · 2 of 3 lit");
    expect(islandWords(TREE[5])).toBe("open water");
    expect(islandWords(TREE[2], "mentor")).toBe("explored 2 of 3");
    expect(islandWords(TREE[0], "mentor")).toBe("not yet explored"); // a verdict never shows in the mentor's lens
  });

  test("islandCommand: the name, the outline's dot, what it means and where the island is", () => {
    const top = islandCommand(flat[0], { sea: "Arrows" });
    expect(top).toEqual({
      id: "island:vectors", group: "islands", name: "Vectors: arrows you can add", detail: "harbour · settled · Arrows",
      keywords: "vectors", dot: "dot settled", slug: "vectors", scale: null, start: true,
    });
    const islet = islandCommand(flat[8], { near: false });
    expect(islet.detail).toBe("open water · in Undoing a move");
    expect(islet.start).toBe(false);
    expect(islet.scale).toBe("undoing");
    expect(islandCommand(flat[8], { sea: "Ways back" }).detail).toBe("open water · Ways back"); // its sea, when the map knows it
    expect(islandCommand(flat[5]).detail).toBe("open water"); // at the top, with no sea: only the state
    expect(islandCommand(flat[3]).dot).toBe("dot open lit");
    expect(islandCommand(flat[2], { lens: "mentor" })).toMatchObject({ detail: "explored 2 of 3", dot: "dot explored" });
  });

  test("an island is found by its state, its sea, or its slug's words", () => {
    const commands = flat.map((e) => islandCommand(e, { sea: e.scale ? null : "Moves" }));
    const find = (q) => paletteSections(commands, q).rows.map((r) => r.command.slug);
    expect(find("reef")).toEqual(["area"]);
    expect(find("harbour")).toEqual(["vectors", "nothing"]);
    expect(find("moves").slice(0, 2)).toEqual(["vectors", "stretching"]); // the sea, in the detail
    expect(find("undoing")).toEqual(["undoing", "turn", "stretch", "nothing"]); // the name first, then "in Undoing a move"
    const zh = islandCommand({ node: node("a-matrix-is-a-move", "矩陣是一種移動"), slug: "a-matrix-is-a-move", name: "矩陣是一種移動", scale: null, parent: null });
    expect(paletteSections([zh], "matrix").rows.length).toBe(1);
    expect(paletteSections([zh], "matrix").rows[0].name).toEqual([]);
  });

  test("the words follow the page's language", () => {
    useLanguage("zh-TW");
    try {
      expect(islandWords(TREE[5])).toBe("未知水域");
      expect(islandWords(TREE[0])).toBe("穩固");
      expect(islandCommand(flat[8]).detail).toBe("未知水域 · 在「Undoing a move」內");
    } finally {
      useLanguage("en");
    }
  });
});

describe("moveActive", () => {
  test("the arrows step and wrap round the ends", () => {
    expect(moveActive(0, 5, "ArrowDown")).toBe(1);
    expect(moveActive(4, 5, "ArrowDown")).toBe(0);
    expect(moveActive(0, 5, "ArrowUp")).toBe(4);
    expect(moveActive(3, 5, "ArrowUp")).toBe(2);
    expect(moveActive(0, 1, "ArrowDown")).toBe(0);
  });

  test("Ctrl+N and Ctrl+P are the arrows; the letters alone are typing", () => {
    expect(moveActive(0, 5, "n", { ctrl: true })).toBe(1);
    expect(moveActive(0, 5, "p", { ctrl: true })).toBe(4);
    expect(moveActive(0, 5, "N", { ctrl: true })).toBe(1);
    expect(moveActive(0, 5, "n")).toBeNull();
    expect(moveActive(0, 5, "p")).toBeNull();
    expect(moveActive(0, 5, "a", { ctrl: true })).toBeNull();
    expect(moveActive(0, 5, "ArrowDown", { ctrl: true })).toBeNull(); // Ctrl with an arrow is not the palette's
  });

  test("Home and End go to the ends", () => {
    expect(moveActive(3, 5, "Home")).toBe(0);
    expect(moveActive(1, 5, "End")).toBe(4);
  });

  test("Page keys step a page and stop at the ends", () => {
    expect(moveActive(0, 30, "PageDown", { page: 8 })).toBe(8);
    expect(moveActive(25, 30, "PageDown", { page: 8 })).toBe(29);
    expect(moveActive(29, 30, "PageDown", { page: 8 })).toBe(29);
    expect(moveActive(10, 30, "PageUp", { page: 8 })).toBe(2);
    expect(moveActive(3, 30, "PageUp", { page: 8 })).toBe(0);
    expect(moveActive(0, 30, "PageUp", { page: 8 })).toBe(0);
    expect(moveActive(0, 30, "PageDown", { page: 0 })).toBe(1); // a list too short to measure still moves
  });

  test("with nothing highlighted the first move lands on an end", () => {
    expect(moveActive(-1, 5, "ArrowDown")).toBe(0);
    expect(moveActive(-1, 5, "ArrowUp")).toBe(4);
    expect(moveActive(99, 5, "ArrowDown")).toBe(0);
  });

  test("no rows, or a key that is not a move: nothing", () => {
    expect(moveActive(0, 0, "ArrowDown")).toBeNull();
    expect(moveActive(0, 5, "Enter")).toBeNull();
    expect(moveActive(0, 5, "Tab")).toBeNull();
    expect(moveActive(0, 5, "a")).toBeNull();
  });
});

// palette.js gathers its commands from a dozen modules by name. A name one of them no longer exports would stop the
// whole page loading (a module graph with a missing import does not run at all), so the names are checked here.
describe("what palette.js is wired to", () => {
  const web = (file) => readFileSync(resolve(import.meta.dir, "../../src/web", file), "utf8");
  const imports = (source) => [...source.matchAll(/^import\s*\{([^}]+)\}\s*from\s*"\.\/([\w./-]+)";/gm)].map((m) => ({
    file: m[2],
    names: m[1].split(",").map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean),
  }));
  const exportsName = (source, name) => new RegExp(`export\\s+(?:async\\s+)?(?:function\\*?|const|let|class)\\s+${name}\\b`).test(source);

  test("every name palette.js imports is exported by the module it names", () => {
    const wired = imports(web("palette.js"));
    expect(wired.length).toBeGreaterThan(15);
    for (const { file, names } of wired) {
      const source = web(file);
      for (const name of names) expect(`${file}: ${name} ${exportsName(source, name)}`).toBe(`${file}: ${name} true`);
    }
  });

  test("keys.js asks palette.js only for what it exports, and the entry points for a button are there", () => {
    const palette = web("palette.js");
    const asked = imports(web("keys.js")).find((i) => i.file === "palette.js");
    expect(asked.names.sort()).toEqual(["isPaletteOpen", "openPalette", "opensPalette", "paletteKey"]);
    for (const name of [...asked.names, "closePalette"]) expect(`${name} ${exportsName(palette, name)}`).toBe(`${name} true`);
  });
});
