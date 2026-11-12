// The shared maps: every file in src/web/gallery/ is a map the app imports, keeps the gallery's own rules, and is
// listed in index.json exactly as `bun run gallery:index` would write it.
import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { GALLERY_DIR, galleryProblems, indexText, readGallery } from "../../scripts/gallery-index.ts";
import { galleryEntry, galleryFileName, galleryFor, galleryLink } from "../../src/web/gallery-model.js";
import { importMap, parseMapFile } from "../../src/core/map-file.ts";
import { openDatabase } from "../../src/core/db.ts";
import { PROMPT_EXAMPLE } from "../../src/web/map-model.js";

const read = (file) => JSON.parse(readFileSync(join(GALLERY_DIR, file), "utf8"));
const files = readdirSync(GALLERY_DIR).filter((f) => f.endsWith(".archipelago.json")).sort();

test("index.json is what gallery:index writes from the map files", () => {
  expect(readFileSync(join(GALLERY_DIR, "index.json"), "utf8")).toBe(indexText(readGallery()));
});

test("every shared map imports as a new domain with all its islands, straits and seas", () => {
  expect(files.length).toBeGreaterThanOrEqual(6);
  for (const file of files) {
    const map = read(file);
    const db = openDatabase(":memory:");
    const made = importMap(db, map);
    expect([file, made.domain.slug, made.islands, made.straits, made.seas]).toEqual([file, map.slug, map.islands.length, map.straits.length, map.seas.length]);
  }
});

test("a translation keeps every slug, strait and sea of the English map", () => {
  const shape = (map) => JSON.parse(JSON.stringify(map, (key, value) => (["name", "summary", "description", "terms", "language"].includes(key) ? undefined : value)));
  const translated = files.filter((f) => galleryFileName(read(f).slug) !== f);
  expect(translated.length).toBeGreaterThan(0);
  for (const file of translated) {
    const map = read(file);
    expect([file, shape(map)]).toEqual([file, shape(read(galleryFileName(map.slug)))]);
  }
});

test("a Traditional Chinese map is written in Chinese", () => {
  for (const file of files.filter((f) => f.includes(".zh-TW."))) {
    const map = read(file);
    // A name may be the field's own English word (Git, Token); what describes it is Chinese.
    for (const text of [map.description, ...map.islands.map((i) => i.summary)]) expect([file, text, /[一-鿿]/.test(text)]).toEqual([file, text, true]);
  }
});

test("the gallery's rules say what is wrong with a map in words", () => {
  const map = parseMapFile(structuredClone(PROMPT_EXAMPLE));
  const problems = galleryProblems("caching.json", map).join("\n");
  expect(problems).toContain("needs a slug");
  expect(problems).toContain('needs "by"');
  expect(problems).toContain("has 2 islands at the top");
  const good = read("git.archipelago.json");
  expect(galleryProblems("git.archipelago.json", parseMapFile(good))).toEqual([]);
  expect(galleryProblems("git.json", parseMapFile(good)).join()).toContain("should be named git.archipelago.json");
  good.islands[0].x = 1;
  good.islands[0].y = 2;
  good.seas[0].islands.pop();
  const bad = galleryProblems("git.archipelago.json", parseMapFile(good)).join("\n");
  expect(bad).toContain("has a position");
  expect(bad).toContain("every island belongs to exactly one sea");
});

test("a map's icon is one emoji", () => {
  const withIcon = (icon) => () => parseMapFile({ ...PROMPT_EXAMPLE, icon });
  expect(withIcon("🗄️")().icon).toBe("🗄️");
  expect(withIcon("🇹🇼")().icon).toBe("🇹🇼");
  expect(withIcon("ab")).toThrow("must be one emoji");
  expect(withIcon("🌿🌿")).toThrow("must be one emoji");
  expect(galleryProblems("caching.archipelago.json", parseMapFile({ ...PROMPT_EXAMPLE, slug: "caching" })).join()).toContain('needs "icon"');
});

test("an index entry carries what a reader sees before opening the map", () => {
  expect(galleryEntry({ ...PROMPT_EXAMPLE, slug: "caching", by: "A" })).toEqual({
    file: "caching.archipelago.json",
    slug: "caching",
    language: "en",
    name: "Caching",
    description: PROMPT_EXAMPLE.description,
    by: "A",
    icon: "",
    islands: ["Eviction", "Invalidation"],
    landmarks: 8,
  });
  expect(galleryFileName("git", "zh-TW")).toBe("git.zh-TW.archipelago.json");
  expect(galleryLink("git")).toBe("/?map=git");
});

test("each subject is listed once, in the page's language where the map has it", () => {
  const index = [
    { slug: "git", language: "en" },
    { slug: "git", language: "zh-TW" },
    { slug: "sql", language: "en" },
    { slug: "cha", language: "zh-TW" },
  ];
  expect(galleryFor(index, "zh-TW").map((e) => `${e.slug}/${e.language}`)).toEqual(["git/zh-TW", "sql/en", "cha/zh-TW"]);
  expect(galleryFor(index, "en").map((e) => `${e.slug}/${e.language}`)).toEqual(["git/en", "sql/en", "cha/zh-TW"]);
});
