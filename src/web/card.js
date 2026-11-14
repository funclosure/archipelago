import { app, api, setScale, frameSelection, setMode } from "./app.js";
import { streamPost } from "./stream.js";
import { logItems, askFor, roundOf, systemText } from "./thread.js";
import { landmarkLit, allExplored, startIsland } from "./view-model.js";
import { MODES, MODE_LABELS, MODE_HINTS, PERSONA_NAMES, headPill, stateLabel } from "./mode-model.js";
import { t } from "./i18n.js";
import { thinkingLine } from "./progress-model.js";
import { thinkingEl } from "./thinking.js";
import { renderMarkdown, markdownBlocks } from "./markdown.js";
import { pinFromReply, isPinned, openBoard } from "./board.js";
import { keyedChildren } from "./keep.js";
import { takeDemoSteps } from "./demo.js";
import { landmarkTerms } from "./term-model.js";
import { modelEl, modelSig, refreshJudgeModel } from "./model-label.js";
import { autoRead, autoReadEl, canSpeak, speak, speakButton } from "./voice.js";
import { loadHighlighter } from "./code.js";
import { renderCta } from "./cta.js";
import { acceptDrops, createTray, messageImagesEl } from "./images.js";
import { select } from "./interactions.js";
import { registerRegion, region } from "./keys.js";
import { icon } from "./icons.js";
import { tip } from "./tip.js";
import { toastError } from "./toast.js";
import { canSend, withRestored, withoutStored } from "./pane-model.js";
import { button, composerEl, el, eventEl, failedEl, failureWords, footMetaEl, fromWordsEl, keepFocus, logFollower, noticeEl, personaGlyph, roveFocus, skeletonEl, syncAnswer } from "./pane-parts.js";
import { chartKey, chartSend, chartTray, chartTurning, closeChart, decideSketch, dropChart, focusChartAnswer, installChart, isChartOpen, openChart, renderChart, stopChartTurn } from "./chart.js";

const pane = document.getElementById("pane");
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
// The log follows its end by intent: only the reader's scroll changes that, so content that grows on its own (a
// diagram drawn late, a demo's frame finding its height, a reply arriving) never reads as having scrolled away.
const follow = logFollower();

let logGen = 0;          // bumped when every log item must be drawn again (a theme change)
let termsSig = "";       // the selected island's landmark terms, as a string, for itemSig
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
  pointers: [],       // "sail to" links the persona left under its replies
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
  speakNext: false,   // a turn ended well: Read aloud plays its reply once the refetch brings it
  stoppedImages: null, // ids an early stop gave back to the tray, until the refetch shows whether the server kept them
};

/** Where a reading belongs, for the now-playing bar: the island's name, and how to come back to the reply from
 *  anywhere (its lens, its scale, its island, then the reply in view). */
function readingOf(slug, mode) {
  const scale = app.scale;
  const island = app.snapshot?.islands.find((i) => i.slug === slug)?.name ?? slug;
  return {
    island,
    go: async (id) => {
      if (app.mode !== mode) setMode(mode);
      if (app.scale !== scale) await setScale(scale);
      if (app.selected !== slug) await select(slug);
      for (let i = 0; i < 60; i++) {
        const pill = pane.querySelector(`.speak[data-id="${id}"]`);
        if (pill) return pill.scrollIntoView({ block: "start", behavior: "smooth" });
        await new Promise((r) => setTimeout(r, 50)); // the thread is still loading
      }
    },
  };
}

/** The role a thread's replies are written as: the Keeper's thread is the judge's. */
const personaRole = (mode) => (mode === "mentor" ? "mentor" : "judge");

let carry = null; // { slug, question, from }: the reader's question a mentor's pointer is taking to another island
/** The images attached to the draft in this thread's answer box; a new thread starts with none. */
const tray = createTray(() => render());
let looseShown; // which loose ends are unfolded under the chips: a landmark's slug, "" for the island's own, undefined for none
let looseFor = null; // the island looseShown belongs to: another island starts folded
let terms = null; // the selected island's landmark words (`landmarkTerms`), marked in the persona's replies

/** Hovering a landmark chip lights its words in the thread, and hovering a word lights its chip. */
function lightLandmark(e, on) {
  const target = e.target.closest?.("[data-lm]");
  if (!target || !pane.contains(target)) return;
  for (const node of pane.querySelectorAll(`[data-lm="${CSS.escape(target.dataset.lm)}"]`)) node.classList.toggle("hot", on);
}

/** Re-reads the model the personas answer on, and redraws the pane when it changed. */
function remodel() {
  const read = () => void refreshJudgeModel().then((changed) => changed && render());
  read();
  // The free credit's balance is written just after a reply ends, so it is read once more a moment later.
  if (globalThis.ARCHIPELAGO_HOSTED === true) setTimeout(read, CREDIT_SETTLE_MS);
}
const CREDIT_SETTLE_MS = 2500;

export function installCard() {
  remodel();
  document.addEventListener("settings", remodel);
  document.addEventListener("turn", remodel); // a cartographer turn ended (chart.js)
  pane.addEventListener("mouseover", (e) => lightLandmark(e, true));
  pane.addEventListener("mouseout", (e) => lightLandmark(e, false));
  // A demo that grows (its frame finds its height, a console line lands) keeps a followed log at its end.
  pane.addEventListener("demo-resize", () => {
    if (follow.following) follow.toEnd();
  });
  document.addEventListener("theme", () => {
    if (!thread.slug) return;
    thread.version = null; // refetch: the log is rebuilt and its diagrams render in the new colours
    logGen++;
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
  // Images dropped on the pane join whichever answer box it shows, while that box takes them.
  acceptDrops(pane, () => {
    const attach = pane.querySelector(".attach");
    if (!attach || attach.disabled) return null;
    return isChartOpen() && !app.selected ? chartTray() : tray;
  });
  installChart({ render: () => render(), sail: (pointer, lens) => void sailFromGuide(pointer, lens), grip: gripEl });
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
      if (!form || !ta || thread.inFlight) return false;
      // ⌘↵ sends what Send would: words, or images alone. A dispute may go without words.
      if (!ta.dataset.reef && !canSend({ text: ta.value, images: tray.ready().length, busy: tray.busy(), disabled: ta.disabled })) return false;
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
      // ← and → walk the pane's controls (Tab is the regions'), mid-turn too: Stop is one of them.
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") return roveFocus(pane, e.key === "ArrowRight" ? 1 : -1);
      const island = app.nodes.find((n) => n.slug === app.selected) ?? null;
      if (!island) return false;
      const click = (sel) => {
        const found = [...pane.querySelectorAll(sel)];
        const b = found[found.length - 1]; // the latest, where a thread holds several
        if (!b || b.disabled) return false;
        b.click();
        return true;
      };
      if (e.key === "s") return click(".head [data-fk='sail']"); // sail closer, or in
      if (e.key === "g") return click(".log .sail-go"); // follow the persona's pointer
      if (thread.inFlight) return false;
      switch (e.key) {
        case "Enter":
          return focusAnswer();
        case "r":
          return click("[data-fk='retry']");
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

const pct = (v) => `${Math.round(v * 100)}%`;

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
  takeDemoSteps(); // what a demo printed belongs to the thread it was used beside
  tray.clear(); // the draft's images go with its words; sent ahead, they are deleted (never attached)
  turnGen += 1; // a stream still running from an earlier visit to this island is no longer ours
  Object.assign(thread, {
    slug, mode, version: null, messages: [], asks: [], pointers: [], loaded: false, draft: "", live: "", progress: null, inFlight: false, error: null, loadError: null,
    disputeDraft: "", stopped: false, stoppedDraft: null, litSeen: null, focusPending: false, answering: false, stay: false, speakNext: false, stoppedImages: null,
  });
  noteOpen = false;
}

async function loadThread(slug) {
  thread.version = app.version;
  const gen = ++loadGen;
  const mode = thread.mode;
  const stale = () => thread.slug !== slug || thread.mode !== mode || gen !== loadGen;
  try {
    const { messages, asks, pointers } = await api(
      `/api/thread?domain=${encodeURIComponent(app.domain)}&island=${encodeURIComponent(slug)}&mode=${encodeURIComponent(mode)}`,
    );
    if (stale()) return;
    thread.messages = messages;
    thread.asks = asks ?? [];
    thread.pointers = pointers ?? [];
    if (thread.speakNext) {
      thread.speakNext = false;
      const role = personaRole(mode);
      const reply = [...messages].reverse().find((m) => m.kind === "text" && m.role !== "you");
      if (reply && reply.role === role && autoRead() && canSpeak(role)) speak(reply.id, { role, ...readingOf(slug, mode) });
    }
    // A question carried here by a mentor's "sail to": into the answer box once the thread has begun; before that the
    // briefing offers to start with it.
    if (carry && carry.slug === slug && mode === "mentor" && messages.length > 0) {
      thread.draft = carry.question;
      thread.focusPending = true;
      carry = null;
    }
    if (thread.stoppedDraft !== null) {
      // An early stop gave the words back; if the server stored them after all, they are in the thread, not the box.
      thread.draft = withoutStored(thread.draft, thread.stoppedDraft, messages.filter((m) => m.role === "you").map((m) => m.body));
      thread.stoppedDraft = null;
    }
    if (thread.stoppedImages !== null) {
      // The same for the images it gave back: on a stored message they are no longer the tray's to send.
      const kept = new Set(messages.flatMap((m) => (m.images ?? []).map((i) => i.id)));
      if (thread.stoppedImages.some((id) => kept.has(id))) tray.drop();
      thread.stoppedImages = null;
    }
    thread.loaded = true;
    thread.answering = false; // a reef answer is complete once the stored proposal status is back
    thread.loadError = null; // thread.error belongs to the last turn and stays until the next one
  } catch (error) {
    if (stale()) return;
    thread.answering = false; // do not wedge the buttons if the refetch fails
    thread.loadError = failureWords(error); // version stays set: the next version change retries, a re-render does not
  }
  render();
}

/** Reads the thread again after a load that failed. */
function retryLoad() {
  thread.version = null; // the render below refetches
  thread.loadError = null;
  render();
}

/** Stops the running turn, as Loomy's Stop does: the request aborts, and the server stops the persona and keeps no reply. */
function stopTurn() {
  if (!turnAbort) return false;
  turnAbort.abort();
  return true;
}

/**
 * One judge turn. `message` null opens or continues the thread without a new reader message; `sent` is the tray's
 * images going with it (a message may be images alone, with `message` "").
 */
async function runTurn(slug, message, askId, sent = []) {
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
  const images = sent.map((item) => item.image);
  const said = Boolean(message) || images.length > 0;
  if (said) thread.messages = [...thread.messages, { id: `local-${Date.now()}`, role: "you", kind: "text", body: message ?? "", images: images.map((i) => ({ ...i, removed: false })) }];
  render();
  if (said) {
    follow.follow(); // sending is a request to watch the reply arrive
    follow.toEnd();
  }
  try {
    // What the reader did in a demo goes along with their words, so the mentor answers what actually happened.
    const demoSteps = said && mode === "mentor" ? takeDemoSteps() : [];
    await streamPost("/api/probe", { domain: app.domain, island: slug, mode, ...(message ? { message } : {}), ...(askId ? { askId } : {}), ...(images.length ? { images: images.map((i) => i.id) } : {}), ...(demoSteps.length ? { demoSteps } : {}) }, (e) => {
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
        thread.draft = withRestored(thread.draft, message); // above anything typed while the turn ran
        thread.stoppedDraft = message;
      }
      if (sent.length && !error.midStream) {
        tray.restore(sent);
        thread.stoppedImages = images.map((i) => i.id);
      }
    } else {
      // Refused or never sent: the server stored nothing, so the words (and images) go back in the box.
      // Broken mid-stream: the server may have stored them, and the refetch will show it.
      const back = Boolean(message) && !error.midStream;
      const words = failureWords(error);
      thread.error = back && words === t("paneParts.offline") ? t("paneParts.offlineKept") : words;
      if (back) thread.draft = withRestored(thread.draft, message);
      if (sent.length && !error.midStream) tray.restore(sent);
    }
  }
  if (turnAbort === abort) turnAbort = null;
  if (!mine()) return;
  cancelLive();
  thread.speakNext = !thread.error && !thread.stopped;
  thread.inFlight = false;
  thread.live = "";
  thread.progress = null;
  thread.version = null; // the stored reply and any system lines come back with the refetch
  render();
  remodel();
  // Focus the answer only if the reader is still where they sent from; Tab away mid-turn is a choice.
  if (region() !== regionAtSend) return;
  // The opening turn renders the box disabled until the refetched thread arrives: focus it then.
  if (!focusAnswer()) thread.focusPending = true;
}

/** Runs a failed turn again: the words given back to the box if there are any, else the thread as it stands. */
function retryTurn(slug) {
  if (thread.inFlight || thread.slug !== slug) return;
  const form = pane.querySelector("#answer-form");
  const ta = pane.querySelector("#answer");
  if (form && ta && !ta.dataset.reef && canSend({ text: ta.value, images: tray.ready().length, busy: tray.busy(), disabled: ta.disabled })) form.requestSubmit();
  else void runTurn(slug, null); // the reader's last message is stored; the persona answers it
}

/** The reader answers one of the Keeper's questions directly: it goes to the top of the draft as a quote. */
function quoteIntoAnswer(question) {
  const ta = pane.querySelector("#answer");
  if (!ta || ta.disabled) return;
  const line = `> ${question}`;
  const reef = Boolean(ta.dataset.reef);
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
    // Not a line in the conversation: the answer was pressed on the map's card or in the box, and both are still there.
    toastError(error, t(answer === "confirm" ? "card.confirmWhat" : "card.disputeWhat"));
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
  const stuck = follow.following;
  if (thread.inFlight && !thread.live) {
    // Nothing has arrived yet: the reply's own line says so, where the words will land.
    live.replaceChildren(thinkingEl(thinkingLine(PERSONA_NAMES[thread.mode], thread.progress)));
  } else if (thread.live) {
    // Block by block: one that has not changed keeps its element, so only the block being written is drawn again.
    const blocks = markdownBlocks(thread.live, { onQuestion: quoteIntoAnswer, lead: true, terms });
    keyedChildren(live, blocks.map((b, i) => ({ key: i, sig: b.sig, build: b.build })));
    for (const old of live.querySelectorAll(".caret")) old.remove();
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
  if (stuck) follow.toEnd();
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

// ---- head ----

/** Who answers here, beside the island's name: the Keeper or the mentor. It is the map's lens too (`m` switches it). */
function lensSwitchEl() {
  const wrap = el("div", "lens-switch");
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", t("card.lensLabel"));
  for (const m of MODES) {
    const b = button(MODE_LABELS[m], () => setMode(m), `seg ${m}${m === thread.mode ? " on" : ""}`);
    b.setAttribute("aria-pressed", String(m === thread.mode));
    b.dataset.fk = `lens-${m}`;
    tip(b, MODE_HINTS[m], "m");
    wrap.append(b);
  }
  return wrap;
}

const LOOSE_KINDS = { confused: "card.looseConfused", asked: "card.looseAsked", later: "card.looseLater" };

/** The "?" on a chip with loose ends (or the island's own, after the chips): a click unfolds them under the row. */
function looseMarkEl(key, label, count) {
  const mark = button(count > 1 ? `?${count}` : "?", () => {
    looseShown = looseShown === key ? undefined : key;
    render();
  }, `loose-mark${looseShown === key ? " on" : ""}`);
  mark.setAttribute("aria-label", label);
  mark.setAttribute("aria-expanded", String(looseShown === key));
  mark.dataset.fk = `loose-${key}`;
  tip(mark, label);
  return mark;
}

/** The unfolded loose ends: what each is, the reader's words, who noted it, and Dismiss. */
function looseListEl(island, ends) {
  const list = el("div", "loose-list");
  for (const e of ends) {
    const item = el("div", "loose-item");
    const text = el("div", "loose-text");
    text.append(el("span", "loose-kind", t(LOOSE_KINDS[e.kind])), el("span", "loose-note", e.note));
    const meta = el("div", "loose-meta", `${t("card.looseQuote", { evidence: e.evidence })} · ${t("card.looseBy", { who: PERSONA_NAMES[e.author] })}`);
    text.append(meta);
    const dismiss = button(t("card.looseDismiss"), async () => {
      dismiss.disabled = true;
      try {
        await api("/api/loose-ends", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ domain: app.domain, island: island.slug, id: e.id }),
        });
      } catch (error) {
        dismiss.disabled = false;
        toastError(error, t("card.looseDismissWhat"));
      }
    }, "btn quiet sm loose-dismiss");
    dismiss.dataset.fk = `dismiss-${e.id}`;
    tip(dismiss, t("card.looseDismissTitle"));
    item.append(text, dismiss);
    list.append(item);
  }
  return list;
}

function chipsEl(island) {
  if (looseFor !== island.slug) [looseFor, looseShown] = [island.slug, undefined];
  const wrap = el("div", "chips-wrap");
  const row = el("div", "chips");
  const on = thread.mode === "mentor" ? "explored" : "lit";
  const ends = island.looseEnds ?? [];
  const known = new Set(island.landmarks.items.map((l) => l.slug));
  for (const l of island.landmarks.items) {
    const lit = landmarkLit(l, thread.mode);
    const chip = el("span", `chip${lit ? ` ${on}` : ""}`, l.name);
    chip.dataset.lm = l.slug;
    // The words it was lit from (the Keeper's lens) or explored with (the mentor's), under the pointer.
    const quote = lit ? (thread.mode === "mentor" ? l.exploredEvidence : l.evidence) : null;
    if (quote) tip(chip, t("paneParts.fromWords", { quote }));
    if (lit && thread.litSeen && !thread.litSeen.has(l.slug)) chip.classList.add("just-lit");
    const here = ends.filter((e) => e.landmark === l.slug);
    if (here.length) {
      chip.classList.add("loose");
      chip.append(looseMarkEl(l.slug, t("card.looseMark", { name: l.name }), here.length));
    }
    row.append(chip);
  }
  const own = ends.filter((e) => e.landmark === null || !known.has(e.landmark));
  if (own.length) row.append(looseMarkEl("", t("card.looseIsland"), own.length));
  wrap.append(row);
  const shown = looseShown === undefined ? [] : looseShown === "" ? own : ends.filter((e) => e.landmark === looseShown);
  if (shown.length) wrap.append(looseListEl(island, shown));
  return wrap;
}

function noteForm(island) {
  const form = el("form", "note");
  const input = el("input", "field");
  input.id = "note";
  input.placeholder = t("card.notePlaceholder");
  input.setAttribute("aria-label", t("card.notePlaceholder"));
  input.value = noteDraft;
  input.addEventListener("input", () => (noteDraft = input.value));
  const send = button(t("paneParts.send"), null, "btn md");
  send.type = "submit";
  send.dataset.fk = "note-send";
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

/** The judge's round on this island, 0 before the first answer; the mentor has no rounds. */
const roundNow = () => (thread.mode === "judge" ? roundOf(thread.messages) : 0);

/** Everything the head is drawn from, as a string: it is drawn again only when this changes, so a snapshot that changed nothing here keeps its buttons (and the keyboard on them). */
function headSig(island) {
  return JSON.stringify([
    island.slug, island.name, island.summary, island.harbour, island.verdict, island.hasChildren, island.children, island.landmarks, island.looseEnds,
    thread.mode, roundNow(), noteOpen, looseFor === island.slug ? looseShown ?? null : null,
  ]);
}

/**
 * The head, top to bottom: the island's name beside who answers; its summary; its landmarks; then one row with
 * where it stands (the status, how many are lit, the round) on the left and where to go from here on the right.
 */
function headEl(island) {
  const head = el("div", "head");
  const titlebar = el("div", "titlebar");
  titlebar.append(el("h2", null, island.name), lensSwitchEl());
  head.append(titlebar);
  if (island.summary) head.append(el("p", "summary", island.summary));
  const hasLandmarks = island.landmarks && island.landmarks.total > 0;
  if (hasLandmarks || island.looseEnds?.length) head.append(chipsEl(island));

  const sub = el("div", "sub");
  const standing = el("span", "standing");
  const pill = headPill(island, thread.mode);
  standing.append(el("span", pill.cls, pill.text));
  if (island.harbour) standing.append(el("span", "pill harbour", t("card.harbour")));
  const parts = [];
  if (hasLandmarks) {
    parts.push(
      thread.mode === "mentor"
        ? t("card.exploredOf", { explored: island.landmarks.explored ?? 0, total: island.landmarks.total })
        : t("card.chartedOf", { n: island.landmarks.unlocked, total: island.landmarks.total }),
    );
  }
  const round = roundNow();
  if (round > 0) parts.push(t("card.round", { n: Math.min(round, ROUNDS), total: ROUNDS })); // the opening turn is not a round yet
  if (parts.length) standing.append(el("span", "count", parts.join(t("card.partsJoin"))));
  sub.append(standing);
  const links = el("span", "links");
  const sail = island.hasChildren
    ? tip(button(t("card.sailIn"), () => setScale(island.slug), "btn quiet sm"), t("card.sailInTip"), "s")
    : tip(button(t("card.sailCloser"), () => void sailCloser(island), "btn quiet sm"), t("card.sailCloserTip"), "s");
  sail.dataset.fk = "sail";
  const noteToggle = button(t("card.noteToggle"), () => {
    noteOpen = !noteOpen;
    render();
    if (noteOpen) pane.querySelector("#note")?.focus();
  }, "btn quiet sm");
  noteToggle.id = "note-toggle";
  noteToggle.setAttribute("aria-expanded", String(noteOpen));
  if (!noteOpen) tip(noteToggle, t("card.noteTip"), "n"); // open, the field under it says the same, and a tip would cover its Send
  links.append(sail, noteToggle);
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

/** The island's verdict, where the thread recorded it: the state with its own mark (the outline's), the words it rests on, and why. */
function verdictEl(v) {
  const card = el("div", "verdict-card");
  const row = el("div", "row");
  row.append(el("span", `pill ${v.state}`, t("card.chartedAs", { state: stateLabel(v.state) })));
  row.append(el("span", "conf", t("card.confidence", { pct: pct(v.confidence), date: v.at.slice(0, 10) })));
  card.append(row);
  card.append(el("q", null, v.evidence));
  if (v.rationale) card.append(el("div", "why", v.rationale));
  return card;
}

/**
 * A lit landmark (or, with the mentor, an explored one), one row each: the lamp, what happened, the landmark's
 * name, and the reader's own words it was lit from. Those words are underlined in their message above, and the
 * row, the words and the landmark's chip light together under the pointer.
 */
function litEl(item) {
  const explored = item.kind === "explored";
  const rows = el("div", "events");
  for (const l of item.lit) {
    const { row, body } = eventEl(explored ? "explored" : "lit", icon(explored ? "compass" : "lamp"), l.slug);
    body.append(el("span", "event-label", t(explored ? "card.exploredTitle" : "card.litTitle")), el("span", "event-name", l.name));
    if (l.quote) body.append(fromWordsEl(l.quote));
    rows.append(row);
  }
  return rows;
}

/** The reef the judge proposed, in the same row: the claim, what would follow from it, and the words it rests on. The reader answers it in the foot, not here. */
function reefEl(item) {
  const p = item.proposal;
  const { row, body } = eventEl(`reef reef-block ${p.status}`, icon("reef"), item.evidence?.key ?? null);
  const title = p.status === "pending" ? "card.reefTitle" : p.status === "confirmed" ? "card.reefMarked" : "card.reefDisputed";
  body.append(el("span", "event-label", t(title)), el("span", "event-name", p.claim));
  body.append(el("span", "event-note", t("card.ifSo", { consequence: p.consequence })));
  if (item.evidence?.quote) body.append(fromWordsEl(item.evidence.quote));
  if (p.status === "pending") body.append(el("span", "event-note todo", t("card.reefPending")));
  return row;
}

/** A quiet row for the rest of the trail: a board write (a button that opens the board at that card), a loose end, a model change, any other line. */
function trailEl(item) {
  if (item.kind === "model") {
    const { row, body } = eventEl("model model-line");
    body.append(el("span", "event-text", t("card.modelFrom", { model: item.text })));
    return row;
  }
  if (/^board: (pinned|updated) /.test(item.text)) {
    // A persona's board write happens out of sight when the board is closed: its line opens the board at that card.
    const { row, body } = eventEl("board board-line", icon("board", { size: 14 }), null, "button");
    row.addEventListener("click", () => openBoard({ latest: true }));
    row.dataset.fk = `board-line-${item.id}`;
    body.append(el("span", "event-text", systemText(item.text)));
    tip(row, t("card.openBoard"));
    return row;
  }
  if (item.text.startsWith("loose end")) {
    const closed = item.text.startsWith("loose end closed");
    const { row, body } = eventEl("loose", icon(closed ? "check" : "question", { size: 14 }), item.evidence?.key ?? null);
    body.append(el("span", "event-text", systemText(item.text)));
    if (item.evidence?.quote) body.append(fromWordsEl(item.evidence.quote));
    return row;
  }
  const { row, body } = eventEl("note");
  body.append(el("span", "event-text", systemText(item.text)));
  return row;
}

/** The options under a persona's question. While it waits for an answer each shows its key; once answered, the pick stays marked and the rest step back, still readable. */
function choicesEl(ask, reefPending) {
  const waiting = ask.picked === null && pendingAskOf()?.id === ask.id; // only the latest unanswered question still takes a pick
  const done = !waiting;
  const own = done && !ask.options.includes(ask.picked);
  const live = waiting && !thread.inFlight && !reefPending;
  const box = el("div", `choices${done ? " done" : ""}`);
  box.append(el("div", "q", t(own ? "card.youAnswered" : done ? "card.youChose" : "card.chooseOne")));
  ask.options.forEach((option, i) => {
    const b = button(null, () => answerAsk(thread.slug, ask, option), "choice");
    b.dataset.fk = `choice-${ask.id}-${i}`;
    if (live) b.append(el("kbd", null, String(i + 1)));
    if (ask.picked === option) {
      b.classList.add("picked");
      b.append(icon("check", { size: 14 }));
    }
    b.append(el("span", null, option));
    b.disabled = !live;
    box.append(b);
  });
  return box;
}

/** A persona's "sail to": the island, why it holds what the reader asked, and in the mentor's lens, that the question goes along. `latest` is the one `g` follows. */
function sailEl(pointer, latest) {
  const box = el("div", "sail");
  const go = button(null, () => void sailTo(pointer), "btn ghost md sail-go");
  go.append(icon("arrow-right", { size: 14 }), el("span", null, t("card.sailTo", { name: pointer.island.name })));
  go.dataset.fk = `sail-${pointer.id}`;
  tip(go, t("card.sailTip"), latest ? "g" : undefined);
  box.append(el("div", "sail-why", pointer.why));
  if (thread.mode === "mentor" && pointer.question) box.append(el("div", "sail-carry", t("card.sailCarries")));
  box.append(go);
  return box;
}

/** Sails to the pointer's island in the same lens, changing scale first when it lives elsewhere. */
async function sailTo(pointer) {
  const from = app.snapshot?.islands.find((i) => i.slug === thread.slug)?.name ?? "";
  carry = thread.mode === "mentor" && pointer.question ? { slug: pointer.island.slug, question: pointer.question, from } : null;
  if (pointer.island.scale !== app.scale) await setScale(pointer.island.scale);
  await select(pointer.island.slug);
}

/** Sails from the guide's card: the lens it suggests (or the reader's pick), and in the mentor's, the question it carries. */
async function sailFromGuide(pointer, lens) {
  setMode(lens);
  carry = lens === "mentor" && pointer.question ? { slug: pointer.island.slug, question: pointer.question, from: t("card.fromGuide") } : null;
  if (pointer.island.scale !== app.scale) await setScale(pointer.island.scale);
  await select(pointer.island.slug);
}

/** What a persona reply's fences pin with: the reader's card, marked as pinned from this persona's reply. */
function pinFor(role) {
  return { add: (card) => pinFromReply({ ...card, from: role }), has: isPinned };
}

function itemEl(item, reefPending) {
  if (item.kind === "landmark" || item.kind === "explored") return litEl(item);
  if (item.kind === "verdict") return verdictEl(item.verdict);
  if (item.kind === "reef_proposal") return reefEl(item);
  if (item.kind === "system" || item.kind === "model") return trailEl(item);
  const m = el("div", `msg ${item.role}`);
  const persona = item.role === "judge" || item.role === "mentor";
  if (persona && Number.isInteger(item.id) && canSpeak(item.role)) m.append(speakButton(item.id, item.role, readingOf(thread.slug, thread.mode)));
  if (item.images?.length) m.append(messageImagesEl(item.images));
  // The reader's own words carry the marks: what a lit landmark, a reef or a loose end quoted from them.
  if (item.text || !item.images?.length) m.append(renderMarkdown(item.text, persona ? { onQuestion: quoteIntoAnswer, lead: true, terms, pin: pinFor(item.role) } : { marks: item.marks }));
  const ask = persona ? askFor(thread.asks, item.id) : null;
  if (ask) m.append(choicesEl(ask, reefPending));
  if (persona) for (const p of thread.pointers.filter((x) => x.messageId === item.id)) m.append(sailEl(p, p.id === thread.pointers.at(-1)?.id));
  return m;
}

/** Everything one log item's element is drawn from, as a string: the element is kept while this stays the same. The item carries its own evidence (`logItems`), so a quote that arrives with a later snapshot draws it again. */
function itemSig(item, reefPending) {
  const persona = item.role === "judge" || item.role === "mentor";
  if (item.kind !== "text" || !persona) return JSON.stringify([logGen, item]);
  const ask = askFor(thread.asks, item.id);
  return JSON.stringify([logGen, item, termsSig, canSpeak(item.role), ask, ask ? [thread.inFlight, reefPending, pendingAskOf()?.id ?? null] : 0, thread.pointers.filter((x) => x.messageId === item.id), thread.pointers.at(-1)?.id ?? null]);
}

/** Whether there is a thread to draw: it has loaded, or it has words in hand, or the island has none to load (the snapshot counts both lenses' messages). */
const threadReady = (island) => thread.loaded || thread.inFlight || thread.messages.length > 0 || island.messages === 0;

let itemsFor = { messages: null, island: null, items: [] };
/** The thread's log items on this island: worked out once per thread and snapshot, since one redraw asks several times (the log, the foot, the map's card). */
function itemsNow(island) {
  if (itemsFor.messages !== thread.messages || itemsFor.island !== island) itemsFor = { messages: thread.messages, island, items: logItems(thread.messages, island) };
  return itemsFor.items;
}

/** The log's children, in order. A keyed entry (a thread item, a notice) keeps its element until its content changes. */
function logEntries(island) {
  const out = [];
  if (!threadReady(island)) {
    // Nothing to show yet: bars where the words will be (only after a moment), or why they did not come.
    if (thread.loadError) out.push({ key: "failed", sig: thread.loadError, build: () => failedEl(t("paneParts.loadFailed"), thread.loadError, retryLoad) });
    else out.push({ key: "skeleton", sig: "", build: skeletonEl });
    return out;
  }
  const items = itemsNow(island);
  const turnError = () => out.push({
    key: "turn-error", sig: thread.error,
    build: () => noticeEl(thread.error, items.length ? { action: { label: t("paneParts.tryAgain"), run: () => retryTurn(island.slug), keys: "r" } } : {}),
  });
  const verdictFirst = () => out.push({ key: "verdict-first", sig: JSON.stringify(island.verdict), build: () => verdictEl(island.verdict) });
  if (items.length === 0 && !thread.inFlight) {
    if (thread.mode === "judge" && island.verdict) verdictFirst();
    out.push({ key: "briefing", sig: JSON.stringify([thread.mode, Boolean(island.verdict), carry]), build: () => briefingEl(island) });
    if (thread.error) turnError(); // the start button above is the way to try again
    return out;
  }
  // a verdict written from the terminal has no system line; show it at the top of the judge's log
  if (thread.mode === "judge" && island.verdict && !items.some((i) => i.kind === "verdict")) verdictFirst();
  const reefPending = Boolean(items.find((i) => i.kind === "reef_proposal" && i.proposal.status === "pending"));
  for (const item of items) out.push({ key: `${item.kind}:${item.id}`, sig: itemSig(item, reefPending), build: () => itemEl(item, reefPending) });
  // The reply as it streams: kept across redraws, so a diagram or demo in it is not drawn again mid-reply.
  out.push({ key: "live", sig: "", build: () => {
    const live = el("div", `msg ${thread.mode}`);
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
  if (thread.stopped) out.push({ key: "stopped", sig: "", build: () => noticeEl(t("paneParts.stopped"), { alert: false }) });
  if (thread.error) turnError();
  // The words above are the last good ones; only reading them again failed. Said at the end, where the reader is.
  if (thread.loadError) out.push({
    key: "stale", sig: thread.loadError,
    build: () => noticeEl(t("paneParts.refreshFailed", { why: thread.loadError }), { action: { label: t("paneParts.retry"), run: retryLoad, keys: "r" } }),
  });
  return out;
}

/**
 * The log. Drawn into the log already on the page when it is this island's in this lens, so a reply whose content
 * has not changed keeps its element: a demo keeps running, a diagram is not drawn again.
 */
function logEl(island, prev = null) {
  const of = `${island.slug}/${thread.mode}`;
  const log = prev && prev.dataset.thread === of ? prev : el("div", "log");
  follow.adopt(log); // a thread it has not seen opens at its latest words
  log.dataset.thread = of;
  keyedChildren(log, logEntries(island));
  follow.watch(); // a diagram drawn late or an image arriving keeps a followed log at its end
  return log;
}

/**
 * Before the first turn: who you are with, what happens and how it ends, and the one button that starts it. The
 * answer box stays away until there is something to answer (`footEl`).
 */
function briefingEl(island) {
  const mentor = thread.mode === "mentor";
  const kind = mentor ? "Mentor" : "Keeper";
  const box = el("div", `briefing ${thread.mode}`);
  box.append(personaGlyph(thread.mode), el("h3", null, t(`card.brief${kind}Title`)));
  const steps = el("ol", "steps");
  [1, 2, 3].forEach((n) => {
    const li = el("li");
    li.append(el("span", "n", String(n)), el("span", null, t(`card.brief${kind}Step${n}`)));
    steps.append(li);
  });
  box.append(steps);
  const carried = mentor && carry && carry.slug === island.slug ? carry : null;
  if (carried) {
    // The question a pointer brought here starts the session in place of the opening.
    const q = el("div", "carried");
    q.append(el("div", "lbl", t("card.carriedFrom", { from: carried.from })), el("p", null, carried.question));
    box.append(q);
  }
  const label = carried ? t("card.askThis") : mentor ? t("card.startExploring") : t(island.verdict ? "card.exploreIt" : "card.makeLandfall");
  const start = button(label, () => {
    carry = null;
    void runTurn(island.slug, carried ? carried.question : null);
  }, "btn xl start");
  start.id = "landfall";
  tip(start, t("card.startTip"), "l");
  box.append(start);
  if (carried) {
    const drop = button(t("card.carryDrop"), () => {
      carry = null;
      render();
    }, "btn quiet sm carry-drop");
    drop.dataset.fk = "carry-drop";
    box.append(drop);
  }
  box.append(el("p", "sub", t("card.briefSwitch")));
  return box;
}

// ---- foot ----

/** The reef waiting for the reader's answer in this thread, or null. */
const pendingReef = (island) => (threadReady(island) ? itemsNow(island).find((i) => i.kind === "reef_proposal" && i.proposal.status === "pending") ?? null : null);

/** What the answer box holds right now: the objection while a reef waits, else the draft. */
const draftOf = (reef) => (reef ? thread.disputeDraft : thread.draft);

/** Everything the foot is drawn from but the draft's words (those live in the box; `syncAnswer` puts back what the page itself changed). */
function footSig(island) {
  const reef = pendingReef(island);
  return JSON.stringify([
    island.slug, thread.mode, thread.messages.length === 0, thread.inFlight, turnAbort !== null, thread.answering, reef?.id ?? null, reef ? null : pendingAskOf()?.id ?? null,
    tray.items.map((i) => [i.key, i.status]), tray.notice, canSpeak(personaRole(thread.mode)), modelSig(),
  ]);
}

/**
 * The foot: the answer box as one composer, and under it what the keys do and the model answering. While a reef
 * waits the box takes the objection and its action is Dispute; while a reply streams the action is Stop, and the
 * box stays open so the next thought can be typed (Enter waits for the reply to end).
 */
function footEl(island) {
  const foot = el("div", "foot");
  const pending = pendingReef(island);
  const ask = pending ? null : pendingAskOf();
  const empty = thread.messages.length === 0; // the opening turn is on its way: nothing to answer yet
  const busy = thread.inFlight || thread.answering;
  const streaming = thread.inFlight && turnAbort !== null;
  const form = composerEl({
    value: draftOf(pending),
    placeholder: pending ? t("card.disputePlaceholder") : ask ? t("card.ownWords") : t(thread.mode === "mentor" ? "card.mentorPlaceholder" : "card.answerPlaceholder"),
    disabled: thread.answering || empty,
    tray: pending ? null : tray, // a dispute is words only
    action: pending ? "dispute" : streaming ? "stop" : "send",
    actionLabel: pending ? t("card.dispute") : undefined,
    actionDisabled: busy,
    onInput(value) {
      if (pending) thread.disputeDraft = value;
      else thread.draft = value;
    },
    onCompose(on) {
      composing = on;
      // A rebuild held back while the word was composed runs now, after the key that committed it has finished.
      if (!on && renderHeld) setTimeout(() => {
        if (!composing && renderHeld) render();
      }, 0);
    },
    onStop: () => stopTurn(),
    onSubmit(body) {
      if (pending) {
        if (!busy) void answerReef(island.slug, pending.id, "dispute", body || undefined);
        return;
      }
      const withImages = tray.ready().length > 0;
      if ((!body && !withImages) || thread.inFlight || tray.busy()) return;
      // A pick from the options carries no images: words with images go as a message of their own.
      if (ask && !withImages) answerAsk(island.slug, ask, body);
      else {
        thread.draft = "";
        void runTurn(island.slug, body, undefined, tray.take());
      }
    },
  });
  if (pending) form.querySelector("#answer").dataset.reef = "1";
  foot.append(form);
  const role = personaRole(thread.mode);
  const hint = pending ? { typing: t("card.metaReef") } : streaming ? { typing: t("paneParts.hintStop") } : { typing: t("paneParts.hintSend"), idle: t("paneParts.hintWrite") };
  foot.append(footMetaEl(hint, [canSpeak(role) ? autoReadEl() : null, modelEl()]));
  return foot;
}

// ---- the pane ----

/** The model handed to renderCta, shared by the "no island selected" and normal render paths. */
function ctaModel(island) {
  const judging = thread.mode === "judge";
  return {
    island,
    pendingReef: judging && island && thread.loaded ? itemsNow(island).find((i) => i.kind === "reef_proposal" && i.proposal.status === "pending") ?? null : null,
    verdict: judging && island ? island.verdict : null,
    handoff: !judging && Boolean(island) && allExplored(island),
    inFlight: thread.inFlight,
    answering: thread.answering,
    stay: thread.stay,
    nearest: nearestOpen(),
    // A scale nobody has talked about yet: where to begin, in either lens, without first picking an island.
    start: island || isChartOpen() ? null : startIsland(app.snapshot),
    onStart: (slug, mode) => {
      setMode(mode);
      void select(slug);
    },
    onConfirm: () => {
      const p = itemsNow(island).find((i) => i.kind === "reef_proposal" && i.proposal.status === "pending");
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

  const prevLog = pane.querySelector(":scope > .log");
  const prevTop = prevLog ? prevLog.scrollTop : 0;

  pane.hidden = false;
  pane.dataset.lens = thread.mode; // the pane's accent is its persona's: the lamp, or the mentor's teal
  terms = landmarkTerms(island.landmarks.items);
  termsSig = JSON.stringify(island.landmarks.items.map((l) => [l.slug, l.name, l.terms ?? null]));
  // The answer box comes once there is something to answer: not before the first turn (the briefing holds the
  // start button), and not while the thread is still being read.
  const answering = threadReady(island) && (thread.messages.length > 0 || thread.inFlight);
  // Each part is drawn again only when what it is drawn from changed (its sig): a snapshot that changed nothing
  // keeps every button where it is, with the keyboard and a press in flight on it. The log stays in the pane when
  // it is this thread's. Where a part is drawn anew, the keyboard goes back to the same control, and the caret to
  // where it stood (a repaint while the reader edits mid-sentence must not move it).
  keepFocus(pane, () => {
    keyedChildren(pane, [
      { key: "grip", sig: "", build: gripEl },
      { key: "head", sig: headSig(island), build: () => headEl(island) },
      { build: () => logEl(island, prevLog) },
      ...(answering ? [{ key: "foot", sig: footSig(island), build: () => footEl(island) }] : []),
    ]);
  });
  // The page changed the draft itself (a quoted question, words given back by a failed send): the box follows.
  const form = pane.querySelector("#answer-form");
  if (form) syncAnswer(form, draftOf(form.querySelector("#answer").dataset.reef), form.querySelector(".dispute") ? null : tray);
  renderLive();
  const log = pane.querySelector(":scope > .log");
  if (log !== prevLog || follow.following) follow.toEnd();
  else log.scrollTop = prevTop;
  if (thread.focusPending) focusAnswer();
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
  tip(grip, t("card.resize"));
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
