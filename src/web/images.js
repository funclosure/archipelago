// The reader's images on the page: shrinking one before it is sent, the tray of images waiting under an answer box,
// thumbnails on the reader's messages, the viewer that shows one full size (and removes it), and Images… in the
// domain menu, which removes old ones. Pure parts are in image-model.js. Images are read through `request`
// (transport.js), never by an <img src> on /api/image: on the hosted build that path lives in a worker.
import { app, api, refresh } from "./app.js";
import { request } from "./transport.js";
import { showDialog, redraw, focusFirst, focusCard, dialogHead, dialogFoot } from "./dialog.js";
import { toast } from "./toast.js";
import { t } from "./i18n.js";
import { IMAGE_BYTES_MAX, PRUNE_AGES, QUALITY, QUALITY_LOW, admit, fitWithin, formatBytes, isStorageFull, keepAsIs, thumbBox } from "./image-model.js";

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label, onClick, className = "btn") {
  const b = el("button", className, label);
  b.type = "button";
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

const post = (path, body) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// ---- reading an image ----

/** Image id → a blob: URL for this page. Ids start again with another database file, so nothing outlives the page. */
const urls = new Map();

/** Puts an image this page already holds (one it just sent) in the cache, so its message shows it at once. */
function seedUrl(id, url) {
  urls.set(id, Promise.resolve(url));
}

/** A blob: URL for the image, read once per page. */
export function imageUrl(id) {
  if (!urls.has(id)) {
    const read = request(`/api/image?domain=${encodeURIComponent(app.domain)}&id=${id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(res.statusText);
        return URL.createObjectURL(await res.blob());
      })
      .catch((error) => {
        urls.delete(id); // a later draw tries again
        throw error;
      });
    urls.set(id, read);
  }
  return urls.get(id);
}

// ---- shrinking and sending ----

async function encode(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function canvasOf(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

/**
 * The image as it will be sent: as it is when it is a small PNG, GIF, or WebP within the edge; otherwise drawn again
 * within the edge as WebP (JPEG on a white ground where the browser cannot write WebP), which also drops a photo's
 * EXIF. Throws a sentence for the tray when it is not an image or stays too heavy.
 */
export async function prepareImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bitmap) throw new Error(t("images.notImage", { name: file.name || t("images.thisFile") }));
  try {
    if (keepAsIs({ type: file.type, size: file.size, width: bitmap.width, height: bitmap.height })) return { blob: file, width: bitmap.width, height: bitmap.height };
    const size = fitWithin(bitmap.width, bitmap.height);
    const canvas = canvasOf(size.width, size.height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, size.width, size.height);
    let blob = await encode(canvas, "image/webp", QUALITY);
    let jpeg = null;
    if (!blob || blob.type !== "image/webp") {
      // No WebP writer here: a JPEG has no transparency, so the drawing goes on white first.
      jpeg = canvasOf(size.width, size.height);
      const g = jpeg.getContext("2d");
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, size.width, size.height);
      g.drawImage(canvas, 0, 0);
      blob = await encode(jpeg, "image/jpeg", QUALITY);
    }
    if (blob.size > IMAGE_BYTES_MAX) blob = await encode(jpeg ?? canvas, blob.type, QUALITY_LOW);
    if (blob.size > IMAGE_BYTES_MAX) throw new Error(t("images.tooBig", { name: file.name || t("images.thisFile"), max: formatBytes(IMAGE_BYTES_MAX) }));
    return { blob, ...size };
  } finally {
    bitmap.close();
  }
}

function base64Of(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(",") + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Sends one prepared image; it waits, unattached, for the message that carries it. */
async function uploadImage(blob) {
  const { image } = await post("/api/images", { domain: app.domain, data: await base64Of(blob) });
  return image;
}

/** A refusal in the reader's words; on a full browser, where to make room. */
function uploadError(error, name) {
  if (isStorageFull(error.message)) return t("images.storageFull");
  return t("images.uploadFailed", { name: name || t("images.thisFile"), error: error.message });
}

// ---- the tray: images waiting under an answer box ----

let trayKeys = 0;

/**
 * The images attached to a draft. Each is shrunk and sent as soon as it is added, so Send is quick; one removed
 * before sending is deleted on the server too. `onChange` repaints the pane that shows it.
 */
export function createTray(onChange) {
  let items = []; // { key, url, name, status: "preparing" | "uploading" | "ready" | "failed", image, error }
  let notice = null; // why the last files were not all taken
  const changed = () => onChange();
  const tray = {
    get items() {
      return items;
    },
    get notice() {
      return notice;
    },
    /** Takes image files from a pick, a paste, or a drop. */
    add(files) {
      const { take, refused } = admit([...files], items.length);
      notice = refused ? t(refused.reason === "tooMany" ? "images.tooMany" : "images.notImage", { n: take.length + items.length, name: refused.name || t("images.thisFile") }) : null;
      for (const file of take) {
        const item = { key: ++trayKeys, url: URL.createObjectURL(file), name: file.name, status: "preparing", image: null, error: null };
        items = [...items, item];
        void (async () => {
          const fail = (message) => {
            item.status = "failed";
            item.error = message;
            changed();
          };
          let blob;
          try {
            ({ blob } = await prepareImage(file)); // its refusals are already sentences for the tray
          } catch (error) {
            return fail(error.message);
          }
          if (!items.includes(item)) return; // taken back while it was being shrunk
          item.status = "uploading";
          changed();
          let image;
          try {
            image = await uploadImage(blob);
          } catch (error) {
            return fail(uploadError(error, file.name));
          }
          if (!items.includes(item)) {
            void post("/api/images/remove", { domain: app.domain, ids: [image.id] }).catch(() => {});
            return;
          }
          URL.revokeObjectURL(item.url);
          item.url = URL.createObjectURL(blob);
          seedUrl(image.id, item.url);
          item.image = image;
          item.status = "ready";
          changed();
        })();
      }
      changed();
    },
    /** Takes one back off the draft; one already sent to the server is deleted there (it was never attached). */
    remove(key) {
      const item = items.find((i) => i.key === key);
      if (!item) return;
      items = items.filter((i) => i !== item);
      if (item.image) {
        urls.delete(item.image.id);
        void post("/api/images/remove", { domain: app.domain, ids: [item.image.id] }).catch(() => {});
      }
      URL.revokeObjectURL(item.url);
      notice = null;
      changed();
    },
    /** Images still being shrunk or sent: Send waits for them. */
    busy: () => items.some((i) => i.status === "preparing" || i.status === "uploading"),
    /** The images ready to go with the message, in order. */
    ready: () => items.filter((i) => i.status === "ready").map((i) => i.image),
    /** Hands the ready images to a message and empties the tray; `restore` puts them back if the message never went. */
    take() {
      const taken = items.filter((i) => i.status === "ready");
      items = items.filter((i) => i.status !== "ready");
      notice = null;
      return taken;
    },
    restore(taken) {
      items = [...taken, ...items];
      changed();
    },
    /** Forgets everything, deleting what was sent but never attached (the thread changed under the draft). */
    clear() {
      for (const item of items) {
        if (item.image) void post("/api/images/remove", { domain: app.domain, ids: [item.image.id] }).catch(() => {});
        else URL.revokeObjectURL(item.url);
      }
      items = [];
      notice = null;
    },
    /** Empties the tray without deleting anything: the server has these on a message after all. */
    drop() {
      items = [];
      notice = null;
    },
  };
  return tray;
}

/** The tray under an answer box: each image small, how it is doing, and × to take it back. Null when empty. */
export function trayEl(tray) {
  if (tray.items.length === 0 && !tray.notice) return null;
  const box = el("div", "tray");
  for (const item of tray.items) {
    const fig = el("figure", `tray-item ${item.status}`);
    const img = el("img");
    img.src = item.url;
    img.alt = item.name || t("images.alt");
    fig.append(img);
    if (item.status === "preparing" || item.status === "uploading") fig.append(el("span", "tray-state", t(item.status === "preparing" ? "images.preparing" : "images.uploading")));
    if (item.status === "failed") {
      fig.title = item.error;
      fig.append(el("span", "tray-state", t("images.failed")));
    }
    const x = button("×", () => tray.remove(item.key), "tray-x");
    x.setAttribute("aria-label", t("images.trayRemove", { name: item.name || t("images.alt") }));
    fig.append(x);
    box.append(fig);
  }
  const failed = tray.items.find((i) => i.status === "failed");
  const say = tray.notice ?? failed?.error;
  if (say) box.append(el("div", "tray-notice", say));
  return box;
}

/** A paper clip, as SVG nodes. */
function clipIcon() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M13.5 6.5 7.8 12.2a1.6 1.6 0 0 0 2.3 2.3l6-6a3.2 3.2 0 0 0-4.5-4.5l-6.2 6.2a4.8 4.8 0 0 0 6.8 6.8l5-5");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.5");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

/** The attach button beside Send: a file picker for images (a phone offers its camera too). */
export function attachButton(tray, disabled = false) {
  const b = el("button", "btn ghost attach");
  b.type = "button";
  b.title = t("images.attach");
  b.setAttribute("aria-label", t("images.attach"));
  b.disabled = disabled;
  b.append(clipIcon());
  b.addEventListener("click", () => {
    const input = el("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.addEventListener("change", () => {
      if (input.files?.length) tray.add(input.files);
    });
    input.click();
  });
  return b;
}

/** Image files on a paste. The words pasted with them (a copied page) still paste; an image alone is not text. */
export function pastedImages(e) {
  const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
  if (files.length && !e.clipboardData.types.includes("text/plain")) e.preventDefault();
  return files;
}

/** Makes `target` take dropped image files into whichever tray `trayFor()` gives (null: none here now). */
export function acceptDrops(target, trayFor) {
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  let depth = 0;
  target.addEventListener("dragenter", (e) => {
    if (!hasFiles(e) || !trayFor()) return;
    depth++;
    target.classList.add("dropping");
  });
  target.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) target.classList.remove("dropping");
  });
  target.addEventListener("dragover", (e) => {
    if (hasFiles(e) && trayFor()) e.preventDefault();
  });
  target.addEventListener("drop", (e) => {
    depth = 0;
    target.classList.remove("dropping");
    const tray = trayFor();
    if (!tray || !hasFiles(e)) return;
    e.preventDefault();
    tray.add(e.dataTransfer.files);
  });
}

// ---- on a message ----

/** The images on a reader's message, as thumbnails that open the viewer; a removed one is a small mark. */
export function messageImagesEl(images) {
  const box = el("div", "msg-images");
  for (const image of images) {
    if (image.removed) {
      box.append(el("span", "msg-image removed", t("images.removed")));
      continue;
    }
    const size = thumbBox(image.width, image.height);
    const open = el("button", "msg-image");
    open.type = "button";
    open.setAttribute("aria-label", t("images.open"));
    open.style.width = `${size.width}px`;
    open.style.height = `${size.height}px`; // the box is the image's before it arrives: the log never jumps
    const img = el("img");
    img.alt = t("images.alt");
    img.width = size.width;
    img.height = size.height;
    imageUrl(image.id).then((url) => (img.src = url), () => open.classList.add("broken"));
    open.append(img);
    open.addEventListener("click", () => openViewer(image));
    box.append(open);
  }
  return box;
}

// ---- the viewer ----
// A dialog of the family (dialog.js), as a lightbox: the picture is the content, so the card sits in the middle of a
// stronger veil and focus rests on the card, not on a button. Remove image is the door at the foot's left; the
// question that follows has the safe answer focused, and Escape there goes back to the picture.

const viewer = { image: null, confirming: false, removing: false, error: null };
let viewerRoot = null;
let viewerImg = null; // the picture's element, kept across redraws of the card so it is never fetched or painted twice

export function openViewer(image) {
  if (!viewerRoot) return;
  Object.assign(viewer, { image, confirming: false, removing: false, error: null });
  viewerImg = el("img");
  viewerImg.alt = t("images.alt");
  const img = viewerImg;
  imageUrl(image.id).then((url) => (img.src = url), () => (img.alt = t("images.unreadable")));
  renderViewer();
  focusFirst(viewerRoot);
}

/** A request to leave: Escape on the remove question goes back to the picture; anything else closes the viewer. */
function leaveViewer(why = "escape") {
  if (viewer.removing) return;
  if (why === "escape" && viewer.confirming) return stopRemoving();
  closeViewer();
}

function closeViewer() {
  if (!viewer.image) return;
  Object.assign(viewer, { image: null, confirming: false });
  viewerImg = null;
  renderViewer();
}

function stopRemoving() {
  viewer.confirming = false;
  viewer.error = null;
  renderViewer();
  viewerRoot.querySelector('[data-key="remove-image"]')?.focus(); // back on the door it came through
}

async function removeShown() {
  const image = viewer.image;
  viewer.removing = true;
  viewer.error = null;
  renderViewer();
  try {
    await post("/api/images/remove", { domain: app.domain, ids: [image.id] });
    urls.delete(image.id);
    viewer.removing = false;
    closeViewer();
    // The thumbnail that opened the viewer is about to go with its image, so the pane itself keeps the keyboard.
    document.getElementById("pane")?.focus({ preventScroll: true });
    void refresh(); // the thread comes back with the mark where the image was
  } catch (error) {
    viewer.removing = false;
    viewer.error = error.message;
    renderViewer();
    focusFirst(viewerRoot);
  }
}

function renderViewer() {
  redraw(viewerRoot, drawViewer);
}

function drawViewer() {
  viewerRoot.hidden = !viewer.image;
  showDialog(viewerRoot, Boolean(viewer.image), { close: leaveViewer });
  viewerRoot.replaceChildren();
  if (!viewer.image) return;
  const card = el("div", "dialog-card viewer-card");
  const head = dialogHead(t("images.alt"), leaveViewer, { id: "viewer-title" });
  head.firstChild.after(el("span", "viewer-size", t("images.size", { width: viewer.image.width, height: viewer.image.height })));
  card.append(head, viewerImg);
  if (viewer.confirming) {
    const yes = button(viewer.removing ? t("images.removing") : t("images.remove"), () => void removeShown(), "btn danger");
    yes.dataset.key = "remove-confirm";
    yes.disabled = viewer.removing;
    const keep = button(t("images.keep"), stopRemoving, "btn ghost");
    keep.dataset.key = "keep";
    keep.dataset.autofocus = "";
    keep.disabled = viewer.removing;
    // The question sits in the foot, where the door was: asking it changes the card's height by nothing.
    const ask = el("span", "ask", viewer.error ?? t("images.confirmRemove"));
    if (viewer.error) ask.classList.add("error");
    card.append(dialogFoot([ask], [keep, yes]));
  } else {
    const door = button(t("images.removeImage"), () => {
      viewer.confirming = true;
      renderViewer();
      focusFirst(viewerRoot); // Keep it: the safe answer has the keyboard
    }, "btn ghost danger");
    door.dataset.key = "remove-image";
    card.append(dialogFoot([door], []));
  }
  viewerRoot.setAttribute("aria-labelledby", "viewer-title");
  viewerRoot.append(card);
}

// ---- Images… in the domain menu ----
// A dialog of the family: what the domain's images take, and a row per way to remove old ones. A row asks first (the
// safe answer focused; Escape goes back to the rows), and what was removed is said in a toast.

const sheet = { open: false, usage: null, error: null, asking: null, pruning: false };
let sheetRoot = null;
let sheetGen = 0;

export function openImagesSheet() {
  if (!sheetRoot) return;
  Object.assign(sheet, { open: true, usage: null, error: null, asking: null, pruning: false });
  void loadUsage();
}

/** A request to leave: Escape on the question goes back to the rows; anything else closes the sheet. */
function leaveSheet(why = "escape") {
  if (sheet.pruning) return;
  if (why === "escape" && sheet.asking) return stopAsking();
  closeSheet();
}

function closeSheet() {
  if (!sheet.open) return;
  Object.assign(sheet, { open: false, asking: null });
  sheetGen++;
  renderSheet();
}

const optionKey = (days) => `older:${days ?? "all"}`;

function stopAsking() {
  const key = optionKey(sheet.asking.days);
  sheet.asking = null;
  sheet.error = null;
  renderSheet();
  sheetRoot.querySelector(`[data-key="${key}"]`)?.focus(); // back on the row that asked
}

async function loadUsage() {
  const gen = ++sheetGen;
  sheet.error = null;
  renderSheet();
  if (!sheet.usage) focusCard(sheetRoot); // nothing to act on until the usage is read
  try {
    const usage = await api(`/api/images/usage?domain=${encodeURIComponent(app.domain)}&older=${PRUNE_AGES.join(",")}`);
    if (gen !== sheetGen || !sheet.open) return;
    sheet.usage = usage;
  } catch (error) {
    if (gen !== sheetGen || !sheet.open) return;
    sheet.error = t("images.readFailed", { error: error.message });
  }
  renderSheet();
  focusFirst(sheetRoot);
}

async function prune(days) {
  sheet.pruning = true;
  sheet.error = null;
  renderSheet();
  try {
    const result = await post("/api/images/prune", { domain: app.domain, olderThanDays: days });
    toast(t("images.done", { count: result.removed, size: formatBytes(result.bytes) }));
    sheet.asking = null;
    sheet.pruning = false;
    void refresh(); // the threads come back with a mark where each image was
    await loadUsage();
  } catch (error) {
    sheet.pruning = false;
    sheet.error = error.message;
    renderSheet();
    focusFirst(sheetRoot);
  }
}

function renderSheet() {
  redraw(sheetRoot, drawSheet);
}

function drawSheet() {
  sheetRoot.hidden = !sheet.open;
  showDialog(sheetRoot, sheet.open, { close: leaveSheet });
  sheetRoot.replaceChildren();
  if (!sheet.open) return;
  const card = el("div", "dialog-card images-card");
  card.append(dialogHead(t("images.sheetTitle"), leaveSheet, { id: "images-title" }));
  sheetRoot.setAttribute("aria-labelledby", "images-title");
  const name = app.snapshot?.domain.name ?? app.domain;
  const u = sheet.usage;
  if (!u && !sheet.error) card.append(el("p", "help muted", t("images.reading")));
  if (u) {
    card.append(el("p", "help", u.count ? t("images.usage", { count: u.count, size: formatBytes(u.bytes), name }) : t("images.none", { name })));
    if (u.removed) card.append(el("p", "help muted", t("images.removedEarlier", { count: u.removed })));
    if (u.count) {
      const options = [...PRUNE_AGES.map((days) => ({ days, label: t("images.olderThan", { n: days }), ...u.older[String(days)] })), { days: null, label: t("images.all"), count: u.count, bytes: u.bytes }];
      const list = el("div", "images-options");
      list.append(el("div", "eyebrow", t("images.removeLabel")));
      for (const o of options) {
        const b = button("", () => {
          sheet.asking = o;
          sheet.error = null;
          renderSheet();
          focusFirst(sheetRoot); // Cancel: the safe answer has the keyboard
        }, `mi images-option${sheet.asking?.days === o.days ? " on" : ""}`);
        b.dataset.key = optionKey(o.days);
        b.append(el("span", "grow", o.label), el("span", "cur", o.count ? t("images.optionCount", { count: o.count, size: formatBytes(o.bytes) }) : t("images.optionNone")));
        b.disabled = !o.count || sheet.pruning;
        list.append(b);
      }
      card.append(list);
    }
  }
  if (u && sheet.asking) {
    card.append(el("p", "confirm", t(sheet.asking.days === null ? "images.confirmAll" : "images.confirmOlder", { count: sheet.asking.count, n: sheet.asking.days ?? 0, name })));
    if (sheet.error) card.append(el("p", "error", sheet.error));
    const yes = button(sheet.pruning ? t("images.removing") : t("images.remove"), () => void prune(sheet.asking.days), "btn danger");
    yes.dataset.key = "remove-confirm";
    yes.disabled = sheet.pruning;
    const no = button(t("images.cancel"), stopAsking, "btn ghost");
    no.dataset.key = "cancel";
    no.dataset.autofocus = "";
    no.disabled = sheet.pruning;
    card.append(dialogFoot([], [no, yes]));
  } else if (sheet.error) {
    // The usage could not be read: say so, and offer the one thing to do.
    card.append(el("p", "error", sheet.error));
    const retry = button(t("images.retry"), () => void loadUsage(), "btn");
    retry.dataset.key = "retry";
    retry.dataset.autofocus = "";
    card.append(dialogFoot([], [retry]));
  }
  sheetRoot.append(card);
}

export function installImages() {
  viewerRoot = document.getElementById("viewer");
  sheetRoot = document.getElementById("images-sheet");
  renderViewer();
  renderSheet();
}
