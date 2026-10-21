// "New domain…": the name, and an optional angle (where the reader charts it from and why). The server makes the
// domain; the page opens it with ?chart=start, where the cartographer sketches its first islands to that angle.
// Works before the map has loaded (no domains yet). "Angle…" in the domain menu reopens the angle alone.
import { api } from "./app.js";
import { registerRegion } from "./keys.js";

/** Mirrors ANGLE_MAX in src/core/validators.ts. */
export const ANGLE_MAX = 500;

/** `editing`: null for a new domain, else the slug and name of the domain whose angle is open. */
const state = { open: false, name: "", angle: "", editing: null, saving: false, error: null };
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

export function openNewDomain() {
  if (!root) return;
  Object.assign(state, { open: true, name: "", angle: "", editing: null, saving: false, error: null });
  render();
  root.querySelector("#new-domain-name")?.focus();
}

/** The angle of an existing domain, read fresh so a change made in the terminal shows. */
export async function openAngle(slug) {
  if (!root) return;
  const { domains } = await api("/api/domains");
  const domain = domains.find((d) => d.slug === slug);
  if (!domain) return;
  Object.assign(state, { open: true, name: domain.name, angle: domain.angle ?? "", editing: { slug, name: domain.name }, saving: false, error: null });
  render();
  root.querySelector("#new-domain-angle")?.focus();
}

function close() {
  state.open = false;
  render();
}

const post = (path, body) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function submit() {
  if (state.saving) return;
  const name = state.name.trim();
  if (!state.editing && !name) return;
  state.saving = true;
  state.error = null;
  render();
  try {
    if (state.editing) {
      await post("/api/domains/angle", { domain: state.editing.slug, angle: state.angle });
      close();
      return;
    }
    const { domain } = await post("/api/domains", { name, angle: state.angle });
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("domain", domain.slug);
    url.searchParams.set("chart", "start");
    location.href = url.toString();
  } catch (error) {
    state.saving = false;
    state.error = error.message;
    render();
    root.querySelector(state.editing ? "#new-domain-angle" : "#new-domain-name")?.focus();
  }
}

function render() {
  if (!root) return;
  root.hidden = !state.open;
  root.replaceChildren();
  if (!state.open) return;
  const card = el("form", "new-domain-card");
  const escape = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  if (state.editing) {
    card.append(el("div", "lbl", `Angle · ${state.editing.name}`), el("p", "help", "Where you chart this from and why. The cartographer sketches to it, the Keeper pitches its questions to it, and the mentor picks examples from it. Islands already drawn stay as they are; ask the cartographer for changes."));
  } else {
    card.append(el("div", "lbl", "New domain"), el("p", "help", "Name what you want to chart, the way you would say it: System Design, Swift Concurrency, Wine. The cartographer sketches its islands next, and you approve the sketch."));
    const input = el("input");
    input.id = "new-domain-name";
    input.placeholder = "React Native";
    input.maxLength = 80;
    input.value = state.name;
    input.disabled = state.saving;
    input.addEventListener("input", () => (state.name = input.value));
    input.addEventListener("keydown", escape);
    card.append(input, el("label", "sub-lbl", "Your angle (optional)"));
  }
  const angle = el("textarea");
  angle.id = "new-domain-angle";
  angle.rows = 3;
  angle.maxLength = ANGLE_MAX;
  angle.placeholder = "e.g. I'm a senior iOS engineer; map it from what I already know, for an interview.";
  angle.value = state.angle;
  angle.disabled = state.saving;
  angle.addEventListener("input", () => (state.angle = angle.value));
  angle.addEventListener("keydown", (e) => {
    escape(e);
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  });
  card.append(angle);
  if (state.error) card.append(el("p", "error", state.error));
  const row = el("div", "row");
  const make = el("button", "btn", state.saving ? (state.editing ? "Saving…" : "Creating…") : state.editing ? "Save" : "Create and sketch");
  make.type = "submit";
  make.disabled = state.saving;
  const cancel = el("button", "btn ghost", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", close);
  row.append(make, cancel);
  card.append(row);
  card.addEventListener("submit", (e) => {
    e.preventDefault();
    void submit();
  });
  root.append(card);
}
