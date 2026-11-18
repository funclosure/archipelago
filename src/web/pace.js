// A reply shown at the pace it is written (pure half: `pace-model.js`). The words that have arrived are let out a
// word at a time, one draw per animation frame at most, so a burst from the model runs on instead of landing as a
// block; once the reply is whole, the rest follows quickly. In a tab no one is looking at, everything shows at once.
import { paceAdvance, revealed } from "./pace-model.js";

/**
 * A pacer for one pane's streaming reply. `draw()` is called when what is shown changed; `text` is what to draw.
 * `update(all)` gives it everything that has arrived so far, `end()` says the reply is whole, `reset()` drops it
 * (a new turn, another thread, a stop), and `shown()` resolves once everything is on screen (or it was reset).
 */
export function createPace(draw) {
  let all = "";
  let pos = 0;
  let done = false;
  let text = "";
  let frame = 0;
  let last = 0;
  let waiting = [];

  const settle = () => {
    const resolve = waiting;
    waiting = [];
    for (const w of resolve) w();
  };
  const show = () => {
    const next = revealed(all, pos, done);
    if (next === text) return;
    text = next;
    draw();
  };
  const tick = (now) => {
    frame = 0;
    pos = paceAdvance(pos, all.length, last ? now - last : 16, done);
    last = now;
    show();
    if (pos < all.length) frame = requestAnimationFrame(tick);
    else {
      last = 0; // the next burst starts its own clock, so a pause between them is not a leap
      if (done) settle();
    }
  };
  const run = () => {
    if (typeof document !== "undefined" && document.hidden) {
      // Nobody is watching: no pace, and no frames to wait for (a hidden tab runs none).
      pos = all.length;
      show();
      if (done) settle();
      return;
    }
    if (!frame) frame = requestAnimationFrame(tick);
  };

  return {
    get text() {
      return text;
    },
    /** Whether the reply is whole and all of it is on screen. */
    get settled() {
      return done && pos >= all.length;
    },
    update(next) {
      all = String(next ?? "");
      run();
    },
    end() {
      done = true;
      if (pos >= all.length) {
        show();
        settle();
      } else run();
    },
    reset() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      all = "";
      pos = 0;
      done = false;
      text = "";
      settle();
    },
    /** Resolves when everything is shown, or when the pacer is reset. */
    shown() {
      return done && pos >= all.length ? Promise.resolve() : new Promise((resolve) => waiting.push(resolve));
    },
  };
}
