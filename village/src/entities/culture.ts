// Culture, Dwarf Fortress style. The village holds shared values; each house
// leans its own way and each person strays further. Values tint what people
// choose and how they feel, give rise to personal needs (to pray, to make
// things, to rest, to be with family), and set people arguing when they clash.
// The village worships a small pantheon and gathers for festivals in the square.
import type { Rng } from "../engine/rng.ts";
import { r3 } from "../log/events.ts";
import { NEED_KINDS, VALUES, type Culture, type Deity, type NeedKind, type Person, type Value } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { furnitureIn, QUALITY_WORDS } from "../world/structures.ts";
import { cheb, clamp01, feel, isKin } from "./person.ts";

const DEITY_NAMES = ["Orvel", "Skadra", "Veth", "Halma", "Brannoc", "Isel", "Tormund", "Ysra", "Garrow", "Eluned"];
const SPHERES: string[][] = [
  ["the harvest", "the hearth"],
  ["the hunt", "winter"],
  ["oaths", "justice"],
  ["rivers", "healing"],
  ["war", "storms"],
  ["love", "spring"],
  ["the dead", "memory"],
  ["craft", "stone"],
];
const FOLK = ["Ashvale", "Harrowmere", "Brindlewood", "Elderford", "Thornholt", "Wyndmoor"];

export function generateCulture(rng: Rng): Culture {
  const values = {} as Record<Value, number>;
  for (const v of VALUES) values[v] = r3(Math.max(-0.8, Math.min(0.9, (rng.next() + rng.next() - 1) * 1.1 + 0.1)));
  const deities: Deity[] = [];
  const names = DEITY_NAMES.slice();
  const spheres = SPHERES.slice();
  for (let i = 0; i < 3; i++) {
    const name = names.splice(rng.int(names.length), 1)[0]!;
    const s = spheres.splice(rng.int(spheres.length), 1)[0]!;
    deities.push({ id: i, name, spheres: s });
  }
  return { name: `the ${FOLK[rng.int(FOLK.length)]} folk`, values, deities };
}

/** A house's leaning: the village's values, nudged. */
export function houseValues(rng: Rng, culture: Culture, spread: number): Record<Value, number> {
  const out = {} as Record<Value, number>;
  for (const v of VALUES) out[v] = r3(Math.max(-1, Math.min(1, culture.values[v] + (rng.next() * 2 - 1) * spread)));
  return out;
}

export function personValues(rng: Rng, base: Record<Value, number>, spread: number): Record<Value, number> {
  return houseValues(rng, { name: "", values: base, deities: [] }, spread);
}

export function fullFocus(): Record<NeedKind, number> {
  return { pray: 0.8, create: 0.8, leisure: 0.8, family: 0.8 };
}

const NEED_VALUE: Record<NeedKind, Value> = { pray: "piety", create: "craftsmanship", leisure: "leisure", family: "family" };
const NEED_TEXT: Record<NeedKind, string> = { pray: "pray", create: "make anything", leisure: "take any time for themselves", family: "spend time with family" };

/** How strongly a need is felt, in [0, 1], from the value behind it. */
export function needStrength(p: Person, n: NeedKind): number {
  return clamp01(0.15 + 0.85 * p.values[NEED_VALUE[n]]);
}

export function satisfy(p: Person, n: NeedKind, amount: number): void {
  p.focus[n] = clamp01(p.focus[n] + amount);
}

/** How alike two people's values are, in [0, 1]. */
export function valueSimilarity(a: Person, b: Person): number {
  let d = 0;
  for (const v of VALUES) d += Math.abs(a.values[v] - b.values[v]);
  return 1 - d / (VALUES.length * 2);
}

/** The value two people disagree about most sharply, if they truly clash over it. */
export function sharpestClash(a: Person, b: Person): Value | null {
  let worst: Value | null = null, gap = 1.1;
  for (const v of VALUES) {
    const g = Math.abs(a.values[v] - b.values[v]);
    if (g > gap && Math.abs(a.values[v]) > 0.4 && Math.abs(b.values[v]) > 0.4) { gap = g; worst = v; }
  }
  return worst;
}

export function deityOf(w: World, p: Person): Deity {
  return w.culture.deities[p.deityId] ?? w.culture.deities[0]!;
}

const FEASTS = ["the Sowing Feast", "Midsummer", "the Harvest Feast", "Midwinter"];

/**
 * Engine rule each tick: needs fade and weigh on mood when unmet, family time
 * feeds the need for family, people admire fine furniture, and festivals begin and end.
 */
export function cultureStep(w: World): void {
  const cfg = w.config.culture;
  const tpd = w.config.time.ticksPerDay;
  const active = w.active();
  for (const p of active) {
    if (w.ageYears(p) < 4) continue;
    for (const n of NEED_KINDS) {
      const s = needStrength(p, n);
      p.focus[n] = clamp01(p.focus[n] - (cfg.focusDecayPerDay * s) / tpd);
      if (p.focus[n] < 0.3) p.mood = Math.max(-1, p.mood - cfg.unmetMoodPerTick * s * (0.3 - p.focus[n]) / 0.3);
    }
    if (!p.asleep && w.tick % 3 === p.id % 3 && active.some((o) => o.id !== p.id && !o.asleep && isKin(p, o) && cheb(o, p) <= 3)) satisfy(p, "family", 0.03);
  }

  if (w.env.minuteOfDay === 10 * 60) {
    for (const p of active) {
      if (w.ageYears(p) < 10) continue;
      const until = p.cooldowns["need-pang"];
      if (until !== undefined && w.tick < until) continue;
      const worst = NEED_KINDS.filter((n) => needStrength(p, n) >= 0.5 && p.focus[n] < 0.15).sort((a, b) => p.focus[a] - p.focus[b])[0];
      if (!worst) continue;
      p.cooldowns["need-pang"] = w.tick + w.days(2);
      feel(w, p, "distracted", `has not been able to ${NEED_TEXT[worst]} in a long while`, 0.3);
    }
  }

  // Fine furniture is a pleasure to live with, for those who care about craft.
  if (w.env.minuteOfDay % 60 === 0) {
    for (const p of active) {
      if (p.asleep || p.values.craftsmanship < 0.1 || w.ageYears(p) < 8) continue;
      const home = w.house(p.householdId);
      if (!w.isInside(p, home)) continue;
      const until = p.cooldowns["admire"];
      if (until !== undefined && w.tick < until) continue;
      const fine = furnitureIn(w, home.id).filter((f) => f.quality >= 2).sort((a, b) => b.quality - a.quality || a.id - b.id)[0];
      if (!fine) continue;
      p.cooldowns["admire"] = w.tick + w.days(3);
      feel(w, p, "pleased", `admired a ${QUALITY_WORDS[fine.quality]} ${fine.kind}`, 0.15 + 0.05 * fine.quality);
    }
  }

  // Festivals: a day in the square, every month or so.
  const day = w.env.day;
  if (!w.festival && day >= cfg.festivalFirstDay && (day - cfg.festivalFirstDay) % cfg.festivalEveryDays === 0 && w.env.minuteOfDay === cfg.festivalHour * 60) {
    const deity = w.culture.deities[Math.floor(day / cfg.festivalEveryDays) % w.culture.deities.length]!;
    w.festival = { name: `${FEASTS[w.env.season]} of ${deity.name}`, deityId: deity.id, startTick: w.tick, endTick: w.tick + cfg.festivalTicks, attended: [] };
    w.emit("festival_began", [], { name: w.festival.name, deity: deity.id, at: [w.map.square.x, w.map.square.y] });
  } else if (w.festival && w.tick >= w.festival.endTick) {
    w.emit("festival_ended", [], { name: w.festival.name, attended: w.festival.attended.length });
    w.festival = null;
  }
}
