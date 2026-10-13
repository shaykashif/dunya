import { describe, expect, it } from "vitest";
import { Rng } from "../src/engine/rng.ts";
import { runSimulation } from "../src/sim.ts";

describe("determinism", () => {
  it("same seed gives identical event-stream hashes", async () => {
    const a = await runSimulation({ seed: 42, ticks: 500 });
    const b = await runSimulation({ seed: 42, ticks: 500 });
    expect(a.summary.hash).toBe(b.summary.hash);
    expect(a.summary.events).toBe(b.summary.events);
  });

  it("different seeds give different battles", async () => {
    const a = await runSimulation({ seed: 42, ticks: 200 });
    const b = await runSimulation({ seed: 43, ticks: 200 });
    expect(a.summary.hash).not.toBe(b.summary.hash);
  });

  it("rng streams are independent and reproducible", () => {
    const a = new Rng(7, "fire"), b = new Rng(7, "fire"), c = new Rng(7, "perception");
    const xs = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(xs);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(xs);
  });
});
