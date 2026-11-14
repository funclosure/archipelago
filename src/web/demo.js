// Demo fences in the log: a persona's small HTML + JS demo, run in a sandboxed iframe (`allow-scripts` only, so an
// opaque origin: no cookies, storage, page, worker, or keys) at /demo-frame.html, which carries its own CSP (no
// network, src/server/demo-frame.ts). The fence's text crosses as a message, never as markup on this page. The
// frame reports its height, console lines, and errors back; Reset reloads it, Code shows the source. A pane rebuild
// that changes the reply makes a new frame; an unchanged reply keeps its element (keep.js), so the demo keeps its
// state. Full screen fills the window with it in place. The caption folds it to its bar, which also stops it.
// Its buttons are the family's small quiet ones (`.btn.sm.quiet`), the same in a reply and on a board card: there
// the card's caption shows a second set of them (`demoTools`), and the demo's own bar shows only while it fills
// the window.
import { t } from "./i18n.js";
import { codeElement } from "./code.js";
import { pinButton } from "./pin.js";
import { icon } from "./icons.js";
import { tip } from "./tip.js";
import { exitFull, setFull as setBoxFull } from "./full.js";
import { THEMES, storedTheme } from "./theme-model.js";
import { DEMO_MAX, DEMO_TOKENS, DEMO_MIN_H, demoHeight, fullZoom, logLine, themeColours } from "./demo-model.js";

/** Bodies of the demos the reader folded, so a pane rebuild keeps them folded. */
const folded = new Set();

/** Every demo made, so one listener routes each frame's messages; a frame gone from the page is dropped. */
const demos = new Set();

function onMessage(e) {
  for (const demo of demos) {
    if (!demo.frame.isConnected) {
      if (demo.left) demos.delete(demo); // a rebuild took it out; a frame not appended yet gets one beat
      else demo.left = true;
    } else if (e.source === demo.frame.contentWindow) demo.receive(e.data);
  }
}
if (typeof window !== "undefined") window.addEventListener("message", onMessage);

/** What the demos printed as the reader used them, newest last, until a message takes them along. */
const steps = [];
const STEPS_KEPT = 40;

function noteStep(text) {
  steps.push(String(text));
  if (steps.length > STEPS_KEPT) steps.splice(0, steps.length - STEPS_KEPT);
}

/** The demos' lines since the last call, and forgets them: card.js sends them with the reader's next message. */
export function takeDemoSteps() {
  return steps.splice(0, steps.length);
}

function isDark() {
  const id = storedTheme(document.documentElement.dataset.theme);
  return THEMES.find((theme) => theme.id === id).dark;
}
function tokens() {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(DEMO_TOKENS.map((name) => [name, style.getPropertyValue(name).trim()]).filter(([, v]) => v));
}

/** Each demo's way to make another set of its buttons, by its box. */
const toolMakers = new WeakMap();

/**
 * Reset, Code and Full screen for the demo in `box`, as buttons of their own wired to it: a board card puts them in
 * its caption. Empty for a demo too long to run.
 */
export function demoTools(box) {
  return toolMakers.get(box)?.() ?? [];
}

function quiet(label) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn sm quiet";
  if (label) b.textContent = label;
  return b;
}

/**
 * A closed demo fence. Too long a body shows as its source with the reason. `preview` is the board editor's: only
 * Reset on its bar, since the code is beside it. `foldable: false` is a board card's: it has no caption to fold by,
 * so it never starts folded because the same demo was folded in a reply.
 */
export function demoElement(source, { pin = null, preview = false, foldable = true } = {}) {
  const box = document.createElement("div");
  box.className = "demo";
  const bar = document.createElement("div");
  bar.className = "bar";
  const cap = document.createElement("button");
  cap.type = "button";
  cap.className = "cap";
  cap.textContent = t("demo.caption");

  const err = document.createElement("div");
  err.className = "error";
  err.hidden = true;
  const pre = codeElement("html", source, true); // highlighted like any other fence, with its copy button
  pre.hidden = true;

  if (source.length > DEMO_MAX) {
    cap.disabled = true;
    err.textContent = t("demo.tooLong", { max: DEMO_MAX });
    err.hidden = false;
    pre.hidden = false;
    bar.append(cap);
    box.append(bar, err, pre);
    return box;
  }

  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.title = t("demo.title");
  frame.style.height = `${DEMO_MIN_H}px`;
  const out = document.createElement("div");
  out.className = "out";
  out.hidden = true;

  const canFold = foldable && !preview;
  const isFull = () => box.classList.contains("full");
  /** Tells the frame how much larger to draw: full screen is far wider than the column a demo is written for. */
  const zoom = () => {
    frame.contentWindow?.postMessage({ type: "demo-zoom", zoom: isFull() ? fullZoom(frame.clientWidth) : 1 }, "*");
  };
  // Full screen fills the window with the box where it stands (full.js), so the demo keeps its state.
  const setFull = (on) =>
    setBoxFull(box, on, () => {
      drawTools();
      zoom();
    });
  const start = () => {
    if (canFold && folded.has(source)) return;
    err.hidden = true;
    err.textContent = "";
    out.hidden = true;
    out.replaceChildren();
    // The frame and its element take the theme's scheme together; if they differ, the browser paints the frame opaque.
    const scheme = isDark() ? "dark" : "light";
    frame.style.colorScheme = scheme;
    frame.src = `/demo-frame.html?${scheme}`;
  };

  /** Every set of this demo's buttons: its own bar's, and any a board card asked for. They are drawn together. */
  const sets = [];
  function drawTools() {
    const on = isFull();
    for (const set of sets) {
      set.code.setAttribute("aria-expanded", String(!pre.hidden));
      // Filling the window, the bar's own button says the way back in words; everywhere else it is one glyph.
      const words = on && set.own;
      set.full.classList.toggle("icon", !words);
      set.full.replaceChildren(icon(on ? "collapse" : "expand", { size: 14 }), ...(words ? [t("demo.exitFull")] : []));
      set.full.setAttribute("aria-label", t(on ? "demo.exitFull" : "demo.full"));
      set.full.setAttribute("aria-pressed", String(on));
      tip(set.full, t(on ? "demo.exitFull" : "demo.full"), on ? "Esc" : undefined);
    }
  }
  const toolSet = (own) => {
    const reset = quiet(t("demo.reset"));
    reset.addEventListener("click", start);
    const code = quiet(t("demo.code"));
    code.addEventListener("click", () => {
      pre.hidden = !pre.hidden;
      drawTools();
    });
    const full = quiet();
    full.addEventListener("click", () => setFull(!isFull()));
    sets.push({ own, code, full });
    drawTools();
    return [reset, code, full];
  };
  const [reset, showCode, full] = toolSet(true);
  bar.append(cap, ...(pin ? [pinButton(pin, { kind: "demo", body: source })] : []), reset, showCode, full);
  toolMakers.set(box, () => toolSet(false));

  /** Says the box changed height, so a log that follows its end can stay there. */
  const grew = () => box.dispatchEvent(new CustomEvent("demo-resize", { bubbles: true }));
  const demo = {
    frame,
    left: false,
    receive(data) {
      if (!data || typeof data.type !== "string") return;
      if (data.type === "demo-ready") {
        const theme = tokens();
        frame.contentWindow?.postMessage({ type: "demo-run", html: themeColours(source, theme), tokens: theme }, "*");
        zoom(); // a demo reset while it fills the window stays large
      }
      else if (data.type === "demo-escape") exitFull(); // this demo, or the editor it is the preview of
      else if (data.type === "demo-size") {
        frame.style.height = `${demoHeight(data.height)}px`;
        grew();
      }
      else if (data.type === "demo-error") {
        err.textContent = t("demo.error", { message: String(data.message).slice(0, 300) });
        err.hidden = false;
        if (!preview) noteStep(`error: ${String(data.message).slice(0, 140)}`);
      } else if (data.type === "demo-log") {
        const line = logLine(data);
        if (!line) return;
        if (!preview) noteStep(line.text); // an editor's preview is the reader building, not using, the demo
        const row = document.createElement("div");
        row.className = "line";
        row.dataset.level = line.level; // a class "log" would pick up the pane's .log rule
        row.textContent = line.text;
        out.append(row);
        while (out.childElementCount > 50) out.firstChild.remove();
        out.hidden = false;
        out.scrollTop = out.scrollHeight;
        grew();
      }
    },
  };
  const fold = (on) => {
    if (on) folded.add(source);
    else folded.delete(source);
    drawFold(on);
    if (on) {
      setFull(false);
      frame.src = "about:blank"; // a folded demo stops running
      err.hidden = true;
      out.hidden = true;
    } else start();
  };
  const drawFold = (on) => {
    box.classList.toggle("folded", on);
    cap.setAttribute("aria-expanded", String(!on));
    tip(cap, t(on ? "demo.unfold" : "demo.fold"));
    reset.hidden = on;
    showCode.hidden = on;
    full.hidden = on;
  };
  if (preview) for (const b of [cap, showCode, full]) b.style.display = "none";
  cap.addEventListener("click", () => fold(!folded.has(source)));
  box.append(bar, pre, err, frame, out);
  demos.add(demo);
  // A demo that cannot be folded here never reads or changes what the reader folded elsewhere.
  if (canFold && folded.has(source)) fold(true);
  else {
    drawFold(false);
    start();
  }
  return box;
}
