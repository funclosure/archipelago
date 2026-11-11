// This browser's account on our proxy: the free start. No sign-in: the first turn asks the proxy for an anonymous
// account, whose token is kept with the settings like a key, and whose balance the page shows after each turn.
import { ArchipelagoError } from "../core/errors.ts";
import type { createSettings } from "./settings.ts";

export type CreditDeps = {
  settings: ReturnType<typeof createSettings>;
  /** Where the proxy answers; none in a build without one. */
  url: () => string | undefined;
  fetch?: typeof fetch;
};

/**
 * What the page shows. `balanceUsd`: null before the first turn, for a token with no balance (ours), or when it cannot
 * be read. `purchased`: the account has bought credit, so what is left is no longer "free". `packs`: the credit packs
 * on sale, in US dollars of credit; none where the proxy sells nothing.
 */
export type CreditView = { balanceUsd: number | null; purchased: boolean; packs: number[] };
const NOTHING: CreditView = { balanceUsd: null, purchased: false, packs: [] };

const NO_CHECKOUT = "Could not open the checkout. Check the connection and try again.";
const UNREACHABLE = "Could not reach Archipelago to start your free chart. Check the connection and send again, or bring your own key under Your key.";

export function createCredit({ settings, url, fetch: send = fetch }: CreditDeps) {
  let starting: Promise<string> | null = null;

  async function start(base: string): Promise<string> {
    let res: Response;
    try {
      res = await send(`${base}/accounts`, { method: "POST" });
    } catch {
      throw new ArchipelagoError(UNREACHABLE);
    }
    const body = (await res.json().catch(() => null)) as { token?: unknown; error?: { message?: unknown } } | null;
    if (!res.ok || typeof body?.token !== "string") {
      // The proxy's own sentence says why (today's free starts are used up, say) and what to do.
      const told = body?.error?.message;
      throw new ArchipelagoError(typeof told === "string" && told ? told : UNREACHABLE);
    }
    await settings.update({ provider: "archipelago", apiKey: body.token });
    return body.token;
  }

  return {
    /** The token a turn goes out with: the one kept, else a new free account's. Two turns at once share one start. */
    async token(): Promise<string> {
      const kept = (await settings.get()).keys.archipelago;
      if (kept) return kept;
      const base = url();
      if (!base) throw new ArchipelagoError("This build has no free start. Open Your key in the domain menu and paste a key.");
      starting ??= start(base).finally(() => (starting = null));
      return starting;
    },
    async view(): Promise<CreditView> {
      const base = url();
      const token = (await settings.get()).keys.archipelago;
      if (!base || !token) return NOTHING;
      try {
        const res = await send(`${base}/account`, { headers: { "x-api-key": token } });
        const body = (await res.json()) as { balanceUsd?: unknown; purchased?: unknown; packs?: unknown };
        if (!res.ok) return NOTHING;
        return {
          balanceUsd: typeof body.balanceUsd === "number" ? body.balanceUsd : null,
          purchased: body.purchased === true,
          packs: Array.isArray(body.packs) ? body.packs.filter((p): p is number => typeof p === "number" && p > 0) : [],
        };
      } catch {
        return NOTHING;
      }
    },
    /** The checkout page for one credit pack, at our payment provider. The paid order tops up this browser's account. */
    async checkout(pack: number): Promise<{ url: string }> {
      const base = url();
      if (!base) throw new ArchipelagoError("This build sells no credit.");
      const token = await this.token();
      let res: Response;
      try {
        res = await send(`${base}/checkout`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": token }, body: JSON.stringify({ pack }) });
      } catch {
        throw new ArchipelagoError(NO_CHECKOUT);
      }
      const body = (await res.json().catch(() => null)) as { url?: unknown; error?: { message?: unknown } } | null;
      // Only a secure page is ever opened: the address comes from another server.
      if (res.ok && typeof body?.url === "string" && body.url.startsWith("https://")) return { url: body.url };
      const told = body?.error?.message;
      throw new ArchipelagoError(typeof told === "string" && told ? told : NO_CHECKOUT);
    },
  };
}
