import { describe, expect, test } from "bun:test";
import { ctaKind, ctaView, ctaAction } from "../../src/web/cta-model.js";

const island = { slug: "caching", name: "Caching" };
const reef = { id: 7, proposal: { claim: "A cache never goes stale", status: "pending" } };
const verdict = { state: "settled", confidence: 0.8 };
const nearest = { slug: "queues", name: "Queues" };
const sketch = { id: 3, body: { islands: [{ slug: "q", name: "Queues", summary: "s", landmarks: [] }], straits: [], updates: [] } };
const start = { slug: "caching", name: "Caching", harbour: true };
const none = { island: null, pendingReef: null, verdict: null, inFlight: false, answering: false, stay: false, nearest: null, handoff: false, sketch: null, start: null, chartOpen: false };

describe("ctaKind", () => {
  test("nothing to do is no card", () => {
    expect(ctaKind(none)).toBeNull();
    expect(ctaView(none)).toBeNull();
  });

  test("a turn in flight hides every card", () => {
    expect(ctaKind({ ...none, island, pendingReef: reef, inFlight: true })).toBeNull();
    expect(ctaKind({ ...none, start, inFlight: true })).toBeNull();
  });

  test("a reef to confirm comes before a sketch, and a sketch before everything else", () => {
    expect(ctaKind({ ...none, island, pendingReef: reef, sketch, verdict, nearest })).toBe("reef");
    expect(ctaKind({ ...none, island, sketch, verdict, nearest })).toBe("sketch");
    expect(ctaKind({ ...none, sketch, start })).toBe("sketch");
  });

  test("a charted island offers the next one, until the reader stays", () => {
    expect(ctaKind({ ...none, island, verdict, nearest })).toBe("next");
    expect(ctaKind({ ...none, island, verdict, nearest, stay: true })).toBeNull();
    expect(ctaKind({ ...none, island, verdict })).toBeNull(); // nowhere left to sail
  });

  test("an island explored with the mentor hands off to the Keeper; a bare, untouched scale says where to begin", () => {
    expect(ctaKind({ ...none, island, handoff: true })).toBe("handoff");
    expect(ctaKind({ ...none, start })).toBe("start");
    expect(ctaKind({ ...none, island, start })).toBeNull(); // an island is open: the pane's briefing starts it
  });
});

describe("ctaView", () => {
  const filled = (view) => view.buttons.filter((b) => b.tone === "primary" || b.tone === "mentor");

  test("the reef card quotes the claim; confirm is the reef's outline and both wait while an answer is sent", () => {
    const view = ctaView({ ...none, island, pendingReef: reef });
    expect(view).toMatchObject({ kind: "reef", label: "reef?", text: "A cache never goes stale" });
    expect(view.buttons.map((b) => [b.id, b.tone, b.key, b.disabled])).toEqual([["confirm", "danger", "c", false], ["dispute", "ghost", "d", false]]);
    expect(filled(view)).toEqual([]);
    expect(ctaView({ ...none, island, pendingReef: reef, answering: true }).buttons.every((b) => b.disabled)).toBe(true);
  });

  test("the sketch card approves with ⌘↵, and offers to read it only while the cartographer is closed", () => {
    const view = ctaView({ ...none, sketch });
    expect(view.text).toBe("The cartographer's sketch: 1 island. Approve it to put it on the map.");
    expect(view.buttons.map((b) => [b.id, b.tone, b.key])).toEqual([["approve", "primary", "⌘↵"], ["read", "ghost", "c"]]);
    expect(ctaView({ ...none, sketch, chartOpen: true }).buttons.map((b) => b.id)).toEqual(["approve"]);
  });

  test("the next card names the island to sail to", () => {
    const view = ctaView({ ...none, island, verdict, nearest });
    expect(view.buttons.map((b) => [b.id, b.label, b.tone, b.key])).toEqual([["sail", "Sail to Queues", "primary", "s"], ["stay", "Stay here", "ghost", undefined]]);
    expect(view.text).toBeNull();
  });

  test("where to begin: the mentor's button in the mentor's colour, the Keeper's an outline", () => {
    const view = ctaView({ ...none, start });
    expect(view.text).toBe("This map sets out from Caching. Or pick any island on the map.");
    expect(ctaView({ ...none, start: { ...start, harbour: false } }).text).toBe("Start at Caching, or pick any island on the map.");
    expect(view.buttons.map((b) => [b.id, b.tone, b.key])).toEqual([["mentor", "mentor", "1"], ["keeper", "ghost", "2"]]);
  });

  test("the hand-off says the Keeper, never the judge, and carries the lens key", () => {
    const view = ctaView({ ...none, island, handoff: true });
    expect(view.buttons).toHaveLength(1);
    expect(view.buttons[0]).toMatchObject({ id: "handoff", label: "Chart it with the Keeper", tone: "primary", key: "m" });
  });

  test("no card fills more than one button, and every key on a card is its own", () => {
    const views = [
      ctaView({ ...none, island, pendingReef: reef }),
      ctaView({ ...none, sketch }),
      ctaView({ ...none, island, verdict, nearest }),
      ctaView({ ...none, island, handoff: true }),
      ctaView({ ...none, start }),
    ];
    for (const view of views) {
      expect(filled(view).length).toBeLessThanOrEqual(1);
      const keys = view.buttons.map((b) => b.key).filter(Boolean);
      expect(new Set(keys).size).toBe(keys.length);
      for (const b of view.buttons) if (b.key) expect(b.tip.length).toBeGreaterThan(10); // a key is shown in the button's tip
    }
  });

  test("the same model draws the same card: a snapshot that changes nothing leaves it alone", () => {
    const model = { ...none, island, pendingReef: reef };
    expect(JSON.stringify(ctaView({ ...model, onConfirm: () => {} }))).toBe(JSON.stringify(ctaView({ ...model, onConfirm: () => {} })));
    expect(JSON.stringify(ctaView({ ...model, answering: true }))).not.toBe(JSON.stringify(ctaView(model)));
  });
});

describe("ctaAction", () => {
  test("every button of every card has a handler on the model", () => {
    const model = { ...none, island, sketch, nearest, start };
    expect(ctaAction(model, "confirm")).toEqual(["onConfirm"]);
    expect(ctaAction(model, "dispute")).toEqual(["onDispute"]);
    expect(ctaAction(model, "approve")).toEqual(["onApproveSketch", 3]);
    expect(ctaAction(model, "read")).toEqual(["onOpenChart"]);
    expect(ctaAction(model, "sail")).toEqual(["onSail", "queues"]);
    expect(ctaAction(model, "stay")).toEqual(["onStay"]);
    expect(ctaAction(model, "handoff")).toEqual(["onHandoff"]);
    expect(ctaAction(model, "mentor")).toEqual(["onStart", "caching", "mentor"]);
    expect(ctaAction(model, "keeper")).toEqual(["onStart", "caching", "judge"]);
    expect(ctaAction(model, "nope")).toBeNull();
  });
});
