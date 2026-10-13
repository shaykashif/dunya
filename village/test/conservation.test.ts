import { describe, expect, it } from "vitest";
import { runSimulation } from "../src/sim.ts";
import { worldTotals } from "../src/world/items.ts";
import { ITEM_KINDS, type Inventory } from "../src/world/types.ts";

describe("14.3 conservation", () => {
  it("item totals change only through logged production and consumption", async () => {
    // Invariants (including conservation) are also checked by the engine every tick.
    const { engine } = await runSimulation({ seed: 42, days: 30, retainEvents: true });
    const events = engine.world.log.retained!;
    const created = events.find((e) => e.type === "scenario_created")!;
    const totals = { ...(created.data.totals as Inventory) };
    for (const e of events) {
      if (e.type === "produced") totals[e.data.kind as keyof Inventory] += e.data.qty as number;
      if (e.type === "consumed") totals[e.data.kind as keyof Inventory] -= e.data.qty as number;
    }
    const actual = worldTotals(engine.world);
    for (const k of ITEM_KINDS) expect(actual[k], k).toBe(totals[k]);
    expect(events.some((e) => e.type === "produced")).toBe(true);
    expect(events.some((e) => e.type === "consumed")).toBe(true);
  });
});
