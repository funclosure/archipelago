// "About you": the one learner note the mentor reads every turn, in every domain. Opened from the outline's domain menu.
// A dialog of the family (dialog.js): the shared shell, head, field and foot; Escape, Cancel, the close button and a
// press on the veil all ask to leave, and a changed note asks Discard / Keep editing first, as the board's editor does.
import { api } from "./app.js";
import { t } from "./i18n.js";
import { showDialog, redraw, rememberFocus, focusFirst, focusCard, dialogHead, dialogFoot, discardFoot, withKey, labelled } from "./dialog.js";
import { isDirty, leaveStep } from "./dialog-model.js";

/** Mirrors NOTE_MAX in src/core/validators.ts. */
export const NOTE_MAX = 1000;
/** The count shows from this share of the limit on: before that it is noise. */
const COUNT_FROM = 0.8;

const state = { open: false, draft: "", saving: false, error: null, loaded: false, confirming: false };
let origin = ""; // the note as it was read: leaving with other words asks first
let resume = null; // where the keyboard was when the Discard question came up
let root = null;
let loadGen = 0; // one per load; closing bumps it too, so a GET from an earlier opening can never overwrite newer typing

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label, onClick, className, key) {
  const b = el("button", className, label);
  b.type = "button";
  b.dataset.key = key;
  b.addEventListener("click", onClick);
  return b;
}

async function load() {
  const gen = ++loadGen;
  const stale = () => !state.open || gen !== loadGen;
  state.error = null;
  state.loaded = false;
  render();
  focusCard(root); // nothing to act on until the note is read
  try {
    const { note } = await api("/api/learner");
    if (stale()) return;
    state.draft = origin = note;
    state.loaded = true;
  } catch (error) {
    if (stale()) return;
    state.error = t("learner.readFailed", { error: error.message });
  }
  render();
  focusField();
}

/** The note, with the caret after what is there; when it could not be read, Retry. */
function focusField() {
  const field = root.querySelector("#about-note:not(:disabled)");
  if (!field) return void focusFirst(root);
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
}

export function openAbout() {
  if (!root) return;
  origin = "";
  Object.assign(state, { open: true, draft: "", saving: false, error: null, loaded: false, confirming: false });
  return load();
}

/** A request to leave, however it was made: a changed note asks before it is dropped. */
function leave() {
  const step = leaveStep({ busy: state.saving, confirming: state.confirming, dirty: state.loaded && isDirty(state.draft, origin) });
  if (step === "stay") return;
  if (step === "resume") return keepEditing();
  if (step === "ask") {
    resume = rememberFocus(root);
    state.confirming = true;
    render();
    focusFirst(root); // Discard: Enter discards, Escape goes back to editing
    return;
  }
  shut();
}

function shut() {
  Object.assign(state, { open: false, confirming: false });
  loadGen++;
  render();
}

function keepEditing() {
  state.confirming = false;
  render();
  if (!resume?.restore()) focusField();
  resume = null;
}

async function save() {
  if (state.saving || state.confirming || !state.loaded) return; // never post what was not loaded: it would erase the stored note
  if (!isDirty(state.draft, origin)) return shut(); // nothing to save
  state.saving = true;
  state.error = null;
  render();
  try {
    await api("/api/learner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note: state.draft }) });
    state.saving = false;
    shut();
  } catch (error) {
    state.saving = false;
    state.error = error.message;
    render();
    focusField(); // the reader's text stays, ready to retry
  }
}

function render() {
  if (!root) return;
  redraw(root, draw);
}

function draw() {
  root.hidden = !state.open;
  showDialog(root, state.open, { close: leave, submit: () => void save() });
  root.replaceChildren();
  if (!state.open) return;
  const card = el("div", "dialog-card about-card");
  card.append(dialogHead(t("learner.title"), leave, { id: "about-title" }), el("p", "help", t("learner.help")));
  const ta = el("textarea", "field");
  ta.id = "about-note";
  ta.rows = 6;
  ta.maxLength = NOTE_MAX;
  ta.value = state.draft;
  ta.disabled = !state.loaded || state.saving;
  ta.placeholder = state.loaded ? t("learner.placeholder") : state.error ? "" : t("learner.loading"); // while it is read, the field says so
  const count = el("span", "count");
  const tally = () => {
    count.textContent = `${state.draft.length} / ${NOTE_MAX}`;
    count.hidden = state.draft.length < NOTE_MAX * COUNT_FROM;
    count.classList.toggle("at-limit", state.draft.length >= NOTE_MAX);
  };
  tally();
  ta.addEventListener("input", () => {
    state.draft = ta.value;
    tally();
  });
  card.append(labelled(t("learner.note"), ta, count));
  if (state.error) card.append(el("p", "error", state.error));
  if (state.confirming) card.append(discardFoot(shut, keepEditing));
  else {
    const cancel = button(t("learner.cancel"), leave, "btn ghost", "cancel");
    if (!state.loaded && state.error) {
      // The note could not be read: the one thing to do is ask again.
      const retry = button(t("learner.retry"), () => void load(), "btn", "retry");
      retry.dataset.autofocus = "";
      card.append(dialogFoot([], [cancel, retry]));
    } else {
      const saveBtn = withKey(button(state.saving ? t("learner.saving") : t("learner.save"), () => void save(), "btn", "save"), "⌘↵");
      saveBtn.disabled = state.saving || !state.loaded;
      card.append(dialogFoot([], [cancel, saveBtn]));
    }
  }
  root.setAttribute("aria-labelledby", "about-title");
  root.append(card);
}

export function installAbout() {
  root = document.getElementById("about");
  render();
}
