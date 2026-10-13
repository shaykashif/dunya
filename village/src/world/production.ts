import { householdMembers } from "../entities/person.ts";
import { discoverTrace } from "../perception/perception.ts";
import { assignTasks } from "../entities/tasks.ts";
import { livestockYield } from "./animals.ts";
import { consume, produce, transfer } from "./items.ts";
import type { World } from "./world.ts";

/**
 * Seasonal production rules run by the engine: crops grow in spring and
 * summer, unharvested grain rots when winter arrives, and in winter the elder
 * releases a ration from the communal store to each household.
 */
export function updateProduction(w: World): void {
  const env = w.env;
  const cfg = w.config;
  if (env.minuteOfDay === 0) {
    w.forageStress.forest *= cfg.forage.stressRecoveryPerDay;
    w.forageStress.river *= cfg.forage.stressRecoveryPerDay;
    w.storeWatch = Math.max(0, w.storeWatch - cfg.communal.watchDecayPerDay);
    w.farms.forEach((farm, id) => {
      if ((env.season === 0 || env.season === 1) && farm.planted) {
        const labour = Math.min(1, farm.work / cfg.fields.workNeeded);
        const weatherF = env.weather === "storm" ? 0.5 : env.day <= env.droughtUntilDay ? 0.4 : 1;
        produce(w, { t: "farm", id }, "grain", Math.round(cfg.fields.growthPerDay * labour * weatherF), "crop_growth");
      }
      if (env.dayOfYear === cfg.time.daysPerSeason * 3) {
        if (farm.crop.grain > 0) consume(w, { t: "farm", id }, "grain", farm.crop.grain, "rotted");
        farm.planted = false;
        farm.work = 0;
      }
    });
  }

  if (env.minuteOfDay === 6 * 60) {
    livestockYield(w);
    for (const hh of w.households) assignTasks(w, hh.id);
  }

  if (env.season === 3 && env.minuteOfDay === cfg.communal.rationHour * 60) {
    const elder = w.maybePerson(w.elderId);
    if (elder && w.isActive(elder.id)) {
      // The elder oversees the store when rationing and notices anything missing.
      for (const t of w.traces.slice()) {
        if (t.kind !== "item_missing" || elder.knownTraces[t.id]) continue;
        const holder = t.details.holder as { t: string };
        if (holder.t === "communal") discoverTrace(w, elder, t, w.rng.get("perception"), "oversight");
      }
    }
    for (const hh of w.households) {
      const members = householdMembers(w, hh.id).length;
      if (members === 0) continue;
      const qty = Math.round(members * cfg.communal.winterRationPerPersonPerDay);
      const n = transfer(w, { t: "communal" }, { t: "household", id: hh.id }, "grain", qty, "ration", elder ? [elder.id] : []);
      if (n > 0) w.emit("ration_distributed", elder ? [elder.id] : [], { household: hh.id, qty: n });
    }
  }
}
