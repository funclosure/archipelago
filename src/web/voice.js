// Reading a persona's reply aloud (src/server/voice.ts holds the key and the voices). One reply plays at a time, in
// an <audio> that streams /api/speak, so it starts within a second and outlives the pane's rebuilds. Each reply's
// Listen pill follows it by message id (idle, starting, reading, paused), and the now-playing bar at the map's
// bottom left names who is reading on which island from anywhere: pause, stop, or tap it to go back to the reply.
// Read aloud (per browser) plays each new reply when its turn ends.
import { t } from "./i18n.js";

const AUTO = "voice:auto";
let voices = []; // [{ role, name }]
let audio = null;
let playing = null; // { id, role, island, go } for the reply being read, or null
let started = false; // its first sound has played
let paused = false;
let bar = null;

/** The voices the server has, from `GET /api/judge`: `[{ role, name }]`. */
export function setVoices(list) {
  voices = Array.isArray(list) ? list.filter((v) => v && typeof v.role === "string") : [];
}

/** Whether a reply of this role (`mentor`, `judge`) can be read aloud here. */
export function canSpeak(role) {
  return voices.some((v) => v.role === role);
}

const nameOf = (role) => voices.find((v) => v.role === role)?.name ?? null;

export function autoRead() {
  try {
    return localStorage.getItem(AUTO) === "1";
  } catch {
    return false;
  }
}

function setAutoRead(on) {
  try {
    if (on) localStorage.setItem(AUTO, "1");
    else localStorage.removeItem(AUTO);
  } catch {
    /* storage unavailable: it stays as it was */
  }
}

const stateOf = (id) => (String(playing?.id) !== String(id) ? "idle" : paused ? "paused" : started ? "reading" : "starting");

function sync() {
  for (const b of document.querySelectorAll(".speak[data-id]")) {
    const state = stateOf(b.dataset.id);
    if (b.dataset.state === state) continue;
    b.dataset.state = state;
    b.setAttribute("aria-pressed", String(state !== "idle"));
    const name = b.dataset.name;
    const key = { idle: "listen", starting: "starting", reading: "pause", paused: "resume" }[state];
    b.querySelector(".lbl").textContent = name ? t(`voice.${key}As`, { name }) : t(`voice.${key}`);
    b.title = t(state === "idle" ? "voice.playTitle" : state === "paused" ? "voice.resumeTitle" : "voice.pauseTitle");
  }
  drawBar();
}

export function stopSpeaking() {
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  audio = null;
  playing = null;
  started = false;
  paused = false;
  sync();
}

function togglePause() {
  if (!audio) return;
  if (paused) void audio.play().catch(() => {});
  else audio.pause();
  paused = !paused;
  sync();
}

/** Reads one reply aloud, stopping whichever was playing. `meta`: its role, its island's name, and `go`, which
 *  brings it back into view. */
export function speak(id, meta = {}) {
  stopSpeaking();
  const a = new Audio(`/api/speak?id=${encodeURIComponent(id)}`);
  audio = a;
  playing = { id, role: meta.role ?? null, island: meta.island ?? "", go: meta.go ?? null };
  const done = () => {
    if (audio === a) stopSpeaking();
  };
  a.addEventListener("playing", () => {
    if (audio !== a) return;
    started = true;
    sync();
  });
  a.addEventListener("ended", done);
  a.addEventListener("error", done);
  a.play().catch(done); // a browser that refuses to play without a click: the button is there
  sync();
}

function barsEl() {
  const icon = document.createElement("span");
  icon.className = "ic";
  icon.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 3; i++) icon.append(document.createElement("i")); // the bars that move while it reads
  return icon;
}

/** The Listen pill above a reply: plays it, then pauses and resumes it; it names the voice and shows the reading. */
export function speakButton(id, role, meta = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "speak";
  b.dataset.id = String(id);
  const name = nameOf(role);
  if (name) b.dataset.name = name;
  const lbl = document.createElement("span");
  lbl.className = "lbl";
  b.append(barsEl(), lbl);
  b.addEventListener("click", () => (String(playing?.id) === String(id) ? togglePause() : speak(id, { role, ...meta })));
  queueMicrotask(sync);
  return b;
}

function button(cls, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}

/** The now-playing bar: built once, drawn from the reading's state, hidden when nothing reads. */
function drawBar() {
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "now-playing";
    bar.setAttribute("role", "region");
    const go = button("np-go", () => playing?.go?.(playing.id));
    const text = document.createElement("span");
    text.className = "np-text";
    const who = document.createElement("span");
    who.className = "np-who";
    const where = document.createElement("span");
    where.className = "np-where";
    text.append(who, where);
    go.append(barsEl(), text);
    bar.append(go, button("np-pause", togglePause), button("np-stop", stopSpeaking));
    document.body.append(bar);
  }
  bar.hidden = !playing;
  if (!playing) return;
  bar.dataset.state = stateOf(playing.id);
  bar.dataset.role = playing.role ?? "";
  bar.setAttribute("aria-label", t("voice.barLabel"));
  const persona = playing.role === "judge" ? t("voice.keeper") : t("voice.mentor");
  const name = nameOf(playing.role);
  bar.querySelector(".np-who").textContent = name ? t("voice.whoAs", { name, persona }) : persona;
  bar.querySelector(".np-where").textContent = playing.island;
  bar.querySelector(".np-go").title = t("voice.goTitle");
  const pause = bar.querySelector(".np-pause");
  pause.textContent = paused ? "▶" : "❚❚";
  pause.title = t(paused ? "voice.resumeTitle" : "voice.pauseTitle");
  pause.setAttribute("aria-label", pause.title);
  const stop = bar.querySelector(".np-stop");
  stop.textContent = "×";
  stop.title = t("voice.stopTitle");
  stop.setAttribute("aria-label", stop.title);
}

/** The Read aloud switch in a pane's foot. */
export function autoReadEl() {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "read-aloud";
  const draw = () => {
    const on = autoRead();
    b.textContent = t(on ? "voice.autoOn" : "voice.autoOff");
    b.setAttribute("aria-pressed", String(on));
    b.title = t("voice.autoTitle");
  };
  b.addEventListener("click", () => {
    setAutoRead(!autoRead());
    if (!autoRead()) stopSpeaking();
    draw();
  });
  draw();
  return b;
}
