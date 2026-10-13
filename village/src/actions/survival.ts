import { clamp01 } from "../entities/person.ts";
import { bestFood, consume, foodUnits, foodValue, produce, transfer } from "../world/items.ts";
import { FOOD_KINDS, type ItemKind, type Person } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { atHome, cand, homeDest, isNight, sleepy, travelTicks } from "./helpers.ts";
import type { ActionDef, CandidateAction } from "./types.ts";

/** Chance of a find at a site this season, reduced as the site is over-worked. */
export function forageChance(w: World, site: "forest" | "river", p: Person): number {
  const cfg = w.config.forage;
  const base = (site === "forest" ? cfg.forestChance : cfg.riverChance)[w.env.season]!;
  const factor = Math.max(cfg.minYieldFactor, 1 - w.forageStress[site] / cfg.stressCapacity[site]);
  return base * factor * (p.inventory.tool > 0 ? 1 : cfg.noToolFactor);
}

export const forage: ActionDef = {
  id: "forage",
  name: "Forage",
  candidates(p, w) {
    const cfg = w.config.forage;
    if (w.ageYears(p) < cfg.minAge) return [];
    const out: CandidateAction[] = [];
    // Stockpiling motive: the emptier the household store, the more a trip is worth to the family.
    const members = Math.max(1, w.active().filter((o) => o.householdId === p.householdId).length);
    const stock = foodUnits(w.households[p.householdId]!.store);
    const scarcity = 1 / (1 + stock / (members * 4));
    const sites: [string, "forest" | "bank", number, ItemKind][] = [
      ["forest", "forest", forageChance(w, "forest", p), "berries"],
      ["river", "bank", forageChance(w, "river", p), "fish"],
    ];
    for (const [label, site, chance, kind] of sites) {
      const dest = w.map.nearest(site, p);
      const units = chance * (1 + cfg.maxYield) / 2;
      const value = units * foodValue(w, kind);
      out.push(
        cand("forage", `forage:${label}`, `forage at the ${label}`, {
          dest,
          duration: cfg.duration,
          travel: travelTicks(w, p, dest),
          risk: w.env.weather === "storm" ? 0.1 : 0,
          item: kind,
          effects: { food: Math.min(value, 1 - p.survival.food) * 0.8, provision: units * 0.35 * scarcity },
        }),
      );
    }
    return out;
  },
  resolve(p, c, w, ctx) {
    const cfg = w.config.forage;
    const site = c.item === "fish" ? "river" : "forest";
    if (ctx.rng.chance(forageChance(w, site, p))) {
      const qty = 1 + ctx.rng.int(cfg.maxYield);
      w.forageStress[site] += qty;
      produce(w, { t: "person", id: p.id }, c.item!, qty, "foraged", [p.id]);
      ctx.emit("foraged", [p.id], { kind: c.item, qty });
    } else {
      ctx.success = false;
      ctx.emit("foraged", [p.id], { kind: c.item, qty: 0 });
    }
    return ctx.events;
  },
};

export const eat: ActionDef = {
  id: "eat",
  name: "Eat",
  candidates(p, w) {
    if (p.survival.food > w.config.food.fullAbove) return [];
    const out: CandidateAction[] = [];
    for (const kind of FOOD_KINDS) {
      if (p.inventory[kind] <= 0) continue;
      out.push(
        cand("eat", `eat:carried:${kind}`, `eat carried ${kind}`, {
          dest: null,
          duration: w.config.food.eatDuration,
          item: kind,
          source: { t: "person", id: p.id },
          effects: { food: Math.min(foodValue(w, kind), 1 - p.survival.food) },
        }),
      );
    }
    if (w.ageYears(p) >= w.config.needs.infantAge) {
      const store = w.households[p.householdId]!.store;
      const kind = bestFood(store);
      if (kind) {
        const dest = homeDest(w, p);
        out.push(
          cand("eat", `eat:home:${kind}`, `eat ${kind} at home`, {
            dest,
            duration: w.config.food.eatDuration,
            travel: travelTicks(w, p, dest),
            item: kind,
            source: { t: "household", id: p.householdId },
            effects: { food: Math.min(foodValue(w, kind), 1 - p.survival.food) },
          }),
        );
      }
    }
    return out;
  },
  resolve(p, c, w, ctx) {
    const src = c.source!;
    if (src.t === "household" && !atHome(w, p)) {
      ctx.success = false;
      return ctx.events;
    }
    const n = consume(w, src, c.item!, 1, "eaten", [p.id]);
    if (n === 0) {
      ctx.success = false;
      return ctx.events;
    }
    p.survival.food = clamp01(p.survival.food + foodValue(w, c.item!));
    return ctx.events;
  },
};

export const drink: ActionDef = {
  id: "drink",
  name: "Drink",
  candidates(p, w) {
    if (p.survival.water > 0.85 || w.ageYears(p) < w.config.needs.infantAge) return [];
    const out: CandidateAction[] = [];
    const gain = 1 - p.survival.water;
    if (w.env.well > w.config.water.wellMinToDrink) {
      // The nearest well: for most people, their own compound's.
      const dest = { ...w.map.nearestWell(p) };
      out.push(cand("drink", "drink:well", "drink at the well", { dest, duration: 1, travel: travelTicks(w, p, dest), effects: { water: gain } }));
    }
    const bank = w.map.nearest("bank", p);
    out.push(cand("drink", "drink:river", "drink at the river", { dest: bank, duration: 1, travel: travelTicks(w, p, bank), effects: { water: gain } }));
    return out;
  },
  resolve(p, c, w, ctx) {
    if (c.key === "drink:well") {
      if (w.env.well < w.config.water.drinkDraw) {
        ctx.success = false;
        ctx.emit("well_dry", [p.id], {});
        return ctx.events;
      }
      w.env.well -= w.config.water.drinkDraw;
    }
    p.survival.water = 1;
    return ctx.events;
  },
};

function restRate(w: World, p: Person): number {
  const cfg = w.config.needs;
  let r = cfg.sleepRestorePerTick;
  if (!isNight(w)) r *= cfg.daySleepFactor;
  if (!w.map.roofed(p.x, p.y)) r *= cfg.unshelteredSleepFactor;
  return r;
}

export const sleep: ActionDef = {
  id: "sleep",
  name: "Sleep",
  candidates(p, w) {
    const window = sleepy(w, p);
    if (p.survival.rest > 0.85 && !window) return [];
    const nightF = isNight(w) ? 1 : w.config.needs.daySleepFactor;
    const gain = (1 - p.survival.rest) * nightF;
    const cold = w.env.temperature < w.config.temperature.comfortTemp;
    const dest = homeDest(w, p);
    const out = [
      cand("sleep", "sleep:home", "sleep at home", {
        dest,
        duration: 1,
        travel: travelTicks(w, p, dest),
        continuous: true,
        effects: { rest: gain, warmth: cold ? 0.1 : 0, comfort: 0.3, security: 0.2 },
      }),
    ];
    if (dest !== null) {
      out.push(
        cand("sleep", "sleep:here", "sleep where they are", {
          dest: null,
          duration: 1,
          continuous: true,
          effects: {
            rest: gain * w.config.needs.unshelteredSleepFactor,
            warmth: cold && !w.map.roofed(p.x, p.y) ? -0.3 : 0,
            comfort: w.map.roofed(p.x, p.y) ? 0 : -0.3,
            security: w.map.roofed(p.x, p.y) ? 0 : -0.3,
          },
        }),
      );
    }
    return out;
  },
  tickEffect(p, _c, w) {
    p.asleep = true;
    p.survival.rest = clamp01(p.survival.rest + restRate(w, p));
  },
  isDone(p, _c, w, performed) {
    const s = p.survival;
    if (performed >= 6 && (s.food < 0.06 || s.water < 0.06 || s.warmth < 0.08)) return true;
    if (performed > 72) return true;
    const window = sleepy(w, p);
    if (!window && s.rest >= 0.7) return true;
    return s.rest >= 0.99 && !window;
  },
  resolve(p, _c, _w, ctx) {
    p.asleep = false;
    return ctx.events;
  },
};

export const idle: ActionDef = {
  id: "idle",
  name: "Idle",
  candidates(p, w) {
    const out = [cand("idle", "idle", "rest a while", { dest: null, duration: 3, effects: { comfort: 0.02 } })];
    const dest = homeDest(w, p);
    if (dest && w.env.temperature < w.config.temperature.comfortTemp) {
      out.push(
        cand("idle", "idle:home", "go home to warm up", {
          dest,
          duration: 6,
          travel: travelTicks(w, p, dest),
          effects: { warmth: (1 - p.survival.warmth) * 0.7, comfort: 0.05 },
        }),
      );
    }
    return out;
  },
  resolve(_p, _c, _w, ctx) {
    return ctx.events;
  },
};

/** Puts carried food and wood into the household store. */
export const storeGoods: ActionDef = {
  id: "store_goods",
  name: "Store goods",
  candidates(p, w) {
    const food = foodUnits(p.inventory);
    const spareFood = Math.max(0, food - 1);
    const wood = p.inventory.wood;
    if (spareFood < 2 && wood < 1) return [];
    const dest = homeDest(w, p);
    const store = w.households[p.householdId]!.store;
    const scarcity = 1 / (1 + foodUnits(store) / 10);
    return [
      cand("store_goods", "store_goods", "bring goods home", {
        dest,
        duration: 1,
        travel: travelTicks(w, p, dest),
        effects: { provision: spareFood * 0.08 * (0.5 + scarcity) + wood * 0.05 },
      }),
    ];
  },
  resolve(p, _c, w, ctx) {
    if (!atHome(w, p)) {
      ctx.success = false;
      return ctx.events;
    }
    const to = { t: "household" as const, id: p.householdId };
    let keep = 1;
    for (const kind of FOOD_KINDS) {
      const have = p.inventory[kind];
      const k = Math.min(keep, have);
      keep -= k;
      if (have - k > 0) transfer(w, { t: "person", id: p.id }, to, kind, have - k, "stored", [p.id]);
    }
    if (p.inventory.wood > 0) transfer(w, { t: "person", id: p.id }, to, "wood", p.inventory.wood, "stored", [p.id]);
    return ctx.events;
  },
};
