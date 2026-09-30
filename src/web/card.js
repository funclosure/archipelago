import { app, api, setScale, frameSelection } from "./app.js";
import { streamPost } from "./stream.js";
import { logItems, askFor, roundOf } from "./thread.js";
import { renderMarkdown } from "./markdown.js";
import { loadHighlighter } from "./code.js";
import { renderCta } from "./cta.js";
import { select } from "./interactions.js";
import { registerRegion, region } from "./keys.js";

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
const PANE_MAX = 760;

let noteDraft = "";       // note text survives re-renders
let noteOpen = false;     // the "Note to cartographer" field is showing
let lastSent = null;      // { slug, text } shown under the head
let renderId = 0;         // guards async appends against stale renders
let loadGen = 0;          // monotonic across islands, so a slow load can never overwrite a newer one
/** Bumped whenever the thread is reset or a turn starts: a stream only writes into the turn that started it. */
let turnGen = 0;
let liveFrame = 0;        // pending animation frame for the streaming reply

// The one thread the page shows: the selected island's stored messages plus the turn in flight.
const thread = {
  slug: null,
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
  litSeen: null,      // slugs already lit at the last render, so only newly lit chips pulse
  focusPending: false, // a turn ended before the answer box was usable; the next render focuses it
  answering: false,   // a reef answer is in flight: Confirm and Dispute are one-shot
  stay: false,        // the reader chose Stay here after a verdict: hide the "sail on" card
};

export function installCard() {
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
  registerRegion("pane", {
    focusAnswer: () => focusAnswer(),
    send() {
      const form = pane.querySelector("#answer-form");
      const ta = pane.querySelector("#answer");
      if (!form || !ta || ta.disabled || !ta.value.trim()) return false;
      form.requestSubmit();
      return true;
    },
    onKey(e) {
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

// Requests go to the cartographer (Claude in the terminal), never to the Keeper: say where they are read.
const SENT_TEXT = {
  sail_closer: "Asked the cartographer to sketch this island's islets. It reads requests in the terminal: run /archipelago-chart there.",
  note: "Note sent to the cartographer. It reads notes in the terminal at the start of its next charting turn: run /archipelago-chart there. The Keeper never sees it.",
};
const NOTE_HELP = "For the cartographer, Claude in the terminal, who sketches the map: a wrong summary, a split you want, where to sail next. The Keeper never sees it.";

async function sendComment(island, kind, body) {
  try {
    await api("/api/comment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: app.domain, targetType: "island", targetId: island.slug, body, kind }),
    });
    lastSent = { slug: island.slug, text: SENT_TEXT[kind] };
  } catch (error) {
    lastSent = { slug: island.slug, text: `Could not send: ${error.message}` };
  }
  render();
}

function post(path, body) {
  return api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

/** Points the thread at another island, dropping everything from the previous one. */
function resetThread(slug) {
  turnGen += 1; // a stream still running from an earlier visit to this island is no longer ours
  Object.assign(thread, {
    slug, version: null, messages: [], asks: [], loaded: false, draft: "", live: "", progress: null, inFlight: false, error: null, loadError: null,
    disputeDraft: "", litSeen: null, focusPending: false, answering: false, stay: false,
  });
  noteOpen = false;
}

async function loadThread(slug) {
  thread.version = app.version;
  const gen = ++loadGen;
  try {
    const { messages, asks } = await api(`/api/thread?domain=${encodeURIComponent(app.domain)}&island=${encodeURIComponent(slug)}`);
    if (thread.slug !== slug || gen !== loadGen) return;
    thread.messages = messages;
    thread.asks = asks ?? [];
    thread.loaded = true;
    thread.answering = false; // a reef answer is complete once the stored proposal status is back
    thread.loadError = null; // thread.error belongs to the last turn and stays until the next one
  } catch (error) {
    if (thread.slug !== slug || gen !== loadGen) return;
    thread.answering = false; // do not wedge the buttons if the refetch fails
    thread.loadError = error.message; // version stays set: the next version change retries, a re-render does not
  }
  render();
}

/** One judge turn. `message` null opens or continues the thread without a new reader message. */
async function runTurn(slug, message, askId) {
  if (thread.inFlight || thread.slug !== slug) return;
  const gen = ++turnGen;
  const mine = () => thread.slug === slug && gen === turnGen;
  const regionAtSend = region();
  thread.inFlight = true;
  thread.live = "";
  thread.progress = null;
  thread.error = null;
  if (message) thread.messages = [...thread.messages, { id: `local-${Date.now()}`, role: "you", kind: "text", body: message }];
  render();
  if (message) {
    const log = pane.querySelector(".log");
    if (log) log.scrollTop = log.scrollHeight; // sending is a request to watch the reply arrive
  }
  try {
    await streamPost("/api/probe", { domain: app.domain, island: slug, ...(message ? { message } : {}), ...(askId ? { askId } : {}) }, (e) => {
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
    });
  } catch (error) {
    if (!mine()) return; // the reader moved on; nothing here is theirs
    thread.error = error.message;
    // Refused or never sent: the server stored nothing, so the words go back in the box.
    // Broken mid-stream: the server may have stored them, and the refetch will show it.
    if (message && !error.midStream) thread.draft = message;
  }
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
  const reef = ta.placeholder === "what is wrong with this reef";
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
    const thinking = el("span", "thinking", "the Keeper is thinking");
    thinking.append(el("span", "caret"));
    live.replaceChildren(thinking);
  } else if (thread.live) {
    live.replaceChildren(renderMarkdown(thread.live, { onQuestion: quoteIntoAnswer }));
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
  progress.textContent = thread.progress ? `the Keeper: ${thread.progress}` : "";
  progress.hidden = !thread.progress;
  if (stuck) log.scrollTop = log.scrollHeight;
}

/** Focuses the answer box if it can take input; returns whether it did. */
function focusAnswer() {
  const ta = pane.querySelector("#answer");
  if (!ta || ta.disabled) return false;
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

function chipsEl(island) {
  const row = el("div", "chips");
  for (const l of island.landmarks.items) {
    const chip = el("span", `chip${l.lit ? " lit" : ""}`, l.name);
    if (l.lit && l.evidence) chip.title = `“${l.evidence}”`;
    if (l.lit && thread.litSeen && !thread.litSeen.has(l.slug)) chip.classList.add("just-lit");
    row.append(chip);
  }
  return row;
}

function noteForm(island) {
  const form = el("form", "note");
  const input = el("input");
  input.id = "note";
  input.placeholder = "a note for the cartographer";
  input.value = noteDraft;
  input.addEventListener("input", () => (noteDraft = input.value));
  const send = button("Send", null);
  send.type = "submit";
  form.append(input, send);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    noteDraft = "";
    noteOpen = false;
    void sendComment(island, "note", body);
  });
  return form;
}

function headEl(island) {
  const head = el("div", "head");
  const row = el("div", "row");
  row.append(el("h2", null, island.name));
  const v = island.verdict;
  const pillText = v ? `${v.state} · ${pct(v.confidence)}` : island.children.total ? "open water · islets below" : "open water";
  const pills = el("span", "pills");
  pills.append(el("span", `pill${v ? (v.state === "reef" ? " reef" : "") : " open"}`, pillText));
  if (island.harbour) pills.append(el("span", "pill harbour", "harbour"));
  row.append(pills);
  head.append(row);
  if (island.summary) head.append(el("p", "summary", island.summary));
  const hasLandmarks = island.landmarks && island.landmarks.total > 0;
  if (hasLandmarks) head.append(chipsEl(island));

  const sub = el("div", "sub");
  const parts = [];
  if (hasLandmarks) parts.push(`${island.landmarks.unlocked} of ${island.landmarks.total} charted`);
  const round = roundOf(thread.messages);
  if (round > 0) parts.push(`round ${Math.min(round, ROUNDS)} of ${ROUNDS}`); // the opening turn is not a round yet
  sub.append(el("span", null, parts.join(" · ")));
  const links = el("span", "links");
  if (island.hasChildren) links.append(button("Sail in", () => setScale(island.slug), "link"));
  else links.append(button("Sail closer", () => sendComment(island, "sail_closer", ""), "link"));
  const noteToggle = button("Note to cartographer", () => {
    noteOpen = !noteOpen;
    render();
    if (noteOpen) pane.querySelector("#note")?.focus();
  }, "link");
  noteToggle.id = "note-toggle";
  links.append(noteToggle);
  sub.append(links);
  head.append(sub);

  if (island.children.total) {
    const b = island.children.byState;
    head.append(
      el("p", "muted", `${island.children.total} islets: ${b.mountainous} mountainous, ${b.settled} settled, ${b.sandbar} sandbar, ${b.reef} reef, ${b.open} open`),
    );
  }
  const earlier = el("div", "earlier");
  earlier.id = "earlier";
  earlier.hidden = true; // filled by renderHistory when the island has more than one verdict
  head.append(earlier);
  if (noteOpen) head.append(noteForm(island), el("p", "note-help", NOTE_HELP));
  if (lastSent && lastSent.slug === island.slug) head.append(el("div", "sent", lastSent.text));
  return head;
}

// ---- log ----

function retryButton() {
  const actions = el("div", "actions");
  actions.append(
    button("Retry", () => {
      thread.version = null; // the render below refetches
      render();
    }),
  );
  return actions;
}

function verdictEl(v) {
  const card = el("div", "verdict-card");
  const row = el("div", "row");
  row.append(el("span", `pill${v.state === "reef" ? " reef" : ""}`, `charted as ${v.state}`));
  row.append(el("span", "conf", `confidence ${pct(v.confidence)} · ${v.at.slice(0, 10)}`));
  card.append(row);
  card.append(el("q", null, v.evidence));
  if (v.rationale) card.append(el("div", "why", v.rationale));
  return card;
}

/** The reef the judge proposed. The reader answers it in the foot, not here. */
function reefEl(item) {
  const p = item.proposal;
  const box = el("div", "reef-block");
  box.append(el("div", "reef-title", "Reef?"));
  box.append(el("p", null, p.claim));
  box.append(el("p", "muted", `If so: ${p.consequence}`));
  const status = p.status === "pending" ? "pending — answer below" : p.status === "confirmed" ? "confirmed, charted as reef" : "disputed";
  box.append(el("div", "muted", status));
  return box;
}

function choicesEl(ask, reefPending) {
  const box = el("div", "choices");
  box.append(el("div", "q", ask.picked !== null ? "you chose" : "choose one, or answer below"));
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
  if (item.kind === "verdict") return verdictEl(item.verdict);
  if (item.kind === "system") return el("div", "msg system", item.text);
  if (item.kind === "reef_proposal") return reefEl(item);
  const m = el("div", `msg ${item.role}`);
  m.append(renderMarkdown(item.text, item.role === "judge" ? { onQuestion: quoteIntoAnswer } : {}));
  const ask = item.role === "judge" ? askFor(thread.asks, item.id) : null;
  if (ask) m.append(choicesEl(ask, reefPending));
  return m;
}

function logEl(island) {
  const log = el("div", "log");
  if (!thread.loaded) {
    if (!thread.loadError) {
      log.append(el("p", "muted", "loading the thread…"));
      return log;
    }
    log.append(el("p", "error", thread.loadError), retryButton());
    return log;
  }
  if (thread.loadError) {
    // the messages below are the last good ones; only the refetch failed
    log.append(el("p", "muted", `could not refresh the thread: ${thread.loadError}`), retryButton());
  }
  const items = logItems(thread.messages, island);
  if (items.length === 0 && !thread.inFlight) {
    const empty = el("div", "empty");
    if (island.verdict) empty.append(verdictEl(island.verdict));
    empty.append(el("p", "muted", island.verdict ? "No thread yet. The Keeper asks first." : "Unsurveyed. The Keeper asks first."));
    const b = button(island.verdict ? "Explore it" : "Make landfall", () => void runTurn(island.slug, null));
    b.id = "landfall";
    empty.append(b);
    log.append(empty);
    if (thread.error) log.append(el("div", "error", thread.error));
    return log;
  }
  // a verdict written from the terminal has no system line; show it at the top of the log
  if (island.verdict && !items.some((i) => i.kind === "verdict")) log.append(verdictEl(island.verdict));
  const reefPending = Boolean(items.find((i) => i.kind === "reef_proposal" && i.proposal.status === "pending"));
  for (const item of items) log.append(itemEl(item, reefPending));
  const live = el("div", "msg judge");
  live.id = "live";
  live.hidden = true;
  const progress = el("div", "progress");
  progress.id = "progress";
  progress.hidden = true;
  log.append(live, progress);
  if (thread.error) log.append(el("div", "error", thread.error));
  return log;
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
      ? "what is wrong with this reef"
      : empty
        ? island.verdict ? "press Explore it to begin" : "press Make landfall to begin"
        : ask
          ? "or answer in your own words"
          : "your answer";
  ta.value = pending ? thread.disputeDraft : thread.draft;
  ta.addEventListener("input", () => {
    if (pending) thread.disputeDraft = ta.value;
    else thread.draft = ta.value;
    growAnswer(ta);
  });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.append(ta);
  if (pending) {
    const dispute = button("Dispute", null, "btn ghost");
    dispute.type = "submit";
    dispute.disabled = busy;
    form.append(dispute);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (busy) return;
      void answerReef(island.slug, pending.id, "dispute", ta.value.trim() || undefined);
    });
  } else {
    const send = button("Send", null);
    send.type = "submit";
    send.disabled = ta.disabled;
    form.append(send);
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
  meta.append(el("span", null, pending ? "Confirm at the bottom of the map · Dispute sends your objection" : "Enter to send · Shift-Enter for a new line"));
  foot.append(meta);
  return foot;
}

// ---- the pane ----

/** The model handed to renderCta, shared by the "no island selected" and normal render paths. */
function ctaModel(island) {
  return {
    island,
    pendingReef: island && thread.loaded ? logItems(thread.messages, island).find((i) => i.kind === "reef_proposal" && i.proposal.status === "pending") ?? null : null,
    verdict: island ? island.verdict : null,
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
  };
}

function render() {
  const s = app.snapshot;
  const island = s && app.selected ? s.islands.find((i) => i.slug === app.selected) : null;
  document.body.classList.toggle("pane-open", Boolean(island));
  if (!island) {
    pane.hidden = true;
    pane.replaceChildren();
    if (thread.slug !== null) resetThread(null);
    renderCta(ctaModel(island));
    return;
  }
  if (thread.slug !== island.slug) {
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
  pane.replaceChildren(headEl(island), logEl(island), footEl(island));
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
  thread.litSeen = new Set((island.landmarks?.items ?? []).filter((l) => l.lit).map((l) => l.slug));
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
  grip.title = "drag to resize";
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
    earlier.textContent = `earlier: ${history.slice(1).map((v) => `${v.state} · ${v.createdAt.slice(0, 10)}`).join("; ")}`;
    earlier.hidden = false;
  } catch (error) {
    console.error(error);
  }
}
