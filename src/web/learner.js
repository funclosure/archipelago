// "About you": the one learner note the mentor reads every turn, in every domain. Opened from the outline's domain menu.
import { api } from "./app.js";
import { registerRegion } from "./keys.js";

/** Mirrors NOTE_MAX in src/core/validators.ts. */
export const NOTE_MAX = 1000;

const state = { open: false, draft: "", saving: false, error: null };
let root = null;

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label, onClick, className) {
  const b = el("button", className, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

export async function openAbout() {
  if (!root) return;
  Object.assign(state, { open: true, draft: "", saving: false, error: null });
  render();
  try {
    const { note } = await api("/api/learner");
    if (!state.open) return;
    state.draft = note;
  } catch (error) {
    state.error = `could not read the note: ${error.message}`;
  }
  render();
  root.querySelector("#about-note")?.focus();
}

function close() {
  state.open = false;
  render();
}

async function save() {
  if (state.saving) return;
  state.saving = true;
  state.error = null;
  render();
  try {
    await api("/api/learner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note: state.draft }) });
    state.saving = false;
    close();
  } catch (error) {
    state.saving = false;
    state.error = error.message;
    render();
  }
}

function render() {
  if (!root) return;
  root.hidden = !state.open;
  root.replaceChildren();
  if (!state.open) return;
  const card = el("div", "about-card");
  card.append(el("div", "lbl", "About you"));
  card.append(el("p", "help", "The mentor reads this every turn to choose analogies from what you already know: your work, the languages you think in, how you like to learn. The Keeper never sees it. One note for every domain."));
  const ta = el("textarea");
  ta.id = "about-note";
  ta.rows = 6;
  ta.maxLength = NOTE_MAX;
  ta.value = state.draft;
  ta.placeholder = "e.g. iOS engineer, ten years of UIKit; I learn best from code";
  const count = el("div", "count", `${state.draft.length} / ${NOTE_MAX}`);
  ta.addEventListener("input", () => {
    state.draft = ta.value;
    count.textContent = `${ta.value.length} / ${NOTE_MAX}`;
  });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      void save();
    }
  });
  const row = el("div", "row");
  const saveBtn = button(state.saving ? "Saving…" : "Save", () => void save(), "btn");
  saveBtn.disabled = state.saving;
  row.append(saveBtn, button("Cancel", close, "btn ghost"));
  card.append(ta, count, row);
  if (state.error) card.append(el("div", "error", state.error));
  root.append(card);
}

export function installAbout() {
  root = document.getElementById("about");
  // Not a focus region: keys.js asks it only whether it is open, and closes it on Escape.
  registerRegion("about", { isOpen: () => state.open, close });
  render();
}
