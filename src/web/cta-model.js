// Pure, DOM-free: what the bottom card says for a model from card.js, as plain data. cta.js draws it, and redraws
// only when this changes.
import { sketchSummary } from "./chart-model.js";
import { t } from "./i18n.js";

/**
 * Which card shows, if any: a reef to confirm, then a sketch to approve, then where to sail next, the hand-off to
 * the Keeper, or where to begin. Nothing while a turn is in flight.
 */
export function ctaKind({ island, pendingReef, verdict, inFlight, stay, nearest, handoff, sketch, start }) {
  if (inFlight) return null;
  if (island && pendingReef) return "reef";
  if (sketch) return "sketch"; // a map action too: it waits on the map, island pane or not, behind only a reef
  if (island && verdict && !stay && nearest) return "next";
  if (island && handoff) return "handoff";
  if (!island && start) return "start";
  return null;
}

/**
 * The card as data, or null: `{ kind, label, text, buttons }`. A button is `{ id, label, tone, key?, tip?, disabled? }`:
 * `tone` is "primary" (the card's one filled action, in the lamp), "mentor" (filled in the mentor's colour),
 * "danger" (the reef's outline) or "ghost"; `key` is the key that presses it from the map; `tip` says what it does.
 * At most one button of a card is filled.
 */
export function ctaView(model) {
  const kind = ctaKind(model);
  if (!kind) return null;
  if (kind === "reef") {
    const disabled = Boolean(model.answering);
    return {
      kind,
      label: t("cta.reefLabel"),
      text: model.pendingReef.proposal.claim,
      buttons: [
        { id: "confirm", label: t("cta.confirmReef"), tone: "danger", key: "c", tip: t("cta.confirmTip"), disabled },
        { id: "dispute", label: t("cta.disputeBelow"), tone: "ghost", key: "d", tip: t("cta.disputeTip"), disabled },
      ],
    };
  }
  if (kind === "sketch") {
    const buttons = [{ id: "approve", label: t("cta.approveSketch"), tone: "primary", key: "⌘↵", tip: t("cta.approveTip") }];
    if (!model.chartOpen) buttons.push({ id: "read", label: t("cta.readIt"), tone: "ghost", key: "c", tip: t("cta.readTip") });
    return { kind, label: t("cta.sketchLabel"), text: t("cta.sketchDrew", { summary: sketchSummary(model.sketch.body) }), buttons };
  }
  if (kind === "next") {
    return {
      kind,
      label: t("cta.chartedLabel"),
      text: null,
      buttons: [
        { id: "sail", label: t("cta.sailTo", { name: model.nearest.name }), tone: "primary", key: "s", tip: t("cta.sailTip") },
        { id: "stay", label: t("cta.stayHere"), tone: "ghost" },
      ],
    };
  }
  if (kind === "handoff") {
    // every landmark explored: the mentor's work here is done, and the Keeper can chart it
    return { kind, label: t("cta.exploredLabel"), text: null, buttons: [{ id: "handoff", label: t("cta.chartWithKeeper"), tone: "primary", key: "m", tip: t("cta.handoffTip") }] };
  }
  const { start } = model;
  return {
    kind,
    label: t("cta.startLabel"),
    text: t(start.harbour ? "cta.startHarbour" : "cta.startAt", { name: start.name }),
    buttons: [
      { id: "mentor", label: t("cta.startMentor"), tone: "mentor", key: "1", tip: t("cta.mentorTip") },
      { id: "keeper", label: t("cta.startKeeper"), tone: "ghost", key: "2", tip: t("cta.keeperTip") },
    ],
  };
}

/** What a button does, as the name of the model's handler and its arguments. */
export function ctaAction(model, id) {
  switch (id) {
    case "confirm": return ["onConfirm"];
    case "dispute": return ["onDispute"];
    case "approve": return ["onApproveSketch", model.sketch?.id];
    case "read": return ["onOpenChart"];
    case "sail": return ["onSail", model.nearest?.slug];
    case "stay": return ["onStay"];
    case "handoff": return ["onHandoff"];
    case "mentor": return ["onStart", model.start?.slug, "mentor"];
    case "keeper": return ["onStart", model.start?.slug, "judge"];
    default: return null;
  }
}
