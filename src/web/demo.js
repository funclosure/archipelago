// Demo fences in the log: a persona's small HTML + JS demo, run in a sandboxed iframe (`allow-scripts` only, so an
// opaque origin: no cookies, storage, page, worker, or keys) at /demo-frame.html, which carries its own CSP (no
// network, src/server/demo-frame.ts). The fence's text crosses as a message, never as markup on this page. The
// frame reports its height, console lines, and errors back; Reset reloads it, Code shows the source. A pane rebuild
// that changes the reply makes a new frame; an unchanged reply keeps its element (keep.js), so the demo keeps its
// state. Full screen fills the window with it in place. The caption folds it to its bar, which also stops it.
import { t } from "./i18n.js";
import { codeElement } from "./code.js";
import { pinButton } from "./pin.js";
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

let leaveFull = null; // closes the demo that fills the window, while one does

/** Brings a demo that fills the window back to its place. True when there was one (Escape stops there). */
export function exitFullDemo() {
  if (!leaveFull) return false;
  leaveFull();
  return true;
}

function tokens() {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(DEMO_TOKENS.map((name) => [name, style.getPropertyValue(name).trim()]).filter(([, v]) => v));
}

/** A closed demo fence. Too long a body shows as its source with the reason. */
export function demoElement(source, { pin = null } = {}) {
  const box = document.createElement("div");
  box.className = "demo";
  const bar = document.createElement("div");
  bar.className = "bar";
  const cap = document.createElement("button");
  cap.type = "button";
  cap.className = "cap";
  cap.textContent = t("demo.caption");
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "btn ghost";
  reset.textContent = t("demo.reset");
  const showCode = document.createElement("button");
  showCode.type = "button";
  showCode.className = "btn ghost";
  showCode.textContent = t("demo.code");
  showCode.setAttribute("aria-expanded", "false");
  const full = document.createElement("button");
  full.type = "button";
  full.className = "btn ghost";
  bar.append(cap, ...(pin ? [pinButton(pin, { kind: "demo", body: source })] : []), reset, showCode, full);
  // Full screen puts the box in the top layer where it stands (a popover), so the frame is never moved and the
  // demo keeps its state going in and coming out.
  const setFull = (on) => {
    if (on === box.classList.contains("full")) return;
    if (on) {
      exitFullDemo();
      try {
        box.setAttribute("popover", "manual");
        box.showPopover();
      } catch {
        box.removeAttribute("popover"); // a browser without popovers: the demo stays where it is
        return;
      }
      leaveFull = () => setFull(false);
    } else {
      try {
        box.hidePopover();
      } catch {
        /* already hidden: it left the page while it was full */
      }
      box.removeAttribute("popover");
      leaveFull = null;
    }
    box.classList.toggle("full", on);
    drawFull();
    zoom();
  };
  /** Tells the frame how much larger to draw: full screen is far wider than the column a demo is written for. */
  const zoom = () => {
    const on = box.classList.contains("full");
    frame.contentWindow?.postMessage({ type: "demo-zoom", zoom: on ? fullZoom(frame.clientWidth) : 1 }, "*");
  };
  const drawFull = () => {
    const on = box.classList.contains("full");
    full.textContent = t(on ? "demo.exitFull" : "demo.full");
    full.title = t(on ? "demo.exitFullTitle" : "demo.fullTitle");
    full.setAttribute("aria-pressed", String(on));
  };
  drawFull();
  full.addEventListener("click", () => setFull(!box.classList.contains("full")));

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
    box.append(bar, err, pre);
    reset.hidden = true;
    showCode.hidden = true;
    full.hidden = true;
    return box;
  }

  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.title = t("demo.title");
  frame.style.height = `${DEMO_MIN_H}px`;
  const out = document.createElement("div");
  out.className = "out";
  out.hidden = true;

  const start = () => {
    if (folded.has(source)) return;
    err.hidden = true;
    err.textContent = "";
    out.hidden = true;
    out.replaceChildren();
    frame.src = `/demo-frame.html`;
  };
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
      else if (data.type === "demo-escape") setFull(false);
      else if (data.type === "demo-size") {
        frame.style.height = `${demoHeight(data.height)}px`;
        grew();
      }
      else if (data.type === "demo-error") {
        err.textContent = t("demo.error", { message: String(data.message).slice(0, 300) });
        err.hidden = false;
      } else if (data.type === "demo-log") {
        const line = logLine(data);
        if (!line) return;
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
    box.classList.toggle("folded", on);
    cap.setAttribute("aria-expanded", String(!on));
    cap.title = t(on ? "demo.unfold" : "demo.fold");
    reset.hidden = on;
    showCode.hidden = on;
    full.hidden = on;
    if (on) {
      setFull(false);
      frame.src = "about:blank"; // a folded demo stops running
      err.hidden = true;
      out.hidden = true;
    } else start();
  };
  cap.addEventListener("click", () => fold(!folded.has(source)));
  reset.addEventListener("click", start);
  showCode.addEventListener("click", () => {
    pre.hidden = !pre.hidden;
    showCode.setAttribute("aria-expanded", String(!pre.hidden));
  });
  box.append(bar, pre, err, frame, out);
  demos.add(demo);
  fold(folded.has(source));
  return box;
}
