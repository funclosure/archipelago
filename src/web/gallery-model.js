// The gallery of shared maps, the pure parts. The maps are files in src/web/gallery/ (served at /gallery/), one per
// subject and language, listed by index.json, which `bun run gallery:index` writes from the files themselves.

/** Where the map files and their index are served. */
export const GALLERY_PATH = "/gallery";
export const GALLERY_INDEX = `${GALLERY_PATH}/index.json`;

/** `<slug>.archipelago.json` in English, `<slug>.<language>.archipelago.json` in another language. */
export const galleryFileName = (slug, language = "en") => (language === "en" ? `${slug}.archipelago.json` : `${slug}.${language}.archipelago.json`);

/** One line of the index, from a map file: what a reader sees before opening it. */
export function galleryEntry(map) {
  const language = map.language ?? "en";
  return {
    file: galleryFileName(map.slug, language),
    slug: map.slug,
    language,
    name: map.name,
    description: map.description ?? "",
    by: map.by ?? "",
    icon: map.icon ?? "",
    islands: map.islands.map((i) => i.name),
    landmarks: map.islands.reduce((n, i) => n + (i.landmarks?.length ?? 0), 0),
  };
}

/** Each subject once, in the page's language where the map has it, else in English, else as it comes. */
export function galleryFor(index, language) {
  const bySlug = new Map();
  for (const entry of index) bySlug.set(entry.slug, [...(bySlug.get(entry.slug) ?? []), entry]);
  return [...bySlug.values()].map((same) => same.find((e) => e.language === language) ?? same.find((e) => e.language === "en") ?? same[0]);
}

/** The link that opens the app on one shared map, ready to add. */
export const galleryLink = (slug) => `/?map=${encodeURIComponent(slug)}`;
