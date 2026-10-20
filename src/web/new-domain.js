// "New domain…": one field, the name. The server makes the domain; the page opens it with ?chart=start,
// where the cartographer sketches its first islands. Works before the map has loaded (no domains yet).
import { api } from "./app.js";
import { registerRegion } from "./keys.js";

const state = { open: false, name: "", saving: false, error: null };
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
  Object.assign(state, { open: true, name: "", saving: false, error: null });
  render();
  root.querySelector("#new-domain-name")?.focus();
}

function close() {
  state.open = false;
  render();
}

async function create() {
  const name = state.name.trim();
  if (!name || state.saving) return;
  state.saving = true;
  state.error = null;
  render();
  try {
    const { domain } = await api("/api/domains", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("domain", domain.slug);
    url.searchParams.set("chart", "start");
    location.href = url.toString();
  } catch (error) {
    state.saving = false;
    state.error = error.message;
    render();
    root.querySelector("#new-domain-name")?.focus();
  }
}

function render() {
  if (!root) return;
  root.hidden = !state.open;
  root.replaceChildren();
  if (!state.open) return;
  const card = el("form", "new-domain-card");
  card.append(el("div", "lbl", "New domain"), el("p", "help", "Name what you want to chart, the way you would say it: System Design, Swift Concurrency, Wine. The cartographer sketches its islands next, and you approve the sketch."));
  const input = el("input");
  input.id = "new-domain-name";
  input.placeholder = "System Design";
  input.maxLength = 80;
  input.value = state.name;
  input.disabled = state.saving;
  input.addEventListener("input", () => (state.name = input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
  card.append(input);
  if (state.error) card.append(el("p", "error", state.error));
  const row = el("div", "row");
  const make = el("button", "btn", state.saving ? "Creating…" : "Create and sketch");
  make.type = "submit";
  make.disabled = state.saving;
  const cancel = el("button", "btn ghost", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", close);
  row.append(make, cancel);
  card.append(row);
  card.addEventListener("submit", (e) => {
    e.preventDefault();
    void create();
  });
  root.append(card);
}
