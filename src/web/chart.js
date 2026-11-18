// The cartographer's pane: one thread per scale, the pending sketch as a card, and the turn in flight. The same pane
// holds the guide (`mode: "guide"`): the mentor before any island, one thread per domain, whose replies carry
// "Sail to" cards instead of a sketch. card.js owns #pane and hands it over while either is open. Head, log and foot
// are the island pane's own parts (pane-parts.js): the same composer, the same notices, the same redraw that keeps
// what has not changed.
import { app, api, refresh, frameSelection } from "./app.js";
import { streamPost } from "./stream.js";
import { renderMarkdown, markdownBlocks } from "./markdown.js";
import { select } from "./interactions.js";
import { chartOpening, sketchRows, sketchSummary } from "./chart-model.js";
import { thinkingLine } from "./progress-model.js";
import { thinkingEl } from "./thinking.js";
import { systemText } from "./thread.js";
import { t } from "./i18n.js";
import { modelEl, modelSig } from "./model-label.js";
import { createTray, messageImagesEl } from "./images.js";
import { canTalk, talkBusy } from "./dictation.js";
import { insertWords } from "./dictation-model.js";
import { keyedChildren } from "./keep.js";
import { createReveal } from "./reveal.js";
import { mentionsFor } from "./mentions.js";
import { icon } from "./icons.js";
import { tip } from "./tip.js";
import { toastError } from "./toast.js";
import { canSend, withRestored } from "./pane-model.js";
import { button, composerEl, el, eventEl, failedEl, failureWords, footMetaEl, keepFocus, logFollower, noticeEl, personaGlyph, roveFocus, skeletonEl, syncAnswer } from "./pane-parts.js";

const LOG_STEP = 80;
const SCROLL_BY = {
  ArrowDown: () => LOG_STEP,
  ArrowUp: () => -LOG_STEP,
  PageDown: (log) => log.clientHeight * 0.9,
  PageUp: (log) => -log.clientHeight * 0.9,
};

const chart = {
  open: false,
  mode: "cartographer", // or "guide": the domain's guide thread, never at a scale
  scale: null,        // the island whose islets this thread sketches; null at the top scale
  version: null,      // snapshot version the thread was fetched at; null forces a refetch
  messages: [],
  sketch: null,       // the pending sketch at this scale, from /api/thread
  pointers: [],       // the guide's "Sail to" cards, each under the reply it rode on
  loaded: false,
  loadError: null,
  draft: "",
  live: "",
  progress: null,
  inFlight: false,
  error: null,
  stopped: false,
  deciding: false,    // an approve or discard is in flight
};
let turnGen = 0;
let loadGen = 0;
let turnAbort = null;
let liveFrame = 0;
let composing = false;
let logGen = 0;       // bumped when every reply must be drawn again (a theme change)
let rerender = () => {};
let sail = () => {};
let gripEl = null;    // the pane's grip is card.js's; the cartographer's pane resizes the same way
const follow = logFollower();
// The reply is drawn as it arrives, its new words fading in (reveal.js); once the turn ends it stays as written until
// the kept one is drawn in its place (load). `heldAfter` is the last load begun before that, which cannot hold it yet.
const reveal = createReveal(() => renderLive());
let heldAfter = 0;
let heldSeq = 0;
/** The images attached to the draft in this pane's answer box (a syllabus for the cartographer, a screenshot for the guide). */
const tray = createTray(() => rerender());
/** The tray images dropped on the pane go to, while this pane shows (card.js owns the drop). */
export const chartTray = () => tray;

/** card.js passes its render (it owns the pane), how to sail from a guide's card (it owns the island's pane), and the pane's grip. */
export function installChart({ render, sail: sailWith, grip }) {
  rerender = render;
  if (sailWith) sail = sailWith;
  if (grip) gripEl = grip;
  document.addEventListener("theme", () => {
    logGen++; // a diagram in a reply is drawn again in the new colours
    if (chart.open) rerender();
  });
  // The server is back (app.js's poll): a thread that could not be read for want of it is read again, unasked.
  document.addEventListener("reconnected", () => {
    if (chart.open && chart.loadError) retryLoad();
  });
}

export const isChartOpen = () => chart.open;
export const isGuideOpen = () => chart.open && chart.mode === "guide";
const guiding = () => chart.mode === "guide";
const speaker = () => (guiding() ? "mentor" : "cartographer");
export const chartTurning = () => chart.inFlight && turnAbort !== null;
/** The tool in flight while the cartographer works at the map's scale (null while it thinks), or undefined when it is not working there. */
export const chartWorkingHere = () => (!guiding() && chart.inFlight && (chart.scale ?? null) === (app.scale ?? null) ? chart.progress : undefined);

/**
 * Words typed and not yet sent, by thread: the cartographer's per scale, the guide's per domain. Closing the pane or
 * moving to another scale keeps them, and the same thread's box opens on them again. Memory only, as card.js keeps
 * an island's.
 */
const drafts = new Map();
const draftKey = (mode, scale) => `${app.domain}/${mode}/${mode === "guide" ? "" : scale ?? ""}`;

/** Keeps the open thread's unsent words before the pane closes or moves to another thread. */
function stashDraft() {
  if (!chart.open) return;
  const key = draftKey(chart.mode, chart.scale);
  if (chart.draft.trim()) drafts.set(key, chart.draft);
  else drafts.delete(key);
}

/** Words spoken into the guide's box that came back after it left the page (dictation.js): they wait in its draft. */
function keepHeard(domain, words) {
  const add = (text) => insertWords(text, text.length, text.length, words).value;
  if (chart.open && guiding() && app.domain === domain) {
    chart.draft = add(chart.draft);
    rerender();
    return;
  }
  const key = `${domain}/guide/`;
  drafts.set(key, add(drafts.get(key) ?? ""));
}

function reset(scale, mode = chart.mode) {
  turnGen += 1; // a stream from an earlier scale is no longer ours
  tray.clear(); // the draft's images go with its words
  stashDraft();
  const at = mode === "guide" ? null : scale;
  reveal.reset();
  Object.assign(chart, { mode, scale: at, version: null, messages: [], sketch: null, pointers: [], loaded: false, loadError: null, draft: drafts.get(draftKey(mode, at)) ?? "", live: "", progress: null, inFlight: false, error: null, stopped: false, deciding: false });
}

/** Which of the two is open in this tab, per domain, so a reload brings it back as it brings back an island's pane. */
const OPEN_KEY = () => `chart:${app.domain}`;
function rememberOpen(mode) {
  try {
    if (mode) sessionStorage.setItem(OPEN_KEY(), mode);
    else sessionStorage.removeItem(OPEN_KEY());
  } catch {
    /* storage unavailable: a reload shows the map */
  }
}

/** After a reload: opens the guide or the cartographer again if it was open, unless an island's pane came back instead. */
export function reopenChart() {
  let mode = null;
  try {
    mode = sessionStorage.getItem(OPEN_KEY());
  } catch {
    return;
  }
  if (!mode) return;
  if (app.selected) return rememberOpen(null); // the island was picked after it: the island's pane is the one open
  if (mode === "guide") openGuide();
  else openChart();
}

/**
 * Opens the cartographer at a scale (the map's current one by default). `start` runs the first turn without a
 * message, as a new domain or a sail-closer does; `message` sends one, as a note to the cartographer does.
 */
export function openChart(scale = app.scale ?? null, { start = false, message = null, mode = "cartographer" } = {}) {
  if (mode === "guide") scale = null;
  if (!chart.open || chart.mode !== mode || chart.scale !== scale) reset(scale, mode);
  chart.open = true;
  rememberOpen(mode);
  if (app.selected) void select(null); // the island pane closes; its listeners repaint the pane as the cartographer's
  else rerender();
  frameSelection(); // the pane's width is settled: refit the map beside it
  if (message) void runTurn(message);
  else if (start) void runTurn(null);
}

/** Opens the guide: the mentor before any island. `start` runs its opening turn when the thread is new. */
export function openGuide({ start = false } = {}) {
  openChart(null, { mode: "guide", start });
}

export function closeChart() {
  if (!chart.open) return;
  turnAbort?.abort();
  stashDraft();
  chart.open = false;
  rememberOpen(null);
  reset(null, "cartographer");
  rerender();
  frameSelection();
}

export function stopChartTurn() {
  if (!turnAbort) return false;
  turnAbort.abort();
  return true;
}

const scaleQuery = () => (chart.scale ? `&island=${encodeURIComponent(chart.scale)}` : "");
const scaleName = () => app.snapshot?.scale.path.at(-1)?.name ?? app.snapshot?.domain.name ?? "";

async function load() {
  chart.version = app.version;
  const gen = ++loadGen;
  const scale = chart.scale;
  const stale = () => !chart.open || chart.scale !== scale || gen !== loadGen;
  try {
    const mode = chart.mode;
    const { messages, sketch, pointers } = await api(`/api/thread?domain=${encodeURIComponent(app.domain)}&mode=${mode}${mode === "guide" ? "" : scaleQuery()}`);
    if (stale() || chart.mode !== mode) return;
    if (chart.live && !chart.inFlight && gen > heldAfter) {
      // The reply on screen as it was written: shown whole first, then the kept one takes its place in the same draw.
      const turnAt = turnGen;
      await reveal.shown();
      if (stale() || chart.mode !== mode || turnGen !== turnAt) return; // a new turn began; the load after it brings this reply
      reveal.reset();
      chart.live = "";
    }
    chart.messages = messages;
    chart.sketch = sketch ?? null;
    chart.pointers = pointers ?? [];
    chart.loaded = true;
    chart.loadError = null;
    chart.deciding = false; // a decision is complete once the refetched thread shows it
  } catch (error) {
    if (stale()) return;
    chart.deciding = false;
    chart.loadError = failureWords(error);
  }
  rerender();
}

/** Reads the thread again after a load that failed. */
function retryLoad() {
  chart.version = null;
  chart.loadError = null;
  rerender();
}

/** One cartographer turn at the open scale. `message` null starts it without a reader message. */
async function runTurn(message, sent = []) {
  if (chart.inFlight || !chart.open) return;
  const gen = ++turnGen;
  const scale = chart.scale;
  const mode = chart.mode;
  const mine = () => chart.open && chart.scale === scale && gen === turnGen;
  if (chart.live) {
    // The last reply is still on screen as it was written: it stays, as a line of the log, until the next load.
    chart.messages = [...chart.messages, { id: `held-${++heldSeq}`, role: speaker(), kind: "text", body: chart.live }];
  }
  reveal.reset();
  follow.anchorAt(null);
  Object.assign(chart, { inFlight: true, live: "", progress: null, error: null, stopped: false });
  const abort = new AbortController();
  turnAbort = abort;
  const images = sent.map((item) => item.image);
  const said = Boolean(message) || images.length > 0;
  const local = said ? { id: `local-${Date.now()}`, role: "you", kind: "text", body: message ?? "", images: images.map((i) => ({ ...i, removed: false })) } : null;
  if (local) chart.messages = [...chart.messages, local];
  rerender();
  if (said) {
    follow.follow(); // sending is a request to watch the reply arrive
    follow.toEnd();
  }
  let unsent = false; // the request never reached the server, or it refused it: nothing there changed
  try {
    const body = { domain: app.domain, mode: chart.mode, ...(scale && !guiding() ? { island: scale } : {}), ...(message ? { message } : {}), ...(images.length ? { images: images.map((i) => i.id) } : {}) };
    await streamPost("/api/probe", body, (e) => {
      if (!mine()) return;
      if (e.type === "text") {
        chart.live += e.data.text;
        chart.progress = null;
        reveal.update(chart.live);
        scheduleLive();
      } else if (e.type === "progress") {
        chart.progress = e.data.message;
        scheduleLive();
      } else if (e.type === "error") {
        chart.error = e.data.message;
      }
    }, abort.signal);
  } catch (error) {
    if (turnAbort === abort) turnAbort = null;
    // Refused or stopped before the stream opened: the server stored nothing, so the words go back in the box.
    const back = Boolean(message) && !error.midStream;
    unsent = !error.aborted && !error.midStream;
    if (!mine()) {
      // The pane closed or moved on; the words still go back to the box they were written in.
      if (!back) return;
      if (chart.open && chart.mode === mode && chart.scale === scale) {
        chart.draft = withRestored(chart.draft, message);
        rerender();
      } else drafts.set(draftKey(mode, scale), withRestored(drafts.get(draftKey(mode, scale)) ?? "", message));
      return;
    }
    if (error.aborted) chart.stopped = true;
    else {
      const words = failureWords(error);
      chart.error = said && unsent && words === t("paneParts.offline") ? t("paneParts.offlineKept") : words;
    }
    // A message the server never took leaves the log: it is in the box again, and one notice says so.
    if (unsent && local) chart.messages = chart.messages.filter((m) => m !== local);
    if (back) chart.draft = withRestored(chart.draft, message);
    if (sent.length && !error.midStream) tray.restore(sent);
  }
  if (turnAbort === abort) turnAbort = null;
  if (!mine()) return;
  if (liveFrame) cancelAnimationFrame(liveFrame);
  liveFrame = 0;
  Object.assign(chart, { inFlight: false, progress: null });
  if (chart.error || chart.stopped || unsent) {
    reveal.reset();
    chart.live = "";
  } else {
    heldAfter = loadGen;
    reveal.end(); // it stays until its last words have faded in and the kept reply is drawn in its place
  }
  if (!unsent) chart.version = null; // the reply and any sketch come back with the refetch; a turn never taken changed nothing
  document.dispatchEvent(new Event("turn")); // the pane's foot re-reads the model and, on the free start, the credit left
  rerender();
  if (!unsent) void refresh().catch(() => {}); // a proposed sketch draws as drafts on the map in the same beat
  focusChartAnswer();
}

/** Runs a failed turn again: the words given back to the box if there are any, else the thread as it stands. */
function retryTurn() {
  if (chart.inFlight) return;
  if (!chartSend({ approve: false })) void runTurn(null);
}

/** Approves or discards a sketch at the open scale, or at the map's scale when the bottom card asks. */
export async function decideSketch(sketchId, action) {
  if (chart.deciding) return;
  chart.deciding = true;
  rerender();
  try {
    const result = await api("/api/sketch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: app.domain, ...(app.scale ? { island: app.scale } : {}), sketchId, action }),
    });
    // A sketch that named a provisional domain can give it a new slug: follow it, or the next poll is a 404.
    if (result.domain && result.domain.slug !== app.domain) {
      const url = new URL(location.href);
      url.searchParams.set("domain", result.domain.slug);
      location.replace(url.toString());
      return;
    }
    chart.version = null; // chart.deciding stays true until the refetched thread lands
    await refresh();
  } catch (error) {
    chart.deciding = false;
    // Not a line in the conversation: the button that was pressed is still there, on the card or on the map.
    toastError(error, t(action === "approve" ? "chart.approveWhat" : "chart.discardWhat"));
    rerender();
  }
}

// ---- streaming: one DOM write per animation frame ----

function scheduleLive() {
  if (liveFrame) return;
  liveFrame = requestAnimationFrame(() => {
    liveFrame = 0;
    renderLive();
  });
}

function renderLive() {
  const pane = document.getElementById("pane");
  const live = pane.querySelector("#live");
  const progress = pane.querySelector("#progress");
  if (!live || !progress) return;
  const stuck = follow.following;
  const text = reveal.text;
  if (chart.inFlight && !text) {
    live.replaceChildren(thinkingEl(thinkingLine(speaker(), chart.progress)));
  } else if (text) {
    // Block by block: one that has not changed keeps its element, so only the block being written is drawn again,
    // and the words it shows for the first time fade in.
    keyedChildren(live, markdownBlocks(text, { lead: true, mentions: mentionsFor(null) }).map((b, i) => ({ key: i, sig: b.sig, build: reveal.fade(i, b.build) })));
    for (const old of live.querySelectorAll(".caret")) old.remove();
    let tail = live;
    while (tail.lastElementChild && !["CODE", "STRONG", "EM", "BR"].includes(tail.lastElementChild.tagName)) tail = tail.lastElementChild;
    if (!reveal.settled) tail.append(el("span", "caret"));
  } else {
    live.replaceChildren();
  }
  live.hidden = !(text || chart.inFlight);
  progress.textContent = chart.progress && text ? `${thinkingLine(speaker(), chart.progress)}…` : "";
  progress.hidden = !progress.textContent;
  if (stuck) {
    if (!live.hidden) follow.anchorAt(live); // once the kept reply has taken its place, the anchor stays where it was
    follow.toEnd();
  }
}

export function focusChartAnswer() {
  const ta = document.getElementById("pane")?.querySelector("#answer");
  if (!ta || ta.disabled) return false;
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  return true;
}

// ---- the pane ----

/** Whether there is a thread to draw: it has loaded, or it has words in hand. */
const ready = () => chart.loaded || chart.inFlight || Boolean(chart.live) || chart.messages.length > 0;
const pendingSummary = () => (chart.sketch ? sketchSummary(chart.sketch.body, app.snapshot?.islands ?? []) : null);

/** Everything the head is drawn from: it is drawn again only when this changes, so its Close button keeps the keyboard. */
function headSig() {
  return JSON.stringify([chart.mode, chart.scale, scaleName(), app.snapshot?.domain.name ?? "", guiding() ? null : pendingSummary()]);
}

/** The head: who this is and Close; what it does; then where it works (and, for the cartographer, the sketch waiting). */
function headEl() {
  const head = el("div", "head");
  const titlebar = el("div", "titlebar");
  const close = button(null, () => closeChart(), "btn quiet icon md");
  close.append(icon("close"));
  close.dataset.fk = "close";
  close.setAttribute("aria-label", t("paneParts.close"));
  tip(close, t("paneParts.close"), "Esc");
  titlebar.append(el("h2", null, t(guiding() ? "chart.guideTitle" : "chart.title")), close);
  head.append(titlebar);
  head.append(el("p", "summary", t(guiding() ? "chart.guideSummary" : "chart.summary")));
  const sub = el("div", "sub");
  const standing = el("span", "standing");
  if (guiding()) standing.append(el("span", "pill mode mentor", app.snapshot?.domain.name ?? ""));
  else {
    standing.append(el("span", "pill mode cartographer", t(chart.scale ? "chart.isletsOf" : "chart.topOf", { name: scaleName() })));
    const waiting = pendingSummary();
    if (waiting) standing.append(el("span", "count", t("chart.toApprove", { summary: waiting })));
  }
  sub.append(standing);
  head.append(sub);
  return head;
}

/** The guide's card: sail in the lens it suggests, or the other one; in the mentor's, the question goes along. `latest` is the one `g` follows. */
function guideSailEl(pointer, latest) {
  const lens = pointer.lens ?? "mentor";
  const box = el("div", `sail ${lens}`);
  const other = lens === "mentor" ? "judge" : "mentor";
  box.append(el("div", "sail-why", pointer.why));
  if (lens === "mentor" && pointer.question) box.append(el("div", "sail-carry", t("chart.sailCarries")));
  const row = el("div", "sail-row");
  const go = button(null, () => sail(pointer, lens), "btn md sail-go");
  go.append(icon("arrow-right", { size: 14 }), el("span", null, t(lens === "mentor" ? "chart.sailMentor" : "chart.sailKeeper", { name: pointer.island.name })));
  go.dataset.fk = `sail-${pointer.id}`;
  if (latest) tip(go, t("chart.sailTip"), "g");
  const alt = button(t(other === "mentor" ? "chart.orMentor" : "chart.orKeeper"), () => sail(pointer, other), "btn quiet md sail-alt");
  alt.dataset.fk = `sail-alt-${pointer.id}`;
  row.append(go, alt);
  box.append(row);
  return box;
}

function sketchCard(sketch) {
  const card = el("div", "sketch-card");
  const rows = sketchRows(sketch.body, app.snapshot?.islands ?? []);
  card.append(el("div", "lbl", t("chart.sketch")), el("div", "sum", sketchSummary(sketch.body, app.snapshot?.islands ?? [])));
  if (rows.islands.length) {
    const list = el("ul", "isles");
    for (const i of rows.islands) {
      const li = el("li");
      const name = el("div", "name", i.name);
      if (i.harbour) name.append(el("span", "pill harbour", t("chart.harbour")));
      li.append(name, el("div", "blurb", i.summary), el("div", "marks", i.landmarks)); // not "about": that class is the About you dialog's
      list.append(li);
    }
    card.append(list);
  }
  if (rows.straits.length) card.append(el("div", "sec", t("chart.straits")), el("div", "straits", rows.straits.join(" · ")));
  if (rows.seas.length) {
    card.append(el("div", "sec", t("chart.seas")));
    for (const s of rows.seas) {
      const row = el("div", "update");
      row.append(el("span", "name", s.name), ` ${s.islands}`);
      card.append(row);
    }
  }
  if (rows.updates.length) {
    card.append(el("div", "sec", t("chart.updates")));
    for (const u of rows.updates) card.append(el("div", "update", u));
  }
  if (rows.harbour) card.append(el("div", "sec", t("chart.harbourOf", { name: rows.harbour })));
  const actions = el("div", "actions");
  const approve = button(t("chart.approve"), () => void decideSketch(sketch.id, "approve"), "btn md");
  approve.id = "approve-sketch";
  tip(approve, t("chart.approveTip"), "⌘↵");
  const discard = button(t("chart.discard"), () => void decideSketch(sketch.id, "discard"), "btn ghost md");
  discard.dataset.fk = "discard-sketch";
  approve.disabled = discard.disabled = chart.deciding || chart.inFlight;
  actions.append(approve, discard);
  card.append(actions);
  return card;
}

function messageEl(m) {
  if (m.kind === "system") {
    const { row, body } = eventEl("note");
    body.append(el("span", "event-text", systemText(m.body)));
    return row;
  }
  const box = el("div", `msg ${m.role === "you" ? "you" : speaker()}`);
  if (m.images?.length) box.append(messageImagesEl(m.images));
  if (m.body || !m.images?.length) box.append(renderMarkdown(m.body, m.role === "you" ? {} : { lead: true, mentions: mentionsFor(null) }));
  return box;
}

/** Before the first words: what this pane is for, and the button that starts it (where there is one). */
function openingEl() {
  const opening = guiding() ? { text: t("chart.guideOpening"), action: t("chart.guideStart") } : chartOpening(app.snapshot);
  const box = el("div", `briefing ${speaker()}`);
  box.append(personaGlyph(speaker()), el("p", "lede", opening.text));
  if (opening.action) {
    const b = button(opening.action, () => void runTurn(null), "btn xl start");
    b.id = "landfall";
    tip(b, t("chart.startTip"), "l");
    box.append(b);
  }
  return box;
}

/** The log's children, in order. A keyed entry (a message, the sketch, a notice) keeps its element until its content changes. */
function logEntries() {
  const out = [];
  if (!ready()) {
    if (chart.loadError) out.push({ key: "failed", sig: chart.loadError, build: () => failedEl(t("paneParts.loadFailed"), chart.loadError, retryLoad) });
    else out.push({ key: "skeleton", sig: "", build: skeletonEl });
    return out;
  }
  if (chart.messages.length === 0 && !chart.inFlight && !chart.live && app.snapshot) {
    out.push({ key: "opening", sig: JSON.stringify([chart.mode, chart.scale, app.snapshot.islands.length, scaleName()]), build: openingEl });
  }
  const names = (app.snapshot?.islands ?? []).map((i) => [i.slug, i.name]);
  const sketchEntry = () => out.push({ key: `sketch:${chart.sketch.id}`, sig: JSON.stringify([chart.sketch, chart.deciding, chart.inFlight, names]), build: () => sketchCard(chart.sketch) });
  const lastPointer = chart.pointers.at(-1)?.id ?? null;
  let placed = false;
  for (const m of chart.messages) {
    out.push({ key: `m:${m.id}`, sig: JSON.stringify([logGen, m, speaker(), m.role === "you" ? "" : mentionsFor(null)?.sig ?? ""]), build: () => messageEl(m) });
    for (const p of chart.pointers) {
      if (p.messageId === m.id) out.push({ key: `sail:${p.id}`, sig: JSON.stringify([p, p.id === lastPointer]), build: () => guideSailEl(p, p.id === lastPointer) });
    }
    if (chart.sketch && chart.sketch.messageId === m.id) {
      sketchEntry();
      placed = true;
    }
  }
  if (chart.sketch && !placed) sketchEntry(); // proposed in a turn whose reply was not kept
  // The reply as it streams: kept across redraws, so its blocks are not drawn again mid-reply.
  out.push({ key: "live", sig: speaker(), build: () => {
    const live = el("div", `msg ${speaker()}`);
    live.id = "live";
    live.hidden = true;
    return live;
  } });
  out.push({ key: "progress", sig: "", build: () => {
    const progress = el("div", "progress");
    progress.id = "progress";
    progress.hidden = true;
    return progress;
  } });
  if (chart.stopped) out.push({ key: "stopped", sig: "", build: () => noticeEl(t("paneParts.stopped"), { alert: false }) });
  if (chart.error) out.push({ key: "turn-error", sig: chart.error, build: () => noticeEl(chart.error, { action: { label: t("paneParts.tryAgain"), run: retryTurn, keys: "r" } }) });
  // The words above are the last good ones; only reading them again failed.
  if (chart.loadError) out.push({ key: "stale", sig: chart.loadError, build: () => noticeEl(t("paneParts.refreshFailed", { why: chart.loadError }), { action: { label: t("paneParts.retry"), run: retryLoad, keys: "r" } }) });
  out.push({ key: "more", sig: "", build: () => follow.moreEl() }); // last: it stands at the foot of the log
  return out;
}

/** The log, drawn into the one already on the page when it is this thread's, so what has not changed keeps its element. */
function logEl(prev = null) {
  const of = `chart:${chart.mode}/${chart.scale ?? ""}`;
  const log = prev && prev.dataset.thread === of ? prev : el("div", "log");
  follow.adopt(log);
  log.dataset.thread = of;
  keyedChildren(log, logEntries());
  follow.watch();
  return log;
}

/** Everything the foot is drawn from but the draft's words, which live in the box. */
function footSig() {
  return JSON.stringify([chart.mode, ready(), chart.deciding, chartTurning(), Boolean(chart.sketch), tray.items.map((i) => [i.key, i.status]), tray.notice, canTalk(), modelSig()]);
}

function footEl() {
  const foot = el("div", "foot");
  const streaming = chartTurning();
  foot.append(composerEl({
    value: chart.draft,
    placeholder: t(guiding() ? "chart.guidePlaceholder" : chart.sketch ? "chart.placeholderSketch" : "chart.placeholder"),
    disabled: !ready() || chart.deciding,
    tray,
    // Push-to-talk for the guide (the mentor before an island), never the cartographer's sketching.
    talk: guiding() ? { key: draftKey("guide", null), keep: ((domain) => (words) => keepHeard(domain, words))(app.domain) } : null,
    action: streaming ? "stop" : "send",
    onInput(value) {
      chart.draft = value;
    },
    onCompose(on) {
      composing = on;
      if (!on) setTimeout(() => !composing && rerender(), 0); // a redraw held back while the word was composed
    },
    onStop: () => stopChartTurn(),
    onSubmit(body) {
      if ((!body && tray.ready().length === 0) || chart.inFlight || tray.busy() || (guiding() && talkBusy(draftKey("guide", null)))) return;
      chart.draft = "";
      void runTurn(body, tray.take());
    },
  }));
  const hint = streaming
    ? { typing: t("paneParts.hintStop") }
    : { typing: t(chart.sketch && !guiding() ? "chart.metaSketch" : "paneParts.hintSend"), idle: t("paneParts.hintWrite") };
  foot.append(footMetaEl(hint, [modelEl()]));
  return foot;
}

/** Paints the cartographer into the pane. card.js calls this from its render while the cartographer is open. */
export function renderChart(pane) {
  if (composing && pane.contains(document.activeElement)) return; // a rebuild now would destroy the word being composed
  const scale = app.scale ?? null;
  if (!guiding() && chart.scale !== scale) reset(scale); // the breadcrumb or the outline moved the map: the cartographer follows (the guide is the domain's)
  if (chart.version !== app.version) void load();
  const prevLog = pane.querySelector(":scope > .log");
  const prevTop = prevLog ? prevLog.scrollTop : 0;
  pane.hidden = false;
  pane.dataset.lens = speaker(); // the pane's accent: the lamp for the cartographer, the mentor's teal for the guide
  // Each part is drawn again only when what it is drawn from changed, and the keyboard stays where it was.
  keepFocus(pane, () => {
    keyedChildren(pane, [
      ...(gripEl ? [{ key: "grip", sig: "", build: gripEl }] : []),
      { key: "chart-head", sig: headSig(), build: headEl },
      { build: () => logEl(prevLog) },
      { key: "chart-foot", sig: footSig(), build: footEl },
    ]);
  });
  syncAnswer(pane.querySelector("#answer-form"), chart.draft, tray); // the page changed the draft itself: words given back by a failed send
  renderLive();
  const log = pane.querySelector(":scope > .log");
  if (log !== prevLog || follow.following) follow.toEnd();
  else log.scrollTop = prevTop;
}

/** The pane region's keys while the cartographer is open. Returns whether the key was used. */
export function chartKey(e) {
  const pane = document.getElementById("pane");
  const log = pane?.querySelector(".log");
  if (log && Object.hasOwn(SCROLL_BY, e.key)) {
    log.scrollBy(0, SCROLL_BY[e.key](log));
    return true;
  }
  // ← and → walk the pane's controls (Tab is the regions'), mid-turn too: Stop is one of them.
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") return roveFocus(pane, e.key === "ArrowRight" ? 1 : -1);
  const click = (sel) => {
    const found = [...pane.querySelectorAll(sel)];
    const b = found[found.length - 1]; // the latest, where the thread holds several
    if (!b || b.disabled) return false;
    b.click();
    return true;
  };
  if (e.key === "g") return click(".log .sail-go"); // follow the guide's pointer
  if (chart.inFlight) return false;
  if (e.key === "Enter") return focusChartAnswer();
  if (e.key === "r") return click("[data-fk='retry']");
  if (e.key === "l") return click("#landfall");
  return false;
}

/** ⌘↵ in the cartographer: approves the pending sketch, else sends what is in the box. `approve: false` only sends. */
export function chartSend({ approve = true } = {}) {
  if (approve && !guiding() && chart.sketch && !chart.inFlight && !chart.deciding) {
    void decideSketch(chart.sketch.id, "approve");
    return true;
  }
  const form = document.getElementById("pane")?.querySelector("#answer-form");
  const ta = document.getElementById("pane")?.querySelector("#answer");
  if (!form || !ta || chart.inFlight || !canSend({ text: ta.value, images: tray.ready().length, busy: tray.busy() || talkBusy(form.dataset.talk), disabled: ta.disabled })) return false;
  form.requestSubmit();
  return true;
}

/** Forgets the cartographer without repainting: an island was selected, and card.js is already painting it. */
export function dropChart() {
  if (!chart.open) return;
  turnAbort?.abort();
  stashDraft();
  chart.open = false;
  rememberOpen(null);
  reset(null, "cartographer");
}
