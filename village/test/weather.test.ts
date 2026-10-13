import { describe, expect, it } from "vitest";
import { createTrace, updateTraces } from "../src/world/traces.ts";
import { freshWorld } from "./helpers.ts";

describe("14.13 weather effects", () => {
  function setup(weather: "rain" | "clear" | "snow") {
    const w = freshWorld(42);
    const house = w.house(0);
    const outside = createTrace(w, "footprint", { ...w.map.square }, [], { size: "large" }, null);
    const inside = createTrace(w, "footprint", { ...house.bed }, [], { size: "large" }, null);
    expect(outside.roofed).toBe(false);
    expect(inside.roofed).toBe(true);
    w.env.weather = weather;
    for (let i = 0; i < w.config.traces.rainClearTicks + 1; i++) {
      updateTraces(w);
      w.tick++;
    }
    return { w, outside, inside };
  }

  it("rain clears footprints on open ground after the configured time but not under a roof", () => {
    const { w, outside, inside } = setup("rain");
    expect(w.traces).not.toContain(outside);
    expect(w.traces).toContain(inside);
    expect(w.log.retained!.some((e) => e.type === "trace_removed" && e.data.trace === outside.id && e.data.reason === "rain")).toBe(true);
  });

  it("snow clears them too, dry weather does not", () => {
    expect(setup("snow").w.traces.map((t) => t.roofed)).toEqual([true]);
    expect(setup("clear").w.traces.length).toBe(2);
  });
});
