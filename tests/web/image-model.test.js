// The page's half of the reader's images, the pure parts: the limits match the server's, which files a message takes,
// how an image is shrunk, a thumbnail's box, sizes in words; and a reader's message keeps its images in the log.
import { test, expect } from "bun:test";
import * as page from "../../src/web/image-model.js";
import * as server from "../../src/core/images.ts";
import { threadItems, logItems } from "../../src/web/thread.js";

test("the page's limits are the server's", () => {
  expect(page.IMAGE_TYPES).toEqual([...server.IMAGE_TYPES]);
  expect(page.IMAGES_PER_MESSAGE).toBe(server.IMAGES_PER_MESSAGE);
  expect(page.IMAGE_EDGE).toBe(server.IMAGE_EDGE);
  expect(page.IMAGE_BYTES_MAX).toBe(server.IMAGE_BYTES_MAX);
});

test("admit takes images up to four a message, and says why the first one left out was", () => {
  const file = (type, name = "x") => ({ type, name });
  expect(page.admit([file("image/png"), file("image/heic")], 0)).toEqual({ take: [file("image/png"), file("image/heic")], refused: null });
  expect(page.admit([file("application/pdf", "notes.pdf"), file("image/png")], 0)).toEqual({ take: [file("image/png")], refused: { reason: "notImage", name: "notes.pdf" } });
  expect(page.admit([file("image/png", "a"), file("image/png", "b")], 3)).toEqual({ take: [file("image/png", "a")], refused: { reason: "tooMany", name: "b" } });
  expect(page.admit([file("image/png")], 4).take).toEqual([]);
});

test("fitWithin keeps the shape inside the edge, and leaves a small image alone", () => {
  expect(page.fitWithin(3136, 1960)).toEqual({ width: 1568, height: 980 });
  expect(page.fitWithin(1000, 4000)).toEqual({ width: 392, height: 1568 });
  expect(page.fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  expect(page.fitWithin(10000, 1)).toEqual({ width: 1568, height: 1 });
});

test("keepAsIs: a small PNG, GIF or WebP within the edge goes as it is; a JPEG is always drawn again (its EXIF goes)", () => {
  const small = { size: 120 * 1024, width: 1200, height: 800 };
  expect(page.keepAsIs({ type: "image/png", ...small })).toBe(true);
  expect(page.keepAsIs({ type: "image/webp", ...small })).toBe(true);
  expect(page.keepAsIs({ type: "image/jpeg", ...small })).toBe(false);
  expect(page.keepAsIs({ type: "image/png", ...small, size: 400 * 1024 })).toBe(false);
  expect(page.keepAsIs({ type: "image/png", ...small, width: 2000 })).toBe(false);
  expect(page.keepAsIs({ type: "image/heic", ...small })).toBe(false);
});

test("thumbBox: the image's shape at the thumbnail's height, narrowed when wide, never taller than the image", () => {
  expect(page.thumbBox(1568, 980)).toEqual({ width: 192, height: 120 });
  expect(page.thumbBox(4000, 400)).toEqual({ width: 320, height: 32 });
  expect(page.thumbBox(40, 30)).toEqual({ width: 40, height: 30 });
  expect(page.thumbBox(1568, 980, { height: 200, maxWidth: 1000 })).toEqual({ width: 320, height: 200 });
});

test("formatBytes and isStorageFull", () => {
  expect([0, 812, 340 * 1024, 1.2 * 1024 * 1024, 42 * 1024 * 1024].map(page.formatBytes)).toEqual(["0 B", "812 B", "340 KB", "1.2 MB", "42 MB"]);
  expect(page.isStorageFull("database or disk is full")).toBe(true);
  expect(page.isStorageFull("QuotaExceededError: The quota has been exceeded.")).toBe(true);
  expect(page.isStorageFull("not an image")).toBe(false);
});

test("a reader's message keeps its images in the log, words or none", () => {
  const images = [{ id: 7, width: 10, height: 8, removed: false }];
  const messages = [
    { id: 1, role: "you", kind: "text", body: "", images },
    { id: 2, role: "mentor", kind: "text", body: "I see a cache.", images: [] },
  ];
  expect(threadItems(messages)[0]).toMatchObject({ id: 1, text: "", images });
  expect("images" in threadItems(messages)[1]).toBe(false);
  expect(logItems(messages, null)[0].images).toEqual(images);
});
