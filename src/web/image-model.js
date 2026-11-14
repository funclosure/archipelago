// The reader's images on the page, the pure parts: the limits (mirroring src/core/images.ts; a test keeps the two
// equal), which files a message takes, how an image is shrunk before it is sent, a thumbnail's box, and sizes in
// words. images.js does the drawing and the sending.

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const IMAGES_PER_MESSAGE = 4;
export const IMAGE_EDGE = 1568;
export const IMAGE_BYTES_MAX = 1024 * 1024;
/** A PNG, GIF, or WebP this small and already within the edge goes as it is: a screenshot of text stays crisp. */
export const KEEP_AS_IS_BYTES = 300 * 1024;
/** WebP (or JPEG where the browser cannot write WebP) at this quality, then once more at the lower one if too heavy. */
export const QUALITY = 0.85;
export const QUALITY_LOW = 0.7;
/** The prune ages Images… offers, in days. */
export const PRUNE_AGES = [30, 90];

/**
 * Which of `files` a message with `have` images already takes: images only (any the browser can draw, since each is
 * redrawn), up to the limit. `refused` says why the first one left out was, or is null.
 */
export function admit(files, have = 0) {
  const take = [];
  let refused = null;
  for (const file of files) {
    if (!String(file.type).startsWith("image/")) {
      refused ??= { reason: "notImage", name: file.name ?? "" };
      continue;
    }
    if (have + take.length >= IMAGES_PER_MESSAGE) {
      refused ??= { reason: "tooMany", name: file.name ?? "" };
      continue;
    }
    take.push(file);
  }
  return { take, refused };
}

/** The size within `edge` on the longer side, keeping the shape; an image already within it keeps its size. */
export function fitWithin(width, height, edge = IMAGE_EDGE) {
  const long = Math.max(width, height);
  if (long <= edge) return { width, height };
  const scale = edge / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Whether a file goes as it is. Everything else is drawn again, smaller where it is large: that also drops a photo's
 * EXIF (where it was taken among it), which is why a JPEG is always drawn again.
 */
export function keepAsIs({ type, size, width, height }) {
  return (type === "image/png" || type === "image/gif" || type === "image/webp") && Math.max(width, height) <= IMAGE_EDGE && size <= KEEP_AS_IS_BYTES;
}

/** A thumbnail's box: `height` high (less for a short image), no wider than `maxWidth`, the image's own shape. */
export function thumbBox(width, height, { height: h = 120, maxWidth = 320 } = {}) {
  let out = Math.min(h, height);
  let w = Math.round((width / height) * out);
  if (w > maxWidth) {
    w = maxWidth;
    out = Math.max(1, Math.round((height / width) * maxWidth));
  }
  return { width: Math.max(1, w), height: Math.max(1, out) };
}

/** Bytes in words: 0 B, 812 B, 340 KB, 1.2 MB. */
export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** Whether an error says the browser's storage is full (hosted: OPFS, through SQLite). */
export const isStorageFull = (message) => /quota|disk is full|SQLITE_FULL|database or disk is full/i.test(String(message));
