// Demo fences in the log: a persona's small HTML + JS demo, run in a sandboxed iframe (`allow-scripts` only, so an
// opaque origin: no cookies, storage, page, worker, or keys) at /demo-frame.html, which carries its own CSP (no
// network, src/server/demo-frame.ts). The fence's text crosses as a message, never as markup on this page. The
// frame reports its height, console lines, and errors back; Reset reloads it, Code shows the source. A pane rebuild
// makes a new frame, so a demo starts over after each turn.
import { t } from "./i18n.js";
import { DEMO_MAX, DEMO_TOKENS, DEMO_MIN_H, demoHeight, logLine } from "./demo-model.js";

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

function tokens() {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(DEMO_TOKENS.map((name) => [name, style.getPropertyValue(name).trim()]).filter(([, v]) => v));
}

/** A closed demo fence. Too long a body shows as its source with the reason. */
export function demoElement(source) {
  const box = document.createElement("div");
  box.className = "demo";
  const bar = document.createElement("div");
  bar.className = "bar";
  const cap = document.createElement("span");
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
  bar.append(cap, reset, showCode);

  const err = document.createElement("div");
  err.className = "error";
  err.hidden = true;
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = source;
  pre.append(code);
  pre.hidden = true;

  if (source.length > DEMO_MAX) {
    err.textContent = t("demo.tooLong", { max: DEMO_MAX });
    err.hidden = false;
    pre.hidden = false;
    box.append(bar, err, pre);
    reset.hidden = true;
    showCode.hidden = true;
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
    err.hidden = true;
    err.textContent = "";
    out.hidden = true;
    out.replaceChildren();
    frame.src = `/demo-frame.html`;
  };
  const demo = {
    frame,
    left: false,
    receive(data) {
      if (!data || typeof data.type !== "string") return;
      if (data.type === "demo-ready") frame.contentWindow?.postMessage({ type: "demo-run", html: source, tokens: tokens() }, "*");
      else if (data.type === "demo-size") frame.style.height = `${demoHeight(data.height)}px`;
      else if (data.type === "demo-error") {
        err.textContent = t("demo.error", { message: String(data.message).slice(0, 300) });
        err.hidden = false;
      } else if (data.type === "demo-log") {
        const line = logLine(data);
        if (!line) return;
        const row = document.createElement("div");
        row.className = `line ${line.level}`;
        row.textContent = line.text;
        out.append(row);
        while (out.childElementCount > 50) out.firstChild.remove();
        out.hidden = false;
        out.scrollTop = out.scrollHeight;
      }
    },
  };
  reset.addEventListener("click", start);
  showCode.addEventListener("click", () => {
    pre.hidden = !pre.hidden;
    showCode.setAttribute("aria-expanded", String(!pre.hidden));
  });
  box.append(bar, pre, err, frame, out);
  demos.add(demo);
  start();
  return box;
}
