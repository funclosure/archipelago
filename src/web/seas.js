// The reader's seas on the map: naming one where they double-click the water, renaming, moving, and removing.
// Every write goes to POST /api/seas; the snapshot brings the seas back. Pure parts live in sea-model.js.
import { app, api, refresh } from "./app.js";
import { t } from "./i18n.js";

/** Mirrors SEA_NAME_MAX in src/core/validators.ts. */
export const SEA_NAME_MAX = 40;

let editor = null; // { input, sea, at }
let removeButton = null;

async function write(body) {
  await api("/api/seas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: app.domain, ...body }) });
  app.version = null; // the next refresh redraws from the stored seas
  await refresh();
}

/** At a scale inside an island the seas are its islets'; at the top there is no island. */
const scale = () => (app.scale ? { island: app.scale } : {});

export function seaEditing() {
  return editor !== null;
}

/**
 * An input on the water: `sea` to rename one, or `at` (a world point) to name a new one there. Enter keeps it,
 * Escape drops it, clicking away keeps it. Renaming a sea to nothing removes it.
 */
export function openSeaEditor({ sea = null, at = null }) {
  closeSeaEditor(false);
  const input = document.createElement("input");
  input.className = "sea-edit";
  input.id = "sea-name";
  input.maxLength = SEA_NAME_MAX;
  input.placeholder = t("seas.placeholder");
  input.setAttribute("aria-label", sea ? t("seas.rename", { name: sea.name }) : t("seas.nameHere"));
  input.value = sea ? sea.name : "";
  const w = sea ?? at;
  const c = app.camera.state;
  input.style.left = `${w.x * c.scale + c.x}px`;
  input.style.top = `${w.y * c.scale + c.y}px`;
  document.body.append(input);
  editor = { input, sea, at };
  input.focus();
  input.select();
  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // the field owns its keys; the page's shortcuts stay quiet
    if (e.key === "Enter") {
      e.preventDefault();
      closeSeaEditor(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSeaEditor(false);
    }
  });
  input.addEventListener("blur", () => closeSeaEditor(true));
}

function closeSeaEditor(commit) {
  if (!editor) return;
  const { input, sea, at } = editor;
  editor = null;
  const name = input.value.trim();
  input.remove();
  if (!commit) return;
  const done = sea
    ? name
      ? name !== sea.name && write({ op: "update", id: sea.id, name })
      : removeSeaById(sea.id)
    : name && write({ op: "add", ...scale(), name, x: at.x, y: at.y }).then(() => {
        const made = app.seas.find((s) => s.name === name && Math.abs(s.x - at.x) < 1 && Math.abs(s.y - at.y) < 1);
        if (made) app.selectedSea = made.id;
      });
  Promise.resolve(done).catch((error) => console.error(error));
}

/** Saves where a dragged sea now sits. */
export function saveSeaPosition(sea) {
  return write({ op: "update", id: sea.id, x: sea.x, y: sea.y }).catch((error) => console.error(error));
}

export function removeSeaById(id) {
  if (app.selectedSea === id) app.selectedSea = null;
  app.seas = app.seas.filter((s) => s.id !== id); // gone at once; the write confirms it
  return write({ op: "remove", id }).catch((error) => console.error(error));
}

/** The "Remove sea" button under a selected sea's name; placed every frame by app.js. */
export function placeRemoveButton(box) {
  if (!removeButton) {
    removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "sea-remove";
    removeButton.textContent = t("seas.remove");
    removeButton.addEventListener("click", () => app.selectedSea !== null && void removeSeaById(app.selectedSea));
    document.body.append(removeButton);
  }
  removeButton.hidden = !box || editor !== null;
  if (!box) return;
  const c = app.camera.state;
  removeButton.style.left = `${((box.x0 + box.x1) / 2) * c.scale + c.x}px`;
  removeButton.style.top = `${box.y1 * c.scale + c.y + 8}px`;
}
