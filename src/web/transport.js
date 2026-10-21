// Where the page's requests go. Locally, `fetch` to `archipelago serve`. In the hosted build (`index.html` sets
// `ARCHIPELAGO_HOSTED`), the server runs in a worker (`/worker.js`, from `src/hosted/worker.ts`) and each request
// is a message to it; the reply comes back as a Response, an event stream as a ReadableStream, so callers see no
// difference. `api` in app.js, `streamPost` in stream.js, and the outline's domain list all come through here.

export function request(path, init = {}) {
  return globalThis.ARCHIPELAGO_HOSTED === true ? viaWorker(path, init) : fetch(path, init);
}

let worker = null;
let nextId = 1;
/** Open requests by id: `{ resolve, reject, controller }`; the controller exists once a stream has started. */
const pending = new Map();

function connect() {
  if (worker) return worker;
  worker = new Worker("/worker.js", { type: "module" });
  worker.addEventListener("message", (event) => receive(event.data));
  worker.addEventListener("error", (event) => {
    const error = new Error(`the local server failed to start: ${event.message || "unknown error"}`);
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
    p.controller ? p.controller.error(new Error(message.message)) : p.reject(new Error(message.message));
  } else if (message.kind === "response" && !message.stream) {
    pending.delete(message.id);
    p.resolve(new Response(message.text ?? null, { status: message.status, headers: message.headers }));
  } else if (message.kind === "response") {
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
