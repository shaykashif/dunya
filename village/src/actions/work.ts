import { workAccident } from "../entities/injuries.ts";
import { clamp01, feel } from "../entities/person.ts";
import { consume, produce, transfer } from "../world/items.ts";
import type { HolderRef, Person, Point } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { atHome, cand, homeDest, homeOf, travelTicks } from "./helpers.ts";
import type { ActionDef } from "./types.ts";

function householdWood(w: World, householdId: number): number {
  const h = w.households[householdId]!;
  return h.store.wood + (w.buildings[h.buildingId]!.hearth?.wood ?? 0);
}

export const gatherWood: ActionDef = {
  id: "gather_wood",
  name: "Gather wood",
  candidates(p, w) {
    const cfg = w.config.wood;
    if (w.ageYears(p) < cfg.minAge) return [];
    const stock = householdWood(w, p.householdId) + p.inventory.wood;
    if (stock >= cfg.householdTarget) return [];
    const dest = w.map.nearest("forest", p);
    const shortage = 1 - stock / cfg.householdTarget;
    return [
      cand("gather_wood", "gather_wood", "gather firewood", {
        dest,
        duration: cfg.gatherDuration,
        travel: travelTicks(w, p, dest),
        risk: w.env.weather === "storm" ? 0.2 : 0,
        effects: { provision: 0.35 * shortage + (w.env.season === 3 ? 0.1 : 0) },
      }),
    ];
  },
  resolve(p, _c, w, ctx) {
    const cfg = w.config.wood;
    workAccident(w, p, ctx.rng, "woodcutting");
    const qty = cfg.yieldMin + ctx.rng.int(cfg.yieldMax - cfg.yieldMin + 1);
    produce(w, { t: "person", id: p.id }, "wood", qty, "gathered", [p.id]);
    return ctx.events;
  },
};

export const tendFire: ActionDef = {
  id: "tend_fire",
  name: "Tend fire",
  candidates(p, w) {
    const cfg = w.config.wood;
    if (w.ageYears(p) < 8) return [];
    const house = homeOf(w, p);
    if (!house.hearth || house.hearth.wood >= cfg.hearthTarget) return [];
    if (w.env.temperature >= cfg.burnBelowTemp) return [];
    const available = p.inventory.wood + w.households[p.householdId]!.store.wood;
    if (available <= 0) return [];
    const dest = homeDest(w, p);
    const cold = (w.config.temperature.comfortTemp - w.env.temperature) / 20;
    return [
      cand("tend_fire", "tend_fire", "feed the hearth", {
        dest,
        duration: 1,
        travel: travelTicks(w, p, dest),
        effects: { warmth: clamp01(cold) * 0.5 + (1 - p.survival.warmth) * 0.3, provision: 0.2 },
      }),
    ];
  },
  resolve(p, _c, w, ctx) {
    const house = homeOf(w, p);
    if (!atHome(w, p) || !house.hearth) {
      ctx.success = false;
      return ctx.events;
    }
    let need = w.config.wood.hearthTarget - house.hearth.wood;
    const to: HolderRef = { t: "hearth", id: house.id };
    need -= transfer(w, { t: "person", id: p.id }, to, "wood", need, "fuel", [p.id]);
    if (need > 0) transfer(w, { t: "household", id: p.householdId }, to, "wood", need, "fuel", [p.id]);
    return ctx.events;
  },
};

export const repairShelter: ActionDef = {
  id: "repair_shelter",
  name: "Repair shelter",
  candidates(p, w) {
    const cfg = w.config.shelter;
    if (w.ageYears(p) < 14) return [];
    const house = homeOf(w, p);
    if (house.condition >= cfg.repairBelow) return [];
    if (p.inventory.wood + w.households[p.householdId]!.store.wood < cfg.repairWood) return [];
    const dest = homeDest(w, p);
    const gap = cfg.repairBelow + 0.05 - house.condition;
    return [
      cand("repair_shelter", "repair_shelter", "repair the house", {
        dest,
        duration: cfg.repairDuration,
        travel: travelTicks(w, p, dest),
        effects: { provision: gap * 1.5, comfort: gap },
      }),
    ];
  },
  resolve(p, _c, w, ctx) {
    const cfg = w.config.shelter;
    if (!atHome(w, p)) {
      ctx.success = false;
      return ctx.events;
    }
    let need = cfg.repairWood;
    need -= consume(w, { t: "person", id: p.id }, "wood", need, "repair", [p.id]);
    if (need > 0) need -= consume(w, { t: "household", id: p.householdId }, "wood", need, "repair", [p.id]);
    if (need > 0) {
      ctx.success = false;
      return ctx.events;
    }
    const house = homeOf(w, p);
    house.condition = clamp01(house.condition + cfg.repairAmount);
    ctx.emit("shelter_repaired", [p.id], { building: house.id, condition: Math.round(house.condition * 1000) / 1000 });
    return ctx.events;
  },
};

/** Nearest tile of the person's own farm. */
function farmSpot(w: World, p: Person): Point {
  const farm = w.compound(p.householdId).farm;
  let best = farm[0]!, bestD = Infinity;
  for (const t of farm) {
    const d = Math.abs(t.x - p.x) + Math.abs(t.y - p.y);
    if (d < bestD) { bestD = d; best = t; }
  }
  return { ...best };
}

export const plant: ActionDef = {
  id: "plant",
  name: "Plant",
  candidates(p, w) {
    const farm = w.farms[p.householdId]!;
    if (w.env.season !== 0 || w.ageYears(p) < 12 || farm.work >= w.config.fields.workNeeded) return [];
    const dest = farmSpot(w, p);
    return [cand("plant", "plant", "work the family farm", { dest, duration: w.config.fields.plantDuration, travel: travelTicks(w, p, dest), effects: { provision: 0.3 } })];
  },
  resolve(p, _c, w, ctx) {
    const farm = w.farms[p.householdId]!;
    farm.work++;
    if (!farm.planted) {
      farm.planted = true;
      ctx.emit("field_planted", [p.id], { household: p.householdId });
    }
    return ctx.events;
  },
};

export const harvest: ActionDef = {
  id: "harvest",
  name: "Harvest",
  candidates(p, w) {
    if (w.env.season !== 2 || w.ageYears(p) < 12 || w.farms[p.householdId]!.crop.grain <= 0) return [];
    const dest = farmSpot(w, p);
    return [
      cand("harvest", "harvest", "bring in the family harvest", {
        dest,
        duration: w.config.fields.harvestDuration,
        travel: travelTicks(w, p, dest),
        effects: { provision: 0.35, status: 0.05 },
      }),
    ];
  },
  resolve(p, _c, w, ctx) {
    const cfg = w.config.fields;
    const farm: HolderRef = { t: "farm", id: p.householdId };
    const tithe = transfer(w, farm, { t: "communal" }, "grain", cfg.harvestTithe, "tithe", [p.id]);
    const amount = Math.round((cfg.harvestPerAction - cfg.harvestTithe) * (p.inventory.tool > 0 ? 1 : 0.5));
    const kept = transfer(w, farm, { t: "household", id: p.householdId }, "grain", amount, "harvest", [p.id]);
    if (tithe + kept === 0) ctx.success = false;
    else feel(w, p, "content", "brought in the harvest", 0.2);
    return ctx.events;
  },
};
