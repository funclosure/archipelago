// Keeping what is already on the page. A rebuild that makes every node again restarts whatever was running in
// them: a demo's frame reloads the moment it leaves the document, so its state is gone. These two helpers let a
// list be redrawn while the nodes whose content has not changed stay exactly where they are, never detached.

/**
 * Makes `parent`'s children exactly `nodes`, in order. A node already there, in the same order, is not touched
 * (never removed and put back); the others are removed or inserted around it.
 */
export function patchChildren(parent, nodes) {
  const want = new Set(nodes);
  for (const child of [...parent.childNodes]) if (!want.has(child)) parent.removeChild(child);
  let cursor = parent.firstChild;
  for (const node of nodes) {
    if (node === cursor) cursor = cursor.nextSibling;
    else parent.insertBefore(node, cursor);
  }
}

const kept = new WeakMap(); // parent → Map(key → { sig, node })

/**
 * Redraws a keyed list into `parent`. Each entry is `{ key, sig, build }`: the node built for `key` is kept while
 * `sig` (a string of everything its content depends on) stays the same, and built again when it changes. An entry
 * with no key is built every time.
 */
export function keyedChildren(parent, entries) {
  const old = kept.get(parent) ?? new Map();
  const next = new Map();
  const nodes = entries.map((entry) => {
    if (entry.key === undefined || entry.key === null || next.has(entry.key)) return entry.build();
    const had = old.get(entry.key);
    const node = had && had.sig === entry.sig && had.node.parentNode === parent ? had.node : entry.build();
    next.set(entry.key, { sig: entry.sig, node });
    return node;
  });
  kept.set(parent, next);
  patchChildren(parent, nodes);
}
