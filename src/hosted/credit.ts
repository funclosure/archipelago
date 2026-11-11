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

/** What the page shows: the balance in US dollars. Null before the first turn, for a token with no balance (ours), or when it cannot be read. */
export type CreditView = { balanceUsd: number | null };

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
      if (!base || !token) return { balanceUsd: null };
      try {
        const res = await send(`${base}/account`, { headers: { "x-api-key": token } });
        const body = (await res.json()) as { balanceUsd?: unknown };
        return { balanceUsd: res.ok && typeof body.balanceUsd === "number" ? body.balanceUsd : null };
      } catch {
        return { balanceUsd: null };
      }
    },
  };
}
