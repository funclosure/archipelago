// "New domain…": one field, the description: what the reader wants to chart and why, in their words. The server
// makes the domain under a provisional name taken from it; the page opens it with ?chart=start, where the
// cartographer names the domain and sketches its first islands, and the reader approves both. Works before the
// map has loaded (no domains yet). the pencil on the current domain's row in the domain menu edits both for an existing domain.
//
// A dialog of the family (dialog.js): the shell, head, foot and fields are the shared ones, Escape is one step back
// (a sub-view to the description, the delete question to the edit form, then out), and the close button or a press
// on the veil leaves altogether. Words are never dropped silently: a new domain's description (and a pasted map)
// stays as a draft for the next opening, and an edited domain asks Discard / Keep editing. With no domains yet
// (`first`) it is the page itself, not a dialog: no veil, no trap, nothing to close.
import { api } from "./app.js";
import { CENTRE, COAST, RING_STEP, ringPoints } from "./contour.js";
import { language, t } from "./i18n.js";
import { agentPrompt, mapFromText } from "./map-model.js";
import { mapIcon } from "./map-icon.js";
import { GALLERY_INDEX, GALLERY_PATH, galleryFor } from "./gallery-model.js";
import { showDialog, redraw, rememberFocus, focusFirst, dialogHead, dialogFoot, discardFoot, withKey, labelled } from "./dialog.js";
import { isDirty, leaveStep } from "./dialog-model.js";
import { icon } from "./icons.js";
import { toast } from "./toast.js";

/** Descriptions to start from: a click puts one in the field, to send or to edit. */
export const EXAMPLES = [1, 2, 3, 4, 5, 6].map((n) => t(`newDomain.example${n}`));

/** Ready-made maps shown as tiles under New domain; the rest are behind "See all". */
const TILES_MAX = 6;

/** Mirrors DESCRIPTION_MAX in src/core/validators.ts. */
export const DESCRIPTION_MAX = 500;

/** `editing`: null for a new domain, else the slug of the domain being edited. `first`: there are no domains yet, so the dialog is the page. */
/** `deleting`: the edit dialog is asking whether to delete the domain. `confirming`: it is asking whether to discard changed words. */
/** `importing`: the new-domain dialog is on its other way in, a map file (pasted, picked, or written by another AI from our prompt). */
/** `gallery`: it is on the shared maps (`maps`: null until the index is read; `pick`: the slug a link asked for; `adding`: the one being added). */
/** `restored`: the description is the draft of an earlier opening, and a line says so. */
const state = { open: false, name: "", description: "", editing: null, first: false, saving: false, error: null, deleting: false, confirming: false, importing: false, mapText: "", copied: false, gallery: false, maps: null, pick: null, adding: null, galleryFailed: false, restored: false };
let root = null;
/** What a new domain's fields held when the dialog was last left: the next opening starts from it. Memory only. */
const draft = { description: "", mapText: "" };
/** What Edit domain opened on: leaving with either changed asks first. */
let origin = { name: "", description: "" };
/** Where the keyboard was when the Discard question came up: Keep editing goes back there. */
let resume = null;

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A button of the family. `key` names it across redraws, so focus on it survives one (dialog.js). */
function button(label, onClick, className, key) {
  const b = el("button", className, label);
  b.type = "button";
  if (key) b.dataset.key = key;
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

export function installNewDomain() {
  root = document.getElementById("new-domain");
}

const focusOn = (selector) => {
  const target = root.querySelector(selector);
  target?.focus();
  return Boolean(target);
};

/** `map`: open on the shared maps with this one picked out, as a link from the gallery page asks (`/?map=<slug>`). */
export function openNewDomain({ first = false, map = null } = {}) {
  if (!root) return;
  Object.assign(state, { open: true, name: "", description: draft.description, restored: draft.description.trim() !== "", editing: null, first, saving: false, error: null, deleting: false, confirming: false, importing: false, mapText: draft.mapText, copied: false, gallery: false, pick: map, adding: null });
  loadGallery();
  if (map) return void showGallery(true);
  render();
  focusDescription();
}

/** The caret goes after the words that are there (a draft from before, an example). */
function focusDescription() {
  const field = root.querySelector("#new-domain-description");
  if (!field) return;
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
}

let galleryRead = null;
/** The shared maps' index, read once; the dialog draws again when it arrives. `maps` stays null when it cannot be read. */
function loadGallery() {
  galleryRead ??= fetch(GALLERY_INDEX)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((index) => {
      state.maps = galleryFor(index, language());
    })
    .catch(() => {
      galleryRead = null; // asked again the next time the dialog opens
      state.galleryFailed = true;
    })
    .finally(() => {
      if (!state.open || state.editing || state.saving) return;
      if (state.gallery) {
        if (state.galleryFailed && !state.maps) state.error = t("newDomain.galleryFailed");
        render();
        focusGallery();
      } else if (!state.importing && state.maps) render(); // the tiles arrive; the caret stays where it is
    });
  return galleryRead;
}

/** An existing domain's name and description, read fresh so a change made in the terminal shows. */
export async function openDomainEdit(slug) {
  if (!root) return;
  const { domains } = await api("/api/domains");
  const domain = domains.find((d) => d.slug === slug);
  if (!domain) return;
  origin = { name: domain.name, description: domain.description ?? "" };
  Object.assign(state, { open: true, ...origin, editing: slug, first: false, saving: false, error: null, deleting: false, confirming: false, importing: false, gallery: false, restored: false });
  render();
  root.querySelector("#new-domain-name")?.select(); // the name is what an edit is most often for
}

const changed = () => Boolean(state.editing) && (isDirty(state.name, origin.name) || isDirty(state.description, origin.description));

/**
 * A request to leave. Escape (`why` "escape") is one step back: a sub-view to the description, the delete question
 * to the edit form, the Discard question to the editing, and then out. The close button, Cancel and a press on the
 * veil ask to leave altogether. An edited domain with changed words asks before it goes.
 */
function leave(why = "escape") {
  if (state.saving) return; // a save, an import or a delete in flight is let finish
  if (why === "escape" && !state.confirming) {
    if (state.importing) return showImport(false);
    if (state.gallery) return showGallery(false);
    if (state.deleting) return stopDeleting();
  }
  if (state.first) return; // nothing behind it to go back to
  const step = leaveStep({ confirming: state.confirming, dirty: changed() });
  if (step === "resume") return keepEditing();
  if (step === "ask") {
    resume = rememberFocus(root);
    Object.assign(state, { confirming: true, deleting: false, error: null });
    render();
    focusFirst(root); // Discard, as the board's editor: Enter discards, Escape goes back to editing
    return;
  }
  shut();
}

/** Closes the dialog. A new domain's words stay as the draft the next opening starts from. */
function shut() {
  if (!state.editing) Object.assign(draft, { description: state.description, mapText: state.mapText });
  Object.assign(state, { open: false, confirming: false, deleting: false });
  render();
}

function keepEditing() {
  state.confirming = false;
  render();
  if (!resume?.restore()) focusFirst(root);
  resume = null;
}

function stopDeleting() {
  state.deleting = false;
  state.error = null;
  render();
  focusOn("#delete-domain"); // back on the door it came through
}

const post = (path, body) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function showImport(on) {
  Object.assign(state, { importing: on, error: null, copied: false });
  render();
  if (on) focusOn("#new-domain-map");
  else if (!focusOn("#import-map")) focusDescription(); // back on what opened it
}

/** The page on a domain just made from a map. */
function openDomain(slug) {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("domain", slug);
  location.href = url.toString();
}

/** The shared maps: the index is read once, the first time they are shown. */
function showGallery(on, pick = null) {
  const was = state.pick;
  Object.assign(state, { gallery: on, error: null });
  state.pick = on ? (pick ?? state.pick) : null;
  render();
  if (!on) {
    // Back on what opened them: the tile that was picked, else the link under the tiles.
    if (!(was && focusOn(`.map-tile[data-slug="${CSS.escape(was)}"]`)) && !focusOn("#shared-maps")) focusDescription();
    return;
  }
  if (state.maps) return focusGallery();
  state.galleryFailed = false;
  void loadGallery();
}

function focusGallery() {
  const row = focusFirst(root); // the picked map, else the first
  if (state.pick && row?.classList.contains("shared-map")) row.scrollIntoView({ block: "nearest" });
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
    if (!focusOn(`.shared-map[data-slug="${CSS.escape(entry.slug)}"]`)) focusGallery();
  }
}

/** The dialog on the shared maps: one row each, and a click adds it as a new domain. */
function galleryView(card) {
  card.append(dialogHead(t("newDomain.galleryTitle"), state.first ? null : leave, { id: "new-domain-title" }), el("p", "help", t("newDomain.galleryHelp")));
  const list = el("div", "shared-maps");
  if (!state.maps && !state.error) list.append(el("p", "help", t("newDomain.galleryLoading")));
  for (const entry of state.maps ?? []) {
    const row = button(undefined, () => void addShared(entry), "shared-map", `map:${entry.slug}`);
    row.dataset.slug = entry.slug;
    row.disabled = state.saving;
    row.classList.toggle("picked", entry.slug === state.pick);
    const meta = t("newDomain.galleryMeta", { islands: entry.islands.length, landmarks: entry.landmarks });
    const words = el("span", "words");
    words.append(el("span", "nm", entry.name), el("span", "ds", entry.description), el("span", "mt", state.adding === entry.slug ? t("newDomain.galleryAdding") : meta));
    row.append(mapIcon(entry), words);
    list.append(row);
  }
  const unread = !state.maps && Boolean(state.error); // the index could not be read: say so, and offer to read it again
  if (!unread) card.append(list);
  if (state.error) card.append(el("p", "error", state.error));
  const back = button(t("newDomain.back"), () => showGallery(false), "btn ghost", "back");
  back.disabled = state.saving;
  const all = el("a", "btn quiet", t("newDomain.galleryAll"));
  all.href = "/maps";
  all.target = "_blank";
  all.rel = "noopener";
  all.dataset.key = "all-maps";
  all.append(icon("external", { size: 14 }));
  const actions = [all];
  if (unread) {
    const retry = button(t("newDomain.tryAgain"), () => {
      Object.assign(state, { error: null, galleryFailed: false });
      render();
      void loadGallery();
    }, "btn", "retry");
    retry.dataset.autofocus = "";
    actions.push(retry);
  }
  card.append(dialogFoot([back], actions));
}

/** A new domain from a map file's text: the app checks it, and says in words what is wrong with one it refuses. */
async function importMap(text = state.mapText) {
  if (state.saving) return;
  const file = mapFromText(text);
  if (!file) {
    state.error = t("newDomain.notAMap");
    render();
    return void focusOn("#new-domain-map");
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
    focusOn("#new-domain-map");
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
    render();
    setTimeout(() => {
      if (!state.copied) return;
      state.copied = false;
      if (state.open && state.importing && !state.saving) render();
    }, 1500);
  } catch {
    toast(t("newDomain.copyRefused"), { kind: "error" });
  }
}

/** The dialog's other way in: a map file. Paste it or pick it, or copy the prompt that has another AI write one. */
function importView(card) {
  card.append(dialogHead(t("newDomain.importTitle"), state.first ? null : leave, { id: "new-domain-title" }), el("p", "help", t("newDomain.importHelp")));
  const text = el("textarea", "field map-text");
  text.id = "new-domain-map";
  text.rows = 7;
  text.spellcheck = false;
  text.placeholder = t("newDomain.importPlaceholder");
  text.value = state.mapText;
  text.disabled = state.saving;
  text.addEventListener("input", () => (state.mapText = text.value));
  card.append(labelled(t("newDomain.mapFile"), text));
  if (state.error) card.append(el("p", "error", state.error));
  const go = withKey(el("button", "btn", state.saving ? t("newDomain.importing") : t("newDomain.importGo")), "⌘↵");
  go.type = "submit";
  go.dataset.key = "import-go";
  go.disabled = state.saving;
  const pick = button(t("newDomain.chooseFile"), chooseMap, "btn ghost", "choose-file");
  pick.disabled = state.saving;
  const back = button(t("newDomain.back"), () => showImport(false), "btn ghost", "back");
  back.disabled = state.saving;
  card.append(dialogFoot([back], [pick, go]));
  const other = el("div", "other-ai");
  const copy = button(state.copied ? t("newDomain.copied") : t("newDomain.copyPrompt"), () => void copyPrompt(), "btn ghost");
  copy.id = "copy-map-prompt";
  if (state.copied) copy.prepend(icon("check", { size: 14 }));
  else copy.prepend(icon("copy", { size: 14 }));
  other.append(el("p", "help", t(state.description.trim() ? "newDomain.promptHelpSubject" : "newDomain.promptHelp")), copy);
  card.append(other);
}

async function submit() {
  if (state.saving || state.confirming || state.deleting || state.gallery) return;
  if (state.importing) return void importMap();
  if (state.editing ? !state.name.trim() : !state.description.trim()) {
    return void focusOn(state.editing ? "#new-domain-name" : "#new-domain-description"); // nothing to send yet: the field that needs words
  }
  if (state.editing && !changed()) return shut(); // nothing to save
  state.saving = true;
  state.error = null;
  render();
  try {
    if (state.editing) {
      await post("/api/domains/update", { domain: state.editing, name: state.name, description: state.description });
      shut();
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
    focusOn("#new-domain-description");
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
    focusFirst(root);
  }
}

/** The edit dialog's second step: what deleting takes with it, and the two ways out. The safe one has the keyboard. */
function deleteView(card) {
  card.append(dialogHead(t("newDomain.deleteTitle"), leave, { id: "new-domain-title" }));
  card.append(el("p", "confirm", t("newDomain.deleteHelp", { name: origin.name })));
  if (globalThis.ARCHIPELAGO_HOSTED) card.append(el("p", "help", t("newDomain.backupFirst")));
  if (state.error) card.append(el("p", "error", state.error));
  const yes = button(state.saving ? t("newDomain.deleting") : t("newDomain.deleteForGood"), () => void removeDomain(), "btn danger", "delete-confirm");
  yes.id = "delete-domain-confirm";
  yes.disabled = state.saving;
  const no = button(t("newDomain.keepIt"), stopDeleting, "btn ghost", "keep");
  no.disabled = state.saving;
  no.dataset.autofocus = "";
  card.append(dialogFoot([], [no, yes]));
}

/** The first-run page is not a dialog, so its keys are its own: Escape steps back from a sub-view, ⌘↵ sends. */
function pageKeys(e) {
  if (e.isComposing || e.keyCode === 229) return; // the input method's key
  if (e.key === "Escape") {
    e.preventDefault();
    leave("escape");
  } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    void submit();
  }
}

function render() {
  if (!root) return;
  redraw(root, draw);
}

function draw() {
  root.hidden = !state.open;
  root.classList.toggle("first", state.first);
  // With no domains yet this is the page itself, never a dialog: no veil, no trap, nothing behind it to quiet.
  root.setAttribute("role", state.first ? "main" : "dialog");
  showDialog(root, state.open && !state.first, { close: leave, submit: () => void submit() });
  root.replaceChildren();
  if (!state.open) return;
  const card = el("form", "dialog-card md new-domain-card");
  root.setAttribute("aria-labelledby", "new-domain-title");
  card.addEventListener("submit", (e) => {
    e.preventDefault();
    void submit();
  });
  if (state.first) card.addEventListener("keydown", pageKeys);
  root.append(card);
  if (state.editing && state.deleting) return deleteView(card);
  if (state.gallery) return galleryView(card);
  if (state.importing) return importView(card);

  const description = el("textarea", "field");
  description.id = "new-domain-description";
  description.rows = 4;
  description.maxLength = DESCRIPTION_MAX;
  description.placeholder = t("newDomain.placeholder");
  description.value = state.description;
  description.disabled = state.saving;
  let restoredNote = null;
  description.addEventListener("input", () => {
    state.description = description.value;
    if (state.restored) {
      // the words are the reader's again: the line about where they came from goes, without a redraw under the caret
      state.restored = false;
      restoredNote?.remove();
    }
  });

  if (state.editing) {
    card.append(dialogHead(t("newDomain.editTitle"), leave, { id: "new-domain-title" }));
    const name = el("input", "field");
    name.id = "new-domain-name";
    name.maxLength = 80;
    name.value = state.name;
    name.disabled = state.saving;
    name.autocomplete = "off";
    name.addEventListener("input", () => (state.name = name.value));
    card.append(labelled(t("newDomain.name"), name), labelled(t("newDomain.description"), description), el("p", "help", t("newDomain.editHelp")));
  } else {
    if (state.first) {
      const title = el("h1", "title", t("newDomain.firstTitle"));
      title.id = "new-domain-title";
      card.append(islandsArt(), el("div", "eyebrow", "Archipelago"), title, el("p", "help", t("newDomain.firstHelp")));
    } else {
      const question = el("h2", "dialog-title", t("newDomain.newQuestion"));
      question.id = "new-domain-question";
      card.append(dialogHead(t("newDomain.newTitle"), leave, { id: "new-domain-title" }), question, el("p", "help", t("newDomain.newHelp")));
    }
    description.setAttribute("aria-labelledby", state.first ? "new-domain-title" : "new-domain-question"); // the question is the field's label
    card.append(description);
    if (state.restored) {
      restoredNote = el("div", "draft-note");
      restoredNote.append(el("span", null, t("newDomain.restored")), button(t("newDomain.startOver"), () => {
        Object.assign(state, { description: "", restored: false });
        draft.description = "";
        render();
        focusDescription();
      }, "btn quiet sm", "start-over"));
      card.append(restoredNote);
    }
    const examples = el("div", "examples");
    card.append(el("div", "sub-lbl", t("newDomain.startFrom")));
    EXAMPLES.forEach((text, i) => {
      const chip = button(text, () => {
        state.description = text;
        description.value = text;
        if (state.restored) {
          state.restored = false;
          restoredNote?.remove();
        }
        focusDescription();
      }, "ex", `example:${i}`);
      chip.disabled = state.saving;
      examples.append(chip);
    });
    card.append(examples);
  }
  if (state.error) card.append(el("p", "error", state.error));

  if (state.confirming) card.append(discardFoot(shut, keepEditing));
  else {
    const make = withKey(el("button", "btn", state.saving ? (state.editing ? t("newDomain.saving") : t("newDomain.creating")) : state.editing ? t("newDomain.save") : t("newDomain.create")), "⌘↵");
    make.type = "submit";
    make.dataset.key = "submit";
    make.disabled = state.saving;
    const cancel = button(t("newDomain.cancel"), () => leave("button"), "btn ghost", "cancel");
    const lead = [];
    if (state.editing) {
      const del = button(t("newDomain.deleteDomain"), () => {
        Object.assign(state, { deleting: true, error: null });
        render();
        focusFirst(root); // Keep it: the safe way out has the keyboard
      }, "btn ghost danger", "delete");
      del.id = "delete-domain";
      del.disabled = state.saving;
      lead.push(del);
    }
    card.append(dialogFoot(lead, state.first ? [make] : [cancel, make]));
  }

  if (!state.editing) {
    // The other way in: a map that already exists, or one another AI writes from our prompt. No model turn of ours.
    const other = el("div", "other-ways");
    if (state.maps?.length) {
      // Ready-made maps, a tile each: a click shows that one in the shared maps, where one more adds it.
      other.append(el("div", "sub-lbl", t("newDomain.readyMade")));
      const tiles = el("div", "map-tiles");
      for (const entry of state.maps.slice(0, TILES_MAX)) {
        const tile = button(undefined, () => showGallery(true, entry.slug), "map-tile", `tile:${entry.slug}`);
        tile.dataset.slug = entry.slug;
        tile.disabled = state.saving;
        const words = el("span", "words");
        words.append(el("span", "nm", entry.name), el("span", "mt", t("newDomain.tileMeta", { islands: entry.islands.length })));
        tile.append(mapIcon(entry), words);
        tiles.append(tile);
      }
      other.append(tiles);
    }
    const links = el("div", "links");
    const shared = button(t(state.maps?.length ? "newDomain.sharedMapsAll" : "newDomain.sharedMaps"), () => showGallery(true), "btn quiet md");
    shared.id = "shared-maps";
    shared.disabled = state.saving;
    const have = button(t("newDomain.importMap"), () => showImport(true), "btn quiet md");
    have.id = "import-map";
    have.disabled = state.saving;
    for (const b of [shared, have]) b.append(icon("chevron-right", { size: 12 }));
    links.append(shared, have);
    other.append(links);
    card.append(other);
  }
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
