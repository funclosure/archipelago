// What only the hosted build shows: the welcome screen (a key, Try without a key, or an import), Your key, export
// and import of the database, and the hand-over when another tab holds the database. The worker keeps the keys,
// one per provider (`src/hosted/settings.ts`); this page sends a key once and reads back only its last four characters.
import { request, release } from "./transport.js";
import { registerRegion } from "./keys.js";
import { t } from "./i18n.js";
import { amountOf, PAID_CHECKS_MS } from "./credit-model.js";

export const isHosted = () => globalThis.ARCHIPELAGO_HOSTED === true;

/** `open`: null, "welcome" (no way out but a choice), "key" (Your key), "import" (the replace warning), "elsewhere". */
const state = { open: null, view: null, provider: null, key: "", model: null, remember: true, saving: false, error: null, file: null, credit: null, buying: false, thanks: null, switching: false, tokenField: false };
let root = null;
let started = null; // resolves the welcome gate

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label, onClick, className = "btn") {
  const b = el("button", className, label);
  b.type = "button";
  b.addEventListener("click", onClick);
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
  registerRegion("hosted", { isOpen: () => state.open !== null, close: () => state.open !== "welcome" && state.open !== "elsewhere" && close() });
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
    .catch((error) => alert(error.message));
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

/** True once, when the page was opened by the checkout's way back (`?credit=added`); the mark is taken off the address. */
function backFromCheckout() {
  const url = new URL(location.href);
  if (url.searchParams.get("credit") !== "added") return false;
  url.searchParams.delete("credit");
  history.replaceState(null, "", url);
  return true;
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
  render();
  try {
    const { url } = await (await call("/hosted/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pack }) })).json();
    try {
      sessionStorage.setItem(BEFORE_KEY, String(state.credit?.balanceUsd ?? 0));
    } catch {}
    location.href = url;
  } catch (error) {
    state.buying = false;
    state.error = error.message;
    render();
  }
}

function open(kind) {
  Object.assign(state, { open: kind, key: "", provider: state.view?.provider ?? null, model: state.view?.model ?? null, remember: state.view?.remember ?? true, saving: false, error: null, switching: false, tokenField: false });
  render();
  // Focus goes to the provider that is chosen: on the first one it reads as if that were the choice.
  (root.querySelector(".providers input:checked") ?? root.querySelector(".models input:checked") ?? root.querySelector("input"))?.focus();
}

function close() {
  state.open = null;
  state.thanks = null;
  render();
}

/** The provider the form shows: the one picked there, else the saved one. */
const providerNow = () => state.view?.providers?.find((p) => p.id === state.provider) ?? state.view?.providers?.[0];

/** Picking a provider shows its own key hint and the model last picked for it. */
function pickProvider(id) {
  const p = state.view.providers.find((x) => x.id === id);
  Object.assign(state, { provider: id, key: "", model: state.view.models?.[id] ?? p.models[0]?.id ?? "", error: null });
  render();
  root.querySelector('input[type="password"]')?.focus();
}

async function saveKey({ stub = false } = {}) {
  if (state.saving) return;
  const patch = { provider: state.provider, model: state.model, remember: state.remember };
  if (stub) patch.stub = true;
  else if (state.key.trim()) patch.apiKey = state.key.trim();
  else if (!state.view?.keyHints?.[state.provider] && !providerNow()?.proxy) {
    state.error = t("hosted.pasteKey");
    return render();
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
    alert(t("hosted.exportFailed", { message: error.message }));
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
  root.hidden = state.open === null;
  root.classList.toggle("welcome", state.open === "welcome" || state.open === "elsewhere"); // nothing behind it yet, or nothing to use
  root.replaceChildren();
  if (state.open === null) return;
  const card = el("div", "hosted-card");
  if (state.open === "welcome" || state.open === "key") renderKey(card);
  else if (state.open === "import") renderImport(card);
  else if (state.open === "elsewhere") {
    card.append(el("div", "lbl", "Archipelago"), el("p", "help", t("hosted.movedHelp")));
    card.append(row(button(t("hosted.reload"), () => location.reload())));
  }
  if (state.error) card.append(el("p", "error", state.error));
  root.append(card);
}

function row(...children) {
  const r = el("div", "row");
  r.append(...children);
  return r;
}

function renderKey(card) {
  const welcome = state.open === "welcome";
  const provider = providerNow();
  const keyHint = state.view?.keyHints?.[provider?.id];
  // On our own server the dialog starts as the credit and a model: providers and keys wait behind "Use my own key instead".
  const simple = !welcome && Boolean(provider?.proxy) && !state.switching;
  // Our own server needs nothing pasted: its field shows only to someone who says they were given a token.
  const showKey = !simple && (!provider?.proxy || state.tokenField);
  card.append(el("div", "lbl", welcome ? "Archipelago" : simple ? t("hosted.yourCredit") : t("hosted.yourKey")));
  if (welcome) card.append(el("p", "lede", t("hosted.lede")));
  if (simple) card.append(creditEl());
  const form = el("form", "fields");

  const providers = el("div", "providers");
  providers.setAttribute("role", "radiogroup");
  providers.setAttribute("aria-label", t("hosted.providerLabel"));
  for (const p of state.view?.providers ?? []) {
    const label = el("label", "provider");
    const radio = el("input");
    radio.type = "radio";
    radio.name = "provider";
    radio.checked = p.id === provider?.id;
    radio.disabled = state.saving;
    radio.addEventListener("change", () => pickProvider(p.id));
    label.append(radio, p.name);
    if (state.view.keyHints?.[p.id]) label.append(el("span", "has-key", "•"));
    providers.append(label);
  }
  if (!simple) form.append(providers);
  // Among the providers, our own server's tab shows its credit where another's shows a key field.
  if (!simple && !welcome && provider?.proxy) form.append(creditEl());

  const field = el("input");
  field.type = "password";
  field.autocomplete = "off";
  field.spellcheck = false;
  // Our own server needs nothing pasted: the field is only for someone who was given an access token.
  field.placeholder = keyHint ? t("hosted.keySet", { hint: keyHint }) : provider?.proxy ? t("hosted.tokenOptional") : provider?.placeholder ?? "";
  field.value = state.key;
  field.disabled = state.saving;
  field.setAttribute("aria-label", t("hosted.keyLabel", { provider: provider?.name ?? "" }));
  field.addEventListener("input", () => (state.key = field.value));
  if (showKey) form.append(field);

  const models = el("div", "models");
  const radios = [];
  let other = null;
  const preset = (provider?.models ?? []).some((m) => m.id === state.model);
  for (const m of provider?.models ?? []) {
    const label = el("label", "model");
    const radio = el("input");
    radio.type = "radio";
    radio.name = "model";
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
  // A provider that serves any model takes its id here; typing one unpicks the listed ones.
  if (provider?.custom) {
    other = el("input", "model-id");
    other.type = "text";
    other.autocomplete = "off";
    other.spellcheck = false;
    other.placeholder = t("hosted.modelOther", { provider: provider.name });
    other.setAttribute("aria-label", other.placeholder);
    other.value = preset ? "" : state.model ?? "";
    other.disabled = state.saving;
    other.addEventListener("input", () => {
      const id = other.value.trim();
      state.model = id || provider.models[0].id;
      for (const radio of radios) radio.checked = !id && radio === radios[0];
    });
    models.append(other);
  }
  if (simple) form.append(el("div", "sect", t("hosted.modelLabel")));
  form.append(models);

  const remember = el("label", "remember");
  const box = el("input");
  box.type = "checkbox";
  box.checked = state.remember;
  box.addEventListener("change", () => (state.remember = box.checked));
  remember.append(box, ` ${t("hosted.remember")}`);
  if (showKey) form.append(remember);

  // In the credit view nothing waits to be saved (a model is saved as it is picked), so the one button closes.
  const actions = row(simple ? button(t("hosted.done"), close) : button(state.saving ? t("hosted.saving") : welcome ? t("hosted.start") : t("hosted.save"), () => void saveKey()));
  actions.firstChild.type = "submit";
  actions.firstChild.disabled = state.saving;
  if (welcome) actions.append(button(t("hosted.tryWithout"), () => void saveKey({ stub: true }), "btn ghost"));
  else if (!simple) {
    // The token is the only handle on credit that was paid for: no button here throws it away.
    const holdsCredit = provider?.proxy && state.credit?.purchased;
    if (keyHint && !holdsCredit && !simple) actions.append(button(t("hosted.forgetKey"), () => void forgetKey(), "btn ghost"));
    actions.append(button(t("hosted.cancel"), close, "btn ghost"));
  }
  form.append(actions);
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
    card.append(row(button(t("hosted.importDatabase"), importDatabase, "btn link")));
  }
  if (welcome) {
    // The landing page names every way to use Archipelago; Claude Code is the one this card cannot offer.
    const other = el("p", "help");
    const link = el("a", null, t("hosted.claudeCodeLink"));
    link.href = "/about#claude-code";
    const [before, after = ""] = t("hosted.claudeCode").split("{link}");
    other.append(before, link, after);
    card.append(other);
  }
  if (welcome) {
    if (provider) card.append(noticeEl(provider));
    card.append(legalEl());
    return;
  }
  // One step further in, one line each: the way to a key from the credit view, the way to a token from our own tab.
  const reveal = (key, change) =>
    button(t(key), () => {
      Object.assign(state, change);
      render();
      root.querySelector('.providers input:checked, input[type="password"]')?.focus();
    }, "btn link");
  if (simple) {
    // Straight to the first provider that takes a key, with the others beside it.
    const own = state.view?.providers?.find((p) => !p.proxy);
    card.append(row(button(t("hosted.ownKey"), () => ((state.switching = true), own ? pickProvider(own.id) : render()), "btn link")));
  }
  else if (provider?.proxy && !state.tokenField) card.append(row(reveal("hosted.haveToken", { tokenField: true })));
  // The long explanations are there for whoever wants them, folded.
  const more = el("details", "more");
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
    credit.append(el("div", "sect", t("hosted.addCreditLabel")));
    const buttons = row(...packs.map((usd) => button(t("hosted.addCredit", { amount: usd }), () => void buy(usd), "btn ghost")));
    for (const b of buttons.children) b.disabled = state.buying;
    credit.append(buttons, el("p", "help", t(state.buying ? "hosted.openingCheckout" : "hosted.creditShort")));
  }
  return credit;
}

function renderImport(card) {
  card.append(el("div", "lbl", t("hosted.importTitle")));
  card.append(el("p", "help", t("hosted.importHelp", { file: state.file.name })));
  const actions = row(button(state.saving ? t("hosted.importing") : t("hosted.replace"), () => void replaceWith(state.file)));
  actions.firstChild.disabled = state.saving;
  if (state.from !== "welcome") actions.append(button(t("hosted.exportFirst"), () => void exportDatabase(), "btn ghost"));
  actions.append(button(t("hosted.cancel"), () => (state.from === "welcome" ? open("welcome") : close()), "btn ghost"));
  card.append(actions);
}
