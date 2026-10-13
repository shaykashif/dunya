// Set pieces on a cleared patch of a real map: sight through hedgerows, cover,
// suppression, and the wound system carried over from the village.
import { describe, expect, it } from "vitest";
import { hitChance } from "../src/combat/fire.ts";
import { cannotWalk, mobility, outOfAction } from "../src/entities/body.ts";
import { healDay, injure, treat, updateInjuries } from "../src/entities/injuries.ts";
import { suppress } from "../src/entities/morale.ts";
import { createSimulation } from "../src/sim.ts";
import type { Soldier } from "../src/world/types.ts";
import type { World } from "../src/world/world.ts";

function setup(): { w: World; us: Soldier; de: Soldier } {
  const w = createSimulation({ seed: 3 }).world;
  return { w, us: w.soldiers.find((s) => s.side === "us" && s.role === "rifleman")!, de: w.soldiers.find((s) => s.side === "de" && s.role === "rifleman")! };
}

/** Clears a patch of ground, with a hedge across it at row `hedgeY`. */
function field(w: World, x0: number, y0: number, x1: number, y1: number, hedgeY: number | null): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.map.set(x, y, y === hedgeY ? "hedge" : "grass");
  w.map.finalize();
}

describe("sight and cover", () => {
  it("a hedgerow blocks sight, except for a man right against it", () => {
    const { w, us, de } = setup();
    field(w, 10, 10, 40, 40, 25);
    w.place(de, 20, 20);
    w.place(us, 20, 35);
    expect(w.map.visibility(us.x, us.y, de.x, de.y)).toBe(0);
    w.place(de, 20, 24);
    const through = w.map.visibility(us.x, us.y, de.x, de.y);
    expect(through).toBeGreaterThan(0.2);
    expect(through).toBeLessThan(1);
  });

  it("the hedge protects against fire from in front, not from the flank", () => {
    const { w, us, de } = setup();
    field(w, 10, 10, 50, 40, 25);
    w.place(de, 30, 24);
    de.posture = "crouch";
    w.place(us, 30, 34);
    const spec = w.config.weapons.m1_garand;
    const front = hitChance(w, us, de, spec, w.map.visibility(us.x, us.y, de.x, de.y));
    w.place(us, 42, 22);
    const flank = hitChance(w, us, de, spec, w.map.visibility(us.x, us.y, de.x, de.y));
    expect(flank).toBeGreaterThan(front * 3);
  });

  it("lying down makes a man much harder to hit", () => {
    const { w, us, de } = setup();
    field(w, 10, 10, 40, 40, null);
    w.place(de, 20, 15);
    w.place(us, 20, 35);
    const spec = w.config.weapons.kar98k;
    us.posture = "stand";
    const standing = hitChance(w, de, us, spec, 1);
    us.posture = "prone";
    expect(hitChance(w, de, us, spec, 1)).toBeLessThan(standing * 0.5);
  });

  it("enough fire pins a man", () => {
    const { w, us } = setup();
    for (let i = 0; i < 12; i++) suppress(w, us, 0.07);
    expect(us.suppression).toBeGreaterThan(w.config.suppression.pinned);
  });
});

describe("wounds (the village's health system)", () => {
  it("an untended gunshot to the body bleeds a man to death within minutes", () => {
    const { w, us } = setup();
    injure(w, us, "torso", "gunshot", 0.9, "test", null, 0.45);
    let ticks = 0;
    while (us.status !== "dead" && ticks < 3600) {
      updateInjuries(w);
      w.tick++;
      ticks++;
    }
    expect(us.status).toBe("dead");
    expect(us.causeOfDeath).toBe("wounds");
    expect(ticks).toBeLessThan(20 * 60);
  });

  it("a medic stops the bleeding and gives morphine", () => {
    const { w, us } = setup();
    const medic = w.soldiers.find((s) => s.side === "us" && s.role === "medic")!;
    injure(w, us, "left leg", "gunshot", 0.8, "test", null, 0.16);
    expect(us.injuries[0]!.bleeding).toBeGreaterThan(0);
    for (let tries = 0; tries < 10 && us.injuries.some((i) => i.bleeding > 0); tries++) treat(w, medic, us, w.rng.get("injuries"), "test");
    expect(us.injuries.every((i) => i.bleeding === 0)).toBe(true);
    expect(us.morphineTick).toBeGreaterThanOrEqual(0);
  });

  it("a broken leg puts a man down: he cannot walk", () => {
    const { w, us } = setup();
    injure(w, us, "right leg", "fracture", 0.85, "test", null, 0.1);
    expect(cannotWalk(us)).toBe(true);
    expect(mobility(us)).toBe(0);
    expect(outOfAction(us, w.config.injuries.painOut)).toBe(true);
  });

  it("wounds mend over the following weeks, sometimes into something lasting", () => {
    const { w } = setup();
    const rng = w.rng.get("aftermath");
    let lasting = 0;
    for (const s of w.soldiers.slice(0, 30)) {
      injure(w, s, "left leg", "fracture", 0.8, "test", null, 0.1);
      injure(w, s, "face", "shrapnel", 0.6, "test", null, 0.1);
      for (let d = 0; d < 80; d++) healDay(w, s, rng, 0);
      expect(s.injuries.every((i) => i.permanent)).toBe(true);
      if (s.injuries.length > 0) lasting++;
    }
    expect(lasting).toBeGreaterThan(5);
  });
});
