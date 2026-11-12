// The landing page and the terms and privacy pages read in English without script, so each one's markup and its
// string table must say the same thing; and their one inline script must be index.html's, whose hash the hosted CSP
// already allows.
import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { TABLES } from "../../src/web/strings/index.js";

const read = (name) => readFileSync(new URL(`../../src/web/${name}`, import.meta.url), "utf8");
const index = read("index.html");
/** Each page, the table its own text comes from, how many texts it has at least, and the keys only script uses. */
const PAGES = [
  { name: "about", least: 25, scriptOnly: ["copied", "copy"] },
  { name: "terms", least: 30, scriptOnly: [] },
  { name: "privacy", least: 30, scriptOnly: [] },
  { name: "maps", least: 12, scriptOnly: ["by", "download", "failed", "meta", "open"] },
];

/** Each `data-t` element's text as written, by `table.key`, with a `data-slot` child read back as its `{slot}`. */
function tagged(html) {
  const out = new Map();
  for (const m of html.matchAll(/<(\w+)[^>]*\sdata-t="(\w+\.\w+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
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

for (const { name, least, scriptOnly } of PAGES) {
  const html = read(`${name}.html`);

  test(`every tagged text in ${name}.html is the English of its string table`, () => {
    const found = tagged(html);
    expect([...found.keys()].filter((k) => k.startsWith(`${name}.`)).length).toBeGreaterThan(least);
    for (const [key, text] of found) {
      const [table, id] = key.split(".");
      expect([key, text]).toEqual([key, TABLES[table].en[id]]);
    }
  });

  test(`every string of ${name} has a tagged element on a page, except what only script uses`, () => {
    // The landing page's table also holds the header and footer the three pages share.
    const found = new Set(PAGES.flatMap((p) => [...tagged(read(`${p.name}.html`)).keys()]));
    const unused = Object.keys(TABLES[name].en).filter((k) => !found.has(`${name}.${k}`));
    expect(unused.sort()).toEqual(scriptOnly);
  });

  test(`${name}.html's inline scripts are index.html's, so the hosted CSP hashes cover them`, () => {
    const inline = (page) => [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(inline(html).length).toBe(1);
    for (const s of inline(html)) expect(inline(index)).toContain(s);
  });
}

test("the legal pages link to each other, to support, and from the landing page", () => {
  for (const name of ["about", "terms", "privacy"]) {
    const html = read(`${name}.html`);
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
  }
  for (const name of ["terms", "privacy"]) expect(read(`${name}.html`)).toContain("mailto:support@archipelago.school");
});

// The home page declares /?ref=share, not /: Telegram files a preview under the declared address, and it holds an
// empty one for / from before the tags existed, which its own refresh bot does not clear.
test("every page carries what a link preview reads", () => {
  for (const [file, path] of [["index", "/?ref=share"], ["about", "/about"], ["maps", "/maps"], ["terms", "/terms"], ["privacy", "/privacy"]]) {
    const html = readFileSync(new URL(`../../src/web/${file}.html`, import.meta.url), "utf8");
    const og = (name) => html.match(new RegExp(`<meta property="og:${name}" content="([^"]+)">`))?.[1];
    expect([file, og("url")]).toEqual([file, `https://archipelago.school${path}`]);
    expect([file, og("image")]).toEqual([file, "https://archipelago.school/og.jpg"]);
    expect([file, Boolean(og("title") && og("description"))]).toEqual([file, true]);
    expect([file, html.includes('<meta name="twitter:card" content="summary_large_image">')]).toEqual([file, true]);
  }
  expect(existsSync(new URL("../../src/web/og.jpg", import.meta.url))).toBe(true);
});
