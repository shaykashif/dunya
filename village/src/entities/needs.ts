import { r3 } from "../log/events.ts";
import { bestFood, consume, foodValue, holderInv } from "../world/items.ts";
import type { DeathCause, Person } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { kill } from "./death.ts";
import { furnishing } from "../world/structures.ts";
import { cheb, clamp01, feel, householdMembers } from "./person.ts";

export const SURVIVAL_CAUSE: Record<"food" | "water" | "warmth" | "rest", DeathCause> = {
  food: "starvation",
  water: "dehydration",
  warmth: "exposure",
  rest: "exhaustion",
};

/** Effective temperature a person feels, given shelter, hearth, clothing and time. */
export function feltTemperature(w: World, p: Person): number {
  const cfg = w.config.needs;
  let t = w.env.temperature;
  const b = w.buildingOf(p);
  if (b && w.map.roofed(p.x, p.y)) {
    t += cfg.shelterBonusTemp * b.condition;
    if (b.lit) t += cfg.hearthBonusTemp;
  } else {
    if (w.env.light < w.config.light.nightThreshold) t -= cfg.nightOutdoorPenalty;
    if (w.env.weather === "storm") t -= cfg.stormOutdoorPenalty;
  }
  if (p.inventory.cloth > 0) t += cfg.clothBonusTemp;
  if (p.inventory.coat > 0 && !(b && w.map.roofed(p.x, p.y))) t += cfg.coatBonusTemp;
  return t;
}

/** Hearths burn wood while it is cold and someone of the household is home. */
export function updateHearths(w: World): void {
  const cfg = w.config.wood;
  for (const b of w.buildings) {
    if (!b.hearth || b.householdId === null) continue;
    const someoneHome = w.active().some((p) => p.householdId === b.householdId && w.isInside(p, b));
    const wanted = w.env.temperature < cfg.burnBelowTemp && someoneHome;
    b.lit = wanted && b.hearth.wood > 0;
    if (!b.lit) continue;
    b.burnAcc += 1 / cfg.ticksPerWoodUnit;
    if (b.burnAcc >= 1) {
      b.burnAcc -= 1;
      consume(w, { t: "hearth", id: b.id }, "wood", 1, "burned");
    }
  }
}

function updateShelter(w: World): void {
  const cfg = w.config.shelter;
  const newDay = w.env.minuteOfDay === 0;
  for (const b of w.buildings) {
    let c = b.condition;
    if (newDay) c -= cfg.decayPerDay;
    if (w.env.weather === "storm") c -= cfg.stormDamagePerTick;
    b.condition = clamp01(c);
  }
}

/** Step 2 of the tick: survival values, wants, emotions, health and deaths. */
export function updateNeeds(w: World): void {
  const cfg = w.config.needs;
  const wc = w.config.wants;
  const tpd = w.config.time.ticksPerDay;
  updateShelter(w);
  updateHearths(w);

  const active = w.active();
  const awake = active.filter((p) => !p.asleep);

  for (const p of active) {
    const s = p.survival;
    const age = w.ageYears(p);

    // Food and water. Infants are carried; a fed mother nurses, another carer gives water.
    const carer = w.infantCarer(p);
    if (carer) {
      w.vacate(p);
      p.x = carer.x;
      p.y = carer.y;
      s.water = Math.max(s.water, 0.8);
      if (p.parents.includes(carer.id) && carer.sex === "f" && carer.survival.food > 0.2) {
        carer.survival.food = clamp01(carer.survival.food - (cfg.foodDecayPerDay / tpd) * cfg.infantDrawOnMother);
        s.food = Math.max(s.food, 0.8);
      } else {
        s.food -= cfg.foodDecayPerDay / tpd;
        // Without a nursing mother, whoever carries the baby feeds it: from its own share, the carer's, or the house store at home.
        if (s.food < 0.45) {
          const home = w.isInside(carer, w.house(p.householdId));
          const sources = [{ t: "person" as const, id: p.id }, { t: "person" as const, id: carer.id }, ...(home ? [{ t: "household" as const, id: p.householdId }] : [])];
          for (const src of sources) {
            const kind = bestFood(holderInv(w, src));
            if (!kind) continue;
            consume(w, src, kind, 1, "fed_infant", [carer.id]);
            s.food = clamp01(s.food + foodValue(w, kind));
            break;
          }
        }
      }
    } else {
      s.food -= cfg.foodDecayPerDay / tpd;
      const heat = Math.max(0, w.env.temperature - cfg.waterHeatAbove) * cfg.waterHeatPerDegree;
      s.water -= (cfg.waterDecayPerDay / tpd) * (1 + heat);
    }

    if (!p.asleep) s.rest -= cfg.restDecayPerDay / tpd;

    const felt = feltTemperature(w, p);
    const comfort = w.config.temperature.comfortTemp;
    if (felt < comfort) s.warmth -= (comfort - felt) * cfg.warmthLossPerDegreeTick;
    else s.warmth += cfg.warmthGainPerTick;
    // A carried infant is wrapped against its carer.
    if (carer) s.warmth = Math.max(s.warmth, carer.survival.warmth);

    s.food = clamp01(s.food);
    s.water = clamp01(s.water);
    s.rest = clamp01(s.rest);
    s.warmth = clamp01(s.warmth);

    // Health declines while any survival value is at zero.
    let zero = false;
    for (const key of ["food", "water", "warmth", "rest"] as const) {
      if (s[key] <= 0) {
        zero = true;
        const loss = cfg.healthLossPerTick[key];
        s.health -= loss;
        p.lossCause[SURVIVAL_CAUSE[key]] += loss;
      }
    }
    if (!zero && s.food >= cfg.recoverAbove && s.water >= cfg.recoverAbove && s.warmth >= cfg.recoverAbove && s.rest >= cfg.recoverAbove) {
      s.health += cfg.healthRecoverPerTick;
    }
    s.health = Math.min(1, s.health);
    if (w.env.minuteOfDay === 0) for (const k of Object.keys(p.lossCause) as DeathCause[]) p.lossCause[k] *= 0.9;

    // Wants.
    const company = awake.some((o) => o.id !== p.id && cheb(o, p) <= wc.companyRadius);
    if (!p.asleep) {
      if (company) p.wants.companionship += wc.companionshipGainPerTick;
      else p.wants.companionship -= wc.companionshipDecayPerDay / tpd;
    }
    const partner = w.maybePerson(p.partnerId);
    const courting = Object.keys(p.relationships).some((k) => {
      const r = p.relationships[Number(k)]!;
      if (r.stage !== "courting") return false;
      const o = w.maybePerson(Number(k));
      return !!o && o.alive && !o.exiled && cheb(o, p) <= wc.companyRadius;
    });
    if ((partner && partner.alive && !partner.exiled && cheb(partner, p) <= wc.companyRadius) || courting) {
      p.wants.affection += wc.affectionPartnerGainPerTick;
    } else if (age >= w.config.bonding.minAge) {
      p.wants.affection -= wc.affectionDecayPerDay / tpd;
    }
    const home = w.house(p.householdId);
    const survivalMean = (s.food + s.water + s.warmth + s.rest) / 4;
    const comfortTarget = 0.35 * home.condition + 0.15 * furnishing(w, p.householdId) + 0.5 * survivalMean;
    p.wants.comfort += (comfortTarget - p.wants.comfort) * wc.wantDriftPerTick;
    // A house's silver and heirlooms carry standing.
    const wealth = Math.min(1, w.households[p.householdId]!.store.valuables / 8);
    const statusTarget = 0.25 + 0.1 * wealth + (p.role === "elder" ? 0.4 : 0) + (p.isHead ? 0.2 : 0) - Math.min(0.3, p.convictions * 0.15);
    p.wants.status += (statusTarget - p.wants.status) * wc.wantDriftPerTick;
    p.wants.security += wc.securityRecoverPerDay / tpd;
    for (const k of ["companionship", "affection", "status", "comfort", "security"] as const) p.wants[k] = clamp01(p.wants[k]);

    // Minimal emotions.
    const e = p.emotions;
    e.guilt = clamp01(e.guilt - w.config.emotions.guiltDecayPerDay / tpd);
    e.grief = clamp01(e.grief - w.config.emotions.griefDecayPerDay / tpd);
    e.jealousy = clamp01(e.jealousy - w.config.emotions.jealousyDecayPerDay / tpd);
    const deficit = Math.max(0, 0.3 - Math.min(s.food, s.water, s.warmth)) / 0.3;
    e.distress = clamp01(0.5 * deficit + 0.3 * e.grief + 0.2 * (1 - p.wants.security));

    if (!p.asleep && w.tick % 6 === p.id % 6) {
      const pangs: [boolean, string, string, string][] = [
        [s.food < 0.15, "desperate", "they have had almost nothing to eat", "feel:hunger"],
        [s.warmth < 0.2, "miserable", "they are freezing", "feel:cold"],
        [s.water < 0.15, "desperate", "they are parched", "feel:thirst"],
        [p.wants.companionship < 0.15 && age >= 6, "lonely", "they have had no one to talk to", "feel:lonely"],
      ];
      for (const [on, emotion, cause, key] of pangs) {
        const until = p.cooldowns[key];
        if (!on || (until !== undefined && w.tick < until)) continue;
        p.cooldowns[key] = w.tick + tpd;
        feel(w, p, emotion, cause, 0.4);
      }
    }
    p.mood *= 0.996;

    if (s.health <= 0) {
      s.health = 0;
      let cause: DeathCause = "starvation";
      let best = -1;
      for (const k of Object.keys(p.lossCause) as DeathCause[]) {
        if (p.lossCause[k] > best) { best = p.lossCause[k]; cause = k; }
      }
      kill(w, p, cause, null, null);
    }
  }
}

/** Village-wide summary of survival values and wants, logged every tick. */
export function tickSummary(w: World): Record<string, unknown> {
  const active = w.active();
  const n = Math.max(1, active.length);
  const avg = (f: (p: Person) => number) => r3(active.reduce((a, p) => a + f(p), 0) / n);
  return {
    pop: active.length,
    food: avg((p) => p.survival.food),
    water: avg((p) => p.survival.water),
    warmth: avg((p) => p.survival.warmth),
    rest: avg((p) => p.survival.rest),
    health: avg((p) => p.survival.health),
    companionship: avg((p) => p.wants.companionship),
    affection: avg((p) => p.wants.affection),
    status: avg((p) => p.wants.status),
    comfort: avg((p) => p.wants.comfort),
    security: avg((p) => p.wants.security),
  };
}

export function householdFamine(w: World, householdId: number): boolean {
  const members = householdMembers(w, householdId);
  if (members.length === 0) return false;
  const hh = w.households[householdId]!;
  let stock = hh.store.grain + hh.store.fish + hh.store.berries;
  for (const m of members) stock += m.inventory.grain + m.inventory.fish + m.inventory.berries;
  if (stock / members.length < w.config.bonding.famineFoodPerMember) return true;
  return members.some((m) => m.survival.food < 0.15);
}
