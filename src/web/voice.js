// Reading a persona's reply aloud (src/server/voice.ts holds the key and the voices). One reply plays at a time, in
// an <audio> that streams /api/speak, so it starts within a second and outlives the pane's rebuilds; each speak
// button follows it by its message id. Read aloud (per browser) plays each new reply when its turn ends.
import { t } from "./i18n.js";

const AUTO = "voice:auto";
let voices = [];
let audio = null;
let playing = null; // the message id being read, or null

/** The roles the server can voice, from `GET /api/judge`. */
export function setVoices(roles) {
  voices = Array.isArray(roles) ? roles : [];
}

/** Whether a reply of this role (`mentor`, `judge`) can be read aloud here. */
export function canSpeak(role) {
  return voices.includes(role);
}

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
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
    b.title = t(on ? "voice.stop" : "voice.play");
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
  a.addEventListener("ended", done);
  a.addEventListener("error", done);
  a.play().catch(done); // a browser that refuses to play without a click: the button is there
  sync();
}

/** The ▶ on a reply: plays it, or stops it while it plays. */
export function speakButton(id) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "speak";
  b.dataset.id = String(id);
  b.setAttribute("aria-label", t("voice.play"));
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
