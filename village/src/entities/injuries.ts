// Injuries, Dwarf Fortress style. Blows, bites, falls and twisted ankles hurt a
// particular part of the body. Wounds heal over days or weeks, faster when
// tended, can fester, and can heal badly into a limp, a crooked arm or a ruined
// face. Someone who cannot walk calls for help and waits to be carried home.
import { interruptPlan } from "../engine/plans.ts";
import type { Rng } from "../engine/rng.ts";
import { r3 } from "../log/events.ts";
import { sightRange } from "../perception/detection.ts";
import type { BodyPart, DeathCause, Injury, InjuryKind, Person } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { OPEN_WOUNDS, cannotWalk, disfigurement, legImpairment, painOf } from "./body.ts";
import { kill } from "./death.ts";
import { cheb, clamp01, feel, firstName, householdMembers } from "./person.ts";

type Weights = Partial<Record<BodyPart, number>>;

/** Where blows land in an ordinary fight. */
export const BLOW_PARTS: Weights = {
  head: 8, face: 7, "left eye": 1, "right eye": 1, torso: 30, "left arm": 9, "right arm": 9, "left hand": 3.5, "right hand": 3.5, "left leg": 9, "right leg": 9, "left foot": 2, "right foot": 2,
};
/** Where someone set on maiming aims: knees, arms, the face. */
export const MAIM_PARTS: Weights = { face: 14, "left eye": 3, "right eye": 3, "left arm": 10, "right arm": 10, "left hand": 5, "right hand": 5, "left leg": 22, "right leg": 22, torso: 6 };
/** Where a wolf bites. */
export const BITE_PARTS: Weights = { "left leg": 25, "right leg": 25, "left arm": 18, "right arm": 18, "left hand": 4, "right hand": 4, face: 3, torso: 8 };

export function pickPart(rng: Rng, weights: Weights): BodyPart {
  const parts = Object.keys(weights) as BodyPart[];
  return parts[rng.weighted(parts.map((k) => weights[k]!))]!;
}

const EYES: readonly BodyPart[] = ["left eye", "right eye"];

/**
 * Records a wound. `health` is the health it costs, if the caller has not
 * already taken it (fights and bites have). Losing an eye is for life at once.
 */
export function injure(w: World, p: Person, part: BodyPart, kind: InjuryKind, severity: number, cause: string, byId: number | null, health = 0): Injury | null {
  if (!p.alive || p.exiled) return null;
  severity = r3(Math.max(0.05, Math.min(1, severity)));
  if (EYES.includes(part) && kind !== "bruise" && severity >= 0.6) kind = "lost";
  if (kind === "lost" && p.injuries.some((i) => i.part === part && i.kind === "lost")) {
    kind = "gash";
    part = "face";
  }
  const inj: Injury = { id: w.nextId("injury"), part, kind, severity, tick: w.tick, cause, byId, care: 0, infected: false, permanent: kind === "lost", lasting: kind === "lost" ? "lost eye" : null };
  p.injuries.push(inj);
  if (health > 0) {
    p.survival.health = clamp01(p.survival.health - health);
    p.lossCause.wounds += health;
  }
  const walked = !cannotWalk(p);
  w.emit("injured", [p.id], { person: p.id, injury: inj.id, part, kind, severity, cause, by: byId, canWalk: walked });
  if (kind === "lost") {
    // The socket itself is a wound to the face until it heals.
    injure(w, p, "face", "gash", severity * 0.6, cause, byId);
    feel(w, p, "devastated", `lost their ${part} (${cause})`, 0.9);
  } else if (severity >= 0.3) {
    feel(w, p, "in pain", `${describeInjury(inj)} (${cause})`, Math.min(0.8, 0.2 + severity * 0.6));
  }
  return inj;
}

const KIND_WORD: Record<InjuryKind, string> = { bruise: "bruised", cut: "cut", gash: "gashed", bite: "bitten", sprain: "twisted", fracture: "broken", gunshot: "shot", lost: "lost" };

/** "a broken left leg", "a twisted right foot", "a lost left eye". */
export function describeInjury(inj: Injury): string {
  if (inj.permanent && inj.lasting) return inj.lasting;
  const word = inj.kind === "sprain" && (inj.part === "left foot" || inj.part === "right foot") ? "twisted" : KIND_WORD[inj.kind];
  return `a ${word} ${inj.part.replace("foot", "ankle")}`;
}

/** How well someone dresses wounds and sets bones. */
export function careSkill(w: World, p: Person): number {
  if (p.task === "healer") return w.config.injuries.healerSkill;
  return Math.min(0.75, 0.3 + 0.3 * p.personality.empathy + (w.ageYears(p) >= 50 ? 0.1 : 0));
}

/** Cleans and binds wounds and sets bones. Returns how many wounds were tended. */
export function treat(w: World, healer: Person, patient: Person, rng: Rng, where: string): number {
  const skill = careSkill(w, healer);
  let n = 0;
  let cured = 0;
  for (const inj of patient.injuries) {
    if (inj.permanent) continue;
    if (inj.care < skill) {
      inj.care = r3(skill);
      n++;
    }
    if (inj.infected && rng.chance(0.4 + 0.6 * skill)) {
      inj.infected = false;
      cured++;
    }
  }
  if (n + cured === 0) return 0;
  w.emit("wounds_treated", healer.id === patient.id ? [healer.id] : [healer.id, patient.id], { by: healer.id, person: patient.id, tended: n, cured, care: r3(skill), where });
  if (healer.id !== patient.id) {
    feel(w, patient, "grateful", `${firstName(healer)} tended their wounds`, 0.5);
    feel(w, healer, "content", `tended ${firstName(patient)}'s wounds`, 0.2);
  }
  return n + cured;
}

/** Needs someone to come and get them: cannot walk, and not safe at home or in the infirmary. */
export function needsRescue(w: World, p: Person): boolean {
  if (!p.alive || p.exiled || p.carriedById !== null || w.ageYears(p) < w.config.needs.infantAge || !cannotWalk(p)) return false;
  const home = w.house(p.householdId);
  return !w.isInside(p, home) && !w.isInside(p, w.hall());
}

export function pickUp(w: World, carrier: Person, p: Person): void {
  p.carriedById = carrier.id;
  carrier.carryingId = p.id;
  interruptPlan(w, p, "carried");
  w.vacate(p);
  p.x = carrier.x;
  p.y = carrier.y;
  w.emit("picked_up", [carrier.id], { carrier: carrier.id, person: p.id, at: [carrier.x, carrier.y] });
  feel(w, p, "relieved", `${firstName(carrier)} came for them`, 0.6);
}

/** Puts the carried person down on a free tile near the carrier, inside `b`'s walls if given. */
export function setDown(w: World, carrier: Person, reason: string, inside: ((x: number, y: number) => boolean) | undefined = undefined): Person | null {
  const p = w.maybePerson(carrier.carryingId);
  carrier.carryingId = null;
  if (!p || p.carriedById !== carrier.id) return null;
  p.carriedById = null;
  const spot = w.freeTileNear(carrier, 8, p.id, inside) ?? w.freeTileNear(carrier, 12, p.id);
  if (spot) w.place(p, spot.x, spot.y);
  w.emit("set_down", [carrier.id], { carrier: carrier.id, person: p.id, reason, at: [p.x, p.y] });
  return p;
}

/** A cry for help: whoever hears it may come. Sleepers wake only if it is close. */
export function callForHelp(w: World, p: Person): void {
  const radius = w.config.perception.hearRadius + 4;
  const heard: number[] = [];
  for (const h of w.people) {
    if (!h.alive || h.exiled || h.id === p.id || w.isCarried(h) || w.ageYears(h) < 12 || cannotWalk(h)) continue;
    const d = cheb(h, p);
    if (d > radius || (h.asleep && d > 4)) continue;
    if (h.asleep) interruptPlan(w, h, "heard a cry for help");
    h.cooldowns[`aid:${p.id}`] = w.tick + 18;
    heard.push(h.id);
  }
  w.emit("cry_for_help", [p.id], { person: p.id, at: [p.x, p.y], heard });
}

function lastingFor(w: World, inj: Injury, rng: Rng): string | null {
  const cfg = w.config.injuries.lasting;
  const protect = 1 - cfg.careProtects * inj.care;
  const leg = inj.part.endsWith("leg") || inj.part.endsWith("foot");
  const arm = inj.part.endsWith("arm") || inj.part.endsWith("hand");
  const open = OPEN_WOUNDS.has(inj.kind);
  if (leg && inj.kind === "fracture" && rng.chance(cfg.lame * protect)) return "lame";
  if (leg && inj.kind === "gunshot" && rng.chance(cfg.lame * 0.6 * protect)) return "lame";
  if (arm && inj.kind === "fracture" && rng.chance(cfg.crookedArm * protect)) return inj.part.endsWith("hand") ? "maimed hand" : "crooked arm";
  if (inj.part === "face") {
    if (inj.kind === "fracture" && rng.chance(cfg.faceScar * 0.6 * protect)) return "ruined face";
    if ((inj.kind === "gash" || inj.kind === "gunshot" || inj.kind === "bite") && rng.chance(cfg.faceScar * protect)) return "disfiguring scar";
    if (inj.kind === "cut" && rng.chance(cfg.scar * protect)) return "facial scar";
  }
  if (inj.part === "head" && inj.kind === "fracture" && rng.chance(0.3 * protect)) return "dented skull";
  if (open && inj.kind !== "cut" && rng.chance(cfg.scar)) return "scar";
  return null;
}

/** A wound finishes healing: cleanly, or into something that stays. */
function finishHealing(w: World, p: Person, inj: Injury, rng: Rng): void {
  const lasting = lastingFor(w, inj, rng);
  if (lasting === null) {
    p.injuries.splice(p.injuries.indexOf(inj), 1);
    if (inj.kind !== "bruise") w.emit("injury_healed", [p.id], { person: p.id, injury: inj.id, part: inj.part, kind: inj.kind });
    return;
  }
  inj.permanent = true;
  inj.lasting = lasting;
  inj.infected = false;
  inj.severity = 0.5;
  w.emit("injury_lasting", [p.id], { person: p.id, injury: inj.id, part: inj.part, kind: inj.kind, lasting, care: inj.care });
  if (lasting === "lame") feel(w, p, "bitter", `their ${inj.part} healed crooked and they will limp for life`, 0.7);
  else if (lasting === "ruined face" || lasting === "disfiguring scar") feel(w, p, "ashamed", `their face healed into a ${lasting === "ruined face" ? "ruin" : "terrible scar"}`, 0.8);
  else if (lasting !== "scar" && lasting !== "facial scar") feel(w, p, "sad", `their ${inj.part} healed badly`, 0.5);
}

function dieOfWounds(w: World, p: Person): void {
  let cause: DeathCause = "wounds";
  let best = -1;
  for (const k of Object.keys(p.lossCause) as DeathCause[]) {
    if (p.lossCause[k] > best) {
      best = p.lossCause[k];
      cause = k;
    }
  }
  kill(w, p, cause, null, null);
}

/**
 * Engine rule after needs: wounds heal or fester, pain weighs on mood, lasting
 * marks are mourned, and anyone who cannot walk calls out and is looked for.
 */
export function updateInjuries(w: World): void {
  const cfg = w.config.injuries;
  const rng = w.rng.get("injuries");
  const tpd = w.config.time.ticksPerDay;
  const newDay = w.env.minuteOfDay === 0;
  for (const p of w.people) {
    if (!p.alive || p.exiled || p.injuries.length === 0) continue;
    const starving = p.survival.food < 0.25 || p.survival.water < 0.25;
    const old = w.ageYears(p) >= 60;
    for (const inj of p.injuries.slice()) {
      if (inj.permanent) continue;
      if (newDay && !inj.infected && OPEN_WOUNDS.has(inj.kind) && inj.severity >= cfg.infectMinSeverity && rng.chance(cfg.infectionPerDay * (1 - inj.care))) {
        inj.infected = true;
        w.emit("infection", [p.id], { person: p.id, injury: inj.id, part: inj.part });
        feel(w, p, "sick", `the wound on their ${inj.part} is festering`, 0.6);
      }
      if (inj.infected) {
        const loss = cfg.infectionHealthPerDay / tpd;
        p.survival.health = clamp01(p.survival.health - loss);
        p.lossCause.infection += loss;
        continue;
      }
      const rate = (cfg.healPerDay[inj.kind] / tpd) * (1 + inj.care) * (starving ? 0.4 : 1) * (old ? 0.7 : 1) * (p.asleep ? 1.3 : 1);
      inj.severity -= rate;
      if (inj.severity <= 0.02) finishHealing(w, p, inj, rng);
    }
    // A crutch is set aside once the leg is sound again.
    if (p.crutch && legImpairment(p).worst < 0.15) {
      p.crutch = false;
      w.emit("crutch_set_aside", [p.id], { person: p.id });
    }
    const pain = painOf(p);
    const marred = disfigurement(p);
    p.mood = Math.max(-1, p.mood - pain * cfg.painMoodPerTick - marred * cfg.painMoodPerTick * 0.5);
    if (p.survival.health <= 0) dieOfWounds(w, p);
  }

  // Lasting marks are hard to live with.
  if (w.env.minuteOfDay === 9 * 60) {
    for (const p of w.active()) {
      const until = p.cooldowns["lament"];
      if (until !== undefined && w.tick < until) continue;
      if (disfigurement(p) >= 0.4) feel(w, p, "ashamed", "people flinch at their scarred face", 0.3);
      else if (p.injuries.some((i) => i.lasting === "lame") && !p.crutch) feel(w, p, "frustrated", "their crippled leg will not carry them properly", 0.3);
      else continue;
      p.cooldowns["lament"] = w.tick + w.days(2);
    }
  }

  // Someone who cannot walk calls out, and passers-by who see them come.
  for (const p of w.people) {
    if (!needsRescue(w, p)) continue;
    if ((w.tick - p.id) % cfg.helpCallEveryTicks === 0 && !p.asleep) callForHelp(w, p);
    for (const o of w.people) {
      if (!o.alive || o.exiled || o.id === p.id || o.asleep || w.isCarried(o) || w.ageYears(o) < 12 || o.cooldowns[`aid:${p.id}`] !== undefined) continue;
      const d = cheb(o, p);
      if (d > sightRange(w, o) * 0.7 || !w.map.lineOfSight(o.x, o.y, p.x, p.y)) continue;
      o.cooldowns[`aid:${p.id}`] = w.tick + 18;
      w.emit("found_injured", [o.id], { finder: o.id, person: p.id, at: [p.x, p.y] });
    }
  }

  // At nightfall a family notices who has not come home, and goes looking.
  if (w.env.minuteOfDay === 20 * 60) {
    for (const p of w.people) {
      if (!needsRescue(w, p)) continue;
      let reported = false;
      for (const m of householdMembers(w, p.householdId)) {
        if (m.id === p.id || w.ageYears(m) < 14 || cannotWalk(m) || m.carryingId !== null) continue;
        if (!m.cooldowns[`search:${p.id}`]) feel(w, m, "worried", `${firstName(p)} has not come home`, 0.6);
        m.cooldowns[`search:${p.id}`] = w.tick + w.days(2);
        if (!reported && m.isHead) {
          w.emit("missing_person", [m.id], { person: p.id, reportedBy: m.id });
          reported = true;
        }
      }
    }
  }
}

/** A stumble: usually a twisted ankle, sometimes worse. */
function stumble(w: World, p: Person, rng: Rng, where: string): void {
  const side = rng.chance(0.5) ? "left" : "right";
  const roll = rng.next();
  const cause = `fell ${where}`;
  if (roll < 0.6) injure(w, p, `${side} foot`, "sprain", 0.25 + rng.next() * 0.35, cause, null, 0.02);
  else if (roll < 0.9) injure(w, p, `${side} foot`, "sprain", 0.72 + rng.next() * 0.23, cause, null, 0.04);
  else injure(w, p, rng.chance(0.5) ? `${side} leg` : `${side} foot`, "fracture", 0.7 + rng.next() * 0.25, cause, null, 0.1);
  afterAccident(w, p, cause);
}

/** Thrown from a horse: legs, arms, head. */
function thrown(w: World, p: Person, rng: Rng): void {
  const side = rng.chance(0.5) ? "left" : "right";
  const roll = rng.next();
  const sev = 0.35 + rng.next() * 0.6;
  const cause = "thrown from their horse";
  if (roll < 0.35) injure(w, p, `${side} leg`, sev > 0.6 ? "fracture" : "sprain", sev, cause, null, sev * 0.12);
  else if (roll < 0.6) injure(w, p, `${side} arm`, sev > 0.55 ? "fracture" : "bruise", sev, cause, null, sev * 0.1);
  else if (roll < 0.8) injure(w, p, "head", sev > 0.75 ? "fracture" : "bruise", sev, cause, null, sev * 0.15);
  else injure(w, p, "torso", "bruise", sev, cause, null, sev * 0.08);
  afterAccident(w, p, cause);
}

function afterAccident(w: World, p: Person, cause: string): void {
  const stuck = cannotWalk(p);
  w.emit("accident", [p.id], { person: p.id, cause, at: [p.x, p.y], canWalk: !stuck, outdoors: !w.map.roofed(p.x, p.y) });
  if (stuck) {
    interruptPlan(w, p, "cannot walk");
    feel(w, p, "afraid", `${cause} and cannot get up`, 0.7);
    if (needsRescue(w, p)) callForHelp(w, p);
  }
}

/** Accidents at work: an axe slips, a branch falls, a hunter turns an ankle. */
export function workAccident(w: World, p: Person, rng: Rng, work: "woodcutting" | "hunting"): void {
  const cfg = w.config.injuries.accidents;
  const chance = work === "hunting" ? cfg.hunting : w.env.weather === "storm" ? cfg.stormWoodcutting : cfg.woodcutting;
  if (!rng.chance(chance)) return;
  if (work === "hunting") {
    stumble(w, p, rng, "in the deep forest");
    return;
  }
  const side = rng.chance(0.5) ? "left" : "right";
  const roll = rng.next();
  const sev = 0.25 + rng.next() * 0.6;
  if (roll < 0.45) injure(w, p, `${side} hand`, sev > 0.5 ? "gash" : "cut", sev, "their axe slipped", null, sev * 0.08);
  else if (roll < 0.75) injure(w, p, `${side} foot`, "gash", sev, "their axe slipped", null, sev * 0.1);
  else injure(w, p, "head", sev > 0.7 ? "fracture" : "bruise", sev, "a falling branch struck them", null, sev * 0.12);
  afterAccident(w, p, "hurt cutting wood");
}

/** Engine rule after movement: walkers may turn an ankle, riders may be thrown. */
export function accidentStep(w: World): void {
  const cfg = w.config.injuries.accidents;
  const rng = w.rng.get("injuries");
  const night = w.env.light < w.config.light.nightThreshold;
  const weather = w.env.weather === "snow" ? cfg.snowFactor : w.env.weather === "rain" || w.env.weather === "storm" ? cfg.wetFactor : 1;
  for (const p of w.people) {
    if (!p.alive || p.exiled || w.isCarried(p)) continue;
    const trail = w.trails.get(p.id);
    if (!trail || trail.length === 0) continue;
    if (p.ridingHorseId !== null) {
      if (rng.chance(cfg.horseFallPerTick * (w.env.weather === "storm" || w.env.weather === "snow" ? 2 : 1) * (night ? 1.5 : 1))) {
        const horse = w.animals.find((a) => a.id === p.ridingHorseId);
        if (horse) {
          horse.riderId = null;
          horse.state = "graze";
          noteAnimal(w, horse, `shied and threw ${firstName(p)}`);
        }
        p.ridingHorseId = null;
        w.emit("dismounted", [p.id], { person: p.id, horse: horse?.id ?? null, reason: "thrown" });
        thrown(w, p, rng);
      }
      continue;
    }
    let risk = 0;
    for (const i of trail) {
      const t = w.map.terrain[i];
      risk += t === "path" ? cfg.roadPerTile : t === "forest" ? cfg.forestPerTile : t === "floor" || t === "door" ? 0 : cfg.groundPerTile;
    }
    if (risk === 0) continue;
    const age = w.ageYears(p);
    const kind = p.plan?.cand.kind;
    risk *= weather * (night ? cfg.nightFactor : 1) * (age >= 60 ? cfg.elderFactor : age < 12 ? cfg.childFactor : 1);
    if (kind === "chase" || kind === "flee") risk *= cfg.hurryFactor;
    if (legImpairment(p).worst > 0.2) risk *= 1.5;
    if (rng.chance(risk)) stumble(w, p, rng, w.map.terrain[trail[trail.length - 1]!] === "path" ? "on the road" : night ? "in the dark" : "on rough ground");
  }
}

/** Adds a line to an animal's history, skipping repeats. */
export function noteAnimal(w: World, a: { log: { tick: number; text: string }[] }, text: string): void {
  const last = a.log[a.log.length - 1];
  if (last && last.text === text) return;
  a.log.push({ tick: w.tick, text });
  if (a.log.length > 24) a.log.shift();
}
