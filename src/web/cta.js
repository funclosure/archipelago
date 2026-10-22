import { sketchSummary } from "./chart-model.js";
import { t } from "./i18n.js";
// The call-to-action card at the bottom centre of the map: actions about the map, never knowledge questions.
// card.js hands it a model each render; it keeps no state of its own.

const el = (tag, className, text) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

function button(label, onClick, className = "") {
  const b = el("button", className, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/** Renders the card into #cta from the model, or hides it when there is nothing to do. */
export function renderCta(model) {
  const wrap = document.getElementById("cta");
  if (!wrap) return;
  const { island, pendingReef, verdict, inFlight, answering, stay, nearest, handoff, sketch } = model;
  const showReef = island && pendingReef && !inFlight;
  // A pending sketch is a map action too: it waits on the map, island pane or not, behind only a reef.
  const showSketch = sketch && !inFlight && !showReef;
  const showNext = island && verdict && !inFlight && !pendingReef && !stay && nearest && !showSketch;
  const showHandoff = island && handoff && !inFlight && !showSketch;
  wrap.replaceChildren();
  if (!showReef && !showSketch && !showNext && !showHandoff) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const card = el("div", "cta-card");
  if (showReef) {
    card.append(el("div", "lbl", t("cta.reefLabel")), el("div", "q", pendingReef.proposal.claim));
    const row = el("div", "row");
    const confirm = button(t("cta.confirmReef"), model.onConfirm, "reefy");
    const dispute = button(t("cta.disputeBelow"), model.onDispute);
    confirm.disabled = dispute.disabled = Boolean(answering);
    row.append(confirm, dispute);
    card.append(row);
  } else if (showSketch) {
    card.append(el("div", "lbl", t("cta.sketchLabel")), el("div", "q", t("cta.sketchDrew", { summary: sketchSummary(sketch.body) })));
    const row = el("div", "row");
    row.append(button(t("cta.approveSketch"), () => model.onApproveSketch(sketch.id), "primary"));
    if (!model.chartOpen) row.append(button(t("cta.readIt"), model.onOpenChart));
    card.append(row);
  } else if (showNext) {
    card.append(el("div", "lbl", t("cta.chartedLabel")));
    const row = el("div", "row");
    row.append(button(t("cta.sailTo", { name: nearest.name }), () => model.onSail(nearest.slug), "primary"), button(t("cta.stayHere"), model.onStay));
    card.append(row);
  } else {
    // every landmark explored: the mentor's work here is done, and the Keeper can chart it
    card.append(el("div", "lbl", t("cta.exploredLabel")));
    const row = el("div", "row");
    row.append(button(t("cta.chartWithJudge"), model.onHandoff, "primary"));
    card.append(row);
  }
  wrap.append(card);
}
