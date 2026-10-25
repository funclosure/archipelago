// The landing page reads in English without script, so its markup and strings/about.js must say the same thing;
// and its one inline script must be index.html's, whose hash the hosted CSP already allows.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import strings from "../../src/web/strings/about.js";

const html = readFileSync(new URL("../../src/web/about.html", import.meta.url), "utf8");
const index = readFileSync(new URL("../../src/web/index.html", import.meta.url), "utf8");

/** Each `data-t` element's text as written, with a `data-slot` child read back as its `{slot}`. */
function tagged() {
  const out = new Map();
  for (const m of html.matchAll(/<(\w+)[^>]*\sdata-t="about\.(\w+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    const text = m[3]
      .replace(/<(\w+)[^>]*\sdata-slot="(\w+)"[^>]*>[\s\S]*?<\/\1>/g, "{$2}")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    out.set(m[2], text);
  }
  return out;
}

test("every tagged text in about.html is the English of strings/about.js", () => {
  const found = tagged();
  expect(found.size).toBeGreaterThan(25);
  for (const [key, text] of found) expect(text).toBe(strings.en[key]);
});

test("every string the page swaps in has a tagged element, except the Copy button's", () => {
  const found = tagged();
  const unused = Object.keys(strings.en).filter((k) => !found.has(k));
  expect(unused.sort()).toEqual(["copied", "copy"]);
});

test("its inline scripts are index.html's, so the hosted CSP hashes cover them", () => {
  const inline = (page) => [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  expect(inline(html).length).toBe(1);
  for (const s of inline(html)) expect(inline(index)).toContain(s);
});
