import { app, api, setScale, frameSelection, setMode } from "./app.js";
import { streamPost } from "./stream.js";
import { logItems, askFor, roundOf, systemText } from "./thread.js";
import { landmarkLit, allExplored } from "./view-model.js";
import { MODES, MODE_LABELS, MODE_ROLES, MODE_HINTS, PERSONA_NAMES, headPill, stateLabel } from "./mode-model.js";
import { t } from "./i18n.js";
import { thinkingLine } from "./progress-model.js";
import { thinkingEl } from "./thinking.js";
import { renderMarkdown } from "./markdown.js";
import { landmarkTerms } from "./term-model.js";
import { loadHighlighter } from "./code.js";
import { renderCta } from "./cta.js";
import { select } from "./interactions.js";
import { registerRegion, region } from "./keys.js";
import { isImeKey } from "./keys-model.js";
import { chartKey, chartSend, chartTurning, closeChart, decideSketch, dropChart, focusChartAnswer, installChart, isChartOpen, openChart, renderChart, stopChartTurn } from "./chart.js";

const pane = document.getElementById("pane");
const STICK_PX = 40;            // within this of the bottom, the log follows new content
const LOG_STEP = 80;            // one arrow's worth of the log
// How far each scroll key moves the log. Arrows step; Page keys take nearly a screen.
const SCROLL_BY = {
  ArrowDown: () => LOG_STEP,
  ArrowUp: () => -LOG_STEP,
  PageDown: (log) => log.clientHeight * 0.9,
  PageUp: (log) => -log.clientHeight * 0.9,
};
const ROUNDS = 4;
const PANE_MIN = 340;
const PANE_MAX = 960;

let noteDraft = "";       // note text survives re-renders
let noteOpen = false;     // the "Note to cartographer" field is showing
let renderId = 0;         // guards async appends against stale renders
let loadGen = 0;          // monotonic across islands, so a slow load can never overwrite a newer one
/** Bumped whenever the thread is reset or a turn starts: a stream only writes into the turn that started it. */
let turnGen = 0;
let turnAbort = null;    // the running turn's AbortController: Stop and Escape abort it
let composing = false;   // the answer box is mid-composition (an IME): a rebuild now would destroy the word
let renderHeld = false;  // a render came in while composing; it runs once the word is committed
let liveFrame = 0;        // pending animation frame for the streaming reply

// The one thread the page shows: the selected island's stored messages plus the turn in flight.
const thread = {
  slug: null,
  mode: "judge",      // whose thread: the judge's or the mentor's (app.mode when it was opened)
  version: null,      // snapshot version the messages were fetched at; null forces a refetch
  messages: [],
  asks: [],           // questions the judge has posed, with their options and any pick
  loaded: false,
  draft: "",
  live: "",           // the judge's reply as it streams
  progress: null,     // tool in flight, shown under the live text
  inFlight: false,
  error: null,        // a turn failed; the messages on screen are still good
  loadError: null,    // the thread itself could not be fetched
  disputeDraft: "",   // the objection typed while a reef is pending
  stopped: false,     // the last turn was stopped by the reader (Stop or Escape)
  stoppedDraft: null, // words an early stop gave back, until the refetch shows whether the server stored them
  litSeen: null,      // slugs already lit at the last render, so only newly lit chips pulse
  focusPending: false, // a turn ended before the answer box was usable; the next render focuses it
  answering: false,   // a reef answer is in flight: Confirm and Dispute are one-shot
  stay: false,        // the reader chose Stay here after a verdict: hide the "sail on" card
};

let terms = null; // the selected island's landmark words (`landmarkTerms`), marked in the persona's replies

/** Hovering a landmark chip lights its words in the thread, and hovering a word lights its chip. */
function lightLandmark(e, on) {
  const target = e.target.closest?.("[data-lm]");
  if (!target || !pane.contains(target)) return;
  for (const node of pane.querySelectorAll(`[data-lm="${CSS.escape(target.dataset.lm)}"]`)) node.classList.toggle("hot", on);
}

export function installCard() {
  pane.addEventListener("mouseover", (e) => lightLandmark(e, true));
  pane.addEventListener("mouseout", (e) => lightLandmark(e, false));
  document.addEventListener("theme", () => {
    if (!thread.slug) return;
    thread.version = null; // refetch: the log is rebuilt and its diagrams render in the new colours
    render();
  });
  try {
    const saved = parseFloat(localStorage.getItem("pane-w"));
    if (Number.isFinite(saved)) {
      const w = Math.min(PANE_MAX, Math.max(PANE_MIN, saved));
      document.documentElement.style.setProperty("--pane-w", `${w}px`);
    }
  } catch {
    /* storage unavailable */
  }
  app.listeners.add(() => render());
  loadHighlighter(() => render());
  installChart({ render: () => render() });
  registerRegion("pane", {
    focusAnswer: () => (isChartOpen() ? focusChartAnswer() : focusAnswer()),
    turning: () => (isChartOpen() ? chartTurning() : thread.inFlight && turnAbort !== null),
    stop: () => (isChartOpen() ? stopChartTurn() : stopTurn()),
    chartOpen: () => isChartOpen(),
    closeChart: () => closeChart(),
    send() {
      if (isChartOpen()) return chartSend();
      const form = pane.querySelector("#answer-form");
      const ta = pane.querySelector("#answer");
      if (!form || !ta || ta.disabled || !ta.value.trim()) return false;
      form.requestSubmit();
      return true;
    },
    onKey(e) {
      if (isChartOpen()) return chartKey(e);
      const log = pane.querySelector(".log");
      if (log && Object.hasOwn(SCROLL_BY, e.key)) { // reading the log is fine mid-turn, so this sits above the in-flight guard
        log.scrollBy(0, SCROLL_BY[e.key](log));
        return true;
      }
      const island = app.nodes.find((n) => n.slug === app.selected) ?? null;
      if (!island || thread.inFlight) return false;
      const click = (sel) => {
        const b = pane.querySelector(sel);
        if (!b || b.disabled) return false;
        b.click();
        return true;
      };
      switch (e.key) {
        case "Enter":
          return focusAnswer();
        case "l":
          return click("#landfall");
        case "n": {
          const note = pane.querySelector("#note");
          if (!note) return click("#note-toggle"); // opening it focuses it; a second n must not close it
          note.focus();
          return true;
        }
        case "c": {
          const p = thread.loaded ? logItems(thread.messages, island).find((i) => i.kind === "reef_proposal" && i.proposal.status === "pending") : null;
          if (!p || thread.answering) return false;
          void answerReef(island.slug, p.id, "confirm");
          return true;
        }
        case "d": // the dispute box is the answer box in reef mode
          return focusAnswer();
        case "1": case "2": case "3": case "4": {
          const ask = thread.loaded ? pendingAskOf() : null;
          const option = ask ? ask.options[Number(e.key) - 1] : undefined;
          if (!option || thread.answering) return false;
          answerAsk(island.slug, ask, option);
          return true;
        }
        default:
          return false;
      }
    },
  });
  render();
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

const pct = (v) => `${Math.round(v * 100)}%`;
const atBottom = (log) => log.scrollHeight - log.scrollTop - log.clientHeight < STICK_PX;

// Requests go to the cartographer, never to the Keeper: they open its pane at this scale.
const NOTE_HELP = t("card.noteHelp");

/** Sail closer: go inside the island and let the cartographer sketch its islets. */
async function sailCloser(island) {
  await setScale(island.slug);
  openChart(island.slug, { start: true });
}

function post(path, body) {
  return api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

/** Points the thread at another island, or another mode's thread, dropping everything from the previous one. */
function resetThread(slug, mode = app.mode) {
  turnGen += 1; // a stream still running from an earlier visit to this island is no longer ours
  Object.assign(thread, {
    slug, mode, version: null, messages: [], asks: [], loaded: false, draft: "", live: "", progress: null, inFlight: false, error: null, loadError: null,
    disputeDraft: "", stopped: false, stoppedDraft: null, litSeen: null, focusPending: false, answering: false, stay: false,
  });
  noteOpen = false;
}

async function loadThread(slug) {
  thread.version = app.version;
  const gen = ++loadGen;
  const mode = thread.mode;
  const stale = () => thread.slug !== slug || thread.mode !== mode || gen !== loadGen;
  try {
    const { messages, asks } = await api(
      `/api/thread?domain=${encodeURIComponent(app.domain)}&island=${encodeURIComponent(slug)}&mode=${encodeURIComponent(mode)}`,
    );
    if (stale()) return;
    thread.messages = messages;
    thread.asks = asks ?? [];
    if (thread.stoppedDraft !== null) {
      // An early stop gave the words back; if the server stored them after all, they are in the thread, not the box.
      if (thread.draft === thread.stoppedDraft && messages.some((m) => m.role === "you" && m.body === thread.stoppedDraft)) thread.draft = "";
      thread.stoppedDraft = null;
    }
    thread.loaded = true;
    thread.answering = false; // a reef answer is complete once the stored proposal status is back
    thread.loadError = null; // thread.error belongs to the last turn and stays until the next one
  } catch (error) {
    if (stale()) return;
    thread.answering = false; // do not wedge the buttons if the refetch fails
    thread.loadError = error.message; // version stays set: the next version change retries, a re-render does not
  }
  render();
}

/** Stops the running turn, as Loomy's Stop does: the request aborts, and the server stops the persona and keeps no reply. */
function stopTurn() {
  if (!turnAbort) return false;
  turnAbort.abort();
  return true;
}

/** One judge turn. `message` null opens or continues the thread without a new reader message. */
async function runTurn(slug, message, askId) {
  if (thread.inFlight || thread.slug !== slug) return;
  const gen = ++turnGen;
  const mode = thread.mode;
  const mine = () => thread.slug === slug && thread.mode === mode && gen === turnGen;
  const regionAtSend = region();
  thread.inFlight = true;
  thread.live = "";
  thread.progress = null;
  thread.error = null;
  thread.stopped = false;
  const abort = new AbortController();
  turnAbort = abort;
  if (message) thread.messages = [...thread.messages, { id: `local-${Date.now()}`, role: "you", kind: "text", body: message }];
  render();
  if (message) {
    const log = pane.querySelector(".log");
    if (log) log.scrollTop = log.scrollHeight; // sending is a request to watch the reply arrive
  }
  try {
    await streamPost("/api/probe", { domain: app.domain, island: slug, mode, ...(message ? { message } : {}), ...(askId ? { askId } : {}) }, (e) => {
      if (!mine()) return;
      if (e.type === "text") {
        thread.live += e.data.text;
        thread.progress = null;
        scheduleLive();
      } else if (e.type === "progress") {
        thread.progress = e.data.message;
        scheduleLive();
      } else if (e.type === "error") {
        thread.error = e.data.message;
      }
    }, abort.signal);
  } catch (error) {
    if (turnAbort === abort) turnAbort = null;
    if (!mine()) return; // the reader moved on; nothing here is theirs
    if (error.aborted) {
      // The reader stopped it. The server keeps no reply. Stopped mid-stream, their message is stored and comes
      // back with the refetch; stopped before the stream opened, it may never have arrived, so the words go back
      // in the box, and the refetch takes them out again if the server did store them.
      thread.stopped = true;
      if (message && !error.midStream) {
        thread.draft = message;
        thread.stoppedDraft = message;
      }
    } else {
      thread.error = error.message;
      // Refused or never sent: the server stored nothing, so the words go back in the box.
      // Broken mid-stream: the server may have stored them, and the refetch will show it.
      if (message && !error.midStream) thread.draft = message;
    }
  }
  if (turnAbort === abort) turnAbort = null;
  if (!mine()) return;
  cancelLive();
  thread.inFlight = false;
  thread.live = "";
  thread.progress = null;
  thread.version = null; // the stored reply and any system lines come back with the refetch
  render();
  // Focus the answer only if the reader is still where they sent from; Tab away mid-turn is a choice.
  if (region() !== regionAtSend) return;
  // The opening turn renders the box disabled until the refetched thread arrives: focus it then.
  if (!focusAnswer()) thread.focusPending = true;
}

/** The reader answers one of the Keeper's questions directly: it goes to the top of the draft as a quote. */
function quoteIntoAnswer(question) {
  const ta = pane.querySelector("#answer");
  if (!ta || ta.disabled) return;
  const line = `> ${question}`;
  const reef = ta.placeholder === t("card.disputePlaceholder");
  const current = reef ? thread.disputeDraft : thread.draft;
  if (!current.split("\n").includes(line)) {
    const next = current.trim() ? `${line}\n${current}` : `${line}\n`;
    if (reef) thread.disputeDraft = next;
    else thread.draft = next;
    render();
  }
  focusAnswer();
}

const pendingAskOf = () => [...thread.asks].reverse().find((a) => a.messageId !== null && a.picked === null) ?? null;

/** The reader chose an option, or typed instead of choosing: either way it is the next message. */
function answerAsk(slug, ask, body) {
  if (thread.inFlight || thread.slug !== slug) return;
  thread.draft = "";
  void runTurn(slug, body, ask.id);
}

async function answerReef(slug, id, answer, note) {
  if (thread.answering || thread.slug !== slug) return; // one answer per proposal: a second click does nothing
  thread.answering = true;
  render();
  let ok = false;
  try {
    await post("/api/probe/reef", { domain: app.domain, id, answer, ...(note ? { note } : {}) });
    if (thread.slug !== slug) return; // the reader moved on while the answer was in flight
    thread.disputeDraft = "";
    thread.version = null;
    // thread.answering stays true: Confirm/Dispute re-enable only once the refetched thread lands
    ok = true;
  } catch (error) {
    if (thread.slug !== slug) return; // the reader moved on; this failure is not theirs to see
    thread.error = error.message;
    thread.answering = false;
  }
  render();
  if (ok && answer === "dispute" && thread.slug === slug) await runTurn(slug, null);
}

// ---- streaming: one DOM write per animation frame, never one per delta ----

function scheduleLive() {
  if (liveFrame) return;
  liveFrame = requestAnimationFrame(() => {
    liveFrame = 0;
    renderLive();
  });
}

function cancelLive() {
  if (liveFrame) cancelAnimationFrame(liveFrame);
  liveFrame = 0;
}

/** Updates only the streaming parts, so deltas do not rebuild the pane. */
function renderLive() {
  const live = pane.querySelector("#live");
  const progress = pane.querySelector("#progress");
  const log = pane.querySelector(".log");
  if (!live || !progress || !log) return; // no list on screen yet; the full render at the end of the turn shows everything
  const stuck = atBottom(log);
  if (thread.inFlight && !thread.live) {
    // Nothing has arrived yet: the reply's own line says so, where the words will land.
    live.replaceChildren(thinkingEl(thinkingLine(PERSONA_NAMES[thread.mode], thread.progress)));
  } else if (thread.live) {
    live.replaceChildren(renderMarkdown(thread.live, { onQuestion: quoteIntoAnswer, lead: true, terms }));
    // Descend to the deepest last block (e.g. into a list's last <li>) so the caret
    // follows the last character rather than landing after the whole block; stop
    // above inline elements so it trails them instead of nesting inside.
    let tail = live;
    while (tail.lastElementChild && !["CODE", "STRONG", "EM", "BR"].includes(tail.lastElementChild.tagName)) tail = tail.lastElementChild;
    tail.append(el("span", "caret"));
  } else {
    live.replaceChildren();
  }
  live.hidden = !(thread.live || thread.inFlight);
  // Before any words, the waiting line itself names the step; once words stream, the step goes under them.
  progress.textContent = thread.progress && thread.live ? `${thinkingLine(PERSONA_NAMES[thread.mode], thread.progress)}…` : "";
  progress.hidden = !progress.textContent;
  if (stuck) log.scrollTop = log.scrollHeight;
}

/** Focuses the answer box if it can take input; returns whether it did. */
function focusAnswer() {
  const ta = pane.querySelector("#answer");
  if (!ta) {
    // Before the first turn there is no answer box: the start button takes the focus.
    const start = pane.querySelector("#landfall");
    start?.focus();
    return Boolean(start);
  }
  if (ta.disabled) return false;
  thread.focusPending = false;
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  return true;
}

function growAnswer(ta) {
  if (!ta) return;
  const log = pane.querySelector(".log");
  const stuck = log && atBottom(log);
  ta.style.height = "auto";
  ta.style.height = `${ta.scrollHeight}px`;
  if (stuck) log.scrollTop = log.scrollHeight; // a taller answer box shrinks the log; keep it at the bottom
}

// ---- head ----

/** Who answers here, beside the island's name: the Keeper or the mentor. It is the map's lens too (`m` switches it). */
function lensSwitchEl() {
  const wrap = el("div", "lens-switch");
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", t("card.lensLabel"));
  for (const m of MODES) {
    const b = button(MODE_LABELS[m], () => setMode(m), `seg ${m}${m === thread.mode ? " on" : ""}`);
    b.setAttribute("aria-pressed", String(m === thread.mode));
    b.title = `${MODE_ROLES[m]}\n${MODE_HINTS[m]}  [m]`;
    wrap.append(b);
  }
  return wrap;
}

function chipsEl(island) {
  const row = el("div", "chips");
  const on = thread.mode === "mentor" ? "explored" : "lit";
  for (const l of island.landmarks.items) {
    const lit = landmarkLit(l, thread.mode);
    const chip = el("span", `chip${lit ? ` ${on}` : ""}`, l.name);
    chip.dataset.lm = l.slug;
    if (lit && thread.mode === "judge" && l.evidence) chip.title = t("card.evidence", { evidence: l.evidence });
    if (lit && thread.litSeen && !thread.litSeen.has(l.slug)) chip.classList.add("just-lit");
    row.append(chip);
  }
  return row;
}

function noteForm(island) {
  const form = el("form", "note");
  const input = el("input");
  input.id = "note";
  input.placeholder = t("card.notePlaceholder");
  input.value = noteDraft;
  input.addEventListener("input", () => (noteDraft = input.value));
  const send = button(t("card.send"), null);
  send.type = "submit";
  form.append(input, send);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    noteDraft = "";
    noteOpen = false;
    openChart(app.scale ?? null, { message: t("card.noteMessage", { name: island.name, slug: island.slug, body }) });
  });
  return form;
}

function headEl(island) {
  const head = el("div", "head");
  const titlebar = el("div", "titlebar");
  titlebar.append(el("h2", null, island.name), lensSwitchEl());
  head.append(titlebar);
  const pill = headPill(island, thread.mode);
  const pills = el("span", "pills");
  pills.append(el("span", pill.cls, pill.text));
  if (island.harbour) pills.append(el("span", "pill harbour", t("card.harbour")));
  head.append(pills);
  if (island.summary) head.append(el("p", "summary", island.summary));
  const hasLandmarks = island.landmarks && island.landmarks.total > 0;
  if (hasLandmarks) head.append(chipsEl(island));

  const sub = el("div", "sub");
  const parts = [];
  if (hasLandmarks) {
    parts.push(
      thread.mode === "mentor"
        ? t("card.exploredOf", { explored: island.landmarks.explored ?? 0, total: island.landmarks.total })
        : t("card.chartedOf", { n: island.landmarks.unlocked, total: island.landmarks.total }),
    );
  }
  const round = thread.mode === "judge" ? roundOf(thread.messages) : 0; // the mentor has no rounds
  if (round > 0) parts.push(t("card.round", { n: Math.min(round, ROUNDS), total: ROUNDS })); // the opening turn is not a round yet
  sub.append(el("span", null, parts.join(t("card.partsJoin"))));
  const links = el("span", "links");
  if (island.hasChildren) links.append(button(t("card.sailIn"), () => setScale(island.slug), "link"));
  else links.append(button(t("card.sailCloser"), () => void sailCloser(island), "link"));
  const noteToggle = button(t("card.noteToggle"), () => {
    noteOpen = !noteOpen;
    render();
    if (noteOpen) pane.querySelector("#note")?.focus();
  }, "link");
  noteToggle.id = "note-toggle";
  links.append(noteToggle);
  // On a phone the pane covers the map and its board button, and there is no Escape key: these two reach them.
  links.append(button(t("card.board"), () => document.getElementById("board-toggle").click(), "link phone-only"));
  links.append(button(t("card.map"), () => void select(null), "link phone-only pane-close"));
  sub.append(links);
  head.append(sub);

  if (island.children.total) {
    const b = island.children.byState;
    head.append(
      el("p", "muted", t("card.islets", { total: island.children.total, mountainous: b.mountainous, settled: b.settled, sandbar: b.sandbar, reef: b.reef, open: b.open })),
    );
  }
  const earlier = el("div", "earlier");
  earlier.id = "earlier";
  earlier.hidden = true; // filled by renderHistory when the island has more than one verdict
  head.append(earlier);
  if (noteOpen) head.append(noteForm(island), el("p", "note-help", NOTE_HELP));
  return head;
}

// ---- log ----

function retryButton() {
  const actions = el("div", "actions");
  actions.append(
    button(t("card.retry"), () => {
      thread.version = null; // the render below refetches
      render();
    }),
  );
  return actions;
}

function verdictEl(v) {
  const card = el("div", "verdict-card");
  const row = el("div", "row");
  row.append(el("span", `pill${v.state === "reef" ? " reef" : ""}`, t("card.chartedAs", { state: stateLabel(v.state) })));
  row.append(el("span", "conf", t("card.confidence", { pct: pct(v.confidence), date: v.at.slice(0, 10) })));
  card.append(row);
  card.append(el("q", null, v.evidence));
  if (v.rationale) card.append(el("div", "why", v.rationale));
  return card;
}

/** The reef the judge proposed. The reader answers it in the foot, not here. */
function reefEl(item) {
  const p = item.proposal;
  const box = el("div", "reef-block");
  box.append(el("div", "reef-title", t("card.reefTitle")));
  box.append(el("p", null, p.claim));
  box.append(el("p", "muted", t("card.ifSo", { consequence: p.consequence })));
  const status = t(p.status === "pending" ? "card.reefPending" : p.status === "confirmed" ? "card.reefConfirmed" : "card.reefDisputed");
  box.append(el("div", "muted", status));
  return box;
}

function choicesEl(ask, reefPending) {
  const box = el("div", "choices");
  box.append(el("div", "q", t(ask.picked !== null ? "card.youChose" : "card.chooseOne")));
  for (const option of ask.options) {
    const b = button(option, () => answerAsk(thread.slug, ask, option), "choice");
    if (ask.picked !== null) {
      b.disabled = true;
      if (ask.picked === option) b.classList.add("picked");
    } else if (thread.inFlight || reefPending) {
      b.disabled = true;
    }
    box.append(b);
  }
  return box;
}

function itemEl(item, reefPending) {
  if (item.kind === "landmark") return el("div", "lit-line", `◆ ${item.names.join(" · ")}`);
  if (item.kind === "explored") return el("div", "explored-line", `◇ ${item.names.join(" · ")}`);
  if (item.kind === "verdict") return verdictEl(item.verdict);
  if (item.kind === "system") return el("div", "msg system", systemText(item.text));
  if (item.kind === "reef_proposal") return reefEl(item);
  const m = el("div", `msg ${item.role}`);
  const persona = item.role === "judge" || item.role === "mentor";
  m.append(renderMarkdown(item.text, persona ? { onQuestion: quoteIntoAnswer, lead: true, terms } : {}));
  const ask = persona ? askFor(thread.asks, item.id) : null;
  if (ask) m.append(choicesEl(ask, reefPending));
  return m;
}

function logEl(island) {
  const log = el("div", "log");
  if (!thread.loaded) {
    if (!thread.loadError) {
      log.append(el("p", "muted", t("card.loading")));
      return log;
    }
    log.append(el("p", "error", thread.loadError), retryButton());
    return log;
  }
  if (thread.loadError) {
    // the messages below are the last good ones; only the refetch failed
    log.append(el("p", "muted", t("card.refreshFailed", { error: thread.loadError })), retryButton());
  }
  const items = logItems(thread.messages, island);
  if (items.length === 0 && !thread.inFlight) {
    if (thread.mode === "judge" && island.verdict) log.append(verdictEl(island.verdict));
    log.append(briefingEl(island));
    if (thread.error) log.append(el("div", "error", thread.error));
    return log;
  }
  // a verdict written from the terminal has no system line; show it at the top of the judge's log
  if (thread.mode === "judge" && island.verdict && !items.some((i) => i.kind === "verdict")) log.append(verdictEl(island.verdict));
  const reefPending = Boolean(items.find((i) => i.kind === "reef_proposal" && i.proposal.status === "pending"));
  for (const item of items) log.append(itemEl(item, reefPending));
  const live = el("div", `msg ${thread.mode}`);
  live.id = "live";
  live.hidden = true;
  const progress = el("div", "progress");
  progress.id = "progress";
  progress.hidden = true;
  log.append(live, progress);
  if (thread.stopped) log.append(el("div", "stopped", t("card.stopped")));
  if (thread.error) log.append(el("div", "error", thread.error));
  return log;
}

/** The persona's mark: the Keeper's lamp, the mentor's compass needle. Built as SVG nodes, never markup. */
function lensGlyph(mode) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 56 56");
  svg.setAttribute("class", "glyph");
  svg.setAttribute("aria-hidden", "true");
  const add = (tag, attrs) => {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    svg.append(node);
  };
  add("circle", { cx: 28, cy: 28, r: 26, class: "ring" });
  if (mode === "mentor") {
    add("path", { d: "M28 9 L33 28 L28 47 L23 28 Z", class: "needle" });
    add("path", { d: "M28 9 L33 28 L23 28 Z", class: "fill" });
  } else {
    add("circle", { cx: 28, cy: 28, r: 17, class: "beam" });
    add("circle", { cx: 28, cy: 28, r: 6, class: "fill" });
  }
  return svg;
}

/**
 * Before the first turn: who you are with, what happens and how it ends, and the one button that starts it. The
 * answer box stays away until there is something to answer (`footEl`).
 */
function briefingEl(island) {
  const mentor = thread.mode === "mentor";
  const kind = mentor ? "Mentor" : "Keeper";
  const box = el("div", `briefing ${thread.mode}`);
  box.append(lensGlyph(thread.mode), el("h3", null, t(`card.brief${kind}Title`)));
  const steps = el("ol", "steps");
  [1, 2, 3].forEach((n) => {
    const li = el("li");
    li.append(el("span", "n", String(n)), el("span", null, t(`card.brief${kind}Step${n}`)));
    steps.append(li);
  });
  box.append(steps);
  const label = mentor ? t("card.startExploring") : t(island.verdict ? "card.exploreIt" : "card.makeLandfall");
  const start = button(label, () => void runTurn(island.slug, null), `btn primary ${thread.mode}`);
  start.id = "landfall";
  box.append(start, el("p", "sub", t("card.briefSwitch")));
  return box;
}

// ---- foot ----

function footEl(island) {
  const foot = el("div", "foot");
  const form = el("form");
  form.id = "answer-form";
  const ta = el("textarea");
  ta.id = "answer";
  ta.rows = 1;
  const pending = thread.loaded ? logItems(thread.messages, island).find((i) => i.kind === "reef_proposal" && i.proposal.status === "pending") : null;
  const ask = thread.loaded && !pending ? pendingAskOf() : null;
  const empty = thread.messages.length === 0;
  const busy = thread.inFlight || thread.answering;
  ta.disabled = !thread.loaded || busy || empty;
  ta.placeholder = pending
      ? t("card.disputePlaceholder")
      : empty
        ? thread.mode === "mentor"
          ? t("card.beginMentor")
          : t(island.verdict ? "card.beginExplore" : "card.beginLandfall")
        : ask
          ? t("card.ownWords")
          : t(thread.mode === "mentor" ? "card.mentorPlaceholder" : "card.answerPlaceholder");
  ta.value = pending ? thread.disputeDraft : thread.draft;
  ta.addEventListener("input", () => {
    if (pending) thread.disputeDraft = ta.value;
    else thread.draft = ta.value;
    growAnswer(ta);
  });
  ta.addEventListener("compositionstart", () => {
    composing = true;
  });
  ta.addEventListener("compositionend", () => {
    composing = false;
    if (pending) thread.disputeDraft = ta.value;
    else thread.draft = ta.value;
    // A rebuild held back while the word was composed runs now, after the key that committed it has finished.
    if (renderHeld) setTimeout(() => {
      if (!composing && renderHeld) render();
    }, 0);
  });
  ta.addEventListener("keydown", (e) => {
    if (isImeKey(e)) return; // Enter picking a Zhuyin candidate is the input method's, never a send
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.append(ta);
  if (pending) {
    const dispute = button(t("card.dispute"), null, "btn ghost");
    dispute.type = "submit";
    dispute.disabled = busy;
    form.append(dispute);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (busy) return;
      void answerReef(island.slug, pending.id, "dispute", ta.value.trim() || undefined);
    });
  } else {
    if (thread.inFlight && turnAbort) {
      // While a reply streams, Send is Stop (Escape does the same).
      const stop = button(t("card.stop"), () => stopTurn(), "btn ghost");
      stop.type = "button";
      stop.id = "stop";
      form.append(stop);
    } else {
      const send = button(t("card.send"), null, `btn send ${thread.mode}`); // tinted by who it goes to, like the head's mode pill
      send.type = "submit";
      send.disabled = ta.disabled;
      form.append(send);
    }
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const body = ta.value.trim();
      if (!body || thread.inFlight) return;
      if (ask) answerAsk(island.slug, ask, body);
      else {
        thread.draft = "";
        void runTurn(island.slug, body);
      }
    });
  }
  foot.append(form);
  const meta = el("div", "meta");
  meta.append(el("span", null, t(pending ? "card.metaReef" : thread.inFlight ? "card.metaStop" : "card.metaSend")));
  foot.append(meta);
  return foot;
}

// ---- the pane ----

/** The model handed to renderCta, shared by the "no island selected" and normal render paths. */
function ctaModel(island) {
  const judging = thread.mode === "judge";
  return {
    island,
    pendingReef: judging && island && thread.loaded ? logItems(thread.messages, island).find((i) => i.kind === "reef_proposal" && i.proposal.status === "pending") ?? null : null,
    verdict: judging && island ? island.verdict : null,
    handoff: !judging && Boolean(island) && allExplored(island),
    inFlight: thread.inFlight,
    answering: thread.answering,
    stay: thread.stay,
    nearest: nearestOpen(),
    onConfirm: () => {
      const p = logItems(thread.messages, island).find((i) => i.kind === "reef_proposal" && i.proposal.status === "pending");
      if (p) void answerReef(island.slug, p.id, "confirm");
    },
    onDispute: () => focusAnswer(),
    onSail: (slug) => void select(slug),
    onStay: () => {
      thread.stay = true;
      render();
    },
    onHandoff: () => setMode("judge"),
    // The cartographer's pending sketch at this scale: approve it from the map, or open its pane to read it.
    sketch: app.snapshot?.sketch ?? null,
    chartOpen: isChartOpen(),
    onApproveSketch: (id) => void decideSketch(id, "approve"),
    onOpenChart: () => openChart(),
  };
}

function render() {
  if (composing && pane.contains(document.activeElement)) {
    renderHeld = true; // rebuilding now would destroy the word being composed; compositionend runs it
    return;
  }
  renderHeld = false;
  const s = app.snapshot;
  const island = s && app.selected ? s.islands.find((i) => i.slug === app.selected) : null;
  if (island) dropChart(); // selecting an island closes the cartographer; the island takes the pane
  else if (isChartOpen() && s) {
    document.body.classList.add("pane-open");
    if (thread.slug !== null) resetThread(null);
    renderChart(pane);
    renderCta(ctaModel(null));
    return;
  }
  document.body.classList.toggle("pane-open", Boolean(island));
  if (!island) {
    pane.hidden = true;
    pane.replaceChildren();
    if (thread.slug !== null) resetThread(null);
    renderCta(ctaModel(island));
    return;
  }
  if (thread.slug !== island.slug || thread.mode !== app.mode) {
    resetThread(island.slug);
    void loadThread(island.slug);
  } else if (thread.version !== app.version) {
    void loadThread(island.slug); // also mid-turn: a verdict's system line shows in the same beat as the map
  }

  const hadFocus = document.activeElement && document.activeElement.id === "answer";
  const hadNoteFocus = document.activeElement && document.activeElement.id === "note";
  const prevLog = pane.querySelector(".log");
  const stuck = !prevLog || atBottom(prevLog);
  const prevTop = prevLog ? prevLog.scrollTop : 0;

  pane.hidden = false;
  terms = landmarkTerms(island.landmarks.items);
  // Before the first turn the briefing holds the start button; the answer box comes with the first reply.
  const briefing = thread.loaded && thread.messages.length === 0 && !thread.inFlight;
  pane.replaceChildren(headEl(island), logEl(island), ...(briefing ? [] : [footEl(island)]));
  pane.prepend(gripEl());
  growAnswer(pane.querySelector("#answer"));
  renderLive();
  const log = pane.querySelector(".log");
  log.scrollTop = stuck ? log.scrollHeight : prevTop;
  if (hadNoteFocus) {
    const note = pane.querySelector("#note");
    if (note) {
      note.focus();
      note.setSelectionRange(note.value.length, note.value.length);
    }
  }
  if (hadFocus || thread.focusPending) focusAnswer();
  // Remember which chips are lit so the next render can pulse only the newly lit ones.
  thread.litSeen = new Set((island.landmarks?.items ?? []).filter((l) => landmarkLit(l, thread.mode)).map((l) => l.slug));
  void renderHistory(island, ++renderId);
  renderCta(ctaModel(island));
}

/** The first island in nearest open water at this scale, as { slug, name }, or null. */
function nearestOpen() {
  const s = app.snapshot;
  if (!s || !s.nearestOpenWater.length) return null;
  const slug = s.nearestOpenWater[0];
  const i = s.islands.find((x) => x.slug === slug);
  return i ? { slug, name: i.name } : null;
}

function gripEl() {
  const grip = el("div", "grip");
  grip.title = t("card.resize");
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    pane.classList.add("resizing");
    const badge = el("div", "pane-width");
    document.body.append(badge);
    let last;
    const move = (ev) => {
      const w = Math.min(PANE_MAX, Math.max(PANE_MIN, window.innerWidth - ev.clientX));
      last = w;
      document.documentElement.style.setProperty("--pane-w", `${w}px`);
      badge.textContent = `${Math.round(w)}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      pane.classList.remove("resizing");
      badge.remove();
      if (last !== undefined) {
        try {
          localStorage.setItem("pane-w", `${last}px`);
        } catch {
          /* storage unavailable */
        }
      }
      frameSelection();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
  return grip;
}

async function renderHistory(island, id) {
  try {
    const { history } = await api(`/api/history?domain=${encodeURIComponent(app.domain)}&target=island:${encodeURIComponent(island.slug)}`);
    if (id !== renderId || app.selected !== island.slug || history.length < 2) return;
    const earlier = pane.querySelector("#earlier");
    if (!earlier) return;
    earlier.textContent = t("card.earlier", { list: history.slice(1).map((v) => t("card.earlierItem", { state: stateLabel(v.state), date: v.createdAt.slice(0, 10) })).join(t("card.earlierJoin")) });
    earlier.hidden = false;
  } catch (error) {
    console.error(error);
  }
}
