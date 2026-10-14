// Small helpers about soldiers: names, speed, notes.
import { cheb } from "../world/map.ts";
import type { Pace, Point, Soldier } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { mobility } from "./body.ts";

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** "Pvt. Kowalski". */
export function label(s: Soldier): string {
  return `${s.abbr} ${s.last}`;
}

/** Remembers something that happened to or was done by a soldier, newest last. */
export function note(w: World, s: Soldier, text: string): void {
  const last = s.recent[s.recent.length - 1];
  if (last && last.text === text) return;
  s.recent.push({ tick: w.tick, text });
  if (s.recent.length > 24) s.recent.shift();
}

/** Tiles per tick at a pace, after fitness, wounds, any load and how blown he is. A winded man cannot run. */
export function speedOf(w: World, s: Soldier, pace: Pace): number {
  const f = w.config.fatigue;
  const p = pace === "rush" && s.fatigue >= f.winded ? "walk" : pace;
  let v = w.config.movement.speed[p] * (0.85 + 0.3 * s.traits.fitness) * mobility(s) * (1 - f.speedLoss * s.fatigue);
  if (s.carryingId !== null) v *= w.config.movement.carrySpeed;
  return v;
}

/** Where a man is, as a point that keeps his floor. */
export function spotOf(s: Soldier): Point {
  return s.z > 0 ? { x: s.x, y: s.y, z: s.z } : { x: s.x, y: s.y };
}

export function postureFor(pace: Pace): "stand" | "crouch" | "prone" {
  return pace === "crawl" ? "prone" : pace === "crouch" ? "crouch" : "stand";
}

export function isLeader(s: Soldier): boolean {
  return s.role === "squad_leader" || s.role === "platoon_leader" || s.role === "platoon_sergeant" || s.role === "asst_leader";
}

export function isGunner(s: Soldier): boolean {
  return s.role === "machine_gunner" || s.role === "auto_rifleman";
}

export function nearest<T extends Point>(from: Point, xs: readonly T[]): T | null {
  let best: T | null = null, bd = Infinity;
  for (const x of xs) {
    const d = cheb(from, x);
    if (d < bd) {
      bd = d;
      best = x;
    }
  }
  return best;
}

/** A short shout, shown in the chronicle and over the soldier's head. */
export function shout(w: World, s: Soldier, text: string, cooldownKey: string | null = null, ticks = 20): void {
  if (cooldownKey) {
    const until = s.cooldowns[cooldownKey];
    if (until !== undefined && w.tick < until) return;
    s.cooldowns[cooldownKey] = w.tick + ticks;
  }
  w.emit("callout", [s.id], { by: s.id, text, at: [s.x, s.y] });
}

/** A German's startled oath: rare, a few in a whole battle, and never the same man twice soon. */
export function gasp(w: World, s: Soldier): void {
  if (s.side !== "de" || !w.rng.get("runners").chance(0.04)) return;
  shout(w, s, "Heiliger Strohsack!", "strohsack", 1500);
}
