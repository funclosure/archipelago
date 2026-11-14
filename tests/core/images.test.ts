// Reading an image's real type and size from its bytes. The fixtures come from real encoders: ffmpeg (PNG, JPEG, GIF)
// and Chrome's canvas (WebP, as the page will make them), plus the simple WebP layouts lifted out of those.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { IMAGE_BYTES_MAX, IMAGE_EDGE, fromBase64, imageProblem, sniffImage, toBase64 } from "../../src/core/images.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/images/${name}`, import.meta.url)));

test("every fixture reads as its type at 7×5", () => {
  const cases: [string, string][] = [
    ["px.png", "image/png"],
    ["px.jpg", "image/jpeg"],
    ["px.gif", "image/gif"],
    ["px-lossy.webp", "image/webp"], // VP8X wrapping VP8, with an ICC profile
    ["px-alpha.webp", "image/webp"], // VP8X with ALPH
    ["px-lossless.webp", "image/webp"], // VP8X wrapping VP8L
    ["px-lossy-simple.webp", "image/webp"], // VP8
    ["px-lossless-simple.webp", "image/webp"], // VP8L
  ];
  for (const [name, mediaType] of cases) expect([name, sniffImage(fixture(name))]).toEqual([name, { mediaType, width: 7, height: 5 }] as never);
});

test("a progressive JPEG, and one whose frame comes after fill bytes and an EXIF segment, still read", () => {
  // SOI, APP1 (EXIF, 6 bytes of payload), fill bytes, SOF2 (progressive): 1200 high, 1568 wide.
  const progressive = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 69, 120, 105, 102, 0, 0, 0xff, 0xff, 0xff, 0xc2, 0x00, 0x11, 0x08, 0x04, 0xb0, 0x06, 0x20, 0x03]);
  expect(sniffImage(progressive)).toEqual({ mediaType: "image/jpeg", width: 1568, height: 1200 });
});

test("anything else is not an image: SVG, HTML, a renamed text file, a header cut short, a zero size", () => {
  const text = (s: string) => new TextEncoder().encode(s);
  expect(sniffImage(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
  expect(sniffImage(text("<!doctype html><title>x</title>"))).toBeNull();
  expect(sniffImage(text("GIF8"))).toBeNull();
  expect(sniffImage(fixture("px.png").slice(0, 20))).toBeNull();
  expect(sniffImage(fixture("px-lossy-simple.webp").slice(0, 24))).toBeNull();
  expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]))).toBeNull(); // a scan before any frame
  const empty = fixture("px.gif");
  empty[6] = empty[7] = 0; // width 0
  expect(sniffImage(empty)).toBeNull();
});

test("imageProblem says why, in words: empty, too heavy, not an image, too large an edge", () => {
  expect(imageProblem(fixture("px.png"))).toBeNull();
  expect(imageProblem(new Uint8Array())).toBe("the image is empty");
  expect(imageProblem(new Uint8Array(IMAGE_BYTES_MAX + 1))).toContain("at most 1024 KB");
  expect(imageProblem(new TextEncoder().encode("<svg/>"))).toContain("PNG, JPEG, WEBP, GIF");
  const wide = fixture("px.png");
  wide.set([0, 0, (IMAGE_EDGE + 1) >> 8, (IMAGE_EDGE + 1) & 0xff], 16);
  expect(imageProblem(wide)).toBe(`the image is ${IMAGE_EDGE + 1}×5; its longest edge is at most ${IMAGE_EDGE} px`);
});

test("base64 goes there and back, also for a megabyte", () => {
  const big = new Uint8Array(IMAGE_BYTES_MAX).map((_, i) => (i * 31) & 0xff);
  expect(fromBase64(toBase64(big))).toEqual(big);
  expect(toBase64(fixture("px.png"))).toBe(Buffer.from(fixture("px.png")).toString("base64"));
  expect(() => fromBase64("not base64!")).toThrow();
});
