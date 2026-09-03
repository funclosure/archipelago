#!/usr/bin/env bun
import { Command, CommanderError } from "commander";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../core/db.ts";
import { ArchipelagoError } from "../core/errors.ts";
import {
  domainInputSchema, islandInputSchema, islandUpdateSchema, straitInputSchema, verdictInputSchema,
  sessionEndInputSchema, slugSchema,
} from "../core/validators.ts";
import { listDomains, requireDomain, upsertDomain } from "../core/repositories/domainRepository.ts";
import {
  getIslandById, islandPath, listIslands, requireIsland, updateIsland, upsertIsland,
} from "../core/repositories/islandRepository.ts";
import { listStraits, upsertStrait } from "../core/repositories/straitRepository.ts";
import { addVerdict, latestVerdict, latestVerdicts, verdictHistory } from "../core/repositories/verdictRepository.ts";
import { activeSession, endSession, listSessions, startSession } from "../core/repositories/sessionRepository.ts";
import { markCommentsRead } from "../core/repositories/commentRepository.ts";
import { getViewState, setFocus } from "../core/repositories/viewStateRepository.ts";
import { buildSnapshot, listCommentViews } from "../core/view-model.ts";
import { resolveVerdictTarget } from "../core/targets.ts";
import { emit, fail, readStdinJson } from "./io.ts";
import { startServer } from "../server/index.ts";

type Opts = Record<string, unknown>;

function withDb<T>(fn: (db: Database) => T): T {
  const db = openDatabase();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** Wraps an action: merges --stdin JSON under the flags, emits JSON, maps errors to exit 1. */
function run(action: (options: Opts) => unknown) {
  return async (options: Opts) => {
    const compact = Boolean(options.json);
    try {
      const { stdin, json: _json, ...flags } = options;
      const merged = stdin ? { ...(await readStdinJson()), ...flags } : flags;
      emit(await action(merged), compact);
    } catch (error) {
      fail(error, compact);
    }
  };
}

const common = (cmd: Command) => cmd.option("--json", "compact JSON output").option("--stdin", "merge a JSON object from stdin");

const program = new Command();
program.name("archipelago").description("Chart what you understand about a domain, as islands in open water.").version("0.1.0");

// Commander's own errors (unknown option, missing argument) go through the same JSON path as ours.
program.exitOverride();
program.configureOutput({ writeErr: () => {} });

// ---- domain ----
const domain = program.command("domain").description("Domains (one per archipelago)");
common(domain.command("add").option("--slug <slug>").option("--name <name>")).action(
  run((o) => withDb((db) => upsertDomain(db, domainInputSchema.parse(o)))),
);
common(domain.command("list")).action(run(() => withDb((db) => ({ domains: listDomains(db) }))));
common(domain.command("show").option("--slug <slug>")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.slug));
      return {
        ...d,
        islands: listIslands(db, d.id, null).map((i) => i.slug),
        activeSession: activeSession(db, d.id),
        version: getViewState(db, d.id).version,
      };
    }),
  ),
);

// ---- island ----
const island = program.command("island").description("Islands and islets");
common(
  island.command("add")
    .option("--domain <slug>").option("--slug <slug>").option("--name <name>")
    .option("--summary <text>").option("--parent <slug>", "make this an islet of that island").option("--order <n>"),
).action(
  run((o) =>
    withDb((db) => {
      const input = islandInputSchema.parse(o);
      const d = requireDomain(db, input.domain);
      const parent = input.parent ? requireIsland(db, d.id, input.parent) : null;
      return upsertIsland(db, {
        domainId: d.id, slug: input.slug, name: input.name, summary: input.summary ?? null,
        parentId: parent ? parent.id : null, sortOrder: input.order ?? null,
      });
    }),
  ),
);
common(
  island.command("update").option("--domain <slug>").option("--slug <slug>").option("--name <name>").option("--summary <text>").option("--order <n>"),
).action(
  run((o) =>
    withDb((db) => {
      const input = islandUpdateSchema.parse(o);
      const d = requireDomain(db, input.domain);
      return updateIsland(db, d.id, input.slug, { name: input.name, summary: input.summary, sortOrder: input.order });
    }),
  ),
);
common(island.command("list").option("--domain <slug>").option("--parent <slug>", "list the islets of this island")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      const parent = o.parent ? requireIsland(db, d.id, slugSchema.parse(o.parent)) : null;
      const islands = listIslands(db, d.id, parent ? parent.id : null);
      const verdicts = latestVerdicts(db, "island", islands.map((i) => i.id));
      return {
        scale: parent ? parent.slug : null,
        islands: islands.map((i) => ({ ...i, state: verdicts.get(i.id)?.state ?? null })),
      };
    }),
  ),
);
common(island.command("show").option("--domain <slug>").option("--slug <slug>")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      const i = requireIsland(db, d.id, slugSchema.parse(o.slug));
      return {
        ...i,
        path: islandPath(db, i.id).map((p) => p.slug),
        children: listIslands(db, d.id, i.id).map((c) => c.slug),
        verdict: latestVerdict(db, "island", i.id),
        history: verdictHistory(db, "island", i.id),
      };
    }),
  ),
);

// ---- strait ----
const strait = program.command("strait").description("Straits between sibling islands");
common(strait.command("add").option("--domain <slug>").option("--from <slug>").option("--to <slug>").option("--name <name>").option("--summary <text>")).action(
  run((o) =>
    withDb((db) => {
      const input = straitInputSchema.parse(o);
      const d = requireDomain(db, input.domain);
      const a = requireIsland(db, d.id, input.from);
      const b = requireIsland(db, d.id, input.to);
      const s = upsertStrait(db, { domainId: d.id, fromIslandId: a.id, toIslandId: b.id, name: input.name ?? null, summary: input.summary ?? null });
      const from = getIslandById(db, s.fromIslandId)!;
      const to = getIslandById(db, s.toIslandId)!;
      return { ...s, from: from.slug, to: to.slug };
    }),
  ),
);
common(strait.command("list").option("--domain <slug>").option("--parent <slug>")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      const parent = o.parent ? requireIsland(db, d.id, slugSchema.parse(o.parent)) : null;
      const straits = listStraits(db, d.id, parent ? parent.id : null);
      const verdicts = latestVerdicts(db, "strait", straits.map((s) => s.id));
      return {
        straits: straits.map((s) => ({
          ...s,
          from: getIslandById(db, s.fromIslandId)!.slug,
          to: getIslandById(db, s.toIslandId)!.slug,
          state: verdicts.get(s.id)?.state ?? null,
        })),
      };
    }),
  ),
);

// ---- verdict ----
const verdict = program.command("verdict").description("Append a verdict or read history");
common(
  verdict.command("set")
    .option("--domain <slug>").option("--target <target>", "island:<slug> or strait:<a>~<b>")
    .option("--state <state>", "sandbar | settled | mountainous | reef").option("--confidence <n>", "0..1")
    .option("--evidence <quote>", "the user's own words").option("--rationale <text>"),
).action(
  run((o) =>
    withDb((db) => {
      const input = verdictInputSchema.parse(o);
      const d = requireDomain(db, input.domain);
      const target = resolveVerdictTarget(db, d.id, input.target);
      const session = activeSession(db, d.id);
      const v = addVerdict(db, {
        targetType: target.targetType, targetId: target.targetId, state: input.state, confidence: input.confidence,
        evidence: input.evidence, rationale: input.rationale ?? null, sessionId: session ? session.id : null,
      });
      return { ...v, target: target.label };
    }),
  ),
);
common(verdict.command("history").option("--domain <slug>").option("--target <target>")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      const target = resolveVerdictTarget(db, d.id, String(o.target ?? ""));
      return { target: target.label, history: verdictHistory(db, target.targetType, target.targetId) };
    }),
  ),
);

// ---- session ----
const session = program.command("session").description("Charting sittings");
common(session.command("start").option("--domain <slug>")).action(
  run((o) => withDb((db) => startSession(db, requireDomain(db, slugSchema.parse(o.domain)).id))),
);
common(session.command("end").option("--domain <slug>").option("--summary <text>")).action(
  run((o) =>
    withDb((db) => {
      const input = sessionEndInputSchema.parse(o);
      return endSession(db, requireDomain(db, input.domain).id, input.summary);
    }),
  ),
);
common(session.command("show").option("--domain <slug>")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      return { active: activeSession(db, d.id), recent: listSessions(db, d.id).slice(0, 5) };
    }),
  ),
);

// ---- focus ----
const focus = program.command("focus").description("The island the map has selected");
common(focus.command("show").option("--domain <slug>")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      const state = getViewState(db, d.id);
      const i = state.focusIslandId === null ? null : getIslandById(db, state.focusIslandId);
      return { focus: i ? i.slug : null, path: i ? islandPath(db, i.id).map((p) => p.slug) : [] };
    }),
  ),
);
common(focus.command("set").option("--domain <slug>").option("--island <slug>").option("--clear", "clear the focus")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      const i = o.clear ? null : requireIsland(db, d.id, slugSchema.parse(o.island));
      const state = setFocus(db, d.id, i ? i.id : null);
      return { focus: i ? i.slug : null, version: state.version };
    }),
  ),
);

// ---- comment ----
const comment = program.command("comment").description("Comments the map sent back");
common(comment.command("list").option("--domain <slug>").option("--unread", "only unread")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      return { comments: listCommentViews(db, d.id, Boolean(o.unread)) };
    }),
  ),
);
common(
  comment.command("mark-read").option("--domain <slug>").option("--id <n...>", "comment ids").option("--all", "every unread comment"),
).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      const ids = o.all ? ("all" as const) : (o.id as string[] | undefined)?.map(Number) ?? [];
      return { marked: markCommentsRead(db, d.id, ids) };
    }),
  ),
);

// ---- snapshot ----
common(program.command("snapshot").description("What the map shows at one scale").option("--domain <slug>").option("--scale <slug>", "island to look inside")).action(
  run((o) => withDb((db) => buildSnapshot(db, slugSchema.parse(o.domain), o.scale ? slugSchema.parse(o.scale) : null))),
);

// ---- serve ----
program
  .command("serve")
  .description("Start the map server and open the browser")
  .option("--port <n>", "port", "4480")
  .option("--domain <slug>", "domain to open")
  .option("--no-open", "do not open the browser")
  .action((o: { port: string; domain?: string; open: boolean }) => {
    try {
      const server = startServer({ port: Number(o.port) });
      const url = `http://127.0.0.1:${server.port}/${o.domain ? `?domain=${encodeURIComponent(o.domain)}` : ""}`;
      console.log(`Archipelago map: ${url}`);
      if (o.open) Bun.spawn(["open", url]);
    } catch (error) {
      fail(error, false);
    }
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError) {
    if (error.exitCode === 0) process.exit(0); // --help / --version already printed
    fail(new ArchipelagoError(error.message.replace(/^error: /, "")), process.argv.includes("--json"));
  }
  throw error;
}
