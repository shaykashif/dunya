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
import { GAME_KINDS, type Animal, type AnimalKind, type Person, type Point } from "./types.ts";
import type { World } from "./world.ts";

/** Animals keep out of buildings; wolves swim, livestock do not. */
function walkable(w: World, a: Animal, x: number, y: number): boolean {
  if (!w.map.inBounds(x, y)) return false;
  const t = w.map.at(x, y);
  if (t === "water") return a.kind === "wolf";
  if (!w.map.passable(x, y)) return false;
  return t !== "floor" && t !== "door";
}

/**
 * Greedy steps toward a point. Animals cut through forest as fast as open
 * ground; a swimming wolf spends two steps on each tile of water.
 */
function stepToward(w: World, a: Animal, to: Point, steps: number, rng: Rng): void {
  for (let i = 0; i < steps; i++) {
    if (a.x === to.x && a.y === to.y) return;
    const options = w.map.neighbors4(a.x, a.y).filter((n) => walkable(w, a, n.x, n.y));
    if (options.length === 0) return;
    options.sort((p, q) => Math.abs(p.x - to.x) + Math.abs(p.y - to.y) - (Math.abs(q.x - to.x) + Math.abs(q.y - to.y)));
    const best = options[0]!;
    const pick = options.length > 1 && rng.chance(0.15) ? options[1]! : best;
    a.x = pick.x;
    a.y = pick.y;
    if (w.map.at(a.x, a.y) === "water") i++;
  }
}

function wander(w: World, a: Animal, radius: number, rng: Rng): void {
  const n = w.map.neighbors4(a.x, a.y).filter((p) => walkable(w, a, p.x, p.y) && cheb(p, a.home) <= radius);
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
        w.animals.push({ id: nextAnimalId(w), kind, x: spot.x, y: spot.y, alive: true, health: kind === "cow" ? 1 : 0.6, householdId: c.householdId, home: pen, hunger: 0, target: null, state: "graze", fearUntil: 0, riderId: null, goal: null, chase: 0, diedTick: null, skinned: false, log: [{ tick: 0, text: `kept in the ${w.households[c.householdId]?.name ?? ""} pen` }] });
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
      w.animals.push({ id: nextAnimalId(w), kind: "wolf", x: best.x, y: best.y, alive: true, health: cfg.wolfHealth, householdId: null, home: best, hunger: r3(rng.next() * 0.5), target: null, state: "rest", fearUntil: 0, riderId: null, goal: null, chase: 0, diedTick: null, skinned: false, log: [{ tick: 0, text: `denned in the deep forest with pack ${p + 1}` }] });
    }
  }
}

/** An animal dies where it stands; its carcass stays until it rots or is cleared. */
export function killAnimal(w: World, a: Animal): void {
  a.alive = false;
  a.diedTick = w.tick;
  a.state = "rest";
  a.target = null;
}

/** A carcass still lying about, fresh enough to see (and to skin). */
export function isCarcass(w: World, a: Animal): boolean {
  return !a.alive && a.diedTick !== null && w.tick - a.diedTick < w.days(w.config.animals.carcassDays);
}

/** A fresh wild animal at a spot. */
function newGame(w: World, kind: AnimalKind, at: Point, home: Point, text: string): Animal {
  return { id: nextAnimalId(w), kind, x: at.x, y: at.y, alive: true, health: kind === "deer" ? 0.7 : 0.3, householdId: null, home: { ...home }, hunger: 0, target: null, state: "graze", fearUntil: 0, riderId: null, goal: null, chase: 0, diedTick: null, skinned: false, log: [{ tick: w.tick, text }] };
}

/** Deep forest, as far as possible from every clearing and from the given points. */
function deepForest(w: World, rng: Rng, avoid: Point[], tries = 200): Point | null {
  const clearings = [w.map.square, ...w.compounds.map((c) => c.center)];
  let best: Point | null = null, bestD = -1;
  for (let i = 0; i < tries; i++) {
    const x = 3 + rng.int(w.map.width - 6), y = 3 + rng.int(w.map.height - 6);
    if (w.map.at(x, y) !== "forest") continue;
    const d = Math.min(...clearings.map((c) => cheb(c, { x, y })), ...avoid.map((a) => cheb(a, { x, y }) * 1.5));
    if (d > bestD) { bestD = d; best = { x, y }; }
  }
  return best;
}

/** Deer herds in the deep woods, rabbits scattered through the forest, a few foxes. */
export function spawnGame(w: World, rng: Rng): void {
  const g = w.config.animals.game;
  const ranges: Point[] = [];
  for (let h = 0; h < g.deerHerds; h++) {
    const home = deepForest(w, rng, ranges, 120);
    if (!home) continue;
    ranges.push(home);
    const n = g.deerPerHerd[0] + rng.int(g.deerPerHerd[1] - g.deerPerHerd[0] + 1);
    for (let i = 0; i < n; i++) w.animals.push(newGame(w, "deer", { x: home.x + rng.int(5) - 2, y: home.y + rng.int(5) - 2 }, home, `born to the herd of the deep woods`));
  }
  for (let i = 0; i < g.rabbits; i++) {
    const at = w.map.forest[rng.int(w.map.forest.length)];
    if (at) w.animals.push(newGame(w, "rabbit", at, at, "dug a warren at the forest's edge"));
  }
  for (let i = 0; i < g.foxes; i++) {
    const at = deepForest(w, rng, ranges, 40);
    if (at) w.animals.push(newGame(w, "fox", at, at, "made an earth in the woods"));
  }
}

/** The step away from a threat that puts the most ground between them. */
function fleeFrom(w: World, a: Animal, from: Point, steps: number): void {
  for (let i = 0; i < steps; i++) {
    const options = w.map.neighbors4(a.x, a.y).filter((n) => walkable(w, a, n.x, n.y));
    if (options.length === 0) return;
    options.sort((p, q) => cheb(q, from) - cheb(p, from) || Math.abs(q.x - from.x) + Math.abs(q.y - from.y) - (Math.abs(p.x - from.x) + Math.abs(p.y - from.y)));
    a.x = options[0]!.x;
    a.y = options[0]!.y;
  }
}

/** What a wild animal is afraid of right now: a person on the move, a hunting wolf or (for rabbits) a fox. */
function nearestThreat(w: World, a: Animal): Point | null {
  const r = (w.config.animals.game.spook as Record<string, number>)[a.kind] ?? 6;
  const still = (w.config.animals.game.spookStill as Record<string, number>)[a.kind] ?? 2;
  let best: Point | null = null, bestD = Infinity;
  for (const p of w.people) {
    if (!p.alive || p.exiled || w.isCarried(p)) continue;
    const d = cheb(p, a);
    // A still, stalking hunter goes unnoticed until very close.
    const moving = p.plan?.phase === "travel";
    if (d > (moving ? r : still) || d >= bestD) continue;
    best = p;
    bestD = d;
  }
  for (const o of w.animals) {
    if (!o.alive || o.id === a.id) continue;
    const predator = (o.kind === "wolf" && (o.state === "hunt" || o.state === "prowl")) || (o.kind === "fox" && a.kind === "rabbit" && o.state === "hunt");
    if (!predator) continue;
    const d = cheb(o, a);
    if (d <= r && d < bestD) { best = o; bestD = d; }
  }
  return best;
}

/**
 * Wild game: deer graze their range by day and bed down at night; rabbits keep
 * close to their warren; foxes hunt rabbits and unguarded hens at night. All of
 * them bolt from people on the move and from hunting predators.
 */
function gameStep(w: World, a: Animal, night: boolean, rng: Rng): void {
  const g = w.config.animals.game;
  const speed = (g.speed as Record<string, number>)[a.kind] ?? 12;
  const threat = nearestThreat(w, a);
  if (threat) {
    if (a.state !== "flee") noteAnimal(w, a, "bolted at a threat");
    a.state = "flee";
    a.target = null;
    fleeFrom(w, a, threat, speed);
    return;
  }
  // A fox hunts once it is hungry again, about once a night.
  if (a.kind === "fox") a.hunger = clamp01(a.hunger + 0.6 / w.config.time.ticksPerDay);
  if (a.kind === "fox" && night && a.hunger >= 0.5) {
    let prey = animalTarget(w, a);
    if (!prey) {
      // Rabbits first; hens only when there are none about, and never behind a palisade.
      const near = w.animals.filter((o) => o.alive && cheb(o, a) <= 18);
      prey =
        near.filter((o) => o.kind === "rabbit").sort((p, q) => cheb(p, a) - cheb(q, a) || p.id - q.id)[0] ??
        near.filter((o) => o.kind === "chicken" && !(o.householdId !== null && w.fenced.includes(o.householdId))).sort((p, q) => cheb(p, a) - cheb(q, a) || p.id - q.id)[0] ??
        null;
      if (prey) {
        a.target = `a:${prey.id}`;
        noteAnimal(w, a, `went after a ${prey.kind}`);
      }
    }
    if (prey) {
      a.state = "hunt";
      stepToward(w, a, prey, speed - 2, rng);
      if (cheb(a, prey) <= 1) {
        a.target = null;
        if (rng.chance((g.caught as Record<string, number>)[prey.kind] ?? 0.5)) {
          a.hunger = 0;
          killAnimal(w, prey);
          noteAnimal(w, prey, "was taken by a fox");
          noteAnimal(w, a, `caught a ${prey.kind}`);
          if (prey.householdId !== null) w.emit("livestock_killed", [], { by: "fox", animal: prey.id, kind: prey.kind, household: prey.householdId, at: [prey.x, prey.y] });
        }
      }
      return;
    }
  }
  const resting = a.kind === "fox" ? !night : night;
  a.state = resting ? "rest" : "graze";
  if (resting) {
    if (cheb(a, a.home) > 3) stepToward(w, a, a.home, 2, rng);
    return;
  }
  wander(w, a, a.kind === "deer" ? g.herdRange : a.kind === "rabbit" ? 6 : 12, rng);
}

/** A forest tile on the edge of the map, where game comes in from beyond. */
function edgeForest(w: World, rng: Rng): Point | null {
  for (let i = 0; i < 40; i++) {
    const side = rng.int(4);
    const x = side === 0 ? 0 : side === 1 ? w.map.width - 1 : rng.int(w.map.width);
    const y = side === 2 ? 0 : side === 3 ? w.map.height - 1 : rng.int(w.map.height);
    if (w.map.at(x, y) === "forest") return { x, y };
  }
  return null;
}

/** Herds and warrens refill slowly, and when the woods are hunted out, game wanders in from beyond. */
function breedGame(w: World, rng: Rng): void {
  const g = w.config.animals.game;
  const day = w.env.day;
  if (day > 0 && day % g.wanderInEveryDays === 0) {
    const count = (k: AnimalKind) => w.animals.filter((a) => a.alive && a.kind === k).length;
    const deerTarget = g.deerHerds * g.deerPerHerd[0];
    if (count("deer") < deerTarget) {
      const at = edgeForest(w, rng);
      const ranges: Point[] = [];
      for (const a of w.animals) if (a.alive && a.kind === "deer" && !ranges.some((r) => r.x === a.home.x && r.y === a.home.y)) ranges.push(a.home);
      const home = ranges.length > 0 && rng.chance(0.5) ? ranges[rng.int(ranges.length)]! : deepForest(w, rng, ranges, 80);
      if (at && home) {
        const n = 2 + rng.int(3);
        for (let i = 0; i < n; i++) w.animals.push(newGame(w, "deer", at, home, "wandered in from beyond the woods"));
        w.emit("game_arrived", [], { kind: "deer", count: n, at: [at.x, at.y] });
      }
    }
    if (count("rabbit") < g.rabbits / 2) {
      const at = edgeForest(w, rng);
      if (at) for (let i = 0; i < 3; i++) w.animals.push(newGame(w, "rabbit", at, at, "hopped in from beyond the woods"));
    }
    if (count("fox") < Math.ceil(g.foxes / 2)) {
      const at = edgeForest(w, rng);
      if (at) w.animals.push(newGame(w, "fox", at, at, "slunk in from beyond the woods"));
    }
  }
  if (day > 0 && day % g.deerBirthEveryDays === 0) {
    const herds = new Map<string, Animal[]>();
    for (const a of w.animals) if (a.alive && a.kind === "deer") herds.set(`${a.home.x},${a.home.y}`, [...(herds.get(`${a.home.x},${a.home.y}`) ?? []), a]);
    for (const herd of herds.values()) {
      if (herd.length < 2 || herd.length >= g.maxPerHerd) continue;
      const mother = herd[0]!;
      w.animals.push(newGame(w, "deer", { x: mother.x, y: mother.y }, mother.home, "was born a fawn in the herd"));
    }
  }
  if (day > 0 && day % g.rabbitBirthEveryDays === 0) {
    const rabbits = w.animals.filter((a) => a.alive && a.kind === "rabbit");
    if (rabbits.length >= 2 && rabbits.length < g.maxRabbits) {
      const parent = rabbits[rng.int(rabbits.length)]!;
      w.animals.push(newGame(w, "rabbit", parent, parent.home, "was born in the warren"));
    }
  }
}

function peopleNear(w: World, at: Point, r: number, exceptId = -1): Person[] {
  return w.people.filter((p) => p.alive && !p.exiled && p.id !== exceptId && !w.isCarried(p) && cheb(p, at) <= r);
}

function outdoors(w: World, p: Point): boolean {
  return !w.map.roofed(p.x, p.y);
}

/** A cornered wolf bites back (at its den, say). */
export function wolfBite(w: World, wolf: Animal, victim: Person, rng: Rng): void {
  wolfAttack(w, wolf, victim, rng);
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
    killAnimal(w, wolf);
    noteAnimal(w, wolf, `was killed by ${firstName(victim)}, whom it attacked`);
    w.emit("wolf_killed", victim.survival.health > 0 ? [victim.id] : [], { wolf: wolf.id, by: victim.id, at: [wolf.x, wolf.y] });
    if (victim.survival.health > 0) feel(w, victim, "triumphant", "killed a wolf that attacked them", 0.7);
  }
  // The house wants these wolves dead.
  for (const m of w.active()) if (m.householdId === victim.householdId && w.ageYears(m) >= 16) m.cooldowns["wolfhunt"] = w.tick + w.days(3);
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
    killAnimal(w, wolf);
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
  if (w.env.minuteOfDay === 0) breedGame(w, rng);
  for (const a of w.animals) {
    if (!a.alive) continue;
    if (GAME_KINDS.includes(a.kind)) {
      gameStep(w, a, night, rng);
      continue;
    }
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
    wolfStep(w, a, night, rng);
  }
}

/** Forest beside a road, near the den: where a pack lies in wait at night. */
function ambushSpot(w: World, a: Animal, rng: Rng): Point | null {
  // Packmates share a spot.
  const mate = w.animals.find((o) => o.alive && o.kind === "wolf" && o.id !== a.id && o.home.x === a.home.x && o.home.y === a.home.y && o.goal !== null);
  if (mate?.goal) return { x: mate.goal.x + rng.int(3) - 1, y: mate.goal.y + rng.int(3) - 1 };
  const r = w.config.animals.wolfAmbushRadius;
  for (let i = 0; i < 80; i++) {
    const x = a.home.x + rng.int(2 * r + 1) - r, y = a.home.y + rng.int(2 * r + 1) - r;
    if (!w.map.inBounds(x, y) || w.map.at(x, y) !== "forest") continue;
    if (w.map.neighbors4(x, y).some((n) => w.map.at(n.x, n.y) === "path")) return { x, y };
  }
  return null;
}

/** Somewhere in the deep woods to range over by day. */
function roamSpot(w: World, a: Animal, rng: Rng): Point | null {
  const r = w.config.animals.wolfRoamRadius;
  for (let i = 0; i < 30; i++) {
    const x = a.home.x + rng.int(2 * r + 1) - r, y = a.home.y + rng.int(2 * r + 1) - r;
    if (w.map.inBounds(x, y) && w.map.at(x, y) === "forest") return { x, y };
  }
  return null;
}

/**
 * Wolves: by day they sleep at the den through the middle hours and range the
 * deep woods morning and evening. At night, hungry, they lie in wait in the
 * trees beside a road and spring on anyone who passes alone; they run down the
 * helpless from far off, and when hungry enough raid unguarded pens.
 */
function wolfStep(w: World, a: Animal, night: boolean, rng: Rng): void {
  const cfg = w.config.animals;
  const tpd = w.config.time.ticksPerDay;
  const before = a.state;
  a.hunger = clamp01(a.hunger + cfg.wolfHungerPerDay / tpd);
  // Groups scare wolves off.
  const crowd = peopleNear(w, a, 4).filter((p) => !p.asleep);
  if (crowd.length >= cfg.wolfGroupFear && (a.state === "hunt" || a.state === "ambush")) {
    a.state = "flee";
    a.fearUntil = w.tick + 12;
    a.target = null;
    a.goal = null;
    noteAnimal(w, a, `was driven off by ${crowd.length} people`);
    w.emit("wolves_driven_off", crowd.map((p) => p.id), { wolf: a.id, by: crowd.map((p) => p.id) });
  }
  if (w.tick < a.fearUntil) {
    a.state = "flee";
    a.target = null;
    if (before !== "flee") noteAnimal(w, a, "fled back toward the den");
    stepToward(w, a, a.home, cfg.wolfSpeed, rng);
    return;
  }
  if (!night || a.hunger < 0.3) {
    a.target = null;
    if (before === "ambush" || before === "hunt") a.goal = null;
    const h = w.env.hour;
    const sleepy = !night && h >= 10 && h < 16;
    if (sleepy || a.hunger < 0.15) {
      a.state = "rest";
      a.goal = null;
      if (before !== "rest") noteAnimal(w, a, night ? "lay in the den, not hungry enough to hunt" : "slept at the den through the middle of the day");
      if (cheb(a, a.home) > 3) stepToward(w, a, a.home, cfg.wolfSpeed, rng);
      else wander(w, a, 3, rng);
      return;
    }
    // Ranging the woods.
    if (!a.goal || cheb(a, a.goal) <= 1) a.goal = roamSpot(w, a, rng);
    a.state = "roam";
    if (before !== "roam") noteAnimal(w, a, "ranged out through the deep woods");
    if (a.goal) stepToward(w, a, a.goal, Math.ceil(cfg.wolfSpeed / 3), rng);
    return;
  }

  // Night, and hungry.
  let prey = personTarget(w, a);
  if (prey && !isLone(w, prey)) {
    a.target = null;
    prey = null;
  }
  let beast = animalTarget(w, a);
  // A chase that has gone on too long is given up.
  if (beast && GAME_KINDS.includes(beast.kind) && a.chase >= w.config.animals.game.chaseTicks) {
    noteAnimal(w, a, `lost the ${beast.kind} it was chasing`);
    a.target = null;
    a.chase = -w.config.animals.game.chaseRest;
    beast = null;
  }
  if (a.chase < 0) a.chase++;
  if (!prey && !beast) {
    // The helpless are smelled from far off; anyone alone and near the ambush is fair game.
    const lone = w.active()
      .filter((p) => !w.isCarried(p) && isLone(w, p) && ((cannotWalk(p) && cheb(p, a.home) <= cfg.wolfHuntRadius * 1.5) || (a.hunger >= 0.6 && cheb(p, a) <= cfg.wolfPounce) || (a.hunger >= 0.85 && cheb(p, a.home) <= cfg.wolfHuntRadius)))
      .sort((p, q) => Number(cannotWalk(q)) - Number(cannotWalk(p)) || cheb(p, a) - cheb(q, a) || p.id - q.id);
    // Wild game nearby is the usual quarry, though it mostly gets away.
    const game = a.chase < 0 ? undefined : w.animals.filter((o) => o.alive && GAME_KINDS.includes(o.kind) && o.kind !== "fox" && cheb(o, a) <= 16).sort((p, q) => cheb(p, a) - cheb(q, a) || p.id - q.id)[0];
    if (lone[0] && (cannotWalk(lone[0]) || !game || cheb(lone[0], a) < cheb(game, a))) {
      prey = lone[0];
      a.target = `p:${prey.id}`;
      noteAnimal(w, a, a.state === "ambush" ? `sprang from the trees at ${firstName(prey)}` : `caught the scent of ${firstName(prey)}, alone ${cannotWalk(prey) ? "and helpless " : ""}outdoors`);
    } else if (game) {
      beast = game;
      a.target = `a:${game.id}`;
      a.chase = 0;
      noteAnimal(w, a, `gave chase to a ${game.kind}`);
    } else if (a.hunger >= 0.6) {
      const stock = w.animals
        // A wolf turned away by a palisade lately leaves fenced pens alone.
        .filter((s) => s.alive && s.householdId !== null && s.riderId === null && cheb(s, a.home) <= cfg.wolfHuntRadius && !(w.fenced.includes(s.householdId) && w.tick - a.fearUntil < 48) && peopleNear(w, s, 8).filter((p) => !p.asleep).length === 0)
        .sort((p, q) => cheb(p, a) - cheb(q, a) || p.id - q.id);
      if (stock[0]) {
        beast = stock[0];
        a.target = `a:${beast.id}`;
        noteAnimal(w, a, `stalked an unguarded ${beast.kind}${beast.householdId !== null ? ` of the ${w.households[beast.householdId]!.name} house` : ""}`);
      }
    }
  }
  const goal: Point | null = prey ?? beast;
  if (!goal) {
    // Lie in wait beside a road.
    if (!a.goal || before !== "ambush" && before !== "prowl") a.goal = ambushSpot(w, a, rng);
    if (a.goal && cheb(a, a.goal) > 0) {
      a.state = "prowl";
      if (before !== "prowl") noteAnimal(w, a, "slipped through the woods toward the road");
      stepToward(w, a, a.goal, cfg.wolfSpeed, rng);
    } else {
      a.state = "ambush";
      if (before !== "ambush") noteAnimal(w, a, "lay in wait in the trees beside the road");
    }
    return;
  }
  a.state = "hunt";
  stepToward(w, a, goal, cfg.wolfSpeed, rng);
  if (prey && cheb(a, prey) <= 1) {
    wolfAttack(w, a, prey, rng);
    a.hunger = clamp01(a.hunger - 0.2);
    // The scream brings people running: it slinks off for a while.
    if (prey.alive) {
      a.target = null;
      a.fearUntil = w.tick + 18;
    }
  } else if (beast && GAME_KINDS.includes(beast.kind)) {
    a.chase++;
    if (cheb(a, beast) <= 1) {
      if (rng.chance((w.config.animals.game.caught as Record<string, number>)[beast.kind] ?? 0.3)) {
        killAnimal(w, beast);
        noteAnimal(w, beast, "was run down by wolves");
        noteAnimal(w, a, `ran down a ${beast.kind} and ate`);
        a.hunger = clamp01(a.hunger - (beast.kind === "deer" ? 1 : 0.35));
        a.target = null;
        a.chase = 0;
        createTrace(w, "blood", { x: beast.x, y: beast.y }, [], { what: beast.kind }, null);
        w.emit("game_killed", [], { by: "wolf", wolf: a.id, animal: beast.id, kind: beast.kind, at: [beast.x, beast.y] });
      } else {
        noteAnimal(w, beast, "slipped away from a wolf");
        a.target = null;
        a.chase = -w.config.animals.game.chaseRest;
      }
    }
  } else if (beast && cheb(a, beast) <= 1) {
    const hid = beast.householdId;
    if (hid !== null && w.fenced.includes(hid) && rng.chance(cfg.palisadeHolds)) {
      a.target = null;
      a.fearUntil = w.tick + 12;
      noteAnimal(w, a, "could not get through the palisade");
      noteAnimal(w, beast, "was kept safe by the palisade");
      w.emit("palisade_held", [], { wolf: a.id, household: hid, at: [beast.x, beast.y] });
      return;
    }
    beast.health -= 0.5;
    noteAnimal(w, beast, "was set upon by a wolf");
    if (beast.health <= 0) {
      killAnimal(w, beast);
      noteAnimal(w, beast, "was killed by a wolf");
      noteAnimal(w, a, `killed a ${beast.kind} and ate its fill`);
      a.hunger = 0;
      a.target = null;
      a.goal = null;
      createTrace(w, "blood", { x: beast.x, y: beast.y }, [], { what: beast.kind }, null);
      w.emit("livestock_killed", [], { by: "wolf", wolf: a.id, animal: beast.id, kind: beast.kind, household: hid, at: [beast.x, beast.y] });
      if (hid !== null) {
        w.livestockLost[hid] = w.tick;
        for (const m of w.active()) {
          if (m.householdId !== hid || w.ageYears(m) < 12) continue;
          if (!m.asleep && cheb(m, beast) <= 20) feel(w, m, "angry", `wolves killed one of their ${beast.kind === "sheep" ? "sheep" : beast.kind + "s"}`, 0.4);
          if (w.ageYears(m) >= 16 && (m.task === "hunter" || m.task === "watchman" || m.isHead)) m.cooldowns["wolfhunt"] = w.tick + w.days(3);
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

