// Pure parts of push-to-talk (`dictation.js`): how a press, a release, Escape and the time limit move a recording
// along, which kind of recording a browser makes, and where heard words go in the words already typed. The limits
// mirror `src/core/dictation.ts` (a test keeps them equal).

/** The longest one recording runs before it stops by itself, and the words so far are heard. */
export const TALK_SECONDS_MAX = 120;
/** The bit rate the page records speech at. */
export const TALK_BITS_PER_SECOND = 48_000;
/** A press let go sooner than this is a tap: the recording goes on until the next press, for an answer too long to hold for. */
export const HOLD_MS = 300;
/** A recording shorter than this holds nothing to hear, and is dropped without asking the server. */
export const TOO_SHORT_MS = 500;

/** The recording kinds to ask a browser for, best first: Opus in WebM (Chrome, Firefox), AAC in MP4 (Safari), Opus in Ogg. */
const AUDIO_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];

/** The first kind of recording `supports` says this browser makes, or "" to leave it to the browser. */
export function pickAudioType(supports) {
  return AUDIO_TYPES.find((type) => supports(type)) ?? "";
}

/**
 * One step of a recording. `state` is `{ phase, since }`: `idle`, `holding` (pressed and still held), `latched` (a
 * tap started it; the next press stops it), or `hearing` (the words are on their way). Events: `press` and `release`
 * (the pointer or ⌥Space), `tap` (a keyboard's click on the button), `cancel` (Escape), `limit` (the time ran out),
 * `heard` (the words came back, or failed to). Returns the next state and what to do: `start`, `stop` (and hear the
 * words), `discard`, or null.
 */
export function talkStep(state, event, now) {
  const { phase } = state;
  const to = (next, act = null) => ({ state: { phase: next, since: next === phase ? state.since : now }, act });
  if (event === "cancel") return phase === "idle" ? to("idle") : to("idle", "discard");
  if (phase === "idle") return event === "press" ? to("holding", "start") : event === "tap" ? to("latched", "start") : to("idle");
  if (phase === "holding") {
    if (event === "release") return now - state.since < HOLD_MS ? to("latched") : to("hearing", "stop");
    if (event === "tap" || event === "limit") return to("hearing", "stop");
    return to("holding");
  }
  if (phase === "latched") return event === "press" || event === "tap" || event === "limit" ? to("hearing", "stop") : to("latched");
  return event === "heard" ? to("idle") : to("hearing");
}

/** Whether a recording is under way or its words are on their way (Send waits for them). */
export const talkBusy = (state) => state.phase !== "idle";

/** Whether the microphone is open: held, or running after a tap. */
export const talkOn = (state) => state.phase === "holding" || state.phase === "latched";

const WIDE_PUNCT = /[　-〿＀-￯]/u; // 。，、「」 and full-width forms
const CJK = /[⺀-⿿぀-鿿가-힯豈-﫿]/u;
const CLOSERS = /[,.;:!?%)\]}”’]/u;
const OPENERS = /[([{“‘]/u;

/** What goes between two characters that meet where heard words join typed ones: a space, or nothing. */
function gap(a, b) {
  if (!a || !b || /\s/u.test(a) || /\s/u.test(b)) return "";
  if (WIDE_PUNCT.test(a) || WIDE_PUNCT.test(b)) return "";
  if (CJK.test(a) && CJK.test(b)) return ""; // Chinese runs on without spaces
  if (CLOSERS.test(b) || OPENERS.test(a)) return "";
  return " ";
}

/**
 * Heard words put into the answer box at its selection (`start`, `end`), replacing what is selected, with a space
 * where English words meet and none inside Chinese. Returns the new value and where the caret goes: after the words.
 */
export function insertWords(value, start, end, words) {
  const said = String(words ?? "").trim();
  const text = String(value ?? "");
  const from = Math.max(0, Math.min(start ?? text.length, text.length));
  const to = Math.max(from, Math.min(end ?? from, text.length));
  if (!said) return { value: text, caret: to };
  const before = text.slice(0, from);
  const after = text.slice(to);
  const lead = gap(before.at(-1), said[0]);
  const tail = gap(said.at(-1), after[0]);
  return { value: before + lead + said + tail + after, caret: before.length + lead.length + said.length };
}

/** How long a recording has run, as a clock: 0:07, 1:52. */
export function talkClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
