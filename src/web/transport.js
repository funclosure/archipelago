// Where the page's requests go. Locally, `fetch` to `archipelago serve`. In the hosted build (`index.html` sets
// `ARCHIPELAGO_HOSTED`), the server runs in a worker (`/worker.js`, from `src/hosted/worker.ts`) and each request
// is a message to it; the reply comes back as a Response, an event stream as a ReadableStream, so callers see no
// difference. `api` in app.js, `streamPost` in stream.js, and the outline's domain list all come through here.
import { t } from "./i18n.js";

export function request(path, init = {}) {
  return globalThis.ARCHIPELAGO_HOSTED === true ? viaWorker(path, init) : fetch(path, init);
}

let worker = null;
let nextId = 1;
/** Open requests by id: `{ resolve, reject, controller }`; the controller exists once a stream has started. */
const pending = new Map();
/** Why this page gave the database up for good (another tab took it over): every request fails with it, and no worker starts again. */
let gone = null;
/** The worker has answered a request, so it holds the database (it answers nothing before its lock is taken). */
let serving = false;

// Leaving the page (a reload, New domain's navigation, the back-forward cache) ends its worker, so the database
// file and its lock are free for the next page's worker at once. A page restored from the cache starts a new one.
addEventListener("pagehide", () => release(t("transport.pageLeft")));

/**
 * Ends this page's worker and frees the database for another tab; open requests fail with `reason`. With `final`
 * (another tab took the database over), the page never starts a worker again: a poll that came after would start
 * one that takes the lock back from the tab that asked for it, and leave neither tab with the database.
 */
export function release(reason, { final = false } = {}) {
  if (final) gone ??= reason;
  serving = false;
  if (!worker) return;
  worker.terminate();
  worker = null;
  const error = new Error(reason);
  for (const p of pending.values()) p.controller ? p.controller.error(error) : p.reject(error);
  pending.clear();
}

/** Whether this page is the one using the database now: its worker has answered, and it has not let it go. */
export const holdsDatabase = () => serving && worker !== null && gone === null;

function connect() {
  if (worker) return worker;
  worker = new Worker("/worker.js", { type: "module" });
  worker.addEventListener("message", (event) => receive(event.data));
  worker.addEventListener("error", (event) => {
    const error = new Error(t("transport.failedToStart", { reason: event.message || t("transport.unknownError") }));
    for (const p of pending.values()) p.controller ? p.controller.error(error) : p.reject(error);
    pending.clear();
  });
  return worker;
}

function abortError() {
  return new DOMException("The operation was aborted.", "AbortError");
}

function viaWorker(path, init) {
  const id = nextId++;
  const signal = init.signal;
  if (signal?.aborted) return Promise.reject(abortError());
  if (gone !== null) return Promise.reject(Object.assign(new Error(gone), { code: "moved" })); // another tab has the database now
  const headers = Object.fromEntries(new Headers(init.headers ?? {}));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, controller: null });
    signal?.addEventListener("abort", () => {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      connect().postMessage({ id, kind: "abort" });
      p.controller ? p.controller.error(abortError()) : p.reject(abortError());
    }, { once: true });
    connect().postMessage({ id, kind: "request", method: init.method ?? "GET", path, headers, body: init.body });
  });
}

function receive(message) {
  const p = pending.get(message.id);
  if (!p) return; // aborted on this side already
  if (message.kind === "error") {
    pending.delete(message.id);
    const error = Object.assign(new Error(message.message), message.code ? { code: message.code } : {});
    p.controller ? p.controller.error(error) : p.reject(error);
  } else if (message.kind === "response" && !message.stream) {
    serving = true;
    pending.delete(message.id);
    p.resolve(new Response(message.bytes ?? message.text ?? null, { status: message.status, headers: message.headers }));
  } else if (message.kind === "response") {
    serving = true;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        p.controller = controller;
      },
      cancel() {
        pending.delete(message.id);
        worker.postMessage({ id: message.id, kind: "abort" });
      },
    });
    p.encode = (chunk) => p.controller.enqueue(encoder.encode(chunk));
    p.resolve(new Response(body, { status: message.status, headers: message.headers }));
  } else if (message.kind === "chunk") {
    p.encode(message.chunk);
  } else if (message.kind === "end") {
    pending.delete(message.id);
    p.controller.close();
  }
}
