// The cartographer's pane: one thread per scale, the pending sketch as a card, and the turn in flight.
// card.js owns #pane and hands it over while the cartographer is open; nothing else here touches the map.
import { app, api, refresh, frameSelection } from "./app.js";
import { streamPost } from "./stream.js";
import { renderMarkdown } from "./markdown.js";
import { select } from "./interactions.js";
import { isImeKey } from "./keys-model.js";
import { chartOpening, sketchRows, sketchSummary } from "./chart-model.js";
import { thinkingLine } from "./progress-model.js";
import { thinkingEl } from "./thinking.js";

const STICK_PX = 40;
const LOG_STEP = 80;
const SCROLL_BY = {
  ArrowDown: () => LOG_STEP,
  ArrowUp: () => -LOG_STEP,
  PageDown: (log) => log.clientHeight * 0.9,
  PageUp: (log) => -log.clientHeight * 0.9,
};

const chart = {
  open: false,
  scale: null,        // the island whose islets this thread sketches; null at the top scale
  version: null,      // snapshot version the thread was fetched at; null forces a refetch
  messages: [],
  sketch: null,       // the pending sketch at this scale, from /api/thread
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
let rerender = () => {};

/** card.js passes its render: the cartographer asks for a repaint through it, since card.js owns the pane. */
export function installChart({ render }) {
  rerender = render;
}

export const isChartOpen = () => chart.open;
export const chartTurning = () => chart.inFlight && turnAbort !== null;
/** The tool in flight while the cartographer works at the map's scale (null while it thinks), or undefined when it is not working there. */
export const chartWorkingHere = () => (chart.inFlight && (chart.scale ?? null) === (app.scale ?? null) ? chart.progress : undefined);

function reset(scale) {
  turnGen += 1; // a stream from an earlier scale is no longer ours
  Object.assign(chart, { scale, version: null, messages: [], sketch: null, loaded: false, loadError: null, draft: "", live: "", progress: null, inFlight: false, error: null, stopped: false, deciding: false });
}

/**
 * Opens the cartographer at a scale (the map's current one by default). `start` runs the first turn without a
 * message, as a new domain or a sail-closer does; `message` sends one, as a note to the cartographer does.
 */
export function openChart(scale = app.scale ?? null, { start = false, message = null } = {}) {
  if (!chart.open || chart.scale !== scale) reset(scale);
  chart.open = true;
  if (app.selected) void select(null); // the island pane closes; its listeners repaint the pane as the cartographer's
  else rerender();
  frameSelection(); // the pane's width is settled: refit the map beside it
  if (message) void runTurn(message);
  else if (start) void runTurn(null);
}

export function closeChart() {
  if (!chart.open) return;
  turnAbort?.abort();
  chart.open = false;
  reset(null);
  rerender();
  frameSelection();
}

export function stopChartTurn() {
  if (!turnAbort) return false;
  turnAbort.abort();
  return true;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label, onClick, className = "btn") {
  const b = el("button", className, label);
  b.type = "button";
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

const atBottom = (log) => log.scrollHeight - log.scrollTop - log.clientHeight < STICK_PX;
const scaleQuery = () => (chart.scale ? `&island=${encodeURIComponent(chart.scale)}` : "");
const scaleName = () => app.snapshot?.scale.path.at(-1)?.name ?? app.snapshot?.domain.name ?? "";

async function load() {
  chart.version = app.version;
  const gen = ++loadGen;
  const scale = chart.scale;
  const stale = () => !chart.open || chart.scale !== scale || gen !== loadGen;
  try {
    const { messages, sketch } = await api(`/api/thread?domain=${encodeURIComponent(app.domain)}&mode=cartographer${scaleQuery()}`);
    if (stale()) return;
    chart.messages = messages;
    chart.sketch = sketch;
    chart.loaded = true;
    chart.loadError = null;
    chart.deciding = false; // a decision is complete once the refetched thread shows it
  } catch (error) {
    if (stale()) return;
    chart.deciding = false;
    chart.loadError = error.message;
  }
  rerender();
}

/** One cartographer turn at the open scale. `message` null starts it without a reader message. */
async function runTurn(message) {
  if (chart.inFlight || !chart.open) return;
  const gen = ++turnGen;
  const scale = chart.scale;
  const mine = () => chart.open && chart.scale === scale && gen === turnGen;
  Object.assign(chart, { inFlight: true, live: "", progress: null, error: null, stopped: false });
  const abort = new AbortController();
  turnAbort = abort;
  if (message) chart.messages = [...chart.messages, { id: `local-${Date.now()}`, role: "you", kind: "text", body: message }];
  rerender();
  try {
    await streamPost("/api/probe", { domain: app.domain, mode: "cartographer", ...(scale ? { island: scale } : {}), ...(message ? { message } : {}) }, (e) => {
      if (!mine()) return;
      if (e.type === "text") {
        chart.live += e.data.text;
        chart.progress = null;
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
    if (!mine()) return;
    if (error.aborted) chart.stopped = true;
    else chart.error = error.message;
    // Refused or stopped before the stream opened: the server stored nothing, so the words go back in the box.
    if (message && !error.midStream) chart.draft = message;
  }
  if (turnAbort === abort) turnAbort = null;
  if (!mine()) return;
  if (liveFrame) cancelAnimationFrame(liveFrame);
  liveFrame = 0;
  Object.assign(chart, { inFlight: false, live: "", progress: null, version: null }); // the reply and any sketch come back with the refetch
  rerender();
  void refresh(); // a proposed sketch draws as drafts on the map in the same beat
  focusChartAnswer();
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
    chart.error = error.message;
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
  const log = pane.querySelector(".log");
  if (!live || !progress || !log) return;
  const stuck = atBottom(log);
  if (chart.inFlight && !chart.live) {
    live.replaceChildren(thinkingEl(thinkingLine("the cartographer", chart.progress)));
  } else if (chart.live) {
    live.replaceChildren(renderMarkdown(chart.live));
  } else {
    live.replaceChildren();
  }
  live.hidden = !(chart.live || chart.inFlight);
  progress.textContent = chart.progress && chart.live ? `${thinkingLine("the cartographer", chart.progress)}…` : "";
  progress.hidden = !progress.textContent;
  if (stuck) log.scrollTop = log.scrollHeight;
}

export function focusChartAnswer() {
  const ta = document.getElementById("pane")?.querySelector("#answer");
  if (!ta || ta.disabled) return false;
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  return true;
}

// ---- the pane ----

function headEl() {
  const head = el("div", "head");
  const row = el("div", "row");
  row.append(el("h2", null, "Cartographer"));
  const pills = el("span", "pills");
  pills.append(el("span", "pill mode cartographer", chart.scale ? `islets of ${scaleName()}` : `top of ${scaleName()}`));
  row.append(pills);
  head.append(row);
  head.append(el("p", "summary", "Sketches the islands at this scale. Nothing is drawn until you approve the sketch."));
  const sub = el("div", "sub");
  sub.append(el("span", null, chart.sketch ? `sketch to approve · ${sketchSummary(chart.sketch.body, app.snapshot?.islands ?? [])}` : ""));
  const links = el("span", "links");
  links.append(button("Close", () => closeChart(), "link"));
  sub.append(links);
  head.append(sub);
  return head;
}

function sketchCard(sketch) {
  const card = el("div", "sketch-card");
  const rows = sketchRows(sketch.body, app.snapshot?.islands ?? []);
  card.append(el("div", "lbl", "sketch"), el("div", "sum", sketchSummary(sketch.body, app.snapshot?.islands ?? [])));
  if (rows.islands.length) {
    const list = el("ul", "isles");
    for (const i of rows.islands) {
      const li = el("li");
      const name = el("div", "name", i.name);
      if (i.harbour) name.append(el("span", "pill harbour", "harbour"));
      li.append(name, el("div", "blurb", i.summary), el("div", "marks", i.landmarks)); // not "about": that class is the About you dialog's
      list.append(li);
    }
    card.append(list);
  }
  if (rows.straits.length) card.append(el("div", "sec", "Straits"), el("div", "straits", rows.straits.join(" · ")));
  if (rows.seas.length) {
    card.append(el("div", "sec", "Seas"));
    for (const s of rows.seas) {
      const row = el("div", "update");
      row.append(el("span", "name", s.name), ` ${s.islands}`);
      card.append(row);
    }
  }
  if (rows.updates.length) {
    card.append(el("div", "sec", "Updates"));
    for (const u of rows.updates) card.append(el("div", "update", u));
  }
  if (rows.harbour) card.append(el("div", "sec", `Harbour: ${rows.harbour}`));
  const actions = el("div", "actions");
  const approve = button("Approve sketch", () => void decideSketch(sketch.id, "approve"));
  approve.id = "approve-sketch";
  const discard = button("Discard", () => void decideSketch(sketch.id, "discard"), "btn ghost");
  approve.disabled = discard.disabled = chart.deciding || chart.inFlight;
  actions.append(approve, discard);
  card.append(actions);
  return card;
}

function messageEl(m) {
  if (m.kind === "system") return el("div", "msg system", m.body);
  const box = el("div", `msg ${m.role === "you" ? "you" : "cartographer"}`);
  box.append(renderMarkdown(m.body));
  return box;
}

function logEl() {
  const log = el("div", "log");
  if (!chart.loaded) {
    log.append(el("p", chart.loadError ? "error" : "muted", chart.loadError ?? "loading the thread…"));
    return log;
  }
  if (chart.loadError) log.append(el("p", "muted", `could not refresh the thread: ${chart.loadError}`));
  if (chart.messages.length === 0 && !chart.inFlight && app.snapshot) {
    const opening = chartOpening(app.snapshot);
    const empty = el("div", "empty");
    empty.append(el("p", "muted", opening.text));
    if (opening.action) {
      const b = button(opening.action, () => void runTurn(null));
      b.id = "landfall";
      empty.append(b);
    }
    log.append(empty);
  }
  let placed = false;
  for (const m of chart.messages) {
    log.append(messageEl(m));
    if (chart.sketch && chart.sketch.messageId === m.id) {
      log.append(sketchCard(chart.sketch));
      placed = true;
    }
  }
  if (chart.sketch && !placed) log.append(sketchCard(chart.sketch)); // proposed in a turn whose reply was not kept
  const live = el("div", "msg cartographer");
  live.id = "live";
  live.hidden = true;
  const progress = el("div", "progress");
  progress.id = "progress";
  progress.hidden = true;
  log.append(live, progress);
  if (chart.stopped) log.append(el("div", "stopped", "stopped · the reply was not kept"));
  if (chart.error) log.append(el("div", "error", chart.error));
  return log;
}

function footEl() {
  const foot = el("div", "foot");
  const form = el("form");
  form.id = "answer-form";
  const ta = el("textarea");
  ta.id = "answer";
  ta.rows = 1;
  ta.disabled = !chart.loaded || chart.deciding;
  ta.placeholder = chart.sketch ? "say what to change in the sketch" : "ask for an island, a split, a better summary";
  ta.value = chart.draft;
  ta.addEventListener("input", () => {
    chart.draft = ta.value;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  });
  ta.addEventListener("compositionstart", () => (composing = true));
  ta.addEventListener("compositionend", () => {
    composing = false;
    chart.draft = ta.value;
  });
  ta.addEventListener("keydown", (e) => {
    if (isImeKey(e)) return;
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.append(ta);
  if (chart.inFlight && turnAbort) {
    const stop = button("Stop", () => stopChartTurn(), "btn ghost");
    stop.id = "stop";
    form.append(stop);
  } else {
    const send = button("Send", null, "btn send cartographer");
    send.type = "submit";
    send.disabled = ta.disabled;
    form.append(send);
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const body = ta.value.trim();
    if (!body || chart.inFlight) return;
    chart.draft = "";
    void runTurn(body);
  });
  foot.append(form);
  const meta = el("div", "meta");
  meta.append(el("span", null, chart.inFlight ? "Esc to stop" : chart.sketch ? "Enter to send · ⌘↵ approves the sketch" : "Enter to send · Shift-Enter for a new line"));
  foot.append(meta);
  return foot;
}

/** Paints the cartographer into the pane. card.js calls this from its render while the cartographer is open. */
export function renderChart(pane) {
  if (composing && pane.contains(document.activeElement)) return; // a rebuild now would destroy the word being composed
  const scale = app.scale ?? null;
  if (chart.scale !== scale) reset(scale); // the breadcrumb or the outline moved the map: the cartographer follows
  if (chart.version !== app.version) void load();
  const hadFocus = document.activeElement?.id === "answer";
  const prevLog = pane.querySelector(".log");
  const stuck = !prevLog || atBottom(prevLog);
  const prevTop = prevLog ? prevLog.scrollTop : 0;
  pane.hidden = false;
  pane.replaceChildren(headEl(), logEl(), footEl());
  renderLive();
  const log = pane.querySelector(".log");
  log.scrollTop = stuck ? log.scrollHeight : prevTop;
  if (hadFocus) focusChartAnswer();
}

/** The pane region's keys while the cartographer is open. Returns whether the key was used. */
export function chartKey(e) {
  const log = document.getElementById("pane")?.querySelector(".log");
  if (log && Object.hasOwn(SCROLL_BY, e.key)) {
    log.scrollBy(0, SCROLL_BY[e.key](log));
    return true;
  }
  if (chart.inFlight) return false;
  if (e.key === "Enter") return focusChartAnswer();
  if (e.key === "l") {
    const start = document.getElementById("pane")?.querySelector("#landfall");
    if (!start) return false;
    start.click();
    return true;
  }
  return false;
}

/** ⌘↵ in the cartographer: approves the pending sketch, else sends what is in the box. */
export function chartSend() {
  if (chart.sketch && !chart.inFlight && !chart.deciding) {
    void decideSketch(chart.sketch.id, "approve");
    return true;
  }
  const form = document.getElementById("pane")?.querySelector("#answer-form");
  const ta = document.getElementById("pane")?.querySelector("#answer");
  if (!form || !ta || ta.disabled || !ta.value.trim()) return false;
  form.requestSubmit();
  return true;
}

/** Forgets the cartographer without repainting: an island was selected, and card.js is already painting it. */
export function dropChart() {
  if (!chart.open) return;
  turnAbort?.abort();
  chart.open = false;
  reset(null);
}
