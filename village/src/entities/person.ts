import { armFactor, cannotWalk, mobility, painOf } from "./body.ts";
import { emptyInventory, type Person, type Personality, type Point, type Relationship, type Sex, type SizeClass, type Survival, type Wants } from "../world/types.ts";
import type { World } from "../world/world.ts";

export function newRelationship(tick: number, kin = false): Relationship {
  return { bond: 0, trust: 0, attraction: 0, stage: "stranger", together: 0, shared: 0, negative: 0, stageTick: tick, kin };
}

/** Relationship from a to b, created on first use. */
export function rel(a: Person, bId: number, tick = 0): Relationship {
  let r = a.relationships[bId];
  if (!r) {
    r = newRelationship(tick);
    a.relationships[bId] = r;
  }
  return r;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function clampTrust(x: number): number {
  return x < -1 ? -1 : x > 1 ? 1 : x;
}

export function adjustBond(a: Person, bId: number, delta: number, tick: number): void {
  const r = rel(a, bId, tick);
  r.bond = clamp01(r.bond + delta);
}

export function adjustTrust(a: Person, bId: number, delta: number, tick: number): void {
  const r = rel(a, bId, tick);
  r.trust = clampTrust(r.trust + delta);
}

export function isKin(a: Person, b: Person): boolean {
  if (a.id === b.id) return true;
  return !!a.relationships[b.id]?.kin || a.partnerId === b.id;
}

export function sizeClassOfAge(age: number): SizeClass {
  return age < 13 ? "small" : "large";
}

export function cheb(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function inSleepWindow(p: Person, hour: number): boolean {
  const start = p.sleepStart;
  const end = (start + p.sleepHours) % 24;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function speedOf(w: World, p: Person): number {
  const age = w.ageYears(p);
  const m = w.config.movement;
  let s = age < 12 ? m.childSpeed : age >= 62 ? m.elderSpeed : m.adultSpeed;
  // Bad legs slow a person on foot; someone who cannot walk barely moves at all.
  if (p.ridingHorseId === null) s *= cannotWalk(p) ? 0.05 : mobility(p);
  if (p.carryingId !== null) s *= w.config.injuries.carrySpeed;
  if (p.ridingHorseId !== null && !w.map.roofed(p.x, p.y)) s *= w.config.animals.horseSpeedFactor;
  const kind = p.plan?.cand.kind;
  if (kind === "chase" || kind === "flee") s *= (0.9 + w.config.chase.sprintBold * p.personality.boldness) * (0.6 + 0.4 * p.survival.health) * (kind === "chase" ? 1.15 : 1);
  const outdoors = !w.map.roofed(p.x, p.y);
  if (outdoors) {
    if (w.env.weather === "snow") s *= m.snowFactor;
    else if (w.env.weather === "storm" || w.env.light < w.config.light.nightThreshold) s *= m.badWeatherFactor;
  }
  return s;
}

export function strengthOf(w: World, p: Person): number {
  const age = w.ageYears(p);
  let base = age < 14 ? 0.3 + 0.05 * Math.max(0, age - 6) : age < 50 ? 1 : Math.max(0.4, 1 - (age - 50) * 0.02);
  if (p.sex === "m" && age >= 14) base *= 1.15;
  const hurt = armFactor(p) * (1 - 0.3 * painOf(p)) * (cannotWalk(p) ? 0.6 : 1);
  return base * hurt * (0.6 + 0.4 * p.survival.health) * (0.8 + 0.4 * p.personality.boldness);
}

export function householdMembers(w: World, householdId: number): Person[] {
  return w.people.filter((p) => p.alive && !p.exiled && p.householdId === householdId);
}

export function blankPerson(init: {
  id: number;
  name: string;
  sex: Sex;
  birthTick: number;
  householdId: number;
  parents: number[];
  x: number;
  y: number;
  personality: Personality;
  survival: Survival;
  wants: Wants;
  sleepStart: number;
  sleepHours: number;
}): Person {
  return {
    ...init,
    emotions: { distress: 0, guilt: 0, grief: 0, jealousy: 0 },
    inventory: emptyInventory(),
    relationships: {},
    beliefs: [],
    knownTraces: {},
    caseFiles: [],
    alive: true,
    exiled: false,
    causeOfDeath: null,
    deathTick: null,
    role: "none",
    isHead: false,
    partnerId: null,
    plan: null,
    asleep: false,
    lossCause: { starvation: 0, dehydration: 0, exposure: 0, exhaustion: 0, wounds: 0, infection: 0, animal: 0, execution: 0, unknown: 0 },
    lastSighted: {},
    recent: [],
    feelings: [],
    mood: 0,
    departure: null,
    task: "child",
    bloodyTool: false,
    bloodyClothes: false,
    ridingHorseId: null,
    madness: 0,
    mad: null,
    lonelyDays: 0,
    captorId: null,
    pregnancy: null,
    detainedUntil: null,
    widowedTick: null,
    grievances: {},
    rivalId: null,
    cooldowns: {},
    convictions: 0,
    injuries: [],
    crutch: false,
    carriedById: null,
    carryingId: null,
    injustice: {},
  };
}

export function pushRecent(p: Person, tick: number, text: string, ok: boolean): void {
  p.recent.push({ tick, text, ok });
  if (p.recent.length > 12) p.recent.shift();
}

const POSITIVE = new Set(["happy", "grateful", "in love", "joyful", "relieved", "proud", "comforted", "content", "hopeful", "triumphant", "vindicated"]);

/**
 * Records a feeling and its cause in the person's short history, nudges their
 * mood, and logs it. Feelings are reactions the engine attributes to events.
 */
export function feel(w: World, p: Person, emotion: string, cause: string, intensity = 0.5): void {
  if (!p.alive || p.exiled) return;
  p.feelings.push({ tick: w.tick, emotion, cause, intensity: Math.round(intensity * 100) / 100 });
  if (p.feelings.length > 15) p.feelings.shift();
  const sign = POSITIVE.has(emotion) ? 1 : -1;
  p.mood = Math.max(-1, Math.min(1, p.mood + sign * intensity * 0.35));
  w.emit("felt", [p.id], { person: p.id, emotion, cause, intensity: Math.round(intensity * 100) / 100 });
}

/** First name, for readable causes. */
export function firstName(p: Person): string {
  return p.name.split(" ")[0]!;
}

/** Oldest active adult of the household becomes its head. */
export function assignHead(w: World, householdId: number): void {
  const hh = w.households[householdId]!;
  const adults = householdMembers(w, householdId)
    .filter((p) => w.ageYears(p) >= 16)
    .sort((a, b) => a.birthTick - b.birthTick || a.id - b.id);
  const head = adults[0] ?? null;
  const prev = hh.headId;
  for (const p of w.people) if (p.householdId === householdId) p.isHead = head !== null && p.id === head.id;
  hh.headId = head ? head.id : null;
  if (prev !== hh.headId) w.emit("head_chosen", head ? [head.id] : [], { household: householdId, head: hh.headId });
}

/** Elder: the oldest active person not in the most-strained household. */
export function assignElder(w: World): void {
  const candidates = w
    .active()
    .filter((p) => p.householdId !== w.strainedHouseholdId)
    .sort((a, b) => a.birthTick - b.birthTick || a.id - b.id);
  const elder = candidates[0] ?? w.active().sort((a, b) => a.birthTick - b.birthTick || a.id - b.id)[0] ?? null;
  const prev = w.elderId;
  for (const p of w.people) p.role = elder && p.id === elder.id ? "elder" : "none";
  w.elderId = elder ? elder.id : null;
  if (prev !== w.elderId) w.emit("elder_chosen", elder ? [elder.id] : [], { elder: w.elderId });
}
