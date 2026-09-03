import { app, api, setScale } from "./app.js";

const card = document.getElementById("card");
let draft = "";                 // note text survives re-renders
let lastSent = null;            // { slug, text } shown under the note box
let renderId = 0;               // guards the async history append against stale renders

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
  probe_me: "Asked Claude to probe this island next.",
  sail_closer: "Asked Claude to chart this island's coastline.",
  note: "Note sent. Claude reads it at the start of the next turn.",
  dispute: "Dispute sent. Claude will reopen this verdict.",
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

function render() {
  const s = app.snapshot;
  const island = s && app.selected ? s.islands.find((i) => i.slug === app.selected) : null;
  if (!island) {
    card.hidden = true;
    card.replaceChildren();
    return;
  }
  card.hidden = false;
  card.replaceChildren();

  card.append(el("h2", null, island.name));
  const stateText = island.verdict ? island.verdict.state : island.children.total ? "open water · islets below" : "open water";
  const state = el("div", "state", stateText);
  if (island.verdict && island.verdict.state === "reef") state.classList.add("reef");
  card.append(state);
  if (island.summary) card.append(el("p", "muted", island.summary));

  if (island.verdict) {
    card.append(el("blockquote", null, `“${island.verdict.evidence}”`));
    if (island.verdict.rationale) card.append(el("p", "muted", island.verdict.rationale));
    card.append(el("p", "muted", `confidence ${Math.round(island.verdict.confidence * 100)}% · ${island.verdict.at.slice(0, 10)}`));
  } else if (island.children.total) {
    const b = island.children.byState;
    card.append(
      el("p", "muted", `${island.children.total} islets: ${b.mountainous} mountainous, ${b.settled} settled, ${b.sandbar} sandbar, ${b.reef} reef, ${b.open} open`),
    );
  } else {
    card.append(el("p", "muted", "Unsurveyed. Ask Claude to probe it, or leave a note."));
  }

  const actions = el("div", "actions");
  actions.append(button("Probe this", () => sendComment(island, "probe_me", "")));
  if (island.hasChildren) actions.append(button("Sail in", () => setScale(island.slug), "ghost"));
  else actions.append(button("Sail closer", () => sendComment(island, "sail_closer", ""), "ghost"));
  card.append(actions);

  const note = el("form", "note");
  const input = el("input");
  input.placeholder = "a note or a dispute for Claude";
  input.value = draft;
  input.addEventListener("input", () => (draft = input.value));
  const kind = el("select");
  for (const k of ["note", "dispute"]) {
    const o = el("option", null, k);
    o.value = k;
    kind.append(o);
  }
  const send = button("Send", null);
  send.type = "submit";
  note.append(input, kind, send);
  note.addEventListener("submit", (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    draft = "";
    void sendComment(island, kind.value, body);
  });
  card.append(note);

  if (lastSent && lastSent.slug === island.slug) card.append(el("div", "sent", lastSent.text));

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
