// The routes only the hosted build has, under /hosted/: the reader's key and model, and the database file out and
// in. The worker answers them beside the shared /api/ routes (`handler.ts`); the local server has no such paths.
import { ArchipelagoError } from "../core/errors.ts";
import { errorResponse, json } from "../server/api-routes.ts";
import { exportName } from "./backup.ts";
import { patchError, viewOf, type createSettings, type SettingsPatch } from "./settings.ts";

export const DATABASE_TYPE = "application/vnd.sqlite3";

export type HostedDeps = {
  settings: ReturnType<typeof createSettings>;
  exportDatabase: () => Uint8Array;
  /** Replaces the database with `bytes`; throws an ArchipelagoError carrying the sentence to show when it refuses. */
  importDatabase: (bytes: Uint8Array) => Promise<void>;
};

export async function handleHostedRequest(req: Request, deps: HostedDeps): Promise<Response> {
  const { pathname } = new URL(req.url);
  try {
    if (pathname === "/hosted/settings" && req.method === "GET") return json(viewOf(await deps.settings.get()));
    if (pathname === "/hosted/settings" && req.method === "POST") {
      const patch = (await req.json()) as SettingsPatch;
      const error = patchError(patch, await deps.settings.get());
      if (error) throw new ArchipelagoError(error);
      return json(viewOf(await deps.settings.update(patch)));
    }
    if (pathname === "/hosted/export" && req.method === "GET") {
      return new Response(deps.exportDatabase() as Uint8Array<ArrayBuffer>, {
        headers: { "content-type": DATABASE_TYPE, "content-disposition": `attachment; filename="${exportName()}"` },
      });
    }
    if (pathname === "/hosted/import" && req.method === "POST") {
      await deps.importDatabase(new Uint8Array(await req.arrayBuffer()));
      return json({ ok: true });
    }
    return json({ error: `no route ${req.method} ${pathname}` }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
