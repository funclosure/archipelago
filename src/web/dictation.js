// Push-to-talk (the server's half, `src/server/dictation.ts`, holds the key): hold the microphone in the answer box,
// or ⌥Space, and speak; let go, and the words land in the box at the caret, to read over and send as usual. Nothing
// is ever sent by itself. A press let go within HOLD_MS is a tap: the recording runs until the next press, for an
// answer too long to hold for; Escape drops it; it stops by itself at TALK_SECONDS_MAX. Offered only where the server
// can hear (an ElevenLabs key, or the stub's own ears) and the page may use a microphone (a secure context: localhost
// or https), so never on the hosted build. One recording at a time, held here across the pane's rebuilds: a button
// drawn anew reads its state from here. The recording leaves the page once, to the server, and is not kept.
import { t, language } from "./i18n.js";
import { icon } from "./icons.js";
import { tip } from "./tip.js";
import { request } from "./transport.js";
import { toast, toastError } from "./toast.js";
import { insertWords, pickAudioType, talkBusy as busy, talkClock, talkOn, talkStep, TALK_BITS_PER_SECOND, TALK_SECONDS_MAX, TOO_SHORT_MS } from "./dictation-model.js";

const TALK_KEY = "⌥Space";
const noHover = typeof matchMedia === "function" ? matchMedia("(hover: none)") : null; // a touch screen: no keyboard to raise

let served = false; // the server can hear (`dictation` from GET /api/judge)
let state = { phase: "idle", since: 0 };
let owner = null; // { key, keep(words) }: the answer box this recording is for
let session = 0; // bumped whenever a recording ends, so a microphone that opens late is shut again
let opening = false; // the microphone was asked for and has not answered (a permission prompt may be up)
let rec = null; // { stream, recorder, chunks, type, startedAt, meter }
let hearing = null; // the AbortController of the words on their way
let timers = [];
let letGo = null; // removes the listeners that end a hold
const parts = new WeakMap(); // a button → { owner, onChange }

/** Whether the server can hear, from `GET /api/judge`. Returns whether that changed, so the pane draws its microphone. */
export function setDictation(on) {
  const was = served;
  served = on === true;
  return served !== was;
}

/** Whether push-to-talk is offered here: the server hears, and this page may record. */
export function canTalk() {
  return served && globalThis.isSecureContext === true && typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder !== "undefined";
}

/** Whether a recording for the box `key` is under way or its words are on their way: Send waits for them. */
export function talkBusy(key) {
  return key != null && busy(state) && owner?.key === key;
}

/** Whether the microphone is open (Escape's `talk` rung drops it first). */
export const talking = () => busy(state);

/** Escape: the recording, or the words on their way, are dropped. */
export function cancelTalk() {
  step("cancel");
}

/**
 * ⌥Space from keys.js, wherever the pane offers the microphone (from inside the answer box too): pressed, it starts
 * a recording, which stops when either key comes up; a quick tap leaves it running until the next ⌥Space. Returns
 * whether the key was push-to-talk's, so keys.js swallows it (and its repeats, which would type spaces).
 */
export function talkKey(e) {
  const b = document.querySelector("#pane:not([hidden]) .talk:not(:disabled)");
  if (!b && !busy(state)) return false;
  if (e.repeat) return true;
  press(b ? parts.get(b)?.owner ?? null : owner, "key"); // with the box gone, the key still stops what it started
  return true;
}

/**
 * The microphone in an answer box. `talk` is `{ key, keep(words) }`: `key` names the box (the composer carries it
 * as `data-talk`), `keep` takes words heard after the reader left it. `onChange` runs as the recording moves along,
 * so the box can hold Send while words are on their way.
 */
export function talkButton(talk, { disabled = false, onChange } = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn quiet icon talk";
  b.dataset.fk = "talk";
  b.disabled = disabled;
  const clock = document.createElement("span");
  clock.className = "talk-clock";
  clock.setAttribute("aria-hidden", "true");
  b.append(icon("mic"), clock);
  parts.set(b, { owner: talk, onChange });
  // A press holds; the caret stays in the words, and on a phone no keyboard rises.
  b.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || b.disabled) return;
    e.preventDefault();
    press(talk, "pointer");
  });
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("contextmenu", (e) => e.preventDefault()); // a long press on a phone is the hold, not a menu
  // Enter or Space on the focused button is a tap: it starts, and the next one stops.
  b.addEventListener("click", (e) => {
    if (e.detail !== 0) return; // a pointer's click: its press already acted
    step("tap", talk);
  });
  paint(b);
  return b;
}

/** The line under the box while the microphone is open says how to stop (footMetaEl draws it, empty). */
function hint() {
  if (state.phase === "holding") return t("dictation.holding");
  if (state.phase === "latched") return noHover?.matches ? t("dictation.latchedTouch") : t("dictation.latched", { key: TALK_KEY });
  if (state.phase === "hearing") return t("dictation.hearing");
  return "";
}

function paint(b) {
  const mine = parts.get(b)?.owner?.key === owner?.key && busy(state);
  const phase = mine ? state.phase : "idle";
  if (b.dataset.phase !== phase) { // the words change with the phase, not with every tick of the clock
    b.dataset.phase = phase;
    b.dataset.state = phase === "holding" || phase === "latched" ? "on" : phase === "hearing" ? "hearing" : "idle";
    b.setAttribute("aria-pressed", String(phase === "holding" || phase === "latched"));
    b.setAttribute("aria-busy", String(phase === "hearing"));
    const label = phase === "idle" ? t("dictation.talk") : phase === "hearing" ? t("dictation.hearing") : t("dictation.stop");
    b.setAttribute("aria-label", label);
    tip(b, phase === "idle" ? t("dictation.talkTip") : phase === "hearing" ? label : hint(), phase === "idle" ? TALK_KEY : null);
  }
  const clock = b.querySelector(".talk-clock");
  if (clock) clock.textContent = talkOn(state) && mine && rec ? talkClock(performance.now() - rec.startedAt) : "";
  const box = b.closest(".composer");
  box?.classList.toggle("talking", mine);
  const line = b.closest(".foot")?.querySelector(".talk-hint");
  if (line) line.textContent = mine ? hint() : "";
}

function sync() {
  for (const b of document.querySelectorAll(".talk")) {
    paint(b);
    parts.get(b)?.onChange?.();
  }
}

function press(talk, via) {
  const before = state.phase;
  step("press", talk);
  if (before !== "idle" || state.phase !== "holding") return;
  // The hold ends when the pointer comes up anywhere (the button may be drawn anew under it), when ⌥ or Space comes
  // up, or when the window loses the keyboard.
  const end = (e) => {
    if (e.type === "keyup" && e.code !== "Space" && e.key !== "Alt") return;
    if (e.type === "keyup") e.preventDefault();
    letGo?.();
    step("release");
  };
  const types = via === "key" ? ["keyup"] : ["pointerup", "pointercancel"];
  for (const type of types) window.addEventListener(type, end, true);
  window.addEventListener("blur", end); // the window's own blur only: a capturing listener would hear every field's
  letGo = () => {
    for (const type of types) window.removeEventListener(type, end, true);
    window.removeEventListener("blur", end);
    letGo = null;
  };
}

/** Moves the recording one step (`talkStep`) and does what the step says. */
function step(event, talk = owner) {
  const next = talkStep(state, event, performance.now());
  state = next.state;
  if (next.act === "start") start(talk);
  else if (next.act === "stop") stop();
  else if (next.act === "discard") discard();
  if (state.phase === "idle" || state.phase === "hearing") letGo?.();
  sync();
}

async function start(talk) {
  owner = talk;
  const gen = ++session;
  opening = true;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (error) {
    opening = false;
    if (gen !== session) return;
    state = { phase: "idle", since: 0 };
    owner = null;
    letGo?.();
    sync();
    const name = error?.name;
    toast(name === "NotAllowedError" || name === "SecurityError" ? t("dictation.blocked") : name === "NotFoundError" ? t("dictation.noMic") : t("dictation.noMicWhy", { why: String(error?.message ?? error) }), { kind: "error" });
    return;
  }
  opening = false;
  // Escape, or the end of the hold before the microphone answered, already decided this one.
  if (gen !== session || !talkOn(state)) {
    for (const track of stream.getTracks()) track.stop();
    return;
  }
  const type = pickAudioType((x) => MediaRecorder.isTypeSupported?.(x) ?? false);
  let recorder;
  try {
    recorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: TALK_BITS_PER_SECOND });
  } catch {
    recorder = new MediaRecorder(stream);
  }
  rec = { stream, recorder, chunks: [], type: recorder.mimeType || type || "audio/webm", startedAt: performance.now(), meter: meter(stream) };
  const chunks = rec.chunks;
  recorder.addEventListener("dataavailable", (e) => e.data?.size && chunks.push(e.data));
  recorder.start();
  timers.push(setTimeout(() => step("limit"), TALK_SECONDS_MAX * 1000), setInterval(sync, 250));
}

function clearTimers() {
  for (const id of timers) {
    clearTimeout(id);
    clearInterval(id);
  }
  timers = [];
}

/** The microphone closes: its tracks stop (the browser's recording light goes out) and the level meter with them. */
function close(r) {
  for (const track of r.stream.getTracks()) track.stop();
  r.meter?.();
}

/** The end of a recording that is to be heard: its words are asked for and go into the box. */
function stop() {
  clearTimers();
  const r = rec;
  rec = null;
  if (!r) {
    // A hold that ended while the microphone was still being asked for (its permission prompt took the release)
    // runs on as a tap: the next press stops it.
    if (opening) state = { phase: "latched", since: performance.now() };
    else {
      state = { phase: "idle", since: 0 };
      owner = null;
    }
    return;
  }
  const took = performance.now() - r.startedAt;
  const talk = owner;
  const gen = session;
  r.recorder.addEventListener("stop", () => {
    close(r);
    const blob = new Blob(r.chunks, { type: r.type });
    if (gen !== session) return;
    if (took < TOO_SHORT_MS || blob.size === 0) { // a slip of the finger: nothing to hear
      owner = null;
      step("heard");
      return;
    }
    void hear(blob, talk, gen);
  }, { once: true });
  r.recorder.stop();
}

/** Escape: whatever was recorded goes, unheard, and words already on their way are not waited for. */
function discard() {
  clearTimers();
  session += 1;
  const r = rec;
  rec = null;
  if (r) {
    r.recorder.addEventListener("stop", () => close(r), { once: true });
    try {
      r.recorder.stop();
    } catch {
      close(r);
    }
  }
  hearing?.abort();
  hearing = null;
  owner = null;
}

async function hear(blob, talk, gen) {
  const controller = new AbortController();
  hearing = controller;
  try {
    const audio = await base64Of(blob);
    const res = await request("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio, type: blob.type, language: language() === "zh-TW" ? "zh-TW" : "en" }),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { status: res.status });
    if (gen !== session) return;
    const words = typeof body.text === "string" ? body.text.trim() : "";
    if (words) put(talk, words);
    else toast(t("dictation.nothing"));
  } catch (error) {
    if (gen === session && error?.name !== "AbortError") toastError(error, t("dictation.what"));
  } finally {
    if (hearing === controller) {
      hearing = null;
      owner = null;
      step("heard");
    }
  }
}

/**
 * The heard words go into the box they were spoken for, at its caret, as if typed there (its own input listener
 * keeps the draft, grows the box, readies Send); a box no longer on the page has them kept in its thread's draft.
 */
function put(talk, words) {
  const ta = document.querySelector("#pane:not([hidden]) #answer");
  const form = ta?.closest("form");
  if (!ta || ta.disabled || !talk || form?.dataset.talk !== talk.key) {
    talk?.keep?.(words);
    return;
  }
  const { value, caret } = insertWords(ta.value, ta.selectionStart, ta.selectionEnd, words);
  ta.value = value;
  ta.setSelectionRange(caret, caret);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  if (!noHover?.matches) ta.focus({ preventScroll: true }); // on a phone the words show without raising the keyboard
}

function base64Of(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(",") + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * How loud the microphone hears the reader, as `--level` (0–1) on the open button, so a hold shows it is listening.
 * Returns what stops it. Without Web Audio (or before the page may play sound) the button simply stays still.
 */
function meter(stream) {
  const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Ctx) return null;
  let ctx;
  try {
    ctx = new Ctx();
    void ctx.resume?.();
  } catch {
    return null;
  }
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let frame = 0;
  let level = 0;
  const tick = () => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const v of samples) sum += v * v;
    const rms = Math.sqrt(sum / samples.length);
    level = Math.max(Math.min(1, rms * 6), level * 0.85); // quick to rise, slow to fall, so speech reads as one level
    for (const b of document.querySelectorAll('.talk[data-state="on"]')) b.style.setProperty("--level", level.toFixed(3));
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    for (const b of document.querySelectorAll(".talk")) b.style.removeProperty("--level");
    void ctx.close?.().catch?.(() => {});
  };
}
