// "New domain…": one field, the description: what the reader wants to chart and why, in their words. The server
// makes the domain under a provisional name taken from it; the page opens it with ?chart=start, where the
// cartographer names the domain and sketches its first islands, and the reader approves both. Works before the
// map has loaded (no domains yet). the pencil on the current domain's row in the domain menu edits both for an existing domain.
import { api } from "./app.js";
import { registerRegion } from "./keys.js";
import { CENTRE, COAST, RING_STEP, ringPoints } from "./contour.js";
import { language, t } from "./i18n.js";
import { agentPrompt, mapFromText } from "./map-model.js";
import { GALLERY_INDEX, GALLERY_PATH, galleryFor } from "./gallery-model.js";

/** Descriptions to start from: a click puts one in the field, to send or to edit. */
export const EXAMPLES = [1, 2, 3, 4, 5, 6].map((n) => t(`newDomain.example${n}`));

/** Mirrors DESCRIPTION_MAX in src/core/validators.ts. */
export const DESCRIPTION_MAX = 500;

/** `editing`: null for a new domain, else the slug of the domain being edited. `first`: there are no domains yet, so the dialog is the page. */
/** `deleting`: the edit dialog is asking whether to delete the domain. */
/** `importing`: the new-domain dialog is on its other way in, a map file (pasted, picked, or written by another AI from our prompt). */
/** `gallery`: it is on the shared maps (`maps`: null until the index is read; `pick`: the slug a link asked for; `adding`: the one being added). */
const state = { open: false, name: "", description: "", editing: null, first: false, saving: false, error: null, deleting: false, importing: false, mapText: "", copied: false, gallery: false, maps: null, pick: null, adding: null };
let root = null;

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function installNewDomain() {
  root = document.getElementById("new-domain");
  registerRegion("newDomain", { isOpen: () => state.open, close });
}

/** `map`: open on the shared maps with this one picked out, as a link from the gallery page asks (`/?map=<slug>`). */
export function openNewDomain({ first = false, map = null } = {}) {
  if (!root) return;
  Object.assign(state, { open: true, name: "", description: "", editing: null, first, saving: false, error: null, deleting: false, importing: false, mapText: "", copied: false, gallery: false, pick: map, adding: null });
  if (map) return void showGallery(true);
  render();
  root.querySelector("#new-domain-description")?.focus();
}

/** An existing domain's name and description, read fresh so a change made in the terminal shows. */
export async function openDomainEdit(slug) {
  if (!root) return;
  const { domains } = await api("/api/domains");
  const domain = domains.find((d) => d.slug === slug);
  if (!domain) return;
  Object.assign(state, { open: true, name: domain.name, description: domain.description ?? "", editing: slug, first: false, saving: false, error: null, deleting: false, importing: false, gallery: false });
  render();
  root.querySelector("#new-domain-description")?.focus();
}

function close() {
  if (state.importing) {
    // One step back, to the description; a map being imported is let finish.
    if (!state.saving) showImport(false);
    return;
  }
  if (state.gallery) {
    if (!state.saving) showGallery(false);
    return;
  }
  if (state.first) return; // nothing behind it to go back to
  if (state.deleting && !state.saving) {
    // Escape on the delete question backs out to the edit dialog
    state.deleting = false;
    state.error = null;
    render();
    return;
  }
  state.open = false;
  render();
}

const post = (path, body) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function showImport(on) {
  Object.assign(state, { importing: on, error: null, copied: false });
  render();
  root.querySelector(on ? "#new-domain-map" : "#new-domain-description")?.focus();
}

/** The page on a domain just made from a map. */
function openDomain(slug) {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("domain", slug);
  location.href = url.toString();
}

/** The shared maps: the index is read once, the first time they are shown. */
function showGallery(on) {
  Object.assign(state, { gallery: on, error: null });
  if (!on) state.pick = null;
  render();
  if (!on) return void root.querySelector("#new-domain-description")?.focus();
  if (state.maps) return focusGallery();
  fetch(GALLERY_INDEX)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((index) => {
      state.maps = galleryFor(index, language());
      if (state.open && state.gallery) {
        render();
        focusGallery();
      }
    })
    .catch(() => {
      state.error = t("newDomain.galleryFailed");
      if (state.open && state.gallery) render();
    });
}

function focusGallery() {
  const rows = [...root.querySelectorAll(".shared-map")];
  const row = rows.find((r) => r.dataset.slug === state.pick) ?? rows[0];
  row?.focus();
  if (state.pick) row?.scrollIntoView({ block: "nearest" });
}

/** A new domain from one of the shared maps: its file, then the same import a pasted one goes through. */
async function addShared(entry) {
  if (state.saving) return;
  Object.assign(state, { saving: true, adding: entry.slug, error: null });
  render();
  try {
    const res = await fetch(`${GALLERY_PATH}/${entry.file}`);
    if (!res.ok) throw new Error(t("newDomain.galleryFailed"));
    const { domain } = await post("/api/map", await res.json());
    openDomain(domain.slug);
  } catch (error) {
    Object.assign(state, { saving: false, adding: null, error: error.message });
    render();
    focusGallery();
  }
}

/** The dialog on the shared maps: one row each, and a click adds it as a new domain. */
function galleryView(card) {
  card.append(el("div", "lbl", t("newDomain.galleryTitle")), el("p", "help", t("newDomain.galleryHelp")));
  const list = el("div", "shared-maps");
  if (!state.maps && !state.error) list.append(el("p", "help", t("newDomain.galleryLoading")));
  for (const entry of state.maps ?? []) {
    const row = el("button", "shared-map");
    row.type = "button";
    row.dataset.slug = entry.slug;
    row.disabled = state.saving;
    row.classList.toggle("picked", entry.slug === state.pick);
    const meta = t("newDomain.galleryMeta", { islands: entry.islands.length, landmarks: entry.landmarks });
    row.append(el("span", "nm", entry.name), el("span", "ds", entry.description), el("span", "mt", state.adding === entry.slug ? t("newDomain.galleryAdding") : meta));
    row.addEventListener("click", () => void addShared(entry));
    row.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close();
    });
    list.append(row);
  }
  card.append(list);
  if (state.error) card.append(el("p", "error", state.error));
  const row = el("div", "row");
  const back = el("button", "btn ghost", t("newDomain.back"));
  back.type = "button";
  back.disabled = state.saving;
  back.addEventListener("click", () => showGallery(false));
  const all = el("a", "as-link push", t("newDomain.galleryAll"));
  all.href = "/maps";
  all.target = "_blank";
  all.rel = "noopener";
  row.append(back, all);
  card.append(row);
}

/** A new domain from a map file's text: the app checks it, and says in words what is wrong with one it refuses. */
async function importMap(text = state.mapText) {
  if (state.saving) return;
  const file = mapFromText(text);
  if (!file) {
    state.error = t("newDomain.notAMap");
    return render();
  }
  state.saving = true;
  state.error = null;
  render();
  try {
    const { domain } = await post("/api/map", file);
    openDomain(domain.slug);
  } catch (error) {
    state.saving = false;
    state.error = error.message;
    render();
    root.querySelector("#new-domain-map")?.focus();
  }
}

/** Picks a map file from the device and imports it. */
function chooseMap() {
  const input = el("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    state.mapText = await file.text();
    void importMap();
  });
  input.click();
}

/** Puts the prompt for another AI on the clipboard, with what the reader wrote as its subject. */
async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(agentPrompt({ subject: state.description, language: language() }));
    state.copied = true;
    state.error = null;
    render();
    setTimeout(() => {
      if (!state.copied) return;
      state.copied = false;
      if (state.open && state.importing && !state.saving) render();
    }, 1500);
  } catch {
    state.error = t("newDomain.copyRefused");
    render();
  }
}

/** The dialog's other way in: a map file. Paste it or pick it, or copy the prompt that has another AI write one. */
function importView(card, keys) {
  card.append(el("div", "lbl", t("newDomain.importTitle")), el("p", "help", t("newDomain.importHelp")));
  const text = el("textarea", "map-text");
  text.id = "new-domain-map";
  text.rows = 7;
  text.spellcheck = false;
  text.placeholder = t("newDomain.importPlaceholder");
  text.value = state.mapText;
  text.disabled = state.saving;
  text.setAttribute("aria-label", t("newDomain.importPlaceholder"));
  text.addEventListener("input", () => (state.mapText = text.value));
  text.addEventListener("keydown", keys);
  card.append(text);
  if (state.error) card.append(el("p", "error", state.error));
  const row = el("div", "row");
  const go = el("button", "btn", state.saving ? t("newDomain.importing") : t("newDomain.importGo"));
  go.type = "submit";
  go.disabled = state.saving;
  const pick = el("button", "btn ghost", t("newDomain.chooseFile"));
  pick.type = "button";
  pick.disabled = state.saving;
  pick.addEventListener("click", chooseMap);
  const back = el("button", "btn ghost", t("newDomain.back"));
  back.type = "button";
  back.disabled = state.saving;
  back.addEventListener("click", () => showImport(false));
  row.append(go, pick, back);
  card.append(row);
  const other = el("div", "other-ai");
  const copy = el("button", "btn ghost", state.copied ? t("newDomain.copied") : t("newDomain.copyPrompt"));
  copy.type = "button";
  copy.id = "copy-map-prompt";
  copy.addEventListener("click", () => void copyPrompt());
  other.append(el("p", "help", t(state.description.trim() ? "newDomain.promptHelpSubject" : "newDomain.promptHelp")), copy);
  card.append(other);
}

async function submit() {
  if (state.saving) return;
  if (state.importing) return void importMap();
  if (state.editing ? !state.name.trim() : !state.description.trim()) return;
  state.saving = true;
  state.error = null;
  render();
  try {
    if (state.editing) {
      await post("/api/domains/update", { domain: state.editing, name: state.name, description: state.description });
      close();
      location.reload(); // the name shows in the breadcrumb, the outline, and the menu: read it fresh everywhere
      return;
    }
    const { domain } = await post("/api/domains", { description: state.description });
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("domain", domain.slug);
    url.searchParams.set("chart", "start");
    location.href = url.toString();
  } catch (error) {
    state.saving = false;
    state.error = error.message;
    render();
    root.querySelector("#new-domain-description")?.focus();
  }
}

/** Deletes the domain being edited, then opens whichever domain is left (or the empty start when none is). */
async function removeDomain() {
  if (state.saving) return;
  state.saving = true;
  state.error = null;
  render();
  try {
    await post("/api/domains/delete", { domain: state.editing });
    for (const key of [`outline:${state.editing}`, `mode:${state.editing}`]) {
      try {
        localStorage.removeItem(key);
      } catch {
        // storage may be blocked; the keys are only conveniences
      }
    }
    location.replace(location.pathname);
  } catch (error) {
    state.saving = false;
    state.error = error.message;
    render();
  }
}

/** The edit dialog's second step: what deleting takes with it, and the two ways out. */
function deleteConfirm() {
  const box = el("div", "delete-confirm");
  box.append(el("p", "help", t("newDomain.deleteHelp", { name: state.name })));
  if (globalThis.ARCHIPELAGO_HOSTED) box.append(el("p", "help", t("newDomain.backupFirst")));
  if (state.error) box.append(el("p", "error", state.error));
  const row = el("div", "row");
  const yes = el("button", "btn danger", state.saving ? t("newDomain.deleting") : t("newDomain.deleteForGood"));
  yes.type = "button";
  yes.id = "delete-domain-confirm";
  yes.disabled = state.saving;
  yes.addEventListener("click", () => void removeDomain());
  const no = el("button", "btn ghost", t("newDomain.keepIt"));
  no.type = "button";
  no.disabled = state.saving;
  no.addEventListener("click", () => {
    state.deleting = false;
    state.error = null;
    render();
  });
  row.append(yes, no);
  box.append(row);
  return box;
}

function render() {
  if (!root) return;
  root.hidden = !state.open;
  root.classList.toggle("first", state.first);
  root.replaceChildren();
  if (!state.open) return;
  const card = el("form", "new-domain-card");
  const keys = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };
  if (state.editing && state.deleting) {
    card.append(el("div", "lbl", t("newDomain.deleteTitle")), deleteConfirm());
    root.append(card);
    card.querySelector(".btn.ghost")?.focus();
    return;
  }
  if (state.gallery) {
    galleryView(card);
    card.addEventListener("submit", (e) => e.preventDefault());
    root.append(card);
    return;
  }
  if (state.importing) {
    importView(card, keys);
    card.addEventListener("submit", (e) => {
      e.preventDefault();
      void submit();
    });
    root.append(card);
    return;
  }
  if (state.editing) {
    card.append(el("div", "lbl", t("newDomain.editTitle")));
    const name = el("input");
    name.id = "new-domain-name";
    name.maxLength = 80;
    name.value = state.name;
    name.disabled = state.saving;
    name.setAttribute("aria-label", t("newDomain.name"));
    name.addEventListener("input", () => (state.name = name.value));
    name.addEventListener("keydown", keys);
    card.append(name, el("p", "help", t("newDomain.editHelp")));
  } else if (state.first) {
    card.append(islandsArt(), el("div", "lbl", "Archipelago"), el("h1", "title", t("newDomain.firstTitle")));
    card.append(el("p", "help", t("newDomain.firstHelp")));
  } else {
    card.append(el("div", "lbl", t("newDomain.newTitle")), el("p", "help", t("newDomain.newHelp")));
  }
  const description = el("textarea");
  description.id = "new-domain-description";
  description.rows = 4;
  description.maxLength = DESCRIPTION_MAX;
  description.placeholder = t("newDomain.placeholder");
  description.value = state.description;
  description.disabled = state.saving;
  description.setAttribute("aria-label", t("newDomain.description"));
  description.addEventListener("input", () => (state.description = description.value));
  description.addEventListener("keydown", keys);
  card.append(description);
  if (!state.editing) {
    const examples = el("div", "examples");
    examples.append(el("span", "ex-lbl", t("newDomain.startFrom")));
    for (const text of EXAMPLES) {
      const chip = el("button", "ex", text);
      chip.type = "button";
      chip.disabled = state.saving;
      chip.addEventListener("click", () => {
        state.description = text;
        description.value = text;
        description.focus();
      });
      examples.append(chip);
    }
    card.append(examples);
  }
  if (state.error) card.append(el("p", "error", state.error));
  const row = el("div", "row");
  const make = el("button", "btn", state.saving ? (state.editing ? t("newDomain.saving") : t("newDomain.creating")) : state.editing ? t("newDomain.save") : t("newDomain.create"));
  make.type = "submit";
  make.disabled = state.saving;
  const cancel = el("button", "btn ghost", t("newDomain.cancel"));
  cancel.type = "button";
  cancel.addEventListener("click", close);
  row.append(make);
  if (!state.first) row.append(cancel);
  if (!state.editing) row.append(el("span", "hint", "⌘↵"));
  if (state.editing) {
    const del = el("button", "btn ghost danger push", t("newDomain.deleteDomain"));
    del.type = "button";
    del.id = "delete-domain";
    del.disabled = state.saving;
    del.addEventListener("click", () => {
      state.deleting = true;
      state.error = null;
      render();
    });
    row.append(del);
  }
  card.append(row);
  if (!state.editing) {
    // The other way in: a map that already exists, or one another AI writes from our prompt. No model turn of ours.
    const shared = el("button", "as-link", t("newDomain.sharedMaps"));
    shared.type = "button";
    shared.id = "shared-maps";
    shared.disabled = state.saving;
    shared.addEventListener("click", () => showGallery(true));
    card.append(shared);
    const have = el("button", "as-link", t("newDomain.importMap"));
    have.type = "button";
    have.id = "import-map";
    have.disabled = state.saving;
    have.addEventListener("click", () => showImport(true));
    card.append(have);
  }
  card.addEventListener("submit", (e) => {
    e.preventDefault();
    void submit();
  });
  root.append(card);
}

const SVG = "http://www.w3.org/2000/svg";

/** Three islands as the map draws them, open water, sandbar, settled: what charting does, before there is anything to chart. */
function islandsArt() {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 600 200");
  svg.setAttribute("class", "art");
  svg.setAttribute("aria-hidden", "true");
  const ring = (seed, r) => ringPoints(seed, r).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const shape = (cls, seed, r) => {
    const p = document.createElementNS(SVG, "polygon");
    p.setAttribute("points", ring(seed, r));
    p.setAttribute("class", cls);
    return p;
  };
  [["open", 7], ["sandbar", 23], ["settled", 41]].forEach(([state, seed], i) => {
    const g = document.createElementNS(SVG, "g");
    g.setAttribute("transform", `translate(${i * 200} 0)`);
    g.setAttribute("class", `isle ${state}`);
    g.append(shape("coast", seed, COAST));
    if (state !== "open") g.append(shape("ring", seed, COAST - RING_STEP));
    if (state === "settled") g.append(shape("ring", seed, COAST - 2 * RING_STEP));
    const label = document.createElementNS(SVG, "text");
    label.setAttribute("x", String(CENTRE));
    label.setAttribute("y", "190");
    label.textContent = { open: t("newDomain.openWater"), sandbar: t("newDomain.sandbar"), settled: t("newDomain.settled") }[state];
    g.append(label);
    svg.append(g);
  });
  return svg;
}
