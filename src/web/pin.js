// "Pin to board" on a persona's fence (a diagram, code, or a demo): the reader keeps it as their own board card,
// marked as pinned from that reply. `pin` comes from card.js: { add(card) → Promise, has(body) → bool }.
import { t } from "./i18n.js";

/** The button for one fence; `card` is { kind, body, lang? }. Already on the board, it says so and does nothing. */
export function pinButton(pin, card) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "pin";
  const done = () => {
    b.textContent = t("pin.pinned");
    b.disabled = true;
  };
  if (pin.has(card.body)) {
    done();
    return b;
  }
  b.textContent = t("pin.pin");
  b.title = t("pin.title");
  b.addEventListener("click", () => {
    b.disabled = true;
    b.textContent = t("pin.pinning");
    pin.add(card).then(done, (error) => {
      b.disabled = false;
      b.textContent = t("pin.pin");
      b.title = String(error && error.message ? error.message : error);
    });
  });
  return b;
}
