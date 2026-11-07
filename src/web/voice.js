// Reading a persona's reply aloud (src/server/voice.ts holds the key and the voices). One reply plays at a time, in
// an <audio> that streams /api/speak, so it starts within a second and outlives the pane's rebuilds; each reply's
// Listen pill follows it by message id: idle, starting, or reading. Read aloud (per browser) plays each new reply
// when its turn ends.
import { t } from "./i18n.js";

const AUTO = "voice:auto";
let voices = []; // [{ role, name }]
let audio = null;
let playing = null; // the message id being read, or null
let started = false; // its first sound has played

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

function sync() {
  for (const b of document.querySelectorAll(".speak[data-id]")) {
    const on = String(playing) === b.dataset.id;
    const state = !on ? "idle" : started ? "reading" : "starting";
    if (b.dataset.state === state) continue;
    b.dataset.state = state;
    b.setAttribute("aria-pressed", String(on));
    const name = b.dataset.name;
    const key = { idle: "listen", starting: "starting", reading: "stop" }[state];
    b.querySelector(".lbl").textContent = name ? t(`voice.${key}As`, { name }) : t(`voice.${key}`);
    b.title = t(on ? "voice.stopTitle" : "voice.playTitle");
  }
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
  sync();
}

/** Reads one reply aloud, stopping whichever was playing. */
export function speak(id) {
  stopSpeaking();
  const a = new Audio(`/api/speak?id=${encodeURIComponent(id)}`);
  audio = a;
  playing = id;
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

/** The Listen pill above a reply: plays it, or stops it while it plays; it names the voice and shows the reading. */
export function speakButton(id, role) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "speak";
  b.dataset.id = String(id);
  const name = nameOf(role);
  if (name) b.dataset.name = name;
  const icon = document.createElement("span");
  icon.className = "ic";
  icon.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 3; i++) icon.append(document.createElement("i")); // the bars that move while it reads
  const lbl = document.createElement("span");
  lbl.className = "lbl";
  b.append(icon, lbl);
  b.addEventListener("click", () => (String(playing) === String(id) ? stopSpeaking() : speak(id)));
  queueMicrotask(sync);
  return b;
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
