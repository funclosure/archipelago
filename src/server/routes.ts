import type { Database } from "bun:sqlite";
import { normalize, resolve, sep } from "node:path";
import { z } from "zod";
import { openDatabase } from "../core/db.ts";
import { ArchipelagoError, ConflictError, NotFoundError } from "../core/errors.ts";
import {
  commentInputSchema, focusInputSchema, positionsInputSchema, probeInputSchema, reefAnswerInputSchema, slugSchema,
} from "../core/validators.ts";
import { attachAsks, listAsks, pickAsk } from "../core/repositories/askRepository.ts";
import { listDomains, requireDomain } from "../core/repositories/domainRepository.ts";
import { getIslandById, requireIsland, setIslandPositions } from "../core/repositories/islandRepository.ts";
import { addVerdict, verdictHistory } from "../core/repositories/verdictRepository.ts";
import { addComment } from "../core/repositories/commentRepository.ts";
import { addMessage, getMessage, listMessages, parseProposal, setReefStatus } from "../core/repositories/messageRepository.ts";
import { activeSession } from "../core/repositories/sessionRepository.ts";
import { getViewState, setFocus } from "../core/repositories/viewStateRepository.ts";
import { buildOutline, buildSnapshot } from "../core/view-model.ts";
import { resolveCommentTarget, resolveVerdictTarget } from "../core/targets.ts";
import { systemLine } from "./judge/tools.ts";
import type { JudgeEvent, JudgeRunner } from "./judge/runner.ts";

export type ServerContext = { dbPath?: string; staticRoot: string; runner: JudgeRunner; turnTimeoutMs: number };

const PING_MS = 20_000;
/** How long one judge turn may run before the island is released. Overridable by `ARCHIPELAGO_TURN_TIMEOUT_MS`. */
export const JUDGE_TURN_TIMEOUT_MS = 180_000;
/** Islands with a judge turn running, as `<domain>/<island>`. One turn per island at a time. */
const inFlight = new Set<string>();

export async function handleRequest(req: Request, ctx: ServerContext): Promise<Response> {
  const url = new URL(req.url);
  try {
    if (url.pathname.startsWith("/api/")) {
      if (req.method === "POST") {
        const guard = crossSitePostGuard(req, url);
        if (guard) return guard;
      }
      return await handleApi(req, url, ctx);
    }
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
    return await serveStatic(url.pathname, ctx.staticRoot);
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Blocks cross-site writes: a POST must carry an `application/json` body, and if it names an
 * Origin or Host, that must point at this server (127.0.0.1/localhost on the request's own port).
 */
function crossSitePostGuard(req: Request, url: URL): Response | null {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.startsWith("application/json")) {
    return json({ error: "expected application/json" }, 415);
  }
  const denied = () => json({ error: "cross-origin writes are not allowed" }, 403);
  const origin = req.headers.get("origin");
  if (origin !== null) {
    const allowed = new Set([`http://127.0.0.1:${url.port}`, `http://localhost:${url.port}`]);
    if (!allowed.has(origin)) return denied();
  }
  const host = req.headers.get("host");
  if (host !== null) {
    let hostname: string;
    try {
      hostname = new URL(`http://${host}`).hostname;
    } catch {
      return denied();
    }
    if (hostname !== "127.0.0.1" && hostname !== "localhost") return denied();
  }
  return null;
}

function withDb<T>(ctx: ServerContext, fn: (db: Database) => T): T {
  const db = openDatabase(ctx.dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

async function handleApi(req: Request, url: URL, ctx: ServerContext): Promise<Response> {
  const route = `${req.method} ${url.pathname}`;
  const q = (name: string) => url.searchParams.get(name);

  if (route === "GET /api/domains") return json({ domains: withDb(ctx, listDomains) });

  if (route === "GET /api/version") {
    const slug = slugSchema.parse(q("domain"));
    return json(withDb(ctx, (db) => ({ version: getViewState(db, requireDomain(db, slug).id).version })));
  }

  if (route === "GET /api/snapshot") {
    const slug = slugSchema.parse(q("domain"));
    const scale = q("scale");
    return json(withDb(ctx, (db) => buildSnapshot(db, slug, scale ? slugSchema.parse(scale) : null)));
  }

  if (route === "GET /api/outline") {
    const slug = slugSchema.parse(q("domain"));
    return json(withDb(ctx, (db) => buildOutline(db, slug)));
  }

  if (route === "GET /api/history") {
    const slug = slugSchema.parse(q("domain"));
    const target = q("target") ?? "";
    return json(
      withDb(ctx, (db) => {
        const d = requireDomain(db, slug);
        const t = resolveVerdictTarget(db, d.id, target);
        return { target: t.label, history: verdictHistory(db, t.targetType, t.targetId) };
      }),
    );
  }

  if (route === "POST /api/focus") {
    const input = focusInputSchema.parse(await req.json());
    return json(
      withDb(ctx, (db) => {
        const d = requireDomain(db, input.domain);
        const island = input.island === null ? null : requireIsland(db, d.id, input.island);
        const state = setFocus(db, d.id, island ? island.id : null);
        return { focus: island ? island.slug : null, version: state.version };
      }),
    );
  }

  if (route === "POST /api/comment") {
    const input = commentInputSchema.parse(await req.json());
    return json(
      withDb(ctx, (db) => {
        const d = requireDomain(db, input.domain);
        const target = resolveCommentTarget(db, d, input.targetType, input.targetId);
        const comment = addComment(db, { domainId: d.id, ...target, body: input.body, kind: input.kind });
        return { comment, version: getViewState(db, d.id).version };
      }),
    );
  }

  if (route === "POST /api/positions") {
    const input = positionsInputSchema.parse(await req.json());
    return json(
      withDb(ctx, (db) => {
        const d = requireDomain(db, input.domain);
        const written = setIslandPositions(
          db,
          d.id,
          input.positions.map((p) => ({ slug: p.island, x: p.x, y: p.y })),
        );
        return { written, version: getViewState(db, d.id).version };
      }),
    );
  }

  if (route === "GET /api/thread") {
    const slug = slugSchema.parse(q("domain"));
    const islandSlug = slugSchema.parse(q("island"));
    return json(
      withDb(ctx, (db) => {
        const d = requireDomain(db, slug);
        const i = requireIsland(db, d.id, islandSlug);
        return { island: i.slug, messages: listMessages(db, i.id), asks: listAsks(db, i.id) };
      }),
    );
  }

  if (route === "POST /api/probe") {
    const input = probeInputSchema.parse(await req.json());
    const key = `${input.domain}/${input.island}`;
    if (inFlight.has(key)) throw new ConflictError("a turn is already running for this island");
    if (input.askId !== undefined && !input.message) throw new ArchipelagoError("a pick needs a message");
    withDb(ctx, (db) => {
      const d = requireDomain(db, input.domain);
      const i = requireIsland(db, d.id, input.island);
      if (input.askId !== undefined) pickAsk(db, d.id, input.askId, input.message!);
      if (input.message) addMessage(db, { domainId: d.id, islandId: i.id, role: "you", kind: "text", body: input.message });
    });
    inFlight.add(key);
    return sseResponse(async (emit) => {
      // A hung turn would wedge this island until the server restarts: cap it, and cancel the runner.
      const ms = ctx.turnTimeoutMs;
      const abort = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expiry = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // Reject before aborting: a runner that rejects on abort would otherwise win the race and
          // report its own cancellation instead of the timeout the reader needs to see.
          reject(new ArchipelagoError(`the judge did not answer within ${ms / 1000} s`));
          abort.abort();
        }, ms);
      });
      try {
        const turn = ctx.runner({ dbPath: ctx.dbPath, domain: input.domain, island: input.island, emit, signal: abort.signal });
        const reply = (await Promise.race([turn, expiry])).trim();
        withDb(ctx, (db) => {
          const d = requireDomain(db, input.domain);
          const i = requireIsland(db, d.id, input.island);
          // An ask recorded this turn rides on the reply; a silent turn still shows its question.
          const unattached = listAsks(db, i.id).find((a) => a.messageId === null);
          const body = reply || (unattached ? unattached.question : "");
          if (!body) return;
          const stored = addMessage(db, { domainId: d.id, islandId: i.id, role: "judge", kind: "text", body });
          attachAsks(db, i.id, stored.id);
        });
        emit({ type: "done" });
      } catch (error) {
        emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
      } finally {
        clearTimeout(timer);
        inFlight.delete(key);
      }
    });
  }

  if (route === "POST /api/probe/reef") {
    const input = reefAnswerInputSchema.parse(await req.json());
    return json(
      withDb(ctx, (db) => {
        const d = requireDomain(db, input.domain);
        const message = getMessage(db, input.id);
        if (!message || message.domainId !== d.id || message.kind !== "reef_proposal") {
          throw new NotFoundError(`no reef proposal ${input.id} in this domain`);
        }
        const proposal = parseProposal(message.body);
        if (proposal.status !== "pending") throw new ConflictError(`reef proposal ${input.id} is already ${proposal.status}`);
        const island = getIslandById(db, message.islandId)!;
        if (input.answer === "confirm") {
          const target = resolveVerdictTarget(db, d.id, proposal.target);
          const session = activeSession(db, d.id);
          db.transaction(() => {
            addVerdict(db, {
              targetType: target.targetType, targetId: target.targetId, state: "reef", confidence: proposal.confidence,
              evidence: proposal.evidence, rationale: `${proposal.claim} — ${proposal.consequence}. ${proposal.rationale}`,
              sessionId: session ? session.id : null,
            });
            setReefStatus(db, message.id, "confirmed");
            addMessage(db, { domainId: d.id, islandId: island.id, role: "judge", kind: "system", body: systemLine(target.label, "reef", island.slug) });
          })();
        } else {
          db.transaction(() => {
            setReefStatus(db, message.id, "disputed");
            addMessage(db, { domainId: d.id, islandId: island.id, role: "you", kind: "text", body: input.note ?? "I dispute this." });
          })();
        }
        return { id: message.id, status: input.answer === "confirm" ? "confirmed" : "disputed", version: getViewState(db, d.id).version };
      }),
    );
  }

  return json({ error: `no route ${route}` }, 404);
}

async function serveStatic(pathname: string, staticRoot: string): Promise<Response> {
  const notFound = () => new Response("Not found", { status: 404 });
  const rootPath = resolve(staticRoot);
  let requested: string;
  try {
    requested = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  } catch {
    return notFound(); // malformed percent-encoding
  }
  if (requested.includes("\0")) return notFound();
  const filePath = resolve(rootPath, normalize(requested));
  if (!filePath.startsWith(rootPath + sep)) return notFound();
  const file = Bun.file(filePath);
  if (!(await file.exists())) return notFound();
  return new Response(file, { headers: { "Cache-Control": "no-cache" } });
}

/**
 * A server-sent-event response driven by `run`. Events are `event: <type>\ndata: <json>\n\n`; a `: ping`
 * comment every 20 s keeps the connection alive through Bun's idle timeout. The stream closes when `run` settles.
 */
function sseResponse(run: (emit: (event: JudgeEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  let open = true;
  let ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false;
        }
      };
      const emit = (event: JudgeEvent) => write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      write(": open\n\n"); // a first frame now, so the headers leave before `run` blocks (a 409 check must see the 200 first)
      ping = setInterval(() => write(": ping\n\n"), PING_MS);
      void run(emit)
        .finally(() => {
          clearInterval(ping);
          if (!open) return;
          open = false;
          try {
            controller.close();
          } catch {
            // already closed by the client
          }
        })
        .catch(() => {});
    },
    cancel() {
      // the client went away: stop the keep-alive now rather than at the end of the turn
      open = false;
      clearInterval(ping);
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" },
  });
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function errorResponse(error: unknown): Response {
  if (error instanceof NotFoundError) return json(error.toJSON(), 404);
  if (error instanceof ConflictError) return json(error.toJSON(), 409);
  if (error instanceof ArchipelagoError) return json(error.toJSON(), 400);
  if (error instanceof z.ZodError) {
    return json({ error: error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }, 400);
  }
  if (error instanceof SyntaxError) return json({ error: "invalid JSON body" }, 400);
  return json({ error: error instanceof Error ? error.message : String(error) }, 500);
}
