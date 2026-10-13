import { describe, expect, it } from "vitest";
import { runSimulation } from "../src/sim.ts";
import { Rng } from "../src/engine/rng.ts";

describe("14.1 determinism", () => {
  it("same seed gives identical event-stream hashes", async () => {
    const a = await runSimulation({ seed: 42, days: 12 });
    const b = await runSimulation({ seed: 42, days: 12 });
    expect(a.summary.hash).toBe(b.summary.hash);
    expect(a.summary.events).toBe(b.summary.events);
  });

  it("different seeds give different streams", async () => {
    const a = await runSimulation({ seed: 42, days: 3 });
    const b = await runSimulation({ seed: 43, days: 3 });
    expect(a.summary.hash).not.toBe(b.summary.hash);
  });

  it("rng streams are independent and reproducible", () => {
    const a = new Rng(7, "weather"), b = new Rng(7, "weather"), c = new Rng(7, "actions");
    const xs = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(xs);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(xs);
  });
});
