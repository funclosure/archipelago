// The worker's side of the page's transport (`src/web/transport.js`): each request message becomes a `Request`
// to `handleApiRequest`, and the `Response` goes back as one message, or, for an event stream, as a head, its
// chunks, and an end. An abort message cancels the stream, which stops a turn as a closed connection does locally.
// Paths under /hosted/ go to the worker's own routes (`routes.ts`); a database file comes back as bytes.
import { handleApiRequest, type ApiContext } from "../server/api-routes.ts";
import { DATABASE_TYPE } from "./routes.ts";

/** Requests are built on the local server's origin, so the host and cross-site guards pass them as they pass the page. */
const ORIGIN = "http://127.0.0.1";

export type PageMessage =
  | { id: number; kind: "request"; method: string; path: string; headers: Record<string, string>; body?: string | ArrayBuffer }
  | { id: number; kind: "abort" };

export type WorkerMessage =
  | { id: number; kind: "response"; status: number; headers: Record<string, string>; text?: string; bytes?: ArrayBuffer; stream?: true }
  | { id: number; kind: "chunk"; chunk: string }
  | { id: number; kind: "end" }
  | { id: number; kind: "error"; message: string; code?: string };

export type Post = (message: WorkerMessage, transfer?: Transferable[]) => void;

export function createHandler(
  context: () => ApiContext | Promise<ApiContext>,
  post: Post,
  hosted?: (req: Request) => Promise<Response>,
) {
  const streams = new Map<number, ReadableStreamDefaultReader<string>>();
  const aborted = new Set<number>();

  return async function onMessage(message: PageMessage): Promise<void> {
    const { id } = message;
    if (message.kind === "abort") {
      aborted.add(id);
      await streams.get(id)?.cancel();
      return;
    }
    try {
      const req = new Request(new URL(message.path, ORIGIN), { method: message.method, headers: message.headers, body: message.body });
      const ctx = await context(); // first, so a database that would not open answers every path with why
      const res = hosted && new URL(req.url).pathname.startsWith("/hosted/") ? await hosted(req) : await handleApiRequest(req, ctx);
      const headers = Object.fromEntries(res.headers);
      if (headers["content-type"] === DATABASE_TYPE) {
        const bytes = await res.arrayBuffer();
        post({ id, kind: "response", status: res.status, headers, bytes }, [bytes]);
        return;
      }
      if (!res.body || !(headers["content-type"] ?? "").startsWith("text/event-stream")) {
        post({ id, kind: "response", status: res.status, headers, text: await res.text() });
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      streams.set(id, reader);
      post({ id, kind: "response", status: res.status, headers, stream: true });
      if (aborted.has(id)) await reader.cancel(); // the page gave up before the head went out
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        post({ id, kind: "chunk", chunk: value });
      }
      post({ id, kind: "end" });
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      post({ id, kind: "error", message: error instanceof Error ? error.message : String(error), ...(typeof code === "string" ? { code } : {}) });
    } finally {
      streams.delete(id);
      aborted.delete(id);
    }
  };
}
