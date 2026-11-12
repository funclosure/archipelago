// The gallery's index: reads every map file in src/web/gallery/, holds each to the gallery's rules (stricter than
// what the app imports, since these are the maps a new reader meets first), and writes index.json beside them.
// `bun run gallery:index` after adding or changing a map; tests/web/gallery.test.js fails when the two drift.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parseMapFile, type MapFile } from "../src/core/map-file.ts";
import { galleryEntry, galleryFileName } from "../src/web/gallery-model.js";

export const GALLERY_DIR = fileURLToPath(new URL("../src/web/gallery/", import.meta.url));
/** What a shared map must be, beyond a map the app can read. */
export const GALLERY_RULES = { islands: [6, 12], landmarks: [3, 8], languages: ["en", "zh-TW"] } as const;

export type GalleryEntry = { file: string; slug: string; language: string; name: string; description: string; by: string; icon: string; islands: string[]; landmarks: number };

/** What is wrong with a map as a gallery map, in words; empty when nothing is. */
export function galleryProblems(file: string, map: MapFile): string[] {
  const problems: string[] = [];
  const say = (text: string) => problems.push(`${file}: ${text}`);
  const { islands, landmarks, languages } = GALLERY_RULES;
  if (!map.slug) say("needs a slug");
  if (!map.description) say("needs a description: one or two sentences on what the map is for");
  if (!map.by) say('needs "by": who made it');
  if (!map.icon) say('needs "icon": one emoji for its island in the gallery');
  if (!(languages as readonly string[]).includes(map.language ?? "en")) say(`language is one of ${languages.join(", ")}`);
  if (map.slug && file !== galleryFileName(map.slug, map.language ?? "en")) say(`should be named ${galleryFileName(map.slug, map.language ?? "en")}`);
  if (map.islands.length < islands[0] || map.islands.length > islands[1]) say(`has ${map.islands.length} islands at the top; a shared map has ${islands[0]} to ${islands[1]}`);
  const walk = (list: MapFile["islands"]) => {
    for (const i of list) {
      const n = i.landmarks?.length ?? 0;
      if (!i.summary) say(`${i.slug} needs a summary`);
      if (n < landmarks[0] || n > landmarks[1]) say(`${i.slug} has ${n} landmarks; a shared map's island has ${landmarks[0]} to ${landmarks[1]}`);
      if (i.x !== undefined) say(`${i.slug} has a position; leave positions out so each reader arranges their own`);
      if (i.islets?.length) walk(i.islets);
    }
  };
  walk(map.islands);
  const inSea = map.islands.map((i) => (map.seas ?? []).filter((s) => s.islands?.includes(i.slug)).length);
  if (!map.seas?.length) say("needs 2 to 4 seas that group its islands");
  else if (inSea.some((n) => n !== 1)) say(`every island belongs to exactly one sea (${map.islands.filter((_, n) => inSea[n] !== 1).map((i) => i.slug).join(", ")})`);
  return problems;
}

/** Every map of the gallery as its index entry, by file name. Throws, naming each problem, when a map breaks a rule. */
export function readGallery(dir = GALLERY_DIR): GalleryEntry[] {
  const problems: string[] = [];
  const entries: GalleryEntry[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".archipelago.json")).sort()) {
    try {
      const map = parseMapFile(JSON.parse(readFileSync(join(dir, file), "utf8")));
      problems.push(...galleryProblems(file, map));
      entries.push(galleryEntry(map));
    } catch (error) {
      problems.push(`${file}: ${(error as Error).message}`);
    }
  }
  if (problems.length) throw new Error(problems.join("\n"));
  return entries;
}

export const indexText = (entries: GalleryEntry[]) => `${JSON.stringify(entries, null, 2)}\n`;

if (import.meta.main) {
  const entries = readGallery();
  writeFileSync(join(GALLERY_DIR, "index.json"), indexText(entries));
  console.log(`${entries.length} maps in the gallery`);
}
