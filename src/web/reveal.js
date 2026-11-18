// A streaming reply drawn as it arrives, its new words fading in (pure half: `reveal-model.js`). Each arrival is drawn
// at once, at most one draw an animation frame, where it will stay; the words a block shows for the first time are
// wrapped in `span.fresh`, whose animation (styles.css) fades each one in a little after the one before. A block
// drawn again keeps the timing of what it already showed (a negative delay picks the fade up where it was), so a
// redraw never restarts a fade. Under reduced motion, and in a tab no one is looking at, words simply appear.
import { FADE_MS, arrive, revealed } from "./reveal-model.js";

// What is drawn as a picture rather than as words: the whole of it fades with its first new word.
const PICTURE = ".diagram, .plot, .demo, svg";

const still = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const unseen = () => typeof document !== "undefined" && document.hidden;

/** Sets `node` to fade in starting `delay` milliseconds from now (negative: it began that long ago). */
function fading(node, delay) {
  node.classList.add("fresh");
  node.style.setProperty("--fade-at", `${Math.round(delay)}ms`);
}

/**
 * Wraps each still-fading word of `root` (`{ from, to, start }`, offsets into its `textContent`) in a `span.fresh`
 * timed to its start. A word split by markup (`**bo**ld`) is wrapped in each of its parts.
 */
function wrapWords(root, words, now) {
  if (!words.length) return;
  const nodes = [];
  let offset = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push([n, offset]);
    offset += n.data.length;
  }
  let i = 0;
  const pictures = new Set();
  for (const [node, start] of nodes) {
    const end = start + node.data.length;
    while (i < words.length && words[i].to <= start) i++;
    if (i >= words.length) break;
    if (words[i].from >= end) continue;
    const picture = node.parentElement?.closest(PICTURE);
    if (picture && root.contains(picture)) {
      if (!pictures.has(picture)) fading(picture, words[i].start - now);
      pictures.add(picture);
      continue;
    }
    const parts = document.createDocumentFragment();
    let at = start;
    for (let j = i; j < words.length && words[j].from < end; j++) {
      const a = Math.max(words[j].from, start);
      const b = Math.min(words[j].to, end);
      if (a > at) parts.append(node.data.slice(at - start, a - start));
      const span = document.createElement("span");
      span.textContent = node.data.slice(a - start, b - start);
      fading(span, words[j].start - now);
      parts.append(span);
      at = b;
    }
    if (at < end) parts.append(node.data.slice(at - start));
    node.replaceWith(parts);
  }
}

/**
 * The reveal of one pane's streaming reply. `draw()` is called when what is shown changed; `text` is what to draw,
 * and `fade(key, build)` wraps a block's builder so the words it shows for the first time fade in. `update(all)`
 * gives it everything that has arrived so far, `end()` says the reply is whole, `reset()` drops it (a new turn,
 * another thread, a stop), and `shown()` resolves once all of it is drawn and done fading (or it was reset).
 */
export function createReveal(draw) {
  let all = "";
  let done = false;
  let dirty = false;
  let text = "";
  let frame = 0;
  let timer = 0;
  let waiting = [];
  let records = new Map();
  let wave = 0;
  let fadeEnd = 0;

  const settle = () => {
    const resolve = waiting;
    waiting = [];
    for (const w of resolve) w();
  };
  const finish = () => {
    if (!done || frame) return;
    clearTimeout(timer);
    const left = fadeEnd - performance.now();
    if (left > 0 && !unseen()) timer = setTimeout(finish, left);
    else settle();
  };
  const show = () => {
    frame = 0;
    const next = revealed(all, done);
    if (next !== text || dirty) {
      text = next;
      dirty = false;
      draw();
    }
    finish();
  };
  const schedule = () => {
    if (frame) return;
    if (unseen()) show(); // a hidden tab runs no frames
    else frame = requestAnimationFrame(show);
  };

  return {
    get text() {
      return text;
    },
    /** Whether the reply is whole (the caret goes). */
    get settled() {
      return done;
    },
    update(next) {
      all = String(next ?? "");
      schedule();
    },
    end() {
      done = true;
      dirty = true; // drawn once more, without the caret, even when the text is as it was
      schedule();
    },
    reset() {
      if (frame) cancelAnimationFrame(frame);
      clearTimeout(timer);
      frame = 0;
      all = "";
      done = false;
      dirty = false;
      text = "";
      records = new Map();
      wave = 0;
      fadeEnd = 0;
      settle();
    },
    /** Resolves once the whole reply is drawn and its last words have faded in, or when the reveal is reset. */
    shown() {
      return done && !frame && performance.now() >= fadeEnd ? Promise.resolve() : new Promise((resolve) => waiting.push(resolve));
    },
    /** `build`, for the block kept under `key`, with the words it shows for the first time fading in. */
    fade(key, build) {
      return () => {
        const node = build();
        const shown = node.textContent ?? "";
        if (still() || unseen() || node.nodeType !== 1) {
          records.set(key, { text: shown, words: [] });
          return node;
        }
        const now = performance.now();
        const next = arrive(records.get(key), shown, now, wave);
        records.set(key, next.record);
        wave = next.wave;
        for (const w of next.record.words) fadeEnd = Math.max(fadeEnd, w.start + FADE_MS);
        wrapWords(node, next.record.words, now);
        return node;
      };
    },
  };
}
