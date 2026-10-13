import { cheb, inSleepWindow, speedOf } from "../entities/person.ts";
import { foodUnits } from "../world/items.ts";
import type { Building, Person, Point } from "../world/types.ts";
import type { World } from "../world/world.ts";
import type { ActionKind, CandidateAction } from "./types.ts";

export function cand(kind: ActionKind, key: string, description: string, rest: Partial<CandidateAction> & Pick<CandidateAction, "dest" | "duration">): CandidateAction {
  return { kind, key, description, travel: 0, risk: 0, effects: {}, ...rest };
}

export function travelTicks(w: World, p: Person, dest: Point | null): number {
  if (!dest) return 0;
  const d = cheb(p, dest);
  if (d === 0) return 0;
  return Math.ceil((d * 1.25) / speedOf(w, p));
}

export function homeOf(w: World, p: Person): Building {
  return w.house(p.householdId);
}

export function atHome(w: World, p: Person): boolean {
  return w.isInside(p, homeOf(w, p));
}

/** Destination inside the person's own home, or null if already inside. */
export function homeDest(w: World, p: Person): Point | null {
  return atHome(w, p) ? null : { ...homeOf(w, p).bed };
}

export function nearbyPeople(w: World, p: Person, radius: number): Person[] {
  return w.active().filter((o) => o.id !== p.id && cheb(o, p) <= radius);
}

export function homeFood(w: World, p: Person): number {
  return foodUnits(w.households[p.householdId]!.store);
}

export function desperation(w: World, p: Person): number {
  const thr = w.config.decision.theftDesperationFood;
  const d = Math.max(0, Math.min(1, (thr - p.survival.food) / thr));
  const supplies = homeFood(w, p) + foodUnits(p.inventory);
  return supplies > 0 ? d * 0.5 : d;
}

export function sleepy(w: World, p: Person): boolean {
  return inSleepWindow(p, w.env.hour);
}

export function isNight(w: World): boolean {
  return w.env.light < w.config.light.nightThreshold;
}

export function onCooldown(w: World, p: Person, key: string): boolean {
  const until = p.cooldowns[key];
  return until !== undefined && w.tick < until;
}

export function setCooldown(w: World, p: Person, key: string, ticks: number): void {
  p.cooldowns[key] = w.tick + ticks;
}

export function isDetained(w: World, p: Person): boolean {
  return p.detainedUntil !== null && w.tick < p.detainedUntil;
}
