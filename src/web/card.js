import { app, api, setScale } from "./app.js";
import { streamPost } from "./stream.js";
import { threadItems, paragraphs } from "./thread.js";

const card = document.getElementById("card");
const dock = document.getElementById("dock");
let noteDraft = "";       // note text survives re-renders
let lastSent = null;      // { slug, text } shown under the note box
let renderId = 0;         // guards async appends against stale renders
let loadGen = 0;          // monotonic across islands, so a slow load can never overwrite a newer one

// The one thread the page shows: the selected island's stored messages plus the turn in flight.
const thread = {
  slug: null,
  version: null,      // snapshot version the messages were fetched at; null forces a refetch
  messages: [],
  loaded: false,
  draft: "",
  live: "",           // the judge's reply as it streams
  progress: null,     // tool in flight, shown under the live text
  inFlight: false,
  error: null,        // a turn failed; the messages on screen are still good
  loadError: null,    // the thread itself could not be fetched
  disputeDraft: "",   // the objection typed into the dock while a reef is pending
  litSeen: null,      // slugs already lit at the last render, so only newly lit chips pulse
};

export function installCard() {
  app.listeners.add(() => render());
  render();
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label, onClick, className) {
  const b = el("button", className, label);
  b.type = "button";
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

const SENT_TEXT = {
  sail_closer: "Asked Claude to chart this island's coastline.",
  note: "Note sent. Claude reads it at the start of the next turn.",
};

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
  Object.assign(thread, {
    slug, version: null, messages: [], loaded: false, draft: "", live: "", progress: null, inFlight: false, error: null, loadError: null,
    disputeDraft: "", litSeen: null,
  });
}

async function loadThread(slug) {
  thread.version = app.version;
  const gen = ++loadGen;
  try {
    const { messages } = await api(`/api/thread?domain=${encodeURIComponent(app.domain)}&island=${encodeURIComponent(slug)}`);
    if (thread.slug !== slug || gen !== loadGen) return;
    thread.messages = messages;
    thread.loaded = true;
    thread.loadError = null; // thread.error belongs to the last turn and stays until the next one
  } catch (error) {
    if (thread.slug !== slug || gen !== loadGen) return;
    thread.loadError = error.message; // version stays set: the next version change retries, a re-render does not
  }
  render();
}

/** One judge turn. `message` null opens or continues the thread without a new reader message. */
async function runTurn(slug, message) {
  if (thread.inFlight || thread.slug !== slug) return;
  thread.inFlight = true;
  thread.live = "";
  thread.progress = null;
  thread.error = null;
  if (message) thread.messages = [...thread.messages, { id: `local-${Date.now()}`, role: "you", kind: "text", body: message }];
  render();
  try {
    await streamPost("/api/probe", { domain: app.domain, island: slug, ...(message ? { message } : {}) }, (e) => {
      if (thread.slug !== slug) return;
      if (e.type === "text") {
        thread.live += e.data.text;
        thread.progress = null;
        renderLive();
      } else if (e.type === "progress") {
        thread.progress = e.data.message;
        renderLive();
      } else if (e.type === "error") {
        thread.error = e.data.message;
      }
    });
  } catch (error) {
    if (thread.slug !== slug) return; // the reader is on another island; nothing here is theirs
    thread.error = error.message;
    if (message) thread.draft = message; // the fetch never reached the server, so the message is not stored: give it back
  }
  if (thread.slug !== slug) return;
  thread.inFlight = false;
  thread.live = "";
  thread.progress = null;
  thread.version = null; // the stored reply and any system lines come back with the refetch
  render();
  const input = document.querySelector("#thread-input");
  if (input && !input.disabled) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

async function answerReef(slug, id, answer, note) {
  try {
    await post("/api/probe/reef", { domain: app.domain, id, answer, ...(note ? { note } : {}) });
    if (thread.slug !== slug) return; // the reader moved on while the answer was in flight
    thread.disputeDraft = "";
    thread.version = null;
    render();
    if (answer === "dispute" && thread.slug === slug) await runTurn(slug, null);
  } catch (error) {
    if (thread.slug !== slug) return; // the reader moved on; this failure is not theirs to see
    thread.error = error.message;
    render();
  }
}

/** Updates only the streaming parts, so deltas do not rebuild the card. */
function renderLive() {
  const live = card.querySelector("#live");
  const progress = card.querySelector("#progress");
  if (!live || !progress) return; // no list on screen yet; the full render at the end of the turn shows everything
  live.replaceChildren(...paragraphs(thread.live).map((p) => el("p", null, p)));
  live.hidden = !thread.live;
  progress.textContent = thread.progress ? `judge: ${thread.progress}` : "";
  progress.hidden = !thread.progress;
  live.scrollIntoView({ block: "nearest" });
}

function messageEl(item) {
  if (item.kind === "landmark") return el("div", "msg landmark", `◆ ${item.text}`);
  if (item.kind === "system") return el("div", "msg system", item.text);
  if (item.kind === "reef_proposal") return reefEl(item);
  const m = el("div", `msg ${item.role}`);
  m.append(...paragraphs(item.text).map((p) => el("p", null, p)));
  return m;
}

const roundOf = (messages) => messages.filter((m) => m.role === "you" && m.kind === "text").length;

/** The landmark chip row: dark chips dashed, lit chips filled with the reader's evidence on hover. */
function landmarksEl(island) {
  const wrap = el("div", "landmarks");
  const row = el("div", "chips");
  for (const l of island.landmarks.items) {
    const chip = el("span", `chip${l.lit ? " lit" : ""}`, l.name);
    if (l.lit && l.evidence) chip.title = `“${l.evidence}”`;
    if (l.lit && thread.litSeen && !thread.litSeen.has(l.slug)) chip.classList.add("just-lit");
    row.append(chip);
  }
  wrap.append(row);
  const parts = [`${island.landmarks.unlocked} of ${island.landmarks.total} charted`];
  if (!island.verdict && thread.messages.length) parts.push(`round ${roundOf(thread.messages)} of 4`);
  wrap.append(el("div", "muted", parts.join(" · ")));
  return wrap;
}

/** The reef the judge proposed. The reader answers it in the dock, not here. */
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

function threadEl(island) {
  const section = el("div", "thread");
  if (!thread.loaded) {
    if (!thread.loadError) {
      section.append(el("p", "muted", "loading the thread…"));
      return section;
    }
    section.append(el("p", "error", thread.loadError));
    const actions = el("div", "actions");
    actions.append(
      button("Retry", () => {
        thread.version = null; // the render below refetches
        render();
      }),
    );
    section.append(actions);
    return section;
  }
  if (thread.loadError) {
    // the messages below are the last good ones; only the refetch failed
    section.append(el("p", "muted", `could not refresh the thread: ${thread.loadError}`));
    const actions = el("div", "actions");
    actions.append(
      button("Retry", () => {
        thread.version = null; // the render below refetches
        render();
      }),
    );
    section.append(actions);
  }
  const items = threadItems(thread.messages);
  if (items.length === 0 && !thread.inFlight) {
    section.append(el("p", "muted", island.verdict ? "No thread yet. The judge asks first." : "Unsurveyed. The judge asks first."));
    const actions = el("div", "actions");
    actions.append(button("Probe this", () => void runTurn(island.slug, null)));
    section.append(actions);
    return section;
  }
  const list = el("div", "messages");
  for (const item of items) list.append(messageEl(item));
  const live = el("div", "msg judge");
  live.id = "live";
  live.hidden = true;
  const progress = el("div", "progress");
  progress.id = "progress";
  progress.hidden = true;
  list.append(live, progress);
  section.append(list);
  if (thread.error) section.append(el("div", "error", thread.error));
  return section;
}

/** The reader's controls: the answer box at the bottom centre, or Confirm / Dispute while a reef is pending. */
function renderDock(island) {
  if (!island || !thread.loaded) {
    dock.hidden = true;
    dock.replaceChildren();
    return;
  }
  dock.hidden = false;
  dock.replaceChildren();
  const pending = threadItems(thread.messages).find((i) => i.kind === "reef_proposal" && i.proposal.status === "pending");
  const form = el("form", "note");
  const input = el("input");
  input.id = "thread-input";
  input.disabled = thread.inFlight;
  input.placeholder = thread.inFlight ? "the judge is thinking…" : pending ? "what is wrong with this reef" : thread.messages.length ? "your answer" : "press Probe this to begin";
  input.value = pending ? thread.disputeDraft : thread.draft;
  input.addEventListener("input", () => {
    if (pending) thread.disputeDraft = input.value;
    else thread.draft = input.value;
  });
  form.append(input);
  if (pending) {
    const dispute = button("Dispute", null, "ghost");
    dispute.type = "submit";
    dispute.disabled = thread.inFlight;
    const confirm = button("Confirm", () => void answerReef(island.slug, pending.id, "confirm"));
    confirm.disabled = thread.inFlight;
    form.append(dispute, confirm);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (thread.inFlight) return;
      void answerReef(island.slug, pending.id, "dispute", input.value.trim() || undefined);
    });
  } else {
    const send = button("Send", null);
    send.type = "submit";
    send.disabled = thread.inFlight || thread.messages.length === 0;
    input.disabled = input.disabled || thread.messages.length === 0;
    form.append(send);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body || thread.inFlight) return;
      thread.draft = "";
      void runTurn(island.slug, body);
    });
  }
  dock.append(form);
}

function render() {
  const s = app.snapshot;
  const island = s && app.selected ? s.islands.find((i) => i.slug === app.selected) : null;
  if (!island) {
    card.hidden = true;
    card.replaceChildren();
    if (thread.slug !== null) resetThread(null);
    renderDock(null);
    return;
  }
  if (thread.slug !== island.slug) {
    resetThread(island.slug);
    void loadThread(island.slug);
  } else if (thread.version !== app.version) {
    void loadThread(island.slug); // also mid-turn: a verdict's system line shows in the same beat as the map
  }

  const hadFocus = document.activeElement && document.activeElement.id === "thread-input";
  card.hidden = false;
  card.replaceChildren();

  card.append(el("h2", null, island.name));
  const stateText = island.verdict ? island.verdict.state : island.children.total ? "open water · islets below" : "open water";
  const state = el("div", "state", stateText);
  if (island.verdict && island.verdict.state === "reef") state.classList.add("reef");
  card.append(state);
  if (island.summary) card.append(el("p", "muted", island.summary));
  if (island.landmarks && island.landmarks.total) card.append(landmarksEl(island));

  if (island.verdict) {
    card.append(el("blockquote", null, `“${island.verdict.evidence}”`));
    if (island.verdict.rationale) card.append(el("p", "muted", island.verdict.rationale));
    card.append(el("p", "muted", `confidence ${Math.round(island.verdict.confidence * 100)}% · ${island.verdict.at.slice(0, 10)}`));
  }
  if (island.children.total) {
    const b = island.children.byState;
    card.append(
      el("p", "muted", `${island.children.total} islets: ${b.mountainous} mountainous, ${b.settled} settled, ${b.sandbar} sandbar, ${b.reef} reef, ${b.open} open`),
    );
  }

  const actions = el("div", "actions");
  if (island.hasChildren) actions.append(button("Sail in", () => setScale(island.slug), "ghost"));
  else actions.append(button("Sail closer", () => sendComment(island, "sail_closer", ""), "ghost"));
  card.append(actions);

  card.append(threadEl(island));
  renderLive();

  const note = el("form", "note");
  const input = el("input");
  input.placeholder = "a note for Claude in the terminal";
  input.value = noteDraft;
  input.addEventListener("input", () => (noteDraft = input.value));
  const send = button("Send", null);
  send.type = "submit";
  note.append(input, send);
  note.addEventListener("submit", (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    noteDraft = "";
    void sendComment(island, "note", body);
  });
  card.append(note);
  if (lastSent && lastSent.slug === island.slug) card.append(el("div", "sent", lastSent.text));

  renderDock(island);
  if (hadFocus) {
    const again = document.querySelector("#thread-input");
    if (again && !again.disabled) {
      again.focus();
      again.setSelectionRange(again.value.length, again.value.length);
    }
  }
  // Remember which chips are lit so the next render can pulse only the newly lit ones.
  thread.litSeen = new Set((island.landmarks?.items ?? []).filter((l) => l.lit).map((l) => l.slug));
  void renderHistory(island, ++renderId);
}

async function renderHistory(island, id) {
  try {
    const { history } = await api(`/api/history?domain=${encodeURIComponent(app.domain)}&target=island:${encodeURIComponent(island.slug)}`);
    if (id !== renderId || app.selected !== island.slug || history.length < 2) return;
    const list = el("ul", "history");
    for (const v of history.slice(1)) {
      list.append(el("li", null, `earlier: ${v.state} · ${v.createdAt.slice(0, 10)} · “${v.evidence}”`));
    }
    card.append(list);
  } catch (error) {
    console.error(error);
  }
}
