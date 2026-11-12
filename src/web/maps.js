// The gallery page's own script: draws one card per shared map from /gallery/index.json, in the reader's language
// where a map has it. about.js handles the page's words and the language switch. No innerHTML: a map's text is data.
import { t, language } from "./i18n.js";
import { mapIcon } from "./map-icon.js";
import { GALLERY_INDEX, GALLERY_PATH, galleryFor, galleryLink } from "./gallery-model.js";

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function card(entry) {
  const box = el("article", "map");
  box.id = entry.slug;
  box.lang = entry.language;
  const meta = [t("maps.meta", { islands: entry.islands.length, landmarks: entry.landmarks }), entry.by ? t("maps.by", { by: entry.by }) : ""].filter(Boolean).join(" · ");
  const islands = el("ul", "isles");
  for (const name of entry.islands) islands.append(el("li", "", name));
  const open = el("a", "btn", t("maps.open"));
  open.href = galleryLink(entry.slug);
  const file = el("a", "file", t("maps.download"));
  file.href = `${GALLERY_PATH}/${entry.file}`;
  file.download = entry.file;
  const row = el("div", "actions");
  row.append(open, file);
  const head = el("div", "map-head");
  head.append(mapIcon(entry), el("h3", "", entry.name));
  box.append(head, el("p", "ds", entry.description), islands, el("p", "mt", meta), row);
  return box;
}

const list = document.getElementById("maps");
try {
  const res = await fetch(GALLERY_INDEX);
  if (!res.ok) throw new Error(String(res.status));
  list.replaceChildren(...galleryFor(await res.json(), language()).map(card));
  // A link to one map (/maps#git) arrives before its card exists.
  if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
} catch {
  list.replaceChildren(el("p", "status", t("maps.failed")));
}
