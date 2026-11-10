import { expect, test } from "bun:test";
import { keyedChildren, patchChildren } from "../../src/web/keep.js";

/** The few DOM calls keep.js makes, on plain objects, counting every time a node leaves or enters its parent. */
function fakeParent() {
  const parent = {
    kids: [],
    moves: [],
    get childNodes() { return this.kids; },
    get firstChild() { return this.kids[0] ?? null; },
    removeChild(node) {
      this.kids.splice(this.kids.indexOf(node), 1);
      node.parentNode = null;
      this.moves.push(`-${node.name}`);
    },
    insertBefore(node, before) {
      if (node.parentNode === this) this.removeChild(node);
      const at = before ? this.kids.indexOf(before) : this.kids.length;
      this.kids.splice(at, 0, node);
      node.parentNode = this;
      this.moves.push(`+${node.name}`);
    },
  };
  return parent;
}
const node = (name) => ({ name, parentNode: null, get nextSibling() { const k = this.parentNode.kids; return k[k.indexOf(this) + 1] ?? null; } });
const names = (parent) => parent.kids.map((k) => k.name).join(" ");

test("patchChildren leaves a node that is already in place alone", () => {
  const parent = fakeParent();
  const [a, b, c, d] = ["a", "b", "c", "d"].map(node);
  patchChildren(parent, [a, b, c]);
  parent.moves.length = 0;
  patchChildren(parent, [d, a, c, node("e")]);
  expect(names(parent)).toBe("d a c e");
  expect(parent.moves).toEqual(["-b", "+d", "+e"]); // a and c never left
});

test("keyedChildren keeps a node while its signature holds and builds it again when it changes", () => {
  const parent = fakeParent();
  let built = 0;
  const entry = (key, sig) => ({ key, sig, build: () => node(`${key}@${sig}#${++built}`) });
  keyedChildren(parent, [entry("one", "x"), entry("two", "x")]);
  const [one, two] = parent.kids;
  keyedChildren(parent, [entry("one", "x"), entry("two", "y"), entry("three", "x")]);
  expect(parent.kids[0]).toBe(one);
  expect(parent.kids[1]).not.toBe(two);
  expect(names(parent)).toBe("one@x#1 two@y#3 three@x#4");
  expect(parent.moves.includes(`-${one.name}`)).toBe(false);
});

test("keyedChildren builds an entry with no key every time, and a repeated key only once kept", () => {
  const parent = fakeParent();
  let built = 0;
  const loose = () => ({ build: () => node(`loose#${++built}`) });
  const keyed = () => ({ key: 1, sig: "s", build: () => node(`k#${++built}`) });
  keyedChildren(parent, [loose(), keyed(), keyed()]);
  const first = parent.kids[1];
  keyedChildren(parent, [loose(), keyed(), keyed()]);
  expect(parent.kids[1]).toBe(first);
  expect(parent.kids[0].name).toBe("loose#4");
  expect(parent.kids.length).toBe(3);
});
