import { test, expect } from "bun:test";
import { HOLD_MS, TALK_BITS_PER_SECOND, TALK_SECONDS_MAX, insertWords, pickAudioType, talkBusy, talkClock, talkOn, talkStep } from "../../src/web/dictation-model.js";
import * as core from "../../src/core/dictation.ts";

const idle = { phase: "idle", since: 0 };
const run = (events) => {
  let state = idle;
  const acts = [];
  for (const [event, now] of events) {
    const next = talkStep(state, event, now);
    state = next.state;
    acts.push(next.act);
  }
  return { phase: state.phase, acts };
};

test("the page's limits are the server's", () => {
  expect(TALK_SECONDS_MAX).toBe(core.TALK_SECONDS_MAX);
  expect(TALK_BITS_PER_SECOND).toBe(core.TALK_BITS_PER_SECOND);
});

test("a hold records until it is let go, and the words are heard", () => {
  expect(run([["press", 1000], ["release", 1000 + HOLD_MS + 1]])).toEqual({ phase: "hearing", acts: ["start", "stop"] });
  expect(run([["press", 0], ["release", 5000], ["heard", 6000]]).phase).toBe("idle");
});

test("a tap starts a recording that runs until the next press, a keyboard's click, or the time limit", () => {
  expect(run([["press", 0], ["release", HOLD_MS - 1]])).toEqual({ phase: "latched", acts: ["start", null] });
  expect(run([["press", 0], ["release", 100], ["press", 9000], ["release", 9100]])).toEqual({ phase: "hearing", acts: ["start", null, "stop", null] });
  expect(run([["tap", 0], ["tap", 4000]])).toEqual({ phase: "hearing", acts: ["start", "stop"] });
  expect(run([["tap", 0], ["limit", 120_000]]).acts).toEqual(["start", "stop"]);
  expect(run([["press", 0], ["limit", 120_000]]).acts).toEqual(["start", "stop"]);
});

test("Escape drops a recording, or words on their way; a press while they come does nothing", () => {
  expect(run([["press", 0], ["cancel", 50]])).toEqual({ phase: "idle", acts: ["start", "discard"] });
  expect(run([["tap", 0], ["cancel", 50]]).acts).toEqual(["start", "discard"]);
  expect(run([["press", 0], ["release", 2000], ["cancel", 2100]]).acts).toEqual(["start", "stop", "discard"]);
  expect(run([["cancel", 0]])).toEqual({ phase: "idle", acts: [null] });
  expect(run([["press", 0], ["release", 2000], ["press", 2100], ["tap", 2200]])).toEqual({ phase: "hearing", acts: ["start", "stop", null, null] });
  expect(run([["release", 0], ["heard", 0], ["limit", 0]])).toEqual({ phase: "idle", acts: [null, null, null] });
});

test("busy while recording or hearing (Send waits); on only while the microphone is open", () => {
  for (const [phase, b, on] of [["idle", false, false], ["holding", true, true], ["latched", true, true], ["hearing", true, false]]) {
    expect(talkBusy({ phase })).toBe(b);
    expect(talkOn({ phase })).toBe(on);
  }
});

test("the recording kind is the first this browser makes: WebM Opus, Safari's MP4, Ogg; else the browser's own", () => {
  expect(pickAudioType(() => true)).toBe("audio/webm;codecs=opus");
  expect(pickAudioType((t) => t === "audio/mp4")).toBe("audio/mp4");
  expect(pickAudioType((t) => t.startsWith("audio/ogg"))).toBe("audio/ogg;codecs=opus");
  expect(pickAudioType(() => false)).toBe("");
});

test("heard words go in at the caret, a space where English meets, none inside Chinese", () => {
  expect(insertWords("", 0, 0, " Caches forget. ")).toEqual({ value: "Caches forget.", caret: 14 });
  expect(insertWords("I think", 7, 7, "it evicts the oldest")).toEqual({ value: "I think it evicts the oldest", caret: 28 });
  expect(insertWords("I think ", 8, 8, "so")).toEqual({ value: "I think so", caret: 10 });
  expect(insertWords("Firstbecause", 5, 5, "it is")).toEqual({ value: "First it is because", caret: 11 });
  expect(insertWords("我覺得", 3, 3, "快取會忘記")).toEqual({ value: "我覺得快取會忘記", caret: 8 });
  expect(insertWords("我覺得", 3, 3, "cache 會忘記")).toEqual({ value: "我覺得 cache 會忘記", caret: 13 });
  expect(insertWords("首先，", 3, 3, "it forgets")).toEqual({ value: "首先，it forgets", caret: 13 });
  expect(insertWords("Well", 4, 4, ", maybe")).toEqual({ value: "Well, maybe", caret: 11 });
  expect(insertWords("(", 1, 1, "maybe")).toEqual({ value: "(maybe", caret: 6 });
  // A selection is replaced.
  expect(insertWords("I said wrong things here", 7, 19, "right")).toEqual({ value: "I said right here", caret: 12 });
  // Nothing heard changes nothing.
  expect(insertWords("kept", 2, 2, "  ")).toEqual({ value: "kept", caret: 2 });
  // A caret out of range is held to the text.
  expect(insertWords("ab", 9, 9, "c")).toEqual({ value: "ab c", caret: 4 });
});

test("the clock counts minutes and seconds", () => {
  expect(talkClock(0)).toBe("0:00");
  expect(talkClock(7_900)).toBe("0:07");
  expect(talkClock(112_000)).toBe("1:52");
  expect(talkClock(-5)).toBe("0:00");
});
