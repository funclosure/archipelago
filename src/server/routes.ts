import { normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { errorResponse, handleApiRequest, json, type ApiContext } from "./api-routes.ts";
import { vendorBundle, type VendorName } from "./vendor.ts";

export { JUDGE_TURN_TIMEOUT_MS } from "./api-routes.ts";

export type ServerContext = ApiContext & { staticRoot: string };

/** Committed, not installed: mermaid is the heaviest download and only the page needs it (`bun run vendor:mermaid` refreshes it). */
const MERMAID_PATH = fileURLToPath(new URL("./vendor/mermaid.min.js", import.meta.url));
const ONIG_WASM_PATH = fileURLToPath(import.meta.resolve("shiki/dist/onig.wasm"));

/** A bundled library: built on first request, then an ETag the page can revalidate against. */
async function vendorResponse(req: Request, name: VendorName): Promise<Response> {
  const { body, etag } = await vendorBundle(name);
  const headers = { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", ETag: etag };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}

export async function handleRequest(req: Request, ctx: ServerContext): Promise<Response> {
  const url = new URL(req.url);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApiRequest(req, ctx);
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
    const route = `${req.method} ${url.pathname}`;
    if (route === "GET /vendor/mermaid.js") {
      return new Response(Bun.file(MERMAID_PATH), { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" } });
    }
    if (route === "GET /vendor/onig.wasm") {
      return new Response(Bun.file(ONIG_WASM_PATH), { headers: { "Content-Type": "application/wasm", "Cache-Control": "no-cache" } });
    }
    if (route === "GET /vendor/shiki.js") return await vendorResponse(req, "shiki");
    if (route === "GET /vendor/plot.js") return await vendorResponse(req, "plot");
    return await serveStatic(url.pathname, ctx.staticRoot);
  } catch (error) {
    return errorResponse(error);
  }
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
