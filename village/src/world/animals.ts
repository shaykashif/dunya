// Animals: livestock graze in their pens and feed the house; wolves rest in
// their dens by day and at night hunt lone people or unguarded livestock.
import { cannotWalk } from "../entities/body.ts";
import { kill } from "../entities/death.ts";
import { BITE_PARTS, injure, noteAnimal, pickPart } from "../entities/injuries.ts";
import { cheb, clamp01, feel, firstName, strengthOf } from "../entities/person.ts";
import { interruptPlan } from "../engine/plans.ts";
import type { Rng } from "../engine/rng.ts";
import { r3 } from "../log/events.ts";
import { gunshot } from "./arms.ts";
import { produce } from "./items.ts";
import { createTrace } from "./traces.ts";
import type { Animal, AnimalKind, Person, Point } from "./types.ts";
import type { World } from "./world.ts";

function walkable(w: World, x: number, y: number): boolean {
  if (!w.map.inBounds(x, y) || !w.map.passable(x, y)) return false;
  const t = w.map.at(x, y);
  return t !== "floor" && t !== "door";
}

/** Greedy steps toward a point; animals cut through forest freely but not through walls or water. */
function stepToward(w: World, a: Animal, to: Point, steps: number, rng: Rng): void {
  for (let i = 0; i < steps; i++) {
    if (a.x === to.x && a.y === to.y) return;
    const options = w.map.neighbors4(a.x, a.y).filter((n) => walkable(w, n.x, n.y));
    if (options.length === 0) return;
    options.sort((p, q) => Math.abs(p.x - to.x) + Math.abs(p.y - to.y) - (Math.abs(q.x - to.x) + Math.abs(q.y - to.y)));
    const best = options[0]!;
    const pick = options.length > 1 && rng.chance(0.15) ? options[1]! : best;
    a.x = pick.x;
    a.y = pick.y;
  }
}

function wander(w: World, a: Animal, radius: number, rng: Rng): void {
  const n = w.map.neighbors4(a.x, a.y).filter((p) => walkable(w, p.x, p.y) && cheb(p, a.home) <= radius);
  if (n.length > 0 && rng.chance(0.5)) {
    const p = rng.pick(n);
    a.x = p.x;
    a.y = p.y;
  }
  if (cheb(a, a.home) > radius) stepToward(w, a, a.home, 1, rng);
}

function nextAnimalId(w: World): number {
  return (w.animals[w.animals.length - 1]?.id ?? 0) + 1;
}

export function spawnAnimals(w: World, rng: Rng): void {
  const cfg = w.config.animals;
  for (const c of w.compounds) {
    const pen = { x: c.center.x + 8, y: c.center.y + 5 };
    for (const kind of ["sheep", "cow", "chicken", "horse"] as const) {
      const [lo, hi] = cfg.livestock[kind];
      const n = kind === "horse" && c.householdId === w.strainedHouseholdId ? 0 : lo + rng.int(hi - lo + 1);
      for (let i = 0; i < n; i++) {
        const spot = w.freeTileNear(pen, 3) ?? pen;
        w.animals.push({ id: nextAnimalId(w), kind, x: spot.x, y: spot.y, alive: true, health: kind === "cow" ? 1 : 0.6, householdId: c.householdId, home: pen, hunger: 0, target: null, state: "graze", fearUntil: 0, riderId: null, log: [{ tick: 0, text: `kept in the ${w.households[c.householdId]?.name ?? ""} pen` }] });
      }
    }
  }
  // Dens: deep forest, as far as possible from every clearing.
  const clearings = [w.map.square, ...w.compounds.map((c) => c.center)];
  const dens: Point[] = [];
  for (let p = 0; p < cfg.wolfPacks; p++) {
    let best: Point | null = null, bestD = -1;
    for (let i = 0; i < 300; i++) {
      const x = 3 + rng.int(w.map.width - 6), y = 3 + rng.int(w.map.height - 6);
      if (w.map.at(x, y) !== "forest") continue;
      const d = Math.min(...clearings.map((c) => cheb(c, { x, y })), ...dens.map((d2) => cheb(d2, { x, y }) / 2));
      if (d > bestD) { bestD = d; best = { x, y }; }
    }
    if (!best) continue;
    dens.push(best);
    for (let i = 0; i < cfg.wolvesPerPack; i++) {
      w.animals.push({ id: nextAnimalId(w), kind: "wolf", x: best.x, y: best.y, alive: true, health: cfg.wolfHealth, householdId: null, home: best, hunger: r3(rng.next() * 0.5), target: null, state: "rest", fearUntil: 0, riderId: null, log: [{ tick: 0, text: `denned in the deep forest with pack ${p + 1}` }] });
    }
  }
}

function peopleNear(w: World, at: Point, r: number, exceptId = -1): Person[] {
  return w.people.filter((p) => p.alive && !p.exiled && p.id !== exceptId && !w.isCarried(p) && cheb(p, at) <= r);
}

function outdoors(w: World, p: Point): boolean {
  return !w.map.roofed(p.x, p.y);
}

/** A wolf bites; the victim screams, then fights back or runs. */
function wolfAttack(w: World, wolf: Animal, victim: Person, rng: Rng): void {
  const cfg = w.config.animals;
  const bite = r3(cfg.wolfBite[0] + rng.next() * (cfg.wolfBite[1] - cfg.wolfBite[0]));
  victim.survival.health = clamp01(victim.survival.health - bite);
  victim.lossCause.animal += bite;
  victim.bloodyClothes = true;
  const helpless = cannotWalk(victim);
  if (victim.survival.health > 0) injure(w, victim, pickPart(rng, BITE_PARTS), "bite", bite * 3.2, "a wolf bit them", null);
  interruptPlan(w, victim, "wolf");
  noteAnimal(w, wolf, `bit ${firstName(victim)}${helpless ? ", who lay helpless" : ""}`);
  // Someone who cannot walk cannot run; they can only fight from the ground.
  const fights = w.ageYears(victim) >= 12 && (helpless || victim.personality.boldness > 0.45 || victim.survival.health > 0.7);
  let wolfDamage = 0;
  if (fights && victim.survival.health > 0) {
    wolfDamage = r3((0.1 + rng.next() * 0.25) * strengthOf(w, victim) * (victim.inventory.tool > 0 ? 1.4 : 1) * (helpless ? 0.5 : 1));
    wolf.health -= wolfDamage;
    if (victim.inventory.tool > 0) victim.bloodyTool = true;
  } else {
    victim.cooldowns["fleeing"] = w.tick + 6;
  }
  w.emit("wolf_attack", victim.survival.health > 0 ? [victim.id] : [], { wolf: wolf.id, person: victim.id, bite, response: fights ? "fight" : "flee", wolfDamage, at: [victim.x, victim.y] });
  // The scream carries: it wakes and calls whoever can hear it.
  createTrace(w, "sound", { x: victim.x, y: victim.y }, [{ kind: "person", id: victim.id }], { what: "scream" }, null);
  w.emit("scream", victim.survival.health > 0 ? [victim.id] : [], { person: victim.id, at: [victim.x, victim.y] });
  for (const h of peopleNear(w, victim, w.config.perception.hearRadius + 4, victim.id)) {
    if (w.ageYears(h) < 14) continue;
    h.cooldowns[`help:${victim.id}`] = w.tick + 8;
    if (!h.asleep) interruptPlan(w, h, "heard a scream");
  }
  if (wolf.health <= 0) {
    wolf.alive = false;
    noteAnimal(w, wolf, `was killed by ${firstName(victim)}, whom it attacked`);
    w.emit("wolf_killed", victim.survival.health > 0 ? [victim.id] : [], { wolf: wolf.id, by: victim.id, at: [wolf.x, wolf.y] });
    if (victim.survival.health > 0) feel(w, victim, "triumphant", "killed a wolf that attacked them", 0.7);
  }
  if (victim.survival.health <= 0) {
    kill(w, victim, "animal", null, null);
    noteAnimal(w, wolf, `killed ${firstName(victim)}`);
  } else {
    feel(w, victim, "afraid", "a wolf attacked them", 0.8);
  }
}

/** Someone answering a scream strikes at a wolf. */
export function strikeWolf(w: World, p: Person, wolf: Animal, rng: Rng): void {
  const shot = p.inventory.musket > 0;
  if (shot) gunshot(w, p, { x: wolf.x, y: wolf.y }, "wolf");
  const dmg = r3(shot ? (rng.chance(w.config.muskets.hitChance) ? 0.8 : 0) : (0.1 + rng.next() * 0.3) * strengthOf(w, p) * (p.inventory.tool > 0 ? 1.4 : 1));
  wolf.health -= dmg;
  wolf.fearUntil = w.tick + 12;
  wolf.target = null;
  wolf.state = "flee";
  if (p.inventory.tool > 0) p.bloodyTool = true;
  w.emit("wolf_struck", [p.id], { wolf: wolf.id, by: p.id, damage: dmg });
  noteAnimal(w, wolf, `was ${shot ? (dmg > 0 ? "shot" : "shot at") : "struck"} by ${firstName(p)} and fled`);
  if (wolf.health <= 0) {
    wolf.alive = false;
    noteAnimal(w, wolf, `was killed by ${firstName(p)}`);
    w.emit("wolf_killed", [p.id], { wolf: wolf.id, by: p.id, at: [wolf.x, wolf.y] });
    feel(w, p, "proud", "killed a wolf", 0.6);
  }
}

function personTarget(w: World, wolf: Animal): Person | null {
  if (!wolf.target?.startsWith("p:")) return null;
  const p = w.maybePerson(Number(wolf.target.slice(2)));
  return p && p.alive && !p.exiled ? p : null;
}

function animalTarget(w: World, wolf: Animal): Animal | null {
  if (!wolf.target?.startsWith("a:")) return null;
  const id = Number(wolf.target.slice(2));
  return w.animals.find((a) => a.id === id && a.alive) ?? null;
}

function isLone(w: World, p: Person): boolean {
  return outdoors(w, p) && peopleNear(w, p, w.config.animals.wolfLoneRadius, p.id).length === 0;
}

/** Engine step for animals, run after people act. */
export function updateAnimals(w: World): void {
  const cfg = w.config.animals;
  const rng = w.rng.get("animals");
  const night = w.env.light < w.config.light.nightThreshold;
  const tpd = w.config.time.ticksPerDay;
  const winter = w.env.season === 3;
  for (const a of w.animals) {
    if (!a.alive) continue;
    if (a.kind !== "wolf") {
      // Livestock graze by day in the warm seasons; in winter they need to be fed.
      a.hunger = clamp01(a.hunger + cfg.livestockHungerPerDay / tpd - (!night && !winter && a.riderId === null ? cfg.grazePerTick : 0));
      if (a.riderId !== null) continue;
      const was = a.state;
      a.state = night ? "rest" : "graze";
      if (was !== a.state && was !== "ridden") noteAnimal(w, a, a.state === "rest" ? "bedded down in the pen for the night" : winter ? "stood about the pen, waiting for feed" : "went out grazing");
      if (a.kind === "horse" && cheb(a, a.home) > 6) stepToward(w, a, a.home, 6, rng);
      else wander(w, a, night ? 1 : 3, rng);
      continue;
    }
    const before = a.state;
    a.hunger = clamp01(a.hunger + cfg.wolfHungerPerDay / tpd);
    // Groups scare wolves off.
    const crowd = peopleNear(w, a, 4).filter((p) => !p.asleep);
    if (crowd.length >= cfg.wolfGroupFear && a.state === "hunt") {
      a.state = "flee";
      a.fearUntil = w.tick + 12;
      a.target = null;
      noteAnimal(w, a, `was driven off by ${crowd.length} people`);
      w.emit("wolves_driven_off", crowd.map((p) => p.id), { wolf: a.id, by: crowd.map((p) => p.id) });
    }
    if (w.tick < a.fearUntil || !night || a.hunger < 0.3) {
      a.state = w.tick < a.fearUntil ? "flee" : "rest";
      a.target = null;
      if (before !== a.state) noteAnimal(w, a, a.state === "flee" ? "fled back toward the den" : night ? "lay in the den, not hungry enough to hunt" : "slept in the den through the day");
      if (cheb(a, a.home) > 3) stepToward(w, a, a.home, cfg.wolfSpeed, rng);
      else wander(w, a, 3, rng);
      continue;
    }
    // Hunting.
    // Someone lying helpless, bleeding, carries a scent from further off.
    const reach = (p: Person) => cfg.wolfHuntRadius * (cannotWalk(p) ? 1.5 : 1);
    let prey = personTarget(w, a);
    if (prey && (!isLone(w, prey) || cheb(prey, a.home) > reach(prey))) {
      a.target = null;
      prey = null;
    }
    let beast = animalTarget(w, a);
    if (!prey && !beast) {
      const lone = w.active()
        .filter((p) => !w.isCarried(p) && cheb(p, a.home) <= reach(p) && isLone(w, p))
        .sort((p, q) => Number(cannotWalk(q)) - Number(cannotWalk(p)) || cheb(p, a) - cheb(q, a) || p.id - q.id);
      if (lone[0]) {
        prey = lone[0];
        a.target = `p:${prey.id}`;
        noteAnimal(w, a, `caught the scent of ${firstName(prey)}, alone ${cannotWalk(prey) ? "and helpless " : ""}outdoors`);
      } else {
        const stock = w.animals
          .filter((s) => s.alive && s.kind !== "wolf" && s.riderId === null && cheb(s, a.home) <= cfg.wolfHuntRadius && peopleNear(w, s, 8).filter((p) => !p.asleep).length === 0)
          .sort((p, q) => cheb(p, a) - cheb(q, a) || p.id - q.id);
        if (stock[0]) {
          beast = stock[0];
          a.target = `a:${beast.id}`;
          noteAnimal(w, a, `stalked an unguarded ${beast.kind}${beast.householdId !== null ? ` of the ${w.households[beast.householdId]!.name} house` : ""}`);
        }
      }
    }
    a.state = prey || beast ? "hunt" : "prowl";
    const goal: Point | null = prey ?? beast;
    if (!goal) {
      if (before !== "prowl") noteAnimal(w, a, "left the den to prowl the night");
      wander(w, a, 12, rng);
      continue;
    }
    stepToward(w, a, goal, cfg.wolfSpeed, rng);
    if (prey && cheb(a, prey) <= 1) {
      wolfAttack(w, a, prey, rng);
      a.hunger = clamp01(a.hunger - 0.2);
    } else if (beast && cheb(a, beast) <= 1) {
      beast.health -= 0.5;
      noteAnimal(w, beast, "was set upon by a wolf");
      if (beast.health <= 0) {
        beast.alive = false;
        noteAnimal(w, beast, "was killed by a wolf");
        noteAnimal(w, a, `killed a ${beast.kind} and ate its fill`);
        a.hunger = 0;
        a.target = null;
        createTrace(w, "blood", { x: beast.x, y: beast.y }, [], { what: beast.kind }, null);
        w.emit("livestock_killed", [], { by: "wolf", wolf: a.id, animal: beast.id, kind: beast.kind, household: beast.householdId, at: [beast.x, beast.y] });
        if (beast.householdId !== null) {
          for (const m of w.active()) if (m.householdId === beast.householdId && !m.asleep && w.ageYears(m) >= 12 && cheb(m, beast) <= 20) feel(w, m, "angry", `wolves killed one of their ${beast.kind === "sheep" ? "sheep" : beast.kind + "s"}`, 0.4);
        }
      }
    }
  }
}

/** Daily yields from healthy, tended livestock. */
export function livestockYield(w: World): void {
  const cfg = w.config.animals;
  for (const hh of w.households) {
    const herd = w.animals.filter((a) => a.alive && a.householdId === hh.id);
    const tended = w.tick - (w.livestockTended[hh.id] ?? -Infinity) <= w.days(2) ? 1 : 0.5;
    // Starving animals give little.
    const fed = (a: Animal) => a.hunger < 0.8;
    const cows = herd.filter((a) => a.kind === "cow" && fed(a)).length;
    const hens = herd.filter((a) => a.kind === "chicken" && fed(a)).length;
    const sheep = herd.filter((a) => a.kind === "sheep" && fed(a)).length;
    const to = { t: "household" as const, id: hh.id };
    produce(w, to, "milk", Math.floor(cows * cfg.milkPerCow * tended), "milked");
    produce(w, to, "eggs", Math.floor(hens * cfg.eggsPerHen * tended), "eggs_laid");
    if (w.env.day > 0 && w.env.day % cfg.woolEveryDays === 0) produce(w, to, "cloth", Math.floor(sheep / 2), "shorn");
  }
}

export function livestockOf(w: World, householdId: number, kind?: AnimalKind): Animal[] {
  return w.animals.filter((a) => a.alive && a.householdId === householdId && (kind === undefined || a.kind === kind));
}

export function wolvesNear(w: World, at: Point, r: number): Animal[] {
  return w.animals.filter((a) => a.alive && a.kind === "wolf" && cheb(a, at) <= r).sort((p, q) => cheb(p, at) - cheb(q, at) || p.id - q.id);
}

