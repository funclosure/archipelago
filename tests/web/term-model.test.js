import { expect, test } from "bun:test";
import { deriveTerms, landmarkTerms, termRuns } from "../../src/web/term-model.js";

test("deriveTerms cuts a landmark's name into the words a reply would use", () => {
  expect(deriveTerms("Indexes: B-trees vs LSM trees")).toEqual(["Index", "B-tree", "LSM tree", "LSM"]);
  expect(deriveTerms("Relational vs NoSQL families")).toEqual(["Relational", "NoSQL family", "NoSQL"]);
  expect(deriveTerms("OLTP, OLAP, and warehouses")).toEqual(["OLTP", "OLAP", "warehouse"]);
  expect(deriveTerms("索引與分區")).toEqual(["索引", "分區"]);
  expect(deriveTerms("Why")).toEqual(["Why"]);
});

test("landmarkTerms prefers a landmark's own terms, longest first, each word kept by its first landmark", () => {
  const terms = landmarkTerms([
    { slug: "indexes", name: "Indexes: B-trees vs LSM trees", terms: ["索引", "B-tree", "LSM tree"] },
    { slug: "relational", name: "Relational vs NoSQL", terms: [] },
    { slug: "dup", name: "Dup", terms: ["b-tree"] },
  ]);
  expect(terms.map((t) => [t.term, t.slug])).toEqual([
    ["Relational", "relational"], ["LSM tree", "indexes"], ["B-tree", "indexes"], ["NoSQL", "relational"], ["索引", "indexes"],
  ]);
});

test("termRuns marks whole Latin words (plurals too) and Chinese anywhere, joining back to the text", () => {
  const terms = landmarkTerms([{ slug: "idx", name: "Indexes", terms: ["索引", "B-tree", "LSM tree", "index"] }]);
  const text = "索引(B-tree 與 LSM trees)常被追問; indexing is not an index.";
  const runs = termRuns(text, terms);
  expect(runs.map((r) => r.text).join("")).toBe(text);
  expect(runs.filter((r) => r.slug).map((r) => r.text)).toEqual(["索引", "B-tree", "LSM trees", "index"]);
  expect(runs.find((r) => r.slug).name).toBe("Indexes");
  expect(termRuns("plain", [])).toEqual([{ text: "plain" }]);
  expect(termRuns("", terms)).toEqual([]);
});
