// Horses and muskets.
import { noteAnimal } from "../entities/injuries.ts";
import { cheb, feel, firstName } from "../entities/person.ts";
import { interruptPlan } from "../engine/plans.ts";
import type { Animal, Person, Point } from "./types.ts";
import { createTrace } from "./traces.ts";
import type { World } from "./world.ts";

function pen(w: World, hid: number): Point {
  const c = w.compound(hid).center;
  return { x: c.x + 8, y: c.y + 5 };
}

export function horseOf(w: World, p: Person): Animal | null {
  if (p.ridingHorseId === null) return null;
  return w.animals.find((a) => a.id === p.ridingHorseId && a.alive) ?? null;
}

/** Someone setting off on a long trip saddles one of the house's free horses, if one is near. */
export function maybeMount(w: World, p: Person, dest: Point): void {
  if (p.ridingHorseId !== null || w.ageYears(p) < 12 || cheb(p, dest) <= w.config.animals.rideAbove) return;
  const horse = w.animals.find((a) => a.alive && a.kind === "horse" && a.householdId === p.householdId && a.riderId === null && cheb(a, p) <= 12);
  if (!horse) return;
  horse.riderId = p.id;
  horse.state = "ridden";
  p.ridingHorseId = horse.id;
  noteAnimal(w, horse, `was saddled by ${firstName(p)} for a long ride`);
  w.emit("mounted", [p.id], { person: p.id, horse: horse.id });
}

export function dismount(w: World, p: Person, reason: string): void {
  const horse = horseOf(w, p);
  p.ridingHorseId = null;
  if (!horse) return;
  horse.riderId = null;
  horse.state = "graze";
  noteAnimal(w, horse, reason === "went indoors" ? `was left at a door by ${firstName(p)}` : `was turned out after carrying ${firstName(p)}`);
  w.emit("dismounted", p.alive && !p.exiled ? [p.id] : [], { person: p.id, horse: horse.id, reason });
}

/**
 * Riders leave their horse at the door when they go indoors, and turn it out to
 * the pen when they are home with nowhere far to go. Horses follow their rider.
 */
export function updateRiders(w: World): void {
  for (const p of w.people) {
    if (p.ridingHorseId === null) continue;
    const horse = horseOf(w, p);
    if (!p.alive || p.exiled || !horse) {
      dismount(w, p, "rider gone");
      continue;
    }
    const indoors = w.map.roofed(p.x, p.y);
    const travelling = p.plan?.phase === "travel" && p.plan.cand.dest !== null && cheb(p, p.plan.cand.dest) > 6;
    if (indoors || (!travelling && cheb(p, pen(w, p.householdId)) <= 14)) {
      dismount(w, p, indoors ? "went indoors" : "home");
      continue;
    }
    horse.x = p.x;
    horse.y = p.y;
  }
}

/**
 * A musket shot: loud, heard far off. A shot in the forest sounds like hunting;
 * one anywhere else draws people who hear it to go and see.
 */
export function gunshot(w: World, shooter: Person, at: Point, purpose: string): void {
  const radius = w.config.muskets.hearRadius;
  createTrace(w, "sound", at, [{ kind: "person", id: shooter.id }], { what: "gunshot", radius }, null);
  const inForest = w.map.at(at.x, at.y) === "forest" || w.map.forestCover(at.x, at.y, at.x, at.y) > 0;
  w.emit("gunshot", [shooter.id], { shooter: shooter.id, at: [at.x, at.y], purpose, forest: inForest });
  if (inForest) return;
  for (const h of w.people) {
    if (!h.alive || h.exiled || h.id === shooter.id || w.isCarried(h) || w.ageYears(h) < 14) continue;
    if (cheb(h, at) > radius) continue;
    h.cooldowns[`shot:${at.x},${at.y}`] = w.tick + 12;
    if (h.asleep) interruptPlan(w, h, "gunshot");
    feel(w, h, "afraid", "heard a gunshot nearby", 0.3);
  }
}
