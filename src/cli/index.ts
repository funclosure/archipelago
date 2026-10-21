#!/usr/bin/env bun
import { Command, CommanderError } from "commander";
import type { Database } from "../core/sql.ts";
import { openDatabase } from "../core/db.ts";
import { ArchipelagoError } from "../core/errors.ts";
import {
  domainInputSchema, domainUpdateSchema, seaWriteSchema, islandInputSchema, islandUpdateSchema, straitInputSchema, verdictInputSchema,
  sessionEndInputSchema, slugSchema, landmarkInputSchema, learnerInputSchema, modeSchema,
} from "../core/validators.ts";
import { listDomains, requireDomain, updateDomain, upsertDomain } from "../core/repositories/domainRepository.ts";
import { addSea, listSeas, removeSea, updateSea } from "../core/repositories/seaRepository.ts";
import {
  getIsland, getIslandById, islandPath, listIslands, requireIsland, updateIsland, upsertIsland,
  setHarbour, clearHarbour, getHarbour,
} from "../core/repositories/islandRepository.ts";
import { countStraitsTouching, listStraits, upsertStrait } from "../core/repositories/straitRepository.ts";
import { addVerdict, latestVerdict, latestVerdicts, verdictHistory } from "../core/repositories/verdictRepository.ts";
import { activeSession, endSession, listSessions, startSession } from "../core/repositories/sessionRepository.ts";
import { markCommentsRead } from "../core/repositories/commentRepository.ts";
import { listMessages, listScaleMessages } from "../core/repositories/messageRepository.ts";
import { listSketches } from "../core/repositories/sketchRepository.ts";
import { listCards } from "../core/repositories/boardRepository.ts";
import { getLearner, setLearnerNote } from "../core/repositories/learnerRepository.ts";
import { listLandmarks, upsertLandmark } from "../core/repositories/landmarkRepository.ts";
import { getViewState, setFocus } from "../core/repositories/viewStateRepository.ts";
import { buildSnapshot, listCommentViews } from "../core/view-model.ts";
import { resolveVerdictTarget } from "../core/targets.ts";
import { emit, fail, readStdinJson } from "./io.ts";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { exportName } from "../hosted/backup.ts";
import { startServer } from "../server/index.ts";
import { defaultJudge, judgeModel, parseJudgeKind, type JudgeKind } from "../server/judge/runner.ts";

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
let commanderOutput = "";
program.exitOverride();
program.configureOutput({ writeErr: (text) => { commanderOutput += text; } });

// ---- domain ----
/** The startup line's judge: which runner, on which model, and why when the key chose it. */
function judgeLine(judge: JudgeKind, named: boolean): string {
  const model = judgeModel(judge);
  const why = !named && !process.env.ARCHIPELAGO_JUDGE && judge === "api" ? ", because ANTHROPIC_API_KEY is set" : "";
  return `judge: ${judge}${model ? ` on ${model}` : ""}${why}`;
}

/** The platform's own opener; a failure leaves the printed URL to click. */
function openInBrowser(url: string) {
  const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {}
}

const domain = program.command("domain").description("Domains (one per archipelago)");
common(domain.command("add").option("--slug <slug>").option("--name <name>").option("--description <text>", "the user's words on what they want to chart and why")).action(
  run((o) => withDb((db) => upsertDomain(db, domainInputSchema.parse(o)))),
);
common(domain.command("update").option("--slug <slug>").option("--name <name>").option("--description <text>", "\"\" clears it")).action(
  run((o) => withDb((db) => {
    const { domain: slug, ...change } = domainUpdateSchema.parse({ domain: o.slug, name: o.name, description: o.description });
    return updateDomain(db, slug, change);
  })),
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
      const parentId = parent ? parent.id : null;
      const existing = getIsland(db, d.id, input.slug);
      const isMove = Boolean(existing) && parentId !== null && parentId !== existing!.parentId;
      const straitsDropped = isMove ? countStraitsTouching(db, existing!.id) : 0;
      const island = upsertIsland(db, {
        domainId: d.id, slug: input.slug, name: input.name, summary: input.summary ?? null,
        parentId, sortOrder: input.order ?? null,
      });
      return isMove ? { ...island, moved: { fromParentId: existing!.parentId, straitsDropped } } : island;
    }),
  ),
);
common(
  island.command("update")
    .option("--domain <slug>").option("--slug <slug>").option("--name <name>").option("--summary <text>").option("--order <n>")
    .option("--x <n>", "map position in world units (a fresh scale spans about 0..1000; any number works)").option("--y <n>", "map position in world units"),
).action(
  run((o) =>
    withDb((db) => {
      const input = islandUpdateSchema.parse(o);
      const d = requireDomain(db, input.domain);
      return updateIsland(db, d.id, input.slug, {
        name: input.name, summary: input.summary, sortOrder: input.order, x: input.x, y: input.y,
      });
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

// ---- landmark ----
const landmark = program.command("landmark").description("The key concepts on an island; the judge lights them");
common(
  landmark.command("add").option("--domain <slug>").option("--island <slug>").option("--slug <slug>").option("--name <name>").option("--order <n>"),
).action(
  run((o) =>
    withDb((db) => {
      const input = landmarkInputSchema.parse(o);
      const d = requireDomain(db, input.domain);
      const i = requireIsland(db, d.id, input.island);
      return upsertLandmark(db, { domainId: d.id, islandId: i.id, slug: input.slug, name: input.name, sortOrder: input.order ?? null });
    }),
  ),
);
common(landmark.command("list").option("--domain <slug>").option("--island <slug>")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      const i = requireIsland(db, d.id, slugSchema.parse(o.island));
      return { island: i.slug, landmarks: listLandmarks(db, i.id) };
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

// ---- harbour ----
const harbour = program.command("harbour").description("The island to set out from at a scale");
const parentOf = (db: Database, domainId: number, slug: unknown) =>
  slug === undefined ? null : requireIsland(db, domainId, slugSchema.parse(slug));
common(harbour.command("set").option("--domain <slug>").option("--island <slug>")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      const island = setHarbour(db, d.id, slugSchema.parse(o.island));
      const parent = island.parentId === null ? null : getIslandById(db, island.parentId);
      return { harbour: island.slug, parent: parent ? parent.slug : null, version: getViewState(db, d.id).version };
    }),
  ),
);
common(harbour.command("clear").option("--domain <slug>").option("--parent <slug>", "clear among this island's islets")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      const parent = parentOf(db, d.id, o.parent);
      const cleared = clearHarbour(db, d.id, parent ? parent.id : null);
      return { cleared, version: getViewState(db, d.id).version };
    }),
  ),
);
common(harbour.command("show").option("--domain <slug>").option("--parent <slug>", "show among this island's islets")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      const parent = parentOf(db, d.id, o.parent);
      const h = getHarbour(db, d.id, parent ? parent.id : null);
      return { harbour: h ? h.slug : null, parent: parent ? parent.slug : null };
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
      const raw = (o.id as string[] | undefined) ?? [];
      const bad = raw.find((s) => !/^[1-9]\d*$/.test(s));
      if (!o.all && bad !== undefined) throw new ArchipelagoError(`--id takes positive integers, got ${bad}`);
      const ids = o.all ? ("all" as const) : raw.map(Number);
      if (!o.all && ids.length === 0) throw new ArchipelagoError("pass --id <n> ... or --all");
      return { marked: markCommentsRead(db, d.id, ids) };
    }),
  ),
);

// ---- thread ----
const thread = program.command("thread").description("A conversation: an island's judge or mentor thread, or the cartographer's at one scale");
common(
  thread
    .command("show")
    .option("--domain <slug>")
    .option("--island <slug>", "the island; for the cartographer, whose islets (omit for the top scale)")
    .option("--mode <mode>", "judge (default), mentor, or cartographer"),
).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      const mode = modeSchema.parse(o.mode ?? "judge");
      if (mode === "cartographer") {
        const scale = o.island === undefined ? null : requireIsland(db, d.id, slugSchema.parse(o.island));
        return { island: scale ? scale.slug : null, mode, messages: listScaleMessages(db, d.id, scale ? scale.id : null) };
      }
      const i = requireIsland(db, d.id, slugSchema.parse(o.island));
      return { island: i.slug, mode, messages: listMessages(db, i.id, mode) };
    }),
  ),
);

// ---- sketch ----
const sketch = program.command("sketch").description("Sketches the cartographer in the app proposed; the reader approves them on the map");
common(sketch.command("list").option("--domain <slug>").option("--island <slug>", "sketches among this island's islets (omit for every scale)").option("--pending", "only pending")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      const scale = o.island === undefined ? undefined : requireIsland(db, d.id, slugSchema.parse(o.island)).id;
      const rows = listSketches(db, d.id, scale).filter((s) => !o.pending || s.status === "pending");
      return { sketches: rows };
    }),
  ),
);

// ---- board ----
const board = program.command("board").description("The island's whiteboard: cards the reader and the judge pinned");
common(board.command("list").option("--domain <slug>").option("--island <slug>")).action(
  run((o) =>
    withDb((db) => {
      const d = requireDomain(db, slugSchema.parse(o.domain));
      const i = requireIsland(db, d.id, slugSchema.parse(o.island));
      return { island: i.slug, cards: listCards(db, i.id) };
    }),
  ),
);

// ---- sea ----
const sea = program.command("sea").description("Names the reader wrote on the water at a scale; write them only when the user asks");
const seaScale = (db: Database, domainId: number, island: unknown) => (island ? requireIsland(db, domainId, slugSchema.parse(island)).id : null);
common(sea.command("list").option("--domain <slug>").option("--island <slug>", "the seas among this island's islets (omit for the top scale)")).action(
  run((o) => withDb((db) => {
    const d = requireDomain(db, slugSchema.parse(o.domain));
    return { seas: listSeas(db, d.id, seaScale(db, d.id, o.island)) };
  })),
);
common(sea.command("add").option("--domain <slug>").option("--island <slug>", "add among this island's islets").option("--name <name>").option("--x <n>").option("--y <n>")).action(
  run((o) => withDb((db) => {
    const input = seaWriteSchema.parse({ op: "add", domain: o.domain, island: o.island, name: o.name, x: o.x, y: o.y });
    if (input.op !== "add") throw new Error("unreachable");
    const d = requireDomain(db, input.domain);
    return addSea(db, { domainId: d.id, parentIslandId: seaScale(db, d.id, input.island), name: input.name, x: input.x, y: input.y });
  })),
);
common(sea.command("update").option("--domain <slug>").option("--id <n>").option("--name <name>").option("--x <n>").option("--y <n>")).action(
  run((o) => withDb((db) => {
    const input = seaWriteSchema.parse({ op: "update", domain: o.domain, id: o.id, name: o.name, x: o.x, y: o.y });
    if (input.op !== "update") throw new Error("unreachable");
    return updateSea(db, requireDomain(db, input.domain).id, input.id, { name: input.name, x: input.x, y: input.y });
  })),
);
common(sea.command("remove").option("--domain <slug>").option("--id <n>")).action(
  run((o) => withDb((db) => {
    const input = seaWriteSchema.parse({ op: "remove", domain: o.domain, id: o.id });
    if (input.op !== "remove") throw new Error("unreachable");
    removeSea(db, requireDomain(db, input.domain).id, input.id);
    return { removed: input.id };
  })),
);

// ---- learner ----
const learner = program.command("learner").description("The note the mentor reads about you, in every domain");
common(learner.command("show")).action(run(() => withDb((db) => getLearner(db))));
common(learner.command("set").option("--note <text>")).action(
  run((o) => withDb((db) => setLearnerNote(db, learnerInputSchema.parse(o).note))),
);

// ---- snapshot ----
common(program.command("snapshot").description("What the map shows at one scale").option("--domain <slug>").option("--scale <slug>", "island to look inside")).action(
  run((o) => withDb((db) => buildSnapshot(db, slugSchema.parse(o.domain), o.scale ? slugSchema.parse(o.scale) : null))),
);

// ---- export ----
common(
  program
    .command("export")
    .description("Copy the whole database into one file: the hosted app imports it, and ARCHIPELAGO_DB_PATH opens it")
    .option("--out <file>", "where to write it (default: ./archipelago-YYYY-MM-DD.sqlite)"),
).action(
  run((o) => {
    const out = resolve(String(o.out ?? exportName()));
    if (existsSync(out)) throw new ArchipelagoError(`${out} already exists. Pick another --out.`);
    // VACUUM INTO writes a compact copy with the WAL folded in, consistent even while a server is writing.
    withDb((db) => db.run("vacuum into ?", [out]));
    return { out, bytes: statSync(out).size };
  }),
);

// ---- serve ----
program
  .command("serve")
  .description("Start the map server and open the browser")
  .option("--port <n>", "port", "4480")
  .option("--domain <slug>", "domain to open")
  .option("--no-open", "do not open the browser")
  .option("--judge <kind>", "api, sdk, or stub (default: api when ANTHROPIC_API_KEY is set, otherwise sdk)")
  .option("--stub", "the same as --judge stub: canned replies, no login needed")
  .action((o: { port: string; domain?: string; open: boolean; judge?: string; stub?: boolean }) => {
    try {
      const judge = o.judge ? parseJudgeKind(o.judge, "--judge") : o.stub ? "stub" : defaultJudge();
      const server = startServer({ port: Number(o.port), judge });
      const url = `http://127.0.0.1:${server.port}/${o.domain ? `?domain=${encodeURIComponent(o.domain)}` : ""}`;
      console.log(`Archipelago map: ${url}  (${judgeLine(judge, Boolean(o.judge || o.stub))})`);
      if (o.open) openInBrowser(url);
    } catch (error) {
      fail(error, false);
    }
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError) {
    if (error.exitCode === 0) process.exit(0); // --help / --version already printed
    if (error.code === "commander.help") {
      // Bare invocation or a command with no subcommand: show the usage commander prepared.
      process.stdout.write(commanderOutput);
      process.exit(error.exitCode);
    }
    const message = error.message.replace(/^error: /, "").replace(/\s*\n\s*/g, " ");
    fail(new ArchipelagoError(message), process.argv.includes("--json"));
  }
  throw error;
}
