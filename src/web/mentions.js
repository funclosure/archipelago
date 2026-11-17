// The places a persona's reply names, linked quietly (`mention-model.js` finds them; markdown.js draws each as an
// `a.mention`). `app.places` is every domain and island the reader has (`GET /api/places`, read with every snapshot).
// A link to an island of this domain sails there in place; one to another domain loads it in this tab, leaving an
// address that names the open island so Back comes back to it.
import { app, setScale } from "./app.js";
import { select } from "./interactions.js";
import { mentionHref, mentionIndex, mentionSig } from "./mention-model.js";
import { t } from "./i18n.js";

/** The tip: where the place is, and what a click does. */
function describe(target) {
  if (target.kind === "domain") return t("mentions.domain", { domain: target.domainName });
  return target.near ? t("mentions.here") : t("mentions.there", { domain: target.domainName });
}

async function open(target, event) {
  // A modified click or another button is the browser's own: a new tab or window on the link's address.
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (target.kind === "island" && target.domain === app.domain) {
    if (target.scale !== app.scale) await setScale(target.scale);
    await select(target.slug);
    return;
  }
  if (app.selected) {
    const here = new URL(location.href);
    here.searchParams.set("island", app.selected);
    history.replaceState(null, "", here);
  }
  location.href = mentionHref(target);
}

let cached = { places: undefined, key: "", value: null };

/**
 * What `renderMarkdown(…, { mentions })` takes for a reply read on `island` (null in the cartographer's or the
 * guide's pane), with `sig` for the caller's own sig; null until the places are read.
 */
export function mentionsFor(island) {
  if (!app.places || !app.domain) return null;
  const key = `${app.domain}/${island ?? ""}`;
  if (cached.places !== app.places || cached.key !== key) {
    const index = mentionIndex(app.places, { domain: app.domain, island });
    cached = { places: app.places, key, value: { index, sig: mentionSig(index), href: mentionHref, describe, open } };
  }
  return cached.value;
}
