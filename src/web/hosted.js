// What only the hosted build shows: the welcome screen (a key, Try without a key, or an import), Your key, export
// and import of the database, and the hand-over when another tab holds the database. The worker keeps the keys,
// one per provider (`src/hosted/settings.ts`); this page sends a key once and reads back only its last four characters.
// Its dialogs are of the family (dialog.js): the shared shell, head, fields and foot. The welcome gate and the
// take-over notice are whole pages with no way out but their own buttons; Your key and the import question close on
// Escape, the close button and a press on the veil.
import { request, release } from "./transport.js";
import { t } from "./i18n.js";
import { amountOf, PAID_CHECKS_MS } from "./credit-model.js";
import { toast, toastError } from "./toast.js";
import { showDialog, redraw, focusFirst, dialogHead, dialogFoot, labelled } from "./dialog.js";

export const isHosted = () => globalThis.ARCHIPELAGO_HOSTED === true;

/** `open`: null, "welcome" (no way out but a choice), "key" (Your key), "import" (the replace warning), "elsewhere". */
const state = { open: null, view: null, provider: null, key: "", model: null, remember: true, saving: false, error: null, file: null, credit: null, buying: false, thanks: null, switching: false, tokenField: false, moreOpen: false, buyError: null };
let root = null;
let started = null; // resolves the welcome gate

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A button of the family. `key` names it across redraws, so focus on it survives one (dialog.js). */
function button(label, onClick, className = "btn", key = null) {
  const b = el("button", className, label);
  b.type = "button";
  if (key) b.dataset.key = key;
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

async function call(path, init) {
  const res = await request(path, init);
  if (res.ok) return res;
  const body = await res.json().catch(() => ({}));
  throw new Error(body.error || res.statusText);
}

// A settings write may change the model the personas answer on: the panes re-read it on this event.
const post = (path, body) =>
  call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json())
    .finally(() => document.dispatchEvent(new Event("settings")));

/** Ask the browser not to clear this site's storage under pressure. Chrome decides on its own; Firefox may ask. */
function persist() {
  void navigator.storage?.persist?.().catch(() => {});
}

export function installHosted() {
  root = document.getElementById("hosted");
  // A tab that asks to take over gets the database: this one lets its worker go and says where Archipelago went.
  if (isHosted() && typeof BroadcastChannel === "function") {
    new BroadcastChannel("archipelago").addEventListener("message", (event) => {
      if (event.data !== "takeover") return;
      release(t("hosted.movedReason"));
      open("elsewhere");
    });
  }
}

/**
 * Before the map: resolves at once when a key is set or the reader chose Try without a key; otherwise shows the
 * welcome screen and resolves when they choose. Locally there is nothing to ask.
 */
export async function welcomeGate() {
  if (!isHosted()) return;
  root ??= document.getElementById("hosted");
  state.view = await (await call("/hosted/settings")).json();
  if (backFromCheckout()) setTimeout(thank, 0);
  if (state.view.key || state.view.stub || state.view.free) return; // free: our own server answers, no key to ask for
  open("welcome");
  await new Promise((resolve) => (started = resolve));
}

export function openYourKey() {
  void Promise.all([call("/hosted/settings").then((r) => r.json()), readCredit()])
    .then(([view, credit]) => {
      state.view = view;
      state.credit = credit;
      open("key");
      // Back from paying with the payment already here: the thank-you says so at once.
      if (state.thanks === "waiting" && hasGrown(credit)) {
        state.thanks = "added";
        render();
      }
    })
    .catch((error) => toastError(error));
}

/** This browser's credit on our own server; null where there is none to show. */
async function readCredit() {
  try {
    return await (await call("/hosted/credit")).json();
  } catch {
    return null;
  }
}

const BEFORE_KEY = "credit:before"; // the balance as the reader left for the checkout, to tell when the payment has arrived
function balanceBefore() {
  try {
    const raw = sessionStorage.getItem(BEFORE_KEY);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}
/** Whether `credit` holds more than when the reader left to pay. */
const hasGrown = (credit) => typeof credit?.balanceUsd === "number" && balanceBefore() !== null && credit.balanceUsd > balanceBefore();

/** The parameter Polar appends to the checkout's way back. */
const CHECKOUT_TOKEN_PARAM = "customer_session_token";

/** True once, when the page was opened by the checkout's way back (`?credit=added`); the mark is taken off the address. */
function backFromCheckout() {
  const url = new URL(location.href);
  const back = url.searchParams.get("credit") === "added";
  // Polar adds a session token for its customer portal to the way back. The page has no use for it, and it is a
  // credential for the buyer's Polar account, so it never stays in the address bar, the history, or a copied link.
  const token = url.searchParams.has(CHECKOUT_TOKEN_PARAM);
  if (!back && !token) return false;
  url.searchParams.delete("credit");
  url.searchParams.delete(CHECKOUT_TOKEN_PARAM);
  history.replaceState(null, "", url);
  return back;
}

/** Back from paying: Your key opens with a thank-you, and the balance is read again until the payment has reached us. */
function thank() {
  state.thanks = "waiting";
  openYourKey();
  for (const wait of PAID_CHECKS_MS) {
    setTimeout(async () => {
      if (state.thanks !== "waiting") return;
      const credit = await readCredit();
      if (!credit || !(hasGrown(credit) || (balanceBefore() === null && credit.balanceUsd !== state.credit?.balanceUsd))) return;
      state.credit = credit;
      state.thanks = "added";
      document.dispatchEvent(new Event("settings")); // the pane's foot shows the balance too
      if (state.open === "key") render();
    }, wait);
  }
}

/** Opens the payment provider's checkout for one pack, in this tab; the way back is `?credit=added`. */
async function buy(pack) {
  if (state.buying) return;
  state.buying = true;
  state.error = null;
  state.buyError = null;
  render();
  try {
    const { url } = await (await call("/hosted/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pack }) })).json();
    try {
      sessionStorage.setItem(BEFORE_KEY, String(state.credit?.balanceUsd ?? 0));
    } catch {}
    location.href = url;
  } catch (error) {
    state.buying = false;
    state.buyError = error.message; // said under the packs it concerns, not over the form's foot
    render();
  }
}

function open(kind) {
  Object.assign(state, { open: kind, key: "", provider: state.view?.provider ?? null, model: state.view?.model ?? null, remember: state.view?.remember ?? true, saving: false, error: null, buyError: null, switching: false, tokenField: false, moreOpen: false });
  render();
  // Focus goes to what is chosen (the provider, else the model), never the first field: on the first one it reads
  // as if that were the choice. The import question starts on Cancel, the take-over notice on Reload.
  focusFirst(root);
}

function close() {
  state.open = null;
  state.thanks = null;
  render();
}

/** A request to leave (Escape, the close button, a press on the veil). The welcome gate and the take-over notice have no way out but their own buttons. */
function leave() {
  if (state.saving || state.open === "welcome" || state.open === "elsewhere") return;
  if (state.open === "import" && state.from === "welcome") return open("welcome"); // back to the gate it came from
  close();
}

/** The provider the form shows: the one picked there, else the saved one. */
const providerNow = () => state.view?.providers?.find((p) => p.id === state.provider) ?? state.view?.providers?.[0];

/**
 * Picking a provider shows its own key hint and the model last picked for it. Picked with the pointer (`toField`),
 * the keyboard moves on to the key field; picked with the arrow keys it stays on the switch, so they keep working.
 */
function pickProvider(id, { toField = true } = {}) {
  const p = state.view.providers.find((x) => x.id === id);
  Object.assign(state, { provider: id, key: "", model: state.view.models?.[id] ?? p.models[0]?.id ?? "", error: null });
  render();
  if (toField) (root.querySelector("#hosted-key") ?? root.querySelector(".providers input:checked"))?.focus();
}

async function saveKey({ stub = false } = {}) {
  if (state.saving) return;
  const patch = { provider: state.provider, model: state.model, remember: state.remember };
  if (stub) patch.stub = true;
  else if (state.key.trim()) patch.apiKey = state.key.trim();
  else if (!state.view?.keyHints?.[state.provider] && !providerNow()?.proxy) {
    state.error = t("hosted.pasteKey");
    render();
    return void root.querySelector("#hosted-key")?.focus(); // the field that needs something
  }
  state.saving = true;
  state.error = null;
  render();
  try {
    state.view = await post("/hosted/settings", patch);
    persist();
    close();
    started?.();
    started = null;
  } catch (error) {
    state.saving = false;
    state.error = error.message;
    render();
  }
}

/** In the credit view a model is saved as it is picked: there is nothing else there to save. */
async function saveModel() {
  state.error = null;
  try {
    state.view = await post("/hosted/settings", { provider: state.provider, model: state.model, remember: state.remember });
  } catch (error) {
    state.error = error.message;
    render();
  }
}

async function forgetKey() {
  try {
    state.view = await post("/hosted/settings", { provider: state.provider, apiKey: null, stub: true });
    close();
  } catch (error) {
    state.error = error.message;
    render();
  }
}

/** Downloads the whole database as archipelago-YYYY-MM-DD.sqlite: the file the local tool opens too. */
export async function exportDatabase() {
  try {
    const res = await call("/hosted/export");
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "archipelago.sqlite";
    const url = URL.createObjectURL(await res.blob());
    const a = el("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (error) {
    toast(t("hosted.exportFailed", { message: error.message }), { kind: "error" });
  }
}

/** Picks a .sqlite file, then asks before it replaces everything in this browser. */
export function importDatabase() {
  const input = el("input");
  input.type = "file";
  input.accept = ".sqlite,.db,application/vnd.sqlite3,application/x-sqlite3";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    const from = state.open === "welcome" ? "welcome" : null;
    Object.assign(state, { open: "import", file, from, saving: false, error: null });
    render();
    focusFirst(root); // Cancel: the safe answer has the keyboard
  });
  input.click();
}

async function replaceWith(file) {
  state.saving = true;
  state.error = null;
  render();
  try {
    await call("/hosted/import", { method: "POST", headers: { "content-type": "application/vnd.sqlite3" }, body: await file.arrayBuffer() });
    // An imported chart needs no key to look at: the stub answers until one is set.
    if (!state.view?.key) await post("/hosted/settings", { stub: true });
    persist();
    location.replace(location.pathname);
  } catch (error) {
    state.saving = false;
    state.error = error.message;
    render();
  }
}

/** Shown in place of the map when another tab holds the database: one button moves it here. */
export function anotherTab(nav) {
  const take = el("button", "crumb start", t("hosted.useItHere"));
  take.type = "button";
  take.addEventListener("click", () => {
    take.disabled = true;
    new BroadcastChannel("archipelago").postMessage("takeover");
    setTimeout(() => location.reload(), 400); // the other tab's worker ends at once; its lock goes with it
  });
  nav.replaceChildren(t("hosted.openElsewhere"), take);
}

function render() {
  if (!root) return;
  redraw(root, draw);
}

function draw() {
  root.hidden = state.open === null;
  root.classList.toggle("welcome", state.open === "welcome" || state.open === "elsewhere"); // nothing behind it yet, or nothing to use
  // ⌘↵ is the key form's main action; the import question, which replaces everything, is never on a shortcut.
  showDialog(root, state.open !== null, { close: leave, submit: state.open === "welcome" || state.open === "key" ? () => root.querySelector("form.fields")?.requestSubmit() : null });
  root.replaceChildren();
  if (state.open === null) return;
  const card = el("div", "dialog-card hosted-card");
  root.setAttribute("aria-labelledby", "hosted-title");
  if (state.open === "welcome" || state.open === "key") renderKey(card);
  else if (state.open === "import") renderImport(card);
  else if (state.open === "elsewhere") {
    card.append(dialogHead("Archipelago", null, { id: "hosted-title" }), el("p", "help", t("hosted.movedHelp")));
    card.append(dialogFoot([], [button(t("hosted.reload"), () => location.reload(), "btn", "reload")]));
  }
  root.append(card);
}

/** A row of quiet buttons: the ways further in, under the form. */
function row(...children) {
  const r = el("div", "row");
  r.append(...children);
  return r;
}

/** A group's visible label (a switch, a list of radios), tied to the group by `aria-labelledby`. */
function groupLabel(group, id, text) {
  const label = el("div", "field-label", text);
  label.id = id;
  group.setAttribute("aria-labelledby", id);
  return label;
}

function renderKey(card) {
  const welcome = state.open === "welcome";
  const provider = providerNow();
  const keyHint = state.view?.keyHints?.[provider?.id];
  // On our own server the dialog starts as the credit and a model: providers and keys wait behind "Use my own key instead".
  const simple = !welcome && Boolean(provider?.proxy) && !state.switching;
  // Our own server needs nothing pasted: its field shows only to someone who says they were given a token.
  const showKey = !simple && (!provider?.proxy || state.tokenField);
  card.append(dialogHead(welcome ? "Archipelago" : simple ? t("hosted.yourCredit") : t("hosted.yourKey"), welcome ? null : leave, { id: "hosted-title" }));
  if (welcome) card.append(el("p", "lede", t("hosted.lede")));
  if (simple) card.append(creditEl());
  const form = el("form", "fields");

  // The provider switch: a segmented control of the family over a radio group, so the arrow keys move along it.
  const providers = el("div", "providers segs");
  providers.setAttribute("role", "radiogroup");
  let byPointer = false; // a pick made with the pointer moves on to the key field; one made with the arrow keys stays
  for (const p of state.view?.providers ?? []) {
    const label = el("label", `provider${p.id === provider?.id ? " on" : ""}`);
    const radio = el("input");
    radio.type = "radio";
    radio.name = "provider";
    radio.dataset.key = `provider:${p.id}`;
    radio.checked = p.id === provider?.id;
    radio.disabled = state.saving;
    label.addEventListener("pointerdown", () => (byPointer = true));
    radio.addEventListener("change", () => pickProvider(p.id, { toField: byPointer }));
    label.append(radio, p.name);
    if (state.view.keyHints?.[p.id]) label.append(el("span", "has-key", "•"));
    providers.append(label);
  }
  if (!simple) form.append(groupLabel(providers, "hosted-provider-label", t("hosted.providerLabel")), providers);
  // Among the providers, our own server's tab shows its credit where another's shows a key field.
  if (!simple && !welcome && provider?.proxy) form.append(creditEl());

  const field = el("input", "field");
  field.id = "hosted-key";
  field.type = "password";
  field.autocomplete = "off";
  field.spellcheck = false;
  // Our own server needs nothing pasted: the field is only for someone who was given an access token.
  field.placeholder = keyHint ? t("hosted.keySet", { hint: keyHint }) : provider?.proxy ? t("hosted.tokenOptional") : provider?.placeholder ?? "";
  field.value = state.key;
  field.disabled = state.saving;
  field.addEventListener("input", () => (state.key = field.value));
  const remember = el("label", "remember");
  const box = el("input");
  box.type = "checkbox";
  box.dataset.key = "remember";
  box.checked = state.remember;
  box.addEventListener("change", () => (state.remember = box.checked));
  remember.append(box, ` ${t("hosted.remember")}`);
  // What went wrong is said under the key it concerns, when the key is showing; else over the foot.
  const problem = state.error ? el("p", "error", state.error) : null;
  if (showKey) {
    const keyed = labelled(provider?.proxy ? t("hosted.tokenLabel") : t("hosted.keyLabel", { provider: provider?.name ?? "" }), field);
    if (problem) keyed.append(problem);
    form.append(keyed, remember);
  }

  const models = el("div", "models");
  models.setAttribute("role", "radiogroup");
  const radios = [];
  let other = null;
  const preset = (provider?.models ?? []).some((m) => m.id === state.model);
  for (const m of provider?.models ?? []) {
    const label = el("label", "model");
    const radio = el("input");
    radio.type = "radio";
    radio.name = "model";
    radio.dataset.key = `model:${m.id}`;
    radio.checked = state.model === m.id;
    radio.addEventListener("change", () => {
      state.model = m.id;
      if (other) other.value = "";
      if (simple) void saveModel();
    });
    radios.push(radio);
    label.append(radio, el("span", "name", m.name), el("span", "note", t(`hosted.${m.note}`)));
    models.append(label);
  }
  form.append(groupLabel(models, "hosted-model-label", t("hosted.modelLabel")), models);
  // A provider that serves any model takes its id here; typing one unpicks the listed ones.
  if (provider?.custom) {
    other = el("input", "field model-id");
    other.id = "hosted-model-id";
    other.type = "text";
    other.autocomplete = "off";
    other.spellcheck = false;
    other.value = preset ? "" : state.model ?? "";
    other.disabled = state.saving;
    other.addEventListener("input", () => {
      const id = other.value.trim();
      state.model = id || provider.models[0].id;
      for (const radio of radios) radio.checked = !id && radio === radios[0];
    });
    form.append(labelled(t("hosted.modelOther", { provider: provider.name }), other));
  }
  if (problem && !showKey) form.append(problem);

  // In the credit view nothing waits to be saved (a model is saved as it is picked), so the one button closes.
  const main = button(simple ? t("hosted.done") : state.saving ? t("hosted.saving") : welcome ? t("hosted.start") : t("hosted.save"), null, "btn", "submit");
  main.type = "submit";
  main.disabled = state.saving;
  const lead = [];
  const actions = [];
  if (welcome) actions.push(button(t("hosted.tryWithout"), () => void saveKey({ stub: true }), "btn ghost", "try-without"));
  else if (!simple) {
    // The token is the only handle on credit that was paid for: no button here throws it away.
    const holdsCredit = provider?.proxy && state.credit?.purchased;
    if (keyHint && !holdsCredit) lead.push(button(t("hosted.forgetKey"), () => void forgetKey(), "btn ghost danger", "forget"));
    actions.push(button(t("hosted.cancel"), leave, "btn ghost", "cancel"));
  }
  form.append(dialogFoot(lead, [...actions, main]));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (simple) close();
    else void saveKey();
  });
  card.append(form);
  if (welcome && provider) {
    // Our own proxy has no page to get a token from yet (a private preview), so no link there.
    if (provider.keysUrl) {
      const get = el("p", "help");
      const link = el("a", null, new URL(provider.keysUrl).host);
      link.href = provider.keysUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const [before, after = ""] = t("hosted.noKey").split("{link}");
      get.append(before, link, after);
      card.append(get);
    }
    card.append(row(button(t("hosted.importDatabase"), importDatabase, "btn quiet md", "import")));
  }
  if (welcome) {
    // The landing page names every way to use Archipelago; Claude Code is the one this card cannot offer.
    const other = el("p", "help");
    const link = el("a", null, t("hosted.claudeCodeLink"));
    link.href = "/about#claude-code";
    const [before, after = ""] = t("hosted.claudeCode").split("{link}");
    other.append(before, link, after);
    card.append(other);
    if (provider) card.append(noticeEl(provider));
    card.append(legalEl());
    return;
  }
  // One step further in, one line each: the way to a key from the credit view, the way to a token from our own tab.
  const reveal = (key, change) =>
    button(t(key), () => {
      Object.assign(state, change);
      render();
      (root.querySelector("#hosted-key") ?? root.querySelector(".providers input:checked"))?.focus();
    }, "btn quiet md", "reveal");
  if (simple) {
    // Straight to the first provider that takes a key, with the others beside it.
    const own = state.view?.providers?.find((p) => !p.proxy);
    card.append(row(button(t("hosted.ownKey"), () => ((state.switching = true), own ? pickProvider(own.id) : render()), "btn quiet md", "own-key")));
  }
  else if (provider?.proxy && !state.tokenField) card.append(row(reveal("hosted.haveToken", { tokenField: true })));
  // The long explanations are there for whoever wants them, folded.
  const more = el("details", "more");
  more.open = state.moreOpen; // kept in the state: a redraw builds the element again
  more.addEventListener("toggle", () => (state.moreOpen = more.open));
  more.append(el("summary", null, t("hosted.howItWorks")));
  if (provider?.proxy) more.append(howEl());
  else if (provider) more.append(noticeEl(provider));
  // On our own server there is no stub to fall back to: forgetting its token starts a new free account.
  if (!provider?.proxy) more.append(el("p", "help", t("hosted.stubHelp")));
  card.append(more, legalEl());
}

const SUPPORT = "support@archipelago.school";

/** How our own server's credit works, a short line per question: paying, what a reply costs, where it lives, what is kept, refunds. */
function howEl() {
  const { purchased = false, packs = [] } = state.credit ?? {};
  const list = el("ul", "points");
  const point = (key) => list.append(el("li", null, t(key)));
  if (!purchased) point("hosted.howFree");
  if (packs.length) point("hosted.howPay");
  point("hosted.howCost");
  point("hosted.howPlace");
  point("hosted.howServer");
  if (packs.length) {
    const refund = el("li");
    const mail = el("a", null, SUPPORT);
    mail.href = `mailto:${SUPPORT}`;
    const [before, after = ""] = t("hosted.howRefund", { email: "{email}" }).split("{email}");
    refund.append(before, mail, after);
    list.append(refund);
  }
  return list;
}

/** The terms and the privacy page, each in its own tab so the map stays where it is. */
function legalEl() {
  const links = el("p", "legal-links");
  for (const [key, href] of [["hosted.termsLink", "/terms"], ["hosted.privacyLink", "/privacy"]]) {
    const link = el("a", null, t(key));
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener";
    links.append(link);
  }
  return links;
}

/** Where a provider's turns go and what is kept, in one paragraph. */
function noticeEl(provider) {
  const notice = el("p", "help");
  if (provider.proxy) notice.textContent = t("hosted.noticeProxy"); // our own server: the free start, no key
  else {
    const [before, after = ""] = t("hosted.notice", { host: "{host}" }).split("{host}");
    notice.append(before, el("code", null, provider.host), after);
  }
  return notice;
}

/** This browser's credit on our own server: what is left, and where credit is on sale, a button per pack. */
function creditEl() {
  const credit = el("div", "credit");
  const { balanceUsd: left = null, purchased = false, packs = [] } = state.credit ?? {};
  if (state.thanks) credit.append(el("p", "thanks", t(state.thanks === "added" ? "hosted.creditAdded" : "hosted.creditThanks")));
  if (typeof left !== "number") credit.append(el("p", "left", t("hosted.creditStart")));
  else if (left <= 0) credit.append(el("p", "left", t(packs.length ? "hosted.creditOut" : "hosted.creditOutKey")));
  else credit.append(el("p", "left", t(purchased ? "hosted.creditLeft" : "hosted.creditFree", { amount: amountOf(left) })));
  if (packs.length) {
    credit.append(el("div", "field-label", t("hosted.addCreditLabel")));
    const buttons = row(...packs.map((usd) => button(t("hosted.addCredit", { amount: usd }), () => void buy(usd), "btn ghost", `pack:${usd}`)));
    for (const b of buttons.children) b.disabled = state.buying;
    credit.append(buttons);
    if (state.buyError) credit.append(el("p", "error", state.buyError));
    credit.append(el("p", "help", t(state.buying ? "hosted.openingCheckout" : "hosted.creditShort")));
  }
  return credit;
}

/** The question before a backup replaces everything in this browser: a destructive confirm like the others, the safe answer focused. */
function renderImport(card) {
  card.append(dialogHead(t("hosted.importTitle"), leave, { id: "hosted-title" }));
  card.append(el("p", "confirm", t("hosted.importHelp", { file: state.file.name })));
  if (state.error) card.append(el("p", "error", state.error));
  const replace = button(state.saving ? t("hosted.importing") : t("hosted.replace"), () => void replaceWith(state.file), "btn danger", "replace");
  replace.disabled = state.saving;
  const cancel = button(t("hosted.cancel"), leave, "btn ghost", "cancel");
  cancel.dataset.autofocus = "";
  cancel.disabled = state.saving;
  // Beside the decision, at the left: a copy of what is here, before it goes.
  const lead = state.from === "welcome" ? [] : [button(t("hosted.exportFirst"), () => void exportDatabase(), "btn ghost", "export-first")];
  card.append(dialogFoot(lead, [cancel, replace]));
}
