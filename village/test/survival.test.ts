import { describe, expect, it } from "vitest";
import { updateNeeds } from "../src/entities/needs.ts";
import { updateEnvironment } from "../src/world/environment.ts";
import type { Person } from "../src/world/types.ts";
import type { World } from "../src/world/world.ts";
import { freshWorld } from "./helpers.ts";

/** Advances only the clock and needs, holding chosen survival values fixed. */
function tickNeeds(w: World, hold: (p: Person) => void): void {
  for (const p of w.people) if (p.alive) hold(p);
  updateEnvironment(w);
  updateNeeds(w);
  w.tick++;
}

function deathOf(w: World, id: number) {
  return w.log.retained!.find((e) => e.type === "death" && e.data.person === id);
}

describe("14.11 survival", () => {
  it("food at zero long enough kills, and the death is logged as starvation", () => {
    const w = freshWorld();
    const p = w.people.find((x) => w.ageYears(x) > 20)!;
    for (let i = 0; i < 144 * 20 && p.alive; i++) {
      tickNeeds(w, (x) => {
        x.survival.water = x.survival.warmth = x.survival.rest = 1;
        x.survival.food = x.id === p.id ? 0 : 1;
      });
    }
    expect(p.alive).toBe(false);
    expect(deathOf(w, p.id)!.data.cause).toBe("starvation");
  });

  it("water at zero kills faster, logged as dehydration", () => {
    const w = freshWorld();
    const p = w.people.find((x) => w.ageYears(x) > 20)!;
    let ticks = 0;
    for (; ticks < 144 * 20 && p.alive; ticks++) {
      tickNeeds(w, (x) => {
        x.survival.food = x.survival.warmth = x.survival.rest = 1;
        x.survival.water = x.id === p.id ? 0 : 1;
      });
    }
    expect(deathOf(w, p.id)!.data.cause).toBe("dehydration");
    expect(ticks).toBeLessThan(144 * 5);
  });

  it("fire and shelter keep a person alive in winter where an unsheltered person dies", () => {
    const w = freshWorld(42, { time: { startDayOfYear: 300 } });
    expect(w.env.season).toBe(3);
    const house = w.house(0);
    const sheltered = w.people.find((x) => x.householdId === 0 && w.ageYears(x) > 20)!;
    const exposed = w.people.find((x) => x.householdId === 1 && w.ageYears(x) > 20)!;
    for (const p of [sheltered, exposed]) {
      p.survival.health = 1;
      p.survival.warmth = 1;
      p.inventory.cloth = 0;
    }
    sheltered.x = house.bed.x;
    sheltered.y = house.bed.y;
    house.condition = 0.8;
    const field = w.map.field[w.map.field.length - 1]!;
    for (let i = 0; i < 144 * 6 && exposed.alive; i++) {
      house.hearth!.wood = 5;
      exposed.x = field.x;
      exposed.y = field.y;
      tickNeeds(w, (x) => {
        x.survival.food = x.survival.water = x.survival.rest = 1;
        if (x !== sheltered && x !== exposed) x.survival.warmth = 1;
      });
    }
    expect(exposed.alive).toBe(false);
    expect(deathOf(w, exposed.id)!.data.cause).toBe("exposure");
    expect(sheltered.alive).toBe(true);
    expect(sheltered.survival.warmth).toBeGreaterThan(0.5);
  });
});
