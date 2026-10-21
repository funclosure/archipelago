# Archipelago on the web: bring your own key

**Date:** 2026-10-20
**Status:** slices 1 and 2 built (2026-10-21); the first deploy and a live turn per persona with a real key are next
**Builds on:** the API runner (`2026-10-20-api-runner-design.md`), the cartographer in the app (`2026-10-20-cartographer-in-app-design.md`)
**Route:** 2 of the distribution routes (1 is the Claude Code plugin, PR #1; 3 is the Claude.ai connector).

## Why

Today Archipelago needs Bun, a checkout or the plugin, and a terminal. That excludes the people who have an Anthropic API key but no Claude Code: they can use a web page but won't install a CLI. With the API runner and the in-app cartographer merged, every persona runs on a plain HTTP client, and a new domain can start from the page. What's left is where the server and the database live. This change puts both inside the browser: one static site that anyone opens, pastes a key into, and charts with, and that has no backend of ours.

## Decisions

| Question | Decision |
|---|---|
| Shape | **The server runs in a dedicated Web Worker.** `handleRequest(req, ctx)` already takes a `Request` and returns a `Response`; the worker calls it unchanged. The page sends its requests to the worker instead of the network. No route is rewritten. |
| Database | SQLite compiled to WebAssembly (`@sqlite.org/sqlite-wasm`, exact pin, devDependency) on the **`opfs-sahpool`** VFS: stored in the origin's private file system, synchronous inside a worker, and it needs no cross-origin isolation (no COOP/COEP headers). The numbered migrations run unchanged. |
| Repositories | Unchanged. A new `src/core/sql.ts` names the subset of the database API they use (`query<T,P>().all/get`, `run`, `exec`, `prepare`, `transaction(fn)` with `.immediate`, `close`). Every `import type { Database } from "bun:sqlite"` becomes an import from `sql.ts`. `bun:sqlite`'s `Database` satisfies it structurally, and the WASM adapter implements it; `tsc` checks both. |
| Seams | Five modules touch Bun or Node at runtime: `db.ts`, `migrate.ts`, `judge/protocol.ts`, `vendor.ts`, and the static-file half of `routes.ts`. The hosted build swaps the first three for `*.browser.ts` twins through a `Bun.build` resolve plugin. It never imports `vendor.ts` or serves static files from the worker. The local tool stays exactly as it is, including reading protocols fresh on each turn. |
| Judge | The `api` runner only, in the worker, with `dangerouslyAllowBrowser: true` (the SDK then sends the direct-browser-access header the API needs for CORS). There's no `sdk` runner, because there's no Claude Code. The `stub` runner is kept as **Try without a key**. |
| Build | `bun run build:web` (`scripts/build-web.ts`) writes `dist/web/`: the page's files copied, the worker bundled, shiki/plot/mermaid/onig/sqlite wasm emitted as static files, protocols and migrations inlined as text. This is the only build; the local page keeps its no-build rule. |
| Hosting | Cloudflare Pages, from `dist/web/`, with a `_headers` file (CSP, see *Key*). Any static host works; nothing is server-side. |
| One tab | `opfs-sahpool` holds the database exclusively. The worker takes a Web Lock (`archipelago-db`) before it opens the database, and a second tab says "Archipelago is open in another tab" with a button to take over. There's no multi-tab sync. |
| Backup | Export and import of the whole database file, both ways compatible with `~/.archipelago/archipelago.sqlite`. The browser can clear site data, so the page asks for persistent storage (`navigator.storage.persist()`) and reminds the reader to export. |

## The worker

`src/hosted/worker.ts` is the hosted server's `index.ts`:

1. Takes the Web Lock, installs the `opfs-sahpool` VFS, opens `archipelago.sqlite` once, and runs `migrateDatabase` on it.
2. Builds a `ServerContext` whose runner is `createApiRunner({ toolbox, apiKey, model, effort })` when a key is set, otherwise the stub.
3. Answers each message `{ id, method, path, headers, body }` by building a `Request` on `http://127.0.0.1/`, which passes the host and cross-site guards as a local request does, and calling `handleRequest`. Plain responses come back as one message `{ id, status, headers, text }`. A `text/event-stream` response is read chunk by chunk and posted as `{ id, chunk }` messages, then `{ id, done }`. `{ id, abort }` from the page aborts the request's `AbortController`, which stops a turn the same way closing the connection does locally.
4. Handles its own control messages: `setKey`, `export` (returns the database bytes), `import` (closes the database, validates, replaces, reopens, migrates), and `takeover`.

The database is opened once, not per request. `db.browser.ts` exports an `openDatabase()` that returns that one connection, with a `close()` that does nothing, so `withDb` in `routes.ts` and `chart.ts` stays as it is.

`migrate.browser.ts` takes its list from a generated module (`{ version, sql }[]`, built from `src/core/migrations/*.sql` with `with { type: "text" }` imports). `migrate.ts` is split so that the loop (`applyMigrations(db, list)`) is shared and only the directory read differs. `protocol.browser.ts` returns the bundled text of `PROTOCOL.md`, `MENTOR.md` and `CARTOGRAPHER.md`.

## The adapter

`src/core/sql-wasm.ts` wraps a sqlite-wasm `oo1.DB` in the `sql.ts` interface in about a hundred lines:
- Statements are cached per SQL string, as `db.query` caches them in Bun.
- Bindings accept both positional arrays and `$name` objects, the two forms the repositories use.
- `all` and `get` return objects keyed by the `as` aliases, so the camelCase convention holds.
- `run` returns `{ changes, lastInsertRowid }`.
- `transaction(fn)` wraps the function in `BEGIN` / `COMMIT` / `ROLLBACK`, and `.immediate` uses `BEGIN IMMEDIATE`. Like Bun's, it doesn't nest (`tools.ts` already relies on that).

The same package runs in Bun with an in-memory database, so **the core repository tests run twice**: once on `bun:sqlite` and once on the adapter (`tests/core/driver.ts` picks the driver from `ARCHIPELAGO_TEST_DRIVER`, and `bun run test:wasm` sets it). That is the adapter's proof. Behaviour the drivers disagree on fails a test that already exists.

## The page

The page needs only two changes.

- **One transport.** `src/web/transport.js` exports `request(path, init)` and returns a `Response`. Locally it is `fetch`. In the hosted build it posts to the worker and rebuilds a `Response` from the reply, using a `ReadableStream` for event streams. The three callers that fetch today go through it: `api` in `app.js` (the version poll included), `streamPost` in `stream.js`, and the domain list in `outline.js`. `code.js` keeps fetching `/vendor/onig.wasm`, which is a static file in both builds.
- **A welcome screen,** shown only in the hosted build, before the map and while there's no key and no stub (`src/web/welcome.js`). It has:
  - one field for the API key, and a **Remember on this device** checkbox, on by default;
  - **Try without a key**, which opens the stub;
  - **Import a database…**;
  - three sentences on cost and storage (below).

  "Your key" and "Export database" move into the outline's domain menu, beside About you.

The hosted build sets `window.ARCHIPELAGO_HOSTED = true` in its `index.html` and loads `transport.js`'s worker variant; everything else is the same files.

## Key

- The key is stored in IndexedDB (the worker reads it there; it can't read `localStorage`), and only when **Remember on this device** is on; otherwise it lives in the worker's memory for the session. It is never written to the SQLite database, so an export never contains it.
- The worker is the only code that calls the API. The page never holds the key after it hands it over.
- The welcome screen says plainly: *Your key stays in this browser and is sent only to api.anthropic.com. Each turn is billed to your key; a long session on Opus can cost a few dollars. Your charts are stored in this browser only; export them to keep a copy.*
- `_headers` sets a CSP of `default-src 'self'; connect-src 'self' https://api.anthropic.com; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`. The page has no `innerHTML` and no third-party script, so a key in the browser is exposed only to the reader's own extensions. This is stated, not hidden.
- A 401 from the runner already becomes "The API key was rejected" (`describeApiError`). On the hosted page, that message also links to **Your key**.

## Export and import

- **Export:** the worker runs `VACUUM INTO` a temporary OPFS file, or uses `sqlite3_js_db_export`, and returns the bytes. The page saves them as `archipelago-YYYY-MM-DD.sqlite`.
- **Import:** the worker checks the SQLite header and that `schema_migrations` exists, then refuses a database newer than the build (an unknown migration version) with that sentence. Otherwise it replaces the file, reopens it, and migrates. It replaces, never merges: the import dialog says so and offers an export first.
- **Local to hosted:** `archipelago export [--out file]` is a new CLI command (`VACUUM INTO`, so the WAL is folded in). The file it writes imports straight into the hosted app, and a hosted export works as `ARCHIPELAGO_DB_PATH`.

## Testing

- The repository and view-model tests on both drivers (above).
- `tests/hosted/transport.test.ts` runs the worker's message handler in Bun against an in-memory adapter and a stub runner: a JSON route, an SSE turn streamed to `done`, an abort mid-turn, and a 409 for a second turn on the same island.
- `tests/hosted/build.test.ts` runs `build:web` into a temporary directory. It asserts that every file the page references exists, that the protocols are inlined, and that no `bun:` or `node:` import survives in the worker bundle.
- By hand, with Playwright against `bunx serve dist/web` on `localhost`:
  - the welcome screen, then Try without a key, New domain, and approving a sketch;
  - one Keeper turn on the stub;
  - export, clear site data, import, and check the map is back;
  - a second tab showing the lock message.
- One live turn per persona with a real key before the first deploy.

## Slices

1. **The worker and the database.** Covers `sql.ts` and the adapter, the tests on both drivers, the `*.browser.ts` twins and the split of `migrate.ts`, the worker, `transport.js`, `build:web`, and the stub path working end to end in a browser. The local tool's behaviour doesn't change.
2. **Ready for people.** Covers a phone layout (the iPhone test clipped the strip and the pane in portrait: the outline becomes a rail by default, the strip wraps, the pane goes full screen), the welcome screen and key handling, the API runner in the worker, export/import and `archipelago export`, the one-tab lock, persistent storage, CSP and `_headers`, and the Cloudflare Pages deploy (a GitHub Action on `main`, or `wrangler pages deploy` by hand).

## Out of scope

- Accounts, sync between devices, or any server of ours. Moving a database between devices is done with export and import.
- Payments, and keys we supply. That's route 4, the paid PWA, which needs a backend.
- Installing as a PWA (manifest, service worker for offline use). The static site is already offline-capable except for the API, so this is cheap later, but not part of this change.
- Showing a cost per turn. The runner sees `usage`, so a small "≈ $0.08" under each reply is a natural follow-up once there's real usage to calibrate it against.
- The terminal cartographer and comments. The hosted app has no CLI; the in-app cartographer covers sketching.

## Settled (2026-10-21)

1. **Domain.** The free `*.pages.dev` address on Cloudflare Pages. A custom domain can be added later without any code change.
2. **License.** The repo stays private and `UNLICENSED` stays. The site is public but its source is not. This gets revisited before inviting contributors.
3. **Default model.** The hosted build defaults to `claude-sonnet-5-5`, still at `high` effort, because it is much cheaper for someone trying it out. The welcome screen and **Your key** offer Opus 5.5 one click away. The choice is stored beside the key, never in the database. The local tool keeps `claude-opus-5-5`.
4. **Safari.** Tested on the iPhone on 2026-10-21, in Safari and in an in-app Safari view: `opfs-sahpool` works, and the data survives a reload, so no fallback is needed. The test found three bugs, all fixed in slice 1:
   - Safari's back-forward cache kept the old page's worker, which held the file. The page now terminates its worker on `pagehide`, and a Web Lock gives one tab at a time.
   - A failed first load said only "disconnected". The page now shows the reason.
   - A restored URL could name a domain that this browser's database never had. The page now falls back to the start screen.

## Slice 2 as built (2026-10-21)

Where the build differs from the plan above, it is recorded here.

- **Control messages became routes.** The worker's own endpoints are paths under `/hosted/` (`GET`/`POST settings`, `GET export`, `POST import`) through the same transport, not `setKey`/`export`/`import` message kinds. `handler.ts` sends them to `hosted/routes.ts`, and a response typed `application/vnd.sqlite3` crosses as bytes (transferred, not copied).
- **Key.** The worker checks it with `sk-ant-` plus at least 8 characters. The page only ever sees `keyHint` (`…abcd`). A key replaces Try without a key, and **Forget key** goes back to it. The 401, 403 and 404 sentences point at **Your key** (`describeApiError(…, hosted)`).
- **Take over.** The second tab shows "Archipelago is open in another tab or window." with **Use it here**. That posts `takeover` on `BroadcastChannel("archipelago")`, and the first tab terminates its worker (`release()` in `transport.js`) and says "Archipelago moved to another tab". The second tab then reloads, and its worker gets the lock.
- **Import.** `prepareImport` checks the header and rewrites bytes 18–19 from 2 to 1, because the local tool keeps its file in WAL mode and `opfs-sahpool` has no WAL. The worker opens the candidate as `/incoming.sqlite` to read `schema_migrations` before it touches the real file. An older database is migrated up after the import. An import of a database with no key set switches on Try without a key, so the imported chart opens without the welcome screen.
- **CSP.** The page has two inline scripts (the theme stamp and the hosted flag), so the build hashes them into `script-src`. function-plot compiles each parsed expression with `new Function`, so `script-src` also carries `'unsafe-eval'`. It's a deliberate trade: the page builds no markup from strings, so there is no injected text for eval to reach. Removing it means a plot renderer that doesn't use eval.
- **Persistent storage** is requested when the reader starts with a key, chooses Try without a key, or imports a database.
- **Phone layout.**
  - The outline starts as a rail on a narrow screen that has no stored state.
  - The breadcrumb and strip wrap, and a strip hint spans the screen.
  - `--pane-w` is forced to `100vw` (`!important`, over the stored width), so the pane takes the screen, and so do the board, the scrim and the cheat sheet, which align to it.
  - The pane head wraps and adds **Board** and **Map** links, because on a phone the board button and the map are both behind the pane.
- **Deploy.** `bun run deploy:web` builds, then runs `wrangler@4.148.0 pages deploy dist/web --project-name archipelago`. Pages applies `_headers`.
- **Checked** in Chromium against the build, served with its `_headers`:
  - welcome, a malformed key, Try without a key, New domain, approve;
  - code, mermaid and plot cards under the CSP;
  - a well-formed fake key, which reaches `api.anthropic.com`, gets a 401, and shows the Your-key sentence;
  - export, then a second tab taking over;
  - import into a fresh browser, both of that export and of an `archipelago export` file, plus a junk file refused;
  - the phone layout at 393 px.
- **Still open:** one live turn per persona with a real key, and the first deploy (it needs `wrangler login` for the Cloudflare account).
