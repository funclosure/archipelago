# Images in the conversation

**Goal.** A reader can paste, drop, or attach images in any of the four conversations (the Keeper, the mentor, the guide, the cartographer), the way they would in a chat with Claude. The persona sees them and talks about them. Both builds get it at once: `archipelago serve` and the hosted site.

**Decided (2026-11-14).**
- An image is context, never evidence. The Keeper lights a landmark or writes a verdict only from the reader's words. When a reader answers with an image (a hand-drawn diagram, say), the Keeper reads it and asks for the key part in a sentence. The same holds for `mark_explored` and `loose_end` evidence.
- Every conversation gets it in v1. The board does not: an image card and "pin this image" come later.
- Hosted ships with local, not after it.

## What the reader sees

- **Attaching.** In any answer box: paste (⌘V with an image on the clipboard), drop onto the pane, or the attach button beside Send (a file input with `accept="image/*"`, so a phone offers the camera). Up to `IMAGES_PER_MESSAGE` (4) per message.
- **Before sending.** A row of thumbnails above the box, each with ×. A message may be an image alone, with no words.
- **In the log.** The reader's message shows its images as thumbnails (at most 240 px high) above the text. A click opens one full size in the top layer (`full.js`). Escape closes it.
- **Limits, said plainly.** A file that is not an image, or more than four, is refused in a line under the box, never silently dropped.
- **Personas never send images.** Only the reader's messages carry them.

## Shrinking in the page

Before upload, `image-model.js` (pure: the sizes) and `attach.js` (DOM) decode with `createImageBitmap` and redraw on a canvas so the long edge is at most `IMAGE_EDGE` (1568 px, the size Claude reads best). Then they encode as WebP at 0.85 (JPEG where the browser cannot write WebP). A PNG already under the edge and under 300 KB stays as it is, so screenshots of text stay crisp. Anything over `IMAGE_BYTES_MAX` (1 MB) after shrinking is refused. Redrawing also strips EXIF, so a phone photo's location never leaves the device.

## Storage

Migration `0022_images.sql`:

```sql
create table images (
  id integer primary key autoincrement,
  domain_id integer not null references domains(id) on delete cascade,
  message_id integer references messages(id) on delete cascade,   -- null until the message that carries it is stored
  position integer not null default 0,                             -- order within the message
  media_type text not null check (media_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  width integer not null check (width > 0), height integer not null check (height > 0),
  bytes blob,                                                      -- null once the reader removed it (a tombstone)
  removed_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  check ((bytes is null) = (removed_at is not null))
);
create index images_message on images(message_id, position);
create index images_domain on images(domain_id, id);
-- and the usual triggers: every insert, update, and delete bumps the domain's version
```

- Bytes live in SQLite. It is one file locally and OPFS when hosted, so **Download a backup** carries them with no extra work, and deleting a domain deletes them.
- `exportMap` never writes them, since a map file is structure only.
- An upload never attached (the reader removed it, or the turn was refused) is deleted after a day, on the next upload.
- `imageRepository.ts`, typed on `Database` from `sql.ts`, so it runs on the WebAssembly adapter (`test:wasm`).

## Cleaning up

Images are the one thing that makes the database grow fast: a screenshot is 100–400 KB, and a whole domain's text rarely reaches that. There are three kinds of outdated image, each with its own way out. Nothing the reader attached to a conversation is deleted without them asking.

- **Never attached.** An upload no message took (removed before sending, or a refused turn) goes after a day, swept on the next upload. Automatic, since the reader never saw it in a conversation.
- **One image.** On a reader message's thumbnail, **Remove image** (in the viewer, and on hover) deletes the bytes and keeps a tombstone: `bytes` becomes null and `removed_at` is set (both in migration 0022). The log keeps a small "image removed" placeholder where it was. The replay says `[image #12, removed by the reader]`, so the persona never pretends to still see it, and the thread's order and its evidence quotes stay intact.
- **In bulk.** **Images…** in the domain menu opens a small sheet:
  - how much this domain's images take (count and size);
  - **Remove images older than** 30 days / 90 days / all, by age alone. An old image a persona still has in view goes too: the replay then says it was removed, and the persona can ask for it again. Protecting the newest four of every thread would leave a long-idle conversation's images impossible to clear in bulk.
  - a confirm line naming the count.

  Then it tombstones them in one transaction and runs `VACUUM` (local; on hosted the `opfs-sahpool` VFS supports it too), so the file actually shrinks. A backup downloaded afterwards is smaller.
- **Routes:**
  - `POST /api/images/remove { domain, ids }` for one;
  - `POST /api/images/prune { domain, olderThanDays }` for bulk (`olderThanDays: null` is every image), which returns `{ removed, bytes, usage }`;
  - `GET /api/images/usage?domain=` for the sheet: `{ count, bytes, removed }`.

  Prune is 409 while a turn runs in the domain, like a domain delete, since `VACUUM` rewrites the whole file. Removing one image needs no lock: a running turn read its bytes as it started.
- **Terminal:** `image usage --domain`, `image prune --domain (--older-than 30d | --all)`.
- **Hosted, near the quota.** When an upload fails on storage (`QuotaExceededError` from OPFS), the refusal says so and offers **Images…**. No silent eviction.

Open question: an automatic policy (say, remove images out of view after 180 days) could come later as a setting. v1 leaves every removal to the reader.

## Routes

Both builds, in `api-routes.ts`:

- `POST /api/images { domain, data }` takes the image as base64 in JSON. Every write must be `application/json`: that is the cross-site guard (`crossSitePostGuard`), and it stays as it is, at the price of a third more bytes on a local hop. The image's own bytes decide its type (`sniffImage` in `src/core/images.ts` reads the PNG, GIF, JPEG and WebP headers), never what the sender says. SVG is never accepted, since it can carry script. Checks the size and the dimensions (`imageProblem`), then returns `{ image: { id, width, height, removed: false } }`.
- `GET /api/image?domain=&id=` serves the bytes with their type, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`, and `Cache-Control: no-store`. Ids start again with another database file (a restored backup, `ARCHIPELAGO_DB_PATH`), so the browser keeps nothing; the page keeps its own copy per page load. Refused when `Sec-Fetch-Site` says another site asked, like `/api/speak`. On hosted, the worker passes an `image/*` response as bytes, like a database file.
- `POST /api/probe` gains `images: number[]` (at most four, no repeats, never with `askId`). In all four kinds of thread, the transaction that stores the reader message attaches them (`addReaderMessage`), and refuses ids from another domain, already attached, or removed (404 / 409), so a bad id stores no message either. A message may be images alone; its body is then `""`.
- `GET /api/thread` gives each message `images: [{ id, width, height, removed }]`, empty when it has none.
- The page never puts `/api/image` in an `<img src>`. Hosted requests go through `transport.js` to the worker, which an `<img>` cannot reach. So `images.js` fetches through `request`, makes a `blob:` URL, and caches it per id (`img-src blob:` is already in the hosted CSP).

## What the model sees

`TurnRequest.prompt` changes from a string to `PromptPart[]`: `{ type: "text", text }` or `{ type: "image", mediaType, data }` (base64).

- **Replay.** `renderReplay` writes a line `[image #12]` at column 0 after a reader message, for each image it carries. A reader's own text can never forge one: their first line follows `Reader: `, and `indent` indents the rest.
- **Budget.** `promptParts(text, thread)` in `context.ts` splits the replay at those lines. It puts the image itself in place of the newest `IMAGES_IN_VIEW` (4) images. Older ones stay as text: `[image #12, shown earlier; not shown again]`. A long thread then costs the same per turn, and a request stays well under any body limit (four images are at most about 5.5 MB of base64, under the proxy's 8 MB).
- **Context line.** Each persona's context says how many images are in view and that they are the reader's.

Per runner:

| Runner | How the parts go |
|---|---|
| `api` (`claudeAdapter`) | The user message's `content` becomes text and `image` blocks (`source: { type: "base64", media_type, data }`). |
| `openai` (`chatAdapter`) | `content` becomes an array of `{ type: "text" }` and `{ type: "image_url", image_url: { url: "data:…;base64,…" } }`. Gemini and OpenRouter take it. A model that cannot see answers with its own error, which `describeError` shows. |
| `sdk` | `query({ prompt })` takes an async iterable yielding one `SDKUserMessage` whose content is the same blocks as the API's. |
| `stub` | Says how many images it was shown (`I see 2 images.`), so tests can check what reached the persona. |

A stored image is read from the database as the turn starts, like the rest of the context. Nothing is cached in the server.

## Protocol text

A short section in each of `PROTOCOL.md`, `MENTOR.md`, `GUIDE.md`, `CARTOGRAPHER.md`:

- **Keeper:** an image is the reader's context, never evidence. Read it, and when it answers your question, ask for the part that matters in a sentence before lighting anything. Evidence stays a verbatim quote of their words.
- **Mentor:** explain from what the image shows (an error, a screen, a diagram they drew). Never quote it as their words in `mark_explored` or `loose_end`.
- **Guide:** use the image to tell where the reader stands, then point as usual.
- **Cartographer:** an image of a syllabus, a table of contents, or a diagram is material for the sketch, like a description.

Conformance gets one scripted turn with an image: a small PNG of a diagram, sent to the Keeper. It FAILs if a landmark is lit or a verdict written from that turn, and WARNs if the reply does not ask for words.

## Hosted and the proxy

- **The proxy** (private `archipelago-proxy`) refused requests over `MAX_BODY = 512 KB`, which one screenshot can approach. Raised to 8 MB in that repo (archipelago-proxy #8), shipped first. Anthropic's own limit is 32 MB.
- **Cost.** An image costs about (w × h) / 750 tokens: a 1568 × 980 screenshot is about 2k tokens, every turn it stays in view. The budget of four bounds it. No change to pricing; the foot's balance already shows what a turn spent.
- **Privacy and terms.** `privacy.html` says images are sent to the model provider with the conversation and kept only in the reader's browser (hosted) or database (local). The proxy stores none, only its ledger. Bump `updated` on both pages (CLAUDE.md: change the page with the behaviour).
- **CSP.** No change: `img-src 'self' data: blob:` already covers it, and nothing loads from elsewhere.

## Out of scope for v1

- Image cards on the board, and pinning an image from a message.
- Images in a persona's reply (generated or fetched).
- Reading an image aloud: the voice skips it.
- Images in map files or the gallery.
- Annotating or cropping in the page.

## Order of work

Each step is one PR, and each leaves `main` working.

1. **Proxy:** raise `MAX_BODY` (archipelago-proxy).
2. **Storage and routes:** migration 0022, `imageRepository`, the three route changes, thread payload, and removal (one image, prune, usage, `VACUUM`, the CLI); core, server, and wasm tests.
3. **Model side:** `PromptPart`, replay markers, budget, four adapters and the stub, protocol sections, the conformance turn.
4. **Page:** attach, paste and drop, shrinking, thumbnails, viewer, Remove image and the Images… sheet, strings in both languages; checked by hand in Chromium and Safari, and on a phone.
5. **Hosted:** build check, the privacy and terms pages, a conformance run on Claude and Gemini before announcing it.
