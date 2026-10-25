// The landing page's script: puts every `data-t` text in the reader's language (strings/about.js), switches the
// language like the domain menu does (stored, then a reload), and gives each command block a Copy button. The page
// reads in English without it.
import { t, language, setLanguage } from "./i18n.js";

/** The element's text in the page's language; a `{name}` placeholder keeps the child marked `data-slot="name"`. */
function fill(el) {
  const text = t(el.dataset.t);
  const slots = new Map([...el.querySelectorAll("[data-slot]")].map((s) => [s.dataset.slot, s]));
  if (slots.size === 0) {
    el.textContent = text;
    return;
  }
  const parts = text.split(/\{(\w+)\}/);
  el.replaceChildren(...parts.map((part, i) => (i % 2 === 1 && slots.has(part) ? slots.get(part) : part)));
}

function copyButton(pre) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy";
  button.textContent = t("about.copy");
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(pre.querySelector("code").textContent);
      button.textContent = t("about.copied");
      setTimeout(() => (button.textContent = t("about.copy")), 1500);
    } catch {
      // clipboard refused: the text is there to select
    }
  });
  pre.append(button);
}

if (language() !== "en") for (const el of document.querySelectorAll("[data-t]")) fill(el);
document.getElementById("lang").addEventListener("click", () => {
  setLanguage(language() === "en" ? "zh-TW" : "en");
  location.reload();
});
for (const pre of document.querySelectorAll("pre.cmd")) copyButton(pre);
document.body.classList.add("ready");
