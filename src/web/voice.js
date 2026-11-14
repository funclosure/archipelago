// Reading a persona's reply aloud (src/server/voice.ts holds the key and the voices). One reply plays at a time, in
// an <audio> that streams /api/speak, so it starts within a second and outlives the pane's rebuilds. Each reply's
// Listen pill follows it by message id (idle, starting, reading, paused), and the now-playing bar at the map's
// bottom left names who is reading on which island from anywhere: 15 s back and forward, pause, speed (1×, 1.5×,
// 2×, kept per browser), stop, a progress line along its foot to seek on, or tap it to go back to the reply. Read
// aloud (per browser) plays each new reply when its turn ends.
import { t } from "./i18n.js";
import { icon } from "./icons.js";
import { tip } from "./tip.js";

const AUTO = "voice:auto";
const RATE = "voice:rate";
const RATES = [1, 1.5, 2];
const SKIP = 15;
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

function rate() {
  try {
    const r = Number(localStorage.getItem(RATE));
    return RATES.includes(r) ? r : 1;
  } catch {
    return 1;
  }
}

function cycleRate() {
  const next = RATES[(RATES.indexOf(rate()) + 1) % RATES.length];
  try {
    localStorage.setItem(RATE, String(next));
  } catch {
    /* storage unavailable: this reading still changes */
  }
  if (audio) audio.playbackRate = next;
  drawBar();
}

/** How long the reading is: its duration once known, else as much as has arrived while it streams. */
function lengthOf(a) {
  if (Number.isFinite(a.duration) && a.duration > 0) return a.duration;
  return a.buffered.length ? a.buffered.end(a.buffered.length - 1) : 0;
}

function seekTo(seconds) {
  if (!audio) return;
  const end = lengthOf(audio);
  audio.currentTime = Math.max(0, end ? Math.min(seconds, end - 0.1) : seconds);
  drawProgress();
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

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
  for (const e of ["timeupdate", "durationchange", "progress"]) a.addEventListener(e, () => audio === a && drawProgress());
  a.playbackRate = rate();
  a.defaultPlaybackRate = rate();
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

const SVG = "http://www.w3.org/2000/svg";

/** A skip icon drawn here: a circular arrow with its head at the top and the seconds inside (`back` mirrors it). */
function skipIcon(seconds, back) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("aria-hidden", "true");
  const arrow = document.createElementNS(SVG, "g");
  arrow.setAttribute("fill", "none");
  arrow.setAttribute("stroke", "currentColor");
  arrow.setAttribute("stroke-width", "1.7");
  arrow.setAttribute("stroke-linecap", "round");
  arrow.setAttribute("stroke-linejoin", "round");
  if (back) arrow.setAttribute("transform", "translate(24 0) scale(-1 1)");
  for (const d of ["M12 4.5A8.5 8.5 0 1 1 4.6 8.8", "M10.2 2.4L12.6 4.5L10.2 6.6"]) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    arrow.append(path);
  }
  const text = document.createElementNS(SVG, "text");
  text.setAttribute("x", "12");
  text.setAttribute("y", "16.2");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", "7.6");
  text.setAttribute("font-weight", "700");
  text.setAttribute("fill", "currentColor");
  text.textContent = String(seconds);
  svg.append(arrow, text);
  return svg;
}

function button(cls, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}

/**
 * The now-playing bar: built once, drawn from the reading's state, hidden when nothing reads. One row at the map's
 * bottom left (who reads, on which island, the clock, the controls) with the progress line along its foot. When it
 * comes or goes it says so with a `voice` event, since the bottom card steps over it.
 */
function drawBar() {
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "now-playing";
    bar.setAttribute("role", "region");
    bar.hidden = true;
    const go = button("np-go", () => playing?.go?.(playing.id));
    const text = document.createElement("span");
    text.className = "np-text";
    for (const cls of ["np-who", "np-where"]) {
      const span = document.createElement("span");
      span.className = cls;
      text.append(span);
    }
    go.append(barsEl(), text);
    const time = document.createElement("span");
    time.className = "np-time";
    const controls = document.createElement("span");
    controls.className = "np-controls";
    controls.append(
      button("np-back", () => audio && seekTo(audio.currentTime - SKIP)),
      button("np-pause", togglePause),
      button("np-fwd", () => audio && seekTo(audio.currentTime + SKIP)),
      button("np-rate", cycleRate),
      button("np-stop", stopSpeaking),
    );
    controls.querySelector(".np-back").append(skipIcon(SKIP, true));
    controls.querySelector(".np-fwd").append(skipIcon(SKIP, false));
    controls.querySelector(".np-stop").append(icon("close", { size: 14 }));
    const track = document.createElement("div");
    track.className = "np-track";
    const fill = document.createElement("div");
    fill.className = "np-fill";
    track.append(fill);
    // A click on the line seeks there, within what has arrived.
    track.addEventListener("click", (e) => {
      if (!audio) return;
      const r = track.getBoundingClientRect();
      seekTo(((e.clientX - r.left) / r.width) * lengthOf(audio));
    });
    bar.append(go, time, controls, track);
    document.body.append(bar);
  }
  if (bar.hidden !== !playing) {
    bar.hidden = !playing;
    document.dispatchEvent(new CustomEvent("voice", { detail: { reading: Boolean(playing) } }));
  }
  if (!playing) return;
  bar.dataset.state = stateOf(playing.id);
  bar.dataset.role = playing.role ?? "";
  bar.setAttribute("aria-label", t("voice.barLabel"));
  const persona = playing.role === "judge" ? t("voice.keeper") : t("voice.mentor");
  const name = nameOf(playing.role);
  bar.querySelector(".np-who").textContent = name ? t("voice.whoAs", { name, persona }) : persona;
  bar.querySelector(".np-where").textContent = playing.island;
  // Each control says what it does when the pointer rests on it; none has words of its own, so the same line names it.
  const label = (cls, words) => {
    const b = bar.querySelector(cls);
    tip(b, words);
    b.setAttribute("aria-label", words);
    return b;
  };
  label(".np-go", t("voice.goTitle"));
  label(".np-back", t("voice.backTitle", { n: SKIP }));
  const pause = label(".np-pause", t(paused ? "voice.resumeTitle" : "voice.pauseTitle"));
  if (pause.dataset.shows !== String(paused)) {
    pause.dataset.shows = String(paused);
    pause.replaceChildren(icon(paused ? "play" : "pause", { size: 14 }));
  }
  label(".np-fwd", t("voice.forwardTitle", { n: SKIP }));
  label(".np-rate", t("voice.rateTitle")).textContent = `${rate()}×`;
  label(".np-stop", t("voice.stopTitle"));
  drawProgress();
}

/** The progress line and the clock, on every tick of the reading. */
function drawProgress() {
  if (!bar || !audio) return;
  const end = lengthOf(audio);
  const at = audio.currentTime;
  bar.querySelector(".np-fill").style.width = `${end ? Math.min(100, (at / end) * 100) : 0}%`;
  const known = Number.isFinite(audio.duration);
  bar.querySelector(".np-time").textContent = known ? `${clock(at)} / ${clock(audio.duration)}` : clock(at);
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
