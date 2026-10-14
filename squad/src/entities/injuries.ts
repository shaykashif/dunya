// Injuries, Dwarf Fortress style, kept from the village simulation. Bullets,
// fragments and falls hurt a particular part of the body. Open wounds bleed
// until bound or clotted; wounds heal over days, faster when tended, can fester,
// and can heal badly into a limp, a crooked arm or a ruined face. A man who
// cannot walk calls for the medic and waits to be carried back.
import type { Rng } from "../engine/rng.ts";
import { r3 } from "../log/events.ts";
import { cheb } from "../world/map.ts";
import type { BodyPart, Injury, InjuryKind, Posture, Soldier } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { OPEN_WOUNDS, cannotWalk, fightingPain, legImpairment, outOfAction, painOf } from "./body.ts";
import { kill } from "./death.ts";
import { clamp01, label, note, shout } from "./soldier.ts";

type Weights = Partial<Record<BodyPart, number>>;

/** Where bullets strike a man standing or walking in the open. */
const HIT_STAND: Weights = { head: 7, face: 4, "left eye": 0.5, "right eye": 0.5, torso: 38, "left arm": 8, "right arm": 8, "left hand": 2.5, "right hand": 2.5, "left leg": 11, "right leg": 11, "left foot": 2.5, "right foot": 2.5 };
const HIT_CROUCH: Weights = { head: 9, face: 5, "left eye": 0.6, "right eye": 0.6, torso: 36, "left arm": 10, "right arm": 10, "left hand": 3, "right hand": 3, "left leg": 7, "right leg": 7, "left foot": 2, "right foot": 2 };
/** Lying down: head, shoulders and arms face the enemy. */
const HIT_PRONE: Weights = { head: 15, face: 8, "left eye": 1, "right eye": 1, torso: 26, "left arm": 14, "right arm": 14, "left hand": 5, "right hand": 5, "left leg": 5, "right leg": 5, "left foot": 2, "right foot": 2 };
/** Behind a hedge, wall or window, only what shows above it can be hit. */
const HIT_COVERED: Weights = { head: 22, face: 12, "left eye": 1.5, "right eye": 1.5, torso: 18, "left arm": 14, "right arm": 14, "left hand": 6, "right hand": 6 };
/** Fragments from a burst at the man's feet. */
const FRAG_PARTS: Weights = { head: 7, face: 6, "left eye": 1, "right eye": 1, torso: 26, "left arm": 9, "right arm": 9, "left hand": 3, "right hand": 3, "left leg": 14, "right leg": 14, "left foot": 4, "right foot": 4 };
const FRAG_PRONE: Weights = { head: 12, face: 6, "left eye": 1, "right eye": 1, torso: 30, "left arm": 9, "right arm": 9, "left hand": 3, "right hand": 3, "left leg": 10, "right leg": 10, "left foot": 3, "right foot": 3 };

export function pickPart(rng: Rng, weights: Weights): BodyPart {
  const parts = Object.keys(weights) as BodyPart[];
  return parts[rng.weighted(parts.map((k) => weights[k]!))]!;
}

/** A sniper's shot at a wounded man crawling away: the legs and feet, to stop him moving. */
export const HIT_LEGS: Weights = { "left leg": 10, "right leg": 10, "left foot": 3, "right foot": 3, torso: 2 };

export function hitWeights(posture: Posture, cover: number): Weights {
  if (cover >= 0.5) return HIT_COVERED;
  return posture === "prone" ? HIT_PRONE : posture === "crouch" ? HIT_CROUCH : HIT_STAND;
}

export function fragWeights(posture: Posture): Weights {
  return posture === "prone" ? FRAG_PRONE : FRAG_PARTS;
}

const EYES: readonly BodyPart[] = ["left eye", "right eye"];

/**
 * Records a wound and takes the health it costs. A hit to the eye that is bad
 * enough takes the eye. Returns the wound, or null if the man was already dead.
 */
export function injure(w: World, p: Soldier, part: BodyPart, kind: InjuryKind, severity: number, cause: string, byId: number | null, health = 0): Injury | null {
  if (p.status === "dead") return null;
  severity = r3(Math.max(0.05, Math.min(1, severity)));
  if (EYES.includes(part) && kind !== "bruise" && severity >= 0.6) kind = "lost";
  if (kind === "lost" && p.injuries.some((i) => i.part === part && i.kind === "lost")) {
    kind = "gash";
    part = "face";
  }
  const cfg = w.config.injuries;
  const bleed = (cfg.bleed[kind] ?? 0) * ((w.config.partBleed as Record<string, number>)[part] ?? 1);
  const inj: Injury = { id: w.nextId("injury"), part, kind, severity, tick: w.tick, cause, byId, care: 0, infected: false, bleeding: r3(severity * bleed), permanent: kind === "lost", lasting: kind === "lost" ? "lost eye" : null };
  if (inj.bleeding > 0) p.bloodied = true;
  p.injuries.push(inj);
  if (health > 0) {
    p.survival.health = clamp01(p.survival.health - health);
    p.lossCause.wounds += health;
  }
  if (severity >= 0.25 && w.onField(p)) w.addPain(p.side, p.x, p.y, severity * 0.8);
  w.emit("injured", [p.id], { person: p.id, injury: inj.id, part, kind, severity, cause, by: byId, canWalk: !cannotWalk(p), health: r3(p.survival.health) });
  note(w, p, `${describeInjury(inj)} (${cause})`);
  if (kind === "lost") injure(w, p, "face", "gash", severity * 0.6, cause, byId);
  return inj;
}

/** Health a wound of this severity on this part costs on impact. */
export function impactHealth(w: World, part: BodyPart, severity: number): number {
  return severity * ((w.config.lethality as Record<string, number>)[part] ?? 0.3);
}

const KIND_WORD: Record<InjuryKind, string> = { bruise: "bruised", cut: "cut", gash: "gashed", sprain: "twisted", fracture: "broken", gunshot: "shot", shrapnel: "shrapnel-torn", lost: "lost" };

/** "a broken left leg", "a twisted right ankle", "a shot torso". */
export function describeInjury(inj: Injury): string {
  if (inj.permanent && inj.lasting) return inj.lasting;
  if (inj.kind === "gunshot") return `a gunshot wound to the ${inj.part.replace("foot", "ankle")}`;
  if (inj.kind === "shrapnel") return `shrapnel in the ${inj.part.replace("foot", "ankle")}`;
  const word = inj.kind === "sprain" && (inj.part === "left foot" || inj.part === "right foot") ? "twisted" : KIND_WORD[inj.kind];
  return `a ${word} ${inj.part.replace("foot", "ankle")}`;
}

/** How well someone dresses wounds: the medic well, anyone else with a field dressing. */
export function careSkill(w: World, p: Soldier): number {
  if (p.role === "medic") return w.config.injuries.medicSkill;
  return Math.min(0.6, 0.3 + 0.3 * p.traits.empathy + (p.experience === "veteran" ? 0.08 : 0));
}

/**
 * Dresses wounds. A medic stops the bleeding and gives morphine; anyone else
 * slows it with a field dressing. Returns how many wounds were seen to.
 */
export function treat(w: World, healer: Soldier, patient: Soldier, rng: Rng, where: string, scale = 1): number {
  const skill = careSkill(w, healer) * scale;
  let n = 0;
  let worst = 0;
  for (const inj of patient.injuries) {
    if (inj.permanent) continue;
    if (inj.bleeding > 0) {
      const before = inj.bleeding;
      inj.bleeding = skill >= 0.7 && rng.chance(0.85) ? 0 : r3(inj.bleeding * (1 - skill));
      if (inj.bleeding !== before) n++;
      worst = Math.max(worst, before);
    }
    if (inj.care < skill) {
      inj.care = r3(skill);
      n++;
    }
  }
  let morphine = false;
  if (healer.role === "medic" && patient.morphineTick < 0 && painOf(patient) > 0.35) {
    patient.morphineTick = w.tick;
    morphine = true;
    n++;
  }
  if (n === 0) return 0;
  healer.treated++;
  w.emit("wounds_treated", healer.id === patient.id ? [healer.id] : [healer.id, patient.id], { by: healer.id, person: patient.id, tended: n, care: r3(skill), morphine, where, bleeding: r3(worst) });
  if (healer.id !== patient.id) {
    note(w, patient, `${label(healer)} dressed their wounds${morphine ? " and gave morphine" : ""}`);
    note(w, healer, `dressed ${label(patient)}'s wounds`);
  } else note(w, patient, "dressed their own wound");
  return n;
}

/** A casualty who cannot get back on his own: unable to walk or unconscious. */
export function needsCarrying(p: Soldier): boolean {
  return p.status === "casualty" && p.carriedById === null && (cannotWalk(p) || !p.conscious);
}

export function needsAid(p: Soldier): boolean {
  if (p.status !== "casualty" && p.status !== "active") return false;
  return p.injuries.some((i) => !i.permanent && (i.bleeding > 0.05 || (i.severity >= 0.3 && i.care < 0.3)));
}

export function pickUp(w: World, carrier: Soldier, p: Soldier): void {
  p.carriedById = carrier.id;
  carrier.carryingId = p.id;
  p.act = null;
  w.vacate(p);
  p.x = carrier.x;
  p.y = carrier.y;
  p.z = carrier.z;
  w.emit("picked_up", [carrier.id], { carrier: carrier.id, person: p.id, at: [carrier.x, carrier.y] });
  note(w, p, `${label(carrier)} carried them`);
}

/** Puts the carried man down on a free tile near the carrier. */
export function setDown(w: World, carrier: Soldier, reason: string): Soldier | null {
  const p = w.maybe(carrier.carryingId);
  carrier.carryingId = null;
  if (!p || p.carriedById !== carrier.id) return null;
  p.carriedById = null;
  const near = { x: carrier.x, y: carrier.y, z: carrier.z };
  const spot = w.freeTileNear(near, 6, p.id) ?? w.freeTileNear(near, 12, p.id);
  if (spot) w.place(p, spot.x, spot.y, spot.z ?? 0);
  p.posture = "prone";
  w.emit("set_down", [carrier.id], { carrier: carrier.id, person: p.id, reason, at: [p.x, p.y] });
  return p;
}

/** "Medic!" Whoever hears it may come; the medic always does if he can. */
export function callForMedic(w: World, p: Soldier): void {
  const radius = w.config.perception.shoutRange + 10;
  const heard: number[] = [];
  for (const h of w.soldiers) {
    if (h.side !== p.side || h.id === p.id || !w.able(h)) continue;
    if (cheb(h, p) > radius && h.role !== "medic") continue;
    if (h.role === "medic" && cheb(h, p) > 80) continue;
    h.cooldowns[`aid:${p.id}`] = w.tick + 60;
    heard.push(h.id);
  }
  shout(w, p, p.side === "us" ? "Medic!" : "Sanitäter!", null);
  w.emit("medic_call", [p.id], { person: p.id, at: [p.x, p.y], heard });
}

function lastingFor(w: World, inj: Injury, rng: Rng): string | null {
  const cfg = w.config.injuries.lasting;
  const protect = 1 - cfg.careProtects * inj.care;
  const leg = inj.part.endsWith("leg") || inj.part.endsWith("foot");
  const arm = inj.part.endsWith("arm") || inj.part.endsWith("hand");
  const open = OPEN_WOUNDS.has(inj.kind);
  if (leg && inj.kind === "fracture" && rng.chance(cfg.lame * protect)) return "lame";
  if (leg && (inj.kind === "gunshot" || inj.kind === "shrapnel") && rng.chance(cfg.lame * 0.6 * protect)) return "lame";
  if (arm && inj.kind === "fracture" && rng.chance(cfg.crookedArm * protect)) return inj.part.endsWith("hand") ? "maimed hand" : "crooked arm";
  if (arm && inj.kind === "gunshot" && inj.severity > 0.2 && rng.chance(cfg.crookedArm * 0.5 * protect)) return inj.part.endsWith("hand") ? "maimed hand" : "crooked arm";
  if (inj.part === "face") {
    if (inj.kind === "fracture" && rng.chance(cfg.faceScar * 0.6 * protect)) return "ruined face";
    if ((inj.kind === "gash" || inj.kind === "gunshot" || inj.kind === "shrapnel") && rng.chance(cfg.faceScar * protect)) return "disfiguring scar";
    if (inj.kind === "cut" && rng.chance(cfg.scar * protect)) return "facial scar";
  }
  if (inj.part === "head" && (inj.kind === "fracture" || inj.kind === "gunshot") && rng.chance(0.3 * protect)) return "dented skull";
  if (open && inj.kind !== "cut" && rng.chance(cfg.scar)) return "scar";
  return null;
}

/** A wound finishes healing: cleanly, or into something that stays. */
export function finishHealing(w: World, p: Soldier, inj: Injury, rng: Rng): void {
  const lasting = lastingFor(w, inj, rng);
  if (lasting === null) {
    p.injuries.splice(p.injuries.indexOf(inj), 1);
    if (inj.kind !== "bruise") w.emit("injury_healed", [p.id], { person: p.id, injury: inj.id, part: inj.part, kind: inj.kind });
    return;
  }
  inj.permanent = true;
  inj.lasting = lasting;
  inj.infected = false;
  inj.bleeding = 0;
  inj.severity = 0.5;
  w.emit("injury_lasting", [p.id], { person: p.id, injury: inj.id, part: inj.part, kind: inj.kind, lasting, care: inj.care });
}

/**
 * One day of healing, for the weeks after the battle: wounds fester or mend,
 * and the festering can kill. `care` is the aid station's.
 */
export function healDay(w: World, p: Soldier, rng: Rng, care: number): void {
  const cfg = w.config.injuries;
  for (const inj of p.injuries.slice()) {
    if (inj.permanent) continue;
    inj.bleeding = 0;
    inj.care = Math.max(inj.care, care);
    if (!inj.infected && OPEN_WOUNDS.has(inj.kind) && inj.severity >= cfg.infectMinSeverity && rng.chance(cfg.infectionPerDay * (1 - inj.care))) {
      inj.infected = true;
      w.emit("infection", [p.id], { person: p.id, injury: inj.id, part: inj.part });
    }
    if (inj.infected) {
      p.survival.health = clamp01(p.survival.health - cfg.infectionHealthPerDay);
      p.lossCause.infection += cfg.infectionHealthPerDay;
      if (rng.chance(0.25 + 0.5 * inj.care)) inj.infected = false;
      continue;
    }
    inj.severity -= cfg.healPerDay[inj.kind] * (1 + inj.care);
    if (inj.severity <= 0.02) finishHealing(w, p, inj, rng);
  }
  // Rest and food bring the strength back.
  if (p.survival.health > 0) p.survival.health = clamp01(p.survival.health + 0.04);
}

/**
 * Engine rule each tick: open wounds bleed and slowly clot (slower for a man on
 * the move), men faint and come round, the out-of-action call for the medic,
 * and anyone whose health runs out dies of his wounds.
 */
export function updateInjuries(w: World): void {
  const cfg = w.config.injuries;
  const perTick = 1 / w.ticksPerMinute();
  for (const p of w.soldiers) {
    if (p.status === "dead" || p.status === "routed" || p.status === "aboard" || p.role === "tank" || p.role === "field_gun") continue;
    if (p.injuries.length === 0 && p.conscious) continue;
    const moving = p.act !== null && (p.act.cand.kind === "move" || p.act.cand.kind === "flee" || p.act.cand.kind === "carry" || p.act.cand.kind === "take_cover");
    for (const inj of p.injuries) {
      if (inj.bleeding <= 0) continue;
      const loss = inj.bleeding * cfg.bleedHealthPerMinute * perTick;
      p.survival.health = clamp01(p.survival.health - loss);
      p.lossCause.wounds += loss;
      inj.bleeding = Math.max(0, inj.bleeding - cfg.clotPerMinute * perTick * (moving ? 0.4 : 1) * (0.5 + inj.care));
    }
    if (p.survival.health <= 0) {
      kill(w, p, "wounds", null);
      continue;
    }
    // Fainting and coming round.
    if (p.conscious && p.survival.health < cfg.unconsciousBelow) {
      p.conscious = false;
      p.act = null;
      p.posture = "prone";
      w.emit("passed_out", [p.id], { person: p.id, health: r3(p.survival.health) });
      note(w, p, "passed out");
    } else if (!p.conscious && p.survival.health >= cfg.unconsciousBelow + 0.05) {
      p.conscious = true;
      w.emit("came_round", [p.id], { person: p.id });
    }
    if (p.status === "active" && outOfAction(p, cfg.painOut)) {
      p.status = "casualty";
      p.act = null;
      p.posture = "prone";
      if (p.carryingId !== null) setDown(w, p, "wounded");
      w.emit("casualty", [p.id], { person: p.id, conscious: p.conscious, canWalk: !cannotWalk(p), pain: r3(fightingPain(p)), health: r3(p.survival.health) });
    } else if (p.status === "casualty" && !outOfAction(p, cfg.painOut) && p.carriedById === null) {
      p.status = "active";
      w.emit("back_in_action", [p.id], { person: p.id });
      note(w, p, "got back into the fight");
    }
    if (p.status === "casualty" && p.conscious && p.carriedById === null && needsAid(p) && (w.tick + p.id) % cfg.callEveryTicks === 0 && w.phase === "battle") callForMedic(w, p);
  }
}

/** A man rushing over rough ground may turn an ankle or go down hard. */
export function stumbleStep(w: World): void {
  const rng = w.rng.get("injuries");
  const chance = w.config.injuries.stumblePerTile;
  for (const p of w.soldiers) {
    if (p.status !== "active" || p.carriedById !== null) continue;
    const trail = w.trails.get(p.id);
    if (!trail || trail.length === 0 || p.act?.cand.pace !== "rush") continue;
    let risk = 0;
    for (const i of trail) {
      const t = w.map.terrain[i];
      risk += t === "road" || t === "floor" ? chance * 0.3 : t === "hedge" || t === "rubble" || t === "crater" || t === "woods" ? chance * 3 : chance;
    }
    if (legImpairment(p).worst > 0.2) risk *= 1.5;
    if (!rng.chance(risk)) continue;
    const side = rng.chance(0.5) ? "left" : "right";
    const sev = 0.25 + rng.next() * 0.5;
    injure(w, p, `${side} foot`, sev > 0.65 ? "fracture" : "sprain", sev, "fell while running", null, 0.02);
    w.emit("stumble", [p.id], { person: p.id, at: [p.x, p.y] });
  }
}
