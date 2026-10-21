import { test, expect } from "bun:test";
import { buildNodes, WORLD } from "../../src/web/view-model.js";
import { createSimulation } from "../../src/web/layout.js";

const island = (slug) => ({
  slug, name: slug, summary: null, hasChildren: false, verdict: null, x: null, y: null,
  children: { total: 0, byState: { sandbar: 0, settled: 0, mountainous: 0, reef: 0, open: 0 } },
});
const snapshot = (islands, straits = []) => ({
  version: 1, domain: { slug: "sd", name: "SD" }, scale: { path: [] }, islands, straits, focus: null, unreadComments: 0, nearestOpenWater: [], reefs: [],
});

test("the simulation settles on its own and draws a stray island toward the centre; there are no walls", () => {
  const nodes = buildNodes(snapshot([island("a"), island("b")]));
  const a = nodes.find((n) => n.slug === "a");
  a.x = -500;
  a.y = 2000;

  const sim = createSimulation();
  sim.setCenter(500, 500);
  sim.setGraph(nodes, [], 1);

  let ticks = 0;
  let settled = false;
  while (ticks < 5000) {
    ticks++;
    if (!sim.tick()) {
      settled = true;
      break;
    }
  }

  expect(settled).toBe(true);
  for (const n of nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
  // a started at (-500, 2000): nothing clamps it, and gravity has drawn it in
  expect(Math.hypot(a.x - 500, a.y - 500)).toBeLessThan(Math.hypot(-500 - 500, 2000 - 500));
});
