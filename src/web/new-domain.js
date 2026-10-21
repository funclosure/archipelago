// "New domain…": one field, the description: what the reader wants to chart and why, in their words. The server
// makes the domain under a provisional name taken from it; the page opens it with ?chart=start, where the
// cartographer names the domain and sketches its first islands, and the reader approves both. Works before the
// map has loaded (no domains yet). "Edit domain…" in the domain menu edits both for an existing domain.
import { api } from "./app.js";
import { registerRegion } from "./keys.js";
import { CENTRE, COAST, RING_STEP, ringPoints } from "./contour.js";

/** Descriptions to start from: a click puts one in the field, to send or to edit. */
export const EXAMPLES = [
  "System design, for a staff engineer interview",
  "React Native, coming from ten years of iOS",
  "Wine, as a curious beginner",
  "Linear algebra, to finally follow ML papers",
];

/** Mirrors DESCRIPTION_MAX in src/core/validators.ts. */
export const DESCRIPTION_MAX = 500;

/** `editing`: null for a new domain, else the slug of the domain being edited. `first`: there are no domains yet, so the dialog is the page. */
const state = { open: false, name: "", description: "", editing: null, first: false, saving: false, error: null };
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

export function openNewDomain({ first = false } = {}) {
  if (!root) return;
  Object.assign(state, { open: true, name: "", description: "", editing: null, first, saving: false, error: null });
  render();
  root.querySelector("#new-domain-description")?.focus();
}

/** An existing domain's name and description, read fresh so a change made in the terminal shows. */
export async function openDomainEdit(slug) {
  if (!root) return;
  const { domains } = await api("/api/domains");
  const domain = domains.find((d) => d.slug === slug);
  if (!domain) return;
  Object.assign(state, { open: true, name: domain.name, description: domain.description ?? "", editing: slug, first: false, saving: false, error: null });
  render();
  root.querySelector("#new-domain-description")?.focus();
}

function close() {
  if (state.first) return; // nothing behind it to go back to
  state.open = false;
  render();
}

const post = (path, body) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function submit() {
  if (state.saving) return;
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
  if (state.editing) {
    card.append(el("div", "lbl", "Edit domain"));
    const name = el("input");
    name.id = "new-domain-name";
    name.maxLength = 80;
    name.value = state.name;
    name.disabled = state.saving;
    name.setAttribute("aria-label", "Name");
    name.addEventListener("input", () => (state.name = name.value));
    name.addEventListener("keydown", keys);
    card.append(name, el("p", "help", "The description is what the cartographer, the Keeper, and the mentor read about why you chart this. Islands already drawn stay as they are; ask the cartographer for changes."));
  } else if (state.first) {
    card.append(islandsArt(), el("div", "lbl", "Archipelago"), el("h1", "title", "What do you want to chart?"));
    card.append(el("p", "help", "Say it your way: the subject, where you come from, what it is for. The cartographer names the domain and sketches it as islands; you approve the sketch, then the Keeper asks about each island and the map fills in."));
  } else {
    card.append(el("div", "lbl", "New domain"), el("p", "help", "What do you want to chart, and why? Say it your way: the subject, where you come from, what it is for. The cartographer names the domain and sketches its islands; you approve both."));
  }
  const description = el("textarea");
  description.id = "new-domain-description";
  description.rows = 4;
  description.maxLength = DESCRIPTION_MAX;
  description.placeholder = "e.g. React Native, coming from ten years of iOS (UIKit and SwiftUI); I have an interview soon.";
  description.value = state.description;
  description.disabled = state.saving;
  description.setAttribute("aria-label", "Description");
  description.addEventListener("input", () => (state.description = description.value));
  description.addEventListener("keydown", keys);
  card.append(description);
  if (!state.editing) {
    const examples = el("div", "examples");
    examples.append(el("span", "ex-lbl", "or start from"));
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
  const make = el("button", "btn", state.saving ? (state.editing ? "Saving…" : "Creating…") : state.editing ? "Save" : "Create and sketch");
  make.type = "submit";
  make.disabled = state.saving;
  const cancel = el("button", "btn ghost", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", close);
  row.append(make);
  if (!state.first) row.append(cancel);
  row.append(el("span", "hint", "⌘↵"));
  card.append(row);
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
    label.textContent = state === "open" ? "open water" : state;
    g.append(label);
    svg.append(g);
  });
  return svg;
}
