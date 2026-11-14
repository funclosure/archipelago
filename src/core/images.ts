// The reader's images: what may be stored, and reading an image's real type and size from its first bytes. Pure: no
// database, no DOM. The page shrinks an image before it uploads it (src/web/image-model.js mirrors the limits, and a
// test keeps the two equal); the server never trusts that and checks the bytes again here.

/** The types a reader may attach. Never SVG: it can carry script. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** At most this many images on one message. */
export const IMAGES_PER_MESSAGE = 4;
/** The longest edge a stored image may have, in pixels: the size Claude reads best; the page shrinks to it. */
export const IMAGE_EDGE = 1568;
/** The most bytes one stored image may take, after the page shrank it. */
export const IMAGE_BYTES_MAX = 1024 * 1024;
/** How many of a thread's newest images a persona sees whole; older ones are named, not shown. */
export const IMAGES_IN_VIEW = 4;

export type ImageInfo = { mediaType: ImageType; width: number; height: number };

const ascii = (b: Uint8Array, at: number, text: string) => {
  if (at + text.length > b.length) return false;
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false;
  return true;
};
const u16be = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;
const u16le = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const u24le = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);
const u32be = (b: Uint8Array, at: number) => ((b[at]! << 24) >>> 0) + ((b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!);

/** JPEG start-of-frame markers (baseline, progressive, lossless, arithmetic); C4, C8 and CC are not frames. */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpeg(b: Uint8Array): ImageInfo | null {
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return null;
    let marker = b[at + 1]!;
    // Fill bytes: a marker may be preceded by any number of 0xFF.
    while (marker === 0xff && at + 2 < b.length) marker = b[++at + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2; // no length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image or start of scan before any frame
    const length = u16be(b, at + 2);
    if (length < 2) return null;
    if (SOF.has(marker)) {
      if (at + 9 > b.length) return null;
      return { mediaType: "image/jpeg", height: u16be(b, at + 5), width: u16be(b, at + 7) };
    }
    at += 2 + length;
  }
  return null;
}

function webp(b: Uint8Array): ImageInfo | null {
  if (!ascii(b, 8, "WEBP") || b.length < 30) return null;
  const at = 12;
  if (ascii(b, at, "VP8X")) return { mediaType: "image/webp", width: 1 + u24le(b, at + 12), height: 1 + u24le(b, at + 15) };
  if (ascii(b, at, "VP8L")) {
    if (b[at + 8] !== 0x2f) return null; // the lossless signature
    const [b0, b1, b2, b3] = [b[at + 9]!, b[at + 10]!, b[at + 11]!, b[at + 12]!];
    return { mediaType: "image/webp", width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
  }
  if (ascii(b, at, "VP8 ")) {
    // The frame tag (3 bytes), then the start code 9d 01 2a, then 14-bit width and height.
    if (b[at + 11] !== 0x9d || b[at + 12] !== 0x01 || b[at + 13] !== 0x2a) return null;
    return { mediaType: "image/webp", width: u16le(b, at + 14) & 0x3fff, height: u16le(b, at + 16) & 0x3fff };
  }
  return null;
}

/**
 * The image's type and size from its own bytes (the header, never the name or what the sender said it is), or null
 * when it is not one of the four types or its header is cut short.
 */
export function sniffImage(b: Uint8Array): ImageInfo | null {
  let info: ImageInfo | null = null;
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, "PNG\r\n\x1a\n") && ascii(b, 12, "IHDR")) {
    info = { mediaType: "image/png", width: u32be(b, 16), height: u32be(b, 20) };
  } else if (b.length >= 10 && (ascii(b, 0, "GIF87a") || ascii(b, 0, "GIF89a"))) {
    info = { mediaType: "image/gif", width: u16le(b, 6), height: u16le(b, 8) };
  } else if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    info = jpeg(b);
  } else if (ascii(b, 0, "RIFF")) {
    info = webp(b);
  }
  return info && info.width > 0 && info.height > 0 ? info : null;
}

/** Why an image may not be stored, in words a reader can act on, or null when it may. */
export function imageProblem(b: Uint8Array): string | null {
  if (b.length === 0) return "the image is empty";
  if (b.length > IMAGE_BYTES_MAX) return `the image is ${Math.ceil(b.length / 1024)} KB; at most ${IMAGE_BYTES_MAX / 1024} KB`;
  const info = sniffImage(b);
  if (!info) return `not an image this app takes (${IMAGE_TYPES.map((t) => t.slice(6).toUpperCase()).join(", ")})`;
  if (Math.max(info.width, info.height) > IMAGE_EDGE) return `the image is ${info.width}×${info.height}; its longest edge is at most ${IMAGE_EDGE} px`;
  return null;
}

/** Base64 to bytes, in Bun and in a worker alike. Throws on text that is not base64. */
export function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Bytes to base64, for a model's image block. Chunked: spreading a megabyte into one call overflows the stack. */
export function toBase64(bytes: Uint8Array): string {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(raw);
}
