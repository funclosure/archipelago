// "Pin to board" on a persona's fence (a diagram, code, or a demo): the reader keeps it as their own board card,
// marked as pinned from that reply. `pin` comes from card.js: { add(card) → Promise, has(body) → bool }.
import { t } from "./i18n.js";
import { icon } from "./icons.js";
import { tip } from "./tip.js";
import { toastError } from "./toast.js";

const buttons = new Set(); // every pin button made, so a board change can redraw them where they stand

/** Redraws every pin button on the page from the board as it is now (a reply's element is kept across renders). */
export function syncPins() {
  for (const entry of buttons) {
    if (!entry.b.isConnected) {
      if (entry.left) buttons.delete(entry); // a button not appended yet gets one beat
      else entry.left = true;
    } else if (!entry.busy) entry.draw();
  }
}

/** The button for one fence; `card` is { kind, body, lang? }. Already on the board, it says so and does nothing. */
export function pinButton(pin, card) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn sm quiet pin";
  const entry = { b, busy: false, left: false, draw: () => {} };
  entry.draw = () => {
    const on = pin.has(card.body);
    // On the board it is a statement, not a command: a tick and the words, and nothing to press.
    b.replaceChildren(...(on ? [icon("check", { size: 12 })] : []), t(on ? "pin.pinned" : "pin.pin"));
    b.disabled = on;
    b.classList.toggle("on", on);
    if (on) delete b.dataset.tip;
    else tip(b, t("pin.title"));
  };
  entry.draw();
  b.addEventListener("click", () => {
    entry.busy = true;
    b.disabled = true;
    b.textContent = t("pin.pinning");
    pin.add(card).then(
      () => {
        entry.busy = false;
        entry.draw();
      },
      (error) => {
        entry.busy = false;
        entry.draw();
        toastError(error, t("pin.what"));
      },
    );
  });
  buttons.add(entry);
  return b;
}
