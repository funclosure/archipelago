// Toasts: one short line that something happened (copied, exported) or went wrong, at the foot of the map; it leaves by
// itself. The page's replacement for alert(): nothing blocks, and an error says what to do next.
import { toastMs, pushToast, failureKind } from "./toast-model.js";
import { icon } from "./icons.js";
import { t } from "./i18n.js";

let root = null;
let list = []; // { id, text, kind, action, el, timer }
let seq = 0;

function ensure() {
  if (root) return root;
  root = document.createElement("div");
  root.className = "toasts";
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", t("toast.region"));
  document.body.append(root);
  return root;
}

function drop(id) {
  const item = list.find((x) => x.id === id);
  if (!item) return;
  clearTimeout(item.timer);
  item.el.remove();
  list = list.filter((x) => x.id !== id);
}

/**
 * Shows a toast. `kind` is "info" or "error"; `action` is `{ label, run }`, one button (Undo, Retry). Returns a
 * function that takes it away early.
 */
export function toast(text, { kind = "info", action = null } = {}) {
  const host = ensure();
  const id = ++seq;
  const el = document.createElement("div");
  el.className = "toast arrive";
  el.dataset.kind = kind; // not a class: `.error` is already the page's red small print
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  if (kind === "error") el.append(icon("info"));
  const words = document.createElement("span");
  words.className = "toast-text";
  words.textContent = text;
  el.append(words);
  if (action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn sm ghost";
    b.textContent = action.label;
    b.addEventListener("click", () => {
      drop(id);
      action.run();
    });
    el.append(b);
  }
  const x = document.createElement("button");
  x.type = "button";
  x.className = "btn sm quiet icon";
  x.setAttribute("aria-label", t("toast.dismiss"));
  x.append(icon("close", { size: 12 }));
  x.addEventListener("click", () => drop(id));
  el.append(x);

  const item = { id, text, kind, action, el, timer: 0 };
  const next = pushToast(list, item);
  for (const old of list) if (!next.includes(old)) drop(old.id);
  list = next;
  host.append(el);
  const ms = toastMs(text, { kind, action: Boolean(action) });
  const arm = () => { item.timer = setTimeout(() => drop(id), ms); };
  el.addEventListener("pointerenter", () => clearTimeout(item.timer)); // it waits while it is being read
  el.addEventListener("pointerleave", arm);
  arm();
  return () => drop(id);
}

/** A failure as a toast, in plain words: what went wrong and what to try. `what` names the thing that failed ("Export"), already translated. */
export function toastError(error, what) {
  const kind = failureKind(error);
  const said = kind === "offline" ? t("toast.offline") : kind === "busy" ? t("toast.busy") : String(error?.message ?? error ?? t("toast.failed"));
  return toast(what ? t("toast.whatFailed", { what, why: said }) : said, { kind: "error" });
}
