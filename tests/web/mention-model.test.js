import { test, expect } from "bun:test";
import { bareName, mentionHref, mentionIndex, mentionOf, mentionRuns, mentionSig } from "../../src/web/mention-model.js";

const PLACES = {
  domains: [
    { slug: "cc", name: "Creative Coding" },
    { slug: "sd", name: "System Design" },
    { slug: "db", name: "Databases" },
    { slug: "zh", name: "分散式系統" },
  ],
  islands: [
    { domain: "cc", slug: "draw-loop", name: "The Draw Loop", scale: null, state: null },
    { domain: "cc", slug: "shaders", name: "Shaders", scale: null, state: null },
    { domain: "cc", slug: "frames", name: "Frames", scale: "draw-loop", state: null },
    { domain: "sd", slug: "scalability", name: "Scalability", scale: null, state: "settled" },
    { domain: "sd", slug: "caching", name: "Caching", scale: null, state: "sandbar" },
    { domain: "db", slug: "caching", name: "Caching", scale: null, state: null },
    { domain: "db", slug: "indexes", name: "Indexes", scale: null, state: "mountainous" },
    { domain: "sd", slug: "indexes", name: "Indexes", scale: null, state: "settled" },
    { domain: "sd", slug: "the-draw-loop", name: "The Draw Loop", scale: null, state: "settled" },
    { domain: "zh", slug: "cache", name: "快取", scale: null, state: "settled" },
  ],
};
const here = mentionIndex(PLACES, { domain: "cc", island: "draw-loop" });

test("a bold or italic span names an island in another domain, case and quotes aside", () => {
  expect(mentionOf(here, "Scalability")).toMatchObject({ kind: "island", domain: "sd", domainName: "System Design", slug: "scalability", scale: null, near: false });
  expect(mentionOf(here, "scalability")?.slug).toBe("scalability");
  expect(mentionOf(here, "Scalability island")?.slug).toBe("scalability");
  expect(mentionOf(here, "「快取」")).toMatchObject({ domain: "zh", slug: "cache" });
  expect(mentionOf(here, "快取島")).toMatchObject({ domain: "zh", slug: "cache" });
  expect(mentionOf(here, "stateless")).toBeNull();
  expect(mentionOf(null, "Scalability")).toBeNull();
});

test("an island in this domain is linked too, at its own scale", () => {
  expect(mentionOf(here, "Frames")).toMatchObject({ domain: "cc", slug: "frames", scale: "draw-loop", near: true });
  expect(mentionOf(here, "Shaders")?.near).toBe(true);
});

test("a name says which island it means, or nothing: this domain's, the only one, the only one on solid ground", () => {
  // Caching: sd (sandbar) and db (open water), neither in this domain nor ground: no link rather than a guess.
  expect(mentionOf(here, "Caching")).toBeNull();
  // Indexes: ground in both domains: still no guess.
  expect(mentionOf(here, "Indexes")).toBeNull();
  const onlyGround = mentionIndex({ ...PLACES, islands: PLACES.islands.filter((i) => !(i.domain === "sd" && i.slug === "indexes")) }, { domain: "cc", island: "draw-loop" });
  expect(mentionOf(onlyGround, "Indexes")?.domain).toBe("db");
  // In the database domain its own Caching wins.
  const inDb = mentionIndex(PLACES, { domain: "db", island: "indexes" });
  expect(mentionOf(inDb, "Caching")).toMatchObject({ domain: "db", near: true });
});

test("never the island the reply is about, its domain, or another place that shares their names", () => {
  // On The Draw Loop in Creative Coding, System Design's island of the same name is not linked either.
  expect(mentionOf(here, "The Draw Loop")).toBeNull();
  expect(mentionOf(here, "Creative Coding")).toBeNull();
  // In the cartographer's pane (no island) the same name is an island of this domain.
  const pane = mentionIndex(PLACES, { domain: "cc", island: null });
  expect(mentionOf(pane, "The Draw Loop")).toMatchObject({ domain: "cc", slug: "draw-loop" });
});

test("a domain's name links to that domain; with the word domain it wins over an island of the same name", () => {
  expect(mentionOf(here, "System Design")).toMatchObject({ kind: "domain", domain: "sd", domainName: "System Design" });
  const sd = mentionIndex({ ...PLACES, islands: [...PLACES.islands, { domain: "cc", slug: "databases", name: "Databases", scale: null, state: null }] }, { domain: "cc", island: "draw-loop" });
  expect(mentionOf(sd, "Databases")).toMatchObject({ kind: "island", domain: "cc" });
  expect(mentionOf(sd, "Databases domain")).toMatchObject({ kind: "domain", domain: "db" });
});

test("in plain text a name counts only before island, islet or domain, and the link is the name alone", () => {
  const runs = mentionRuns("One analogy, from your Scalability island: think of draw() as stateless. Scalability matters.", here);
  expect(runs.map((r) => r.text).join("")).toBe("One analogy, from your Scalability island: think of draw() as stateless. Scalability matters.");
  expect(runs.filter((r) => r.target).map((r) => [r.text, r.target.slug])).toEqual([["Scalability", "scalability"]]);
  const domain = mentionRuns("It's the one in your System Design domain, not this one.", here);
  expect(domain.filter((r) => r.target).map((r) => [r.text, r.target.kind])).toEqual([["System Design", "domain"]]);
  const zh = mentionRuns("借用你在「快取」島上學到的東西，還有分散式系統領域。", here);
  expect(zh.filter((r) => r.target).map((r) => r.text)).toEqual(["快取", "分散式系統"]);
  // Inside a longer word, or with nothing after it, a name is just a word.
  expect(mentionRuns("Unscalability islands are rare", here).some((r) => r.target)).toBe(false);
  expect(mentionRuns("frames per second", here).some((r) => r.target)).toBe(false);
  expect(mentionRuns("the Frames islet", here).find((r) => r.target)?.target.slug).toBe("frames");
  expect(mentionRuns("", here)).toEqual([]);
  expect(mentionRuns("Scalability island", null)).toEqual([{ text: "Scalability island" }]);
});

test("bareName takes off quotes and the kind word", () => {
  expect(bareName(" Scalability island ")).toBe("Scalability");
  expect(bareName("System Design domain")).toBe("System Design");
  expect(bareName("「快取」島")).toBe("快取");
  expect(bareName("“Caching”")).toBe("Caching");
});

test("the sig changes with what is linked, not with a verdict that links nothing new", () => {
  const sig = mentionSig(here);
  const later = mentionIndex({ ...PLACES, islands: PLACES.islands.map((i) => (i.slug === "scalability" ? { ...i, state: "mountainous" } : i)) }, { domain: "cc", island: "draw-loop" });
  expect(mentionSig(later)).toBe(sig);
  const renamed = mentionIndex({ ...PLACES, islands: PLACES.islands.map((i) => (i.slug === "scalability" ? { ...i, name: "Scaling" } : i)) }, { domain: "cc", island: "draw-loop" });
  expect(mentionSig(renamed)).not.toBe(sig);
  expect(mentionSig(null)).toBe("");
});

test("an island opens at its scale in its domain, a domain at its top", () => {
  expect(mentionHref(mentionOf(here, "Scalability"))).toBe("/?domain=sd&island=scalability");
  expect(mentionHref(mentionOf(here, "Frames"))).toBe("/?domain=cc&scale=draw-loop&island=frames");
  expect(mentionHref(mentionOf(here, "System Design"))).toBe("/?domain=sd");
});
