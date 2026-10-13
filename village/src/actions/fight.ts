// Fights: the attacker strikes, the defender fights back, flees or gives in.
// Several rounds can pass in one tick; either side can be killed.
import { cannotWalk } from "../entities/body.ts";
import { kill } from "../entities/death.ts";
import { BLOW_PARTS, MAIM_PARTS, injure, pickPart } from "../entities/injuries.ts";
import { adjustBond, adjustTrust, clamp01, feel, firstName, rel, speedOf, strengthOf } from "../entities/person.ts";
import { interruptPlan } from "../engine/plans.ts";
import type { Rng } from "../engine/rng.ts";
import { perceiveIdentity, witnessAction } from "../perception/detection.ts";
import { bestFood, transfer } from "../world/items.ts";
import { gunshot } from "../world/arms.ts";
import { createTrace } from "../world/traces.ts";
import type { Crime, CrimeKind, EntityRef, HolderRef, Person, Point } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { cand } from "./helpers.ts";
import type { CandidateAction, ResolveCtx } from "./types.ts";

export type DefenseChoice = "fight" | "flee" | "yield";

export function recordCrime(w: World, kind: CrimeKind, actorId: number, victim: HolderRef, location: Point, actionSeq: number, qty: number): Crime {
  const crime: Crime = { id: w.nextId("crime"), kind, actorId, victim, tick: w.tick, location: { ...location }, actionSeq, traceIds: [], qty };
  w.crimes.push(crime);
  return crime;
}

/** The actor knows what they did: a self-observation belief, sourced from the action event. */
export function selfKnowledge(w: World, actor: Person, predicate: string, object: EntityRef, place: Point, eventSeq: number, crimeId: number): void {
  w.pendingObservations.push({
    observerId: actor.id,
    eventSeq,
    crimeId,
    belief: { subject: { kind: "person", id: actor.id }, predicate, object, time: w.tick, confidence: 1, source: "saw", place: { ...place } },
  });
}

/** What the defender can do when attacked; their own decision source chooses. */
export function defenseOptions(w: World, defender: Person, attacker: Person, lethal: boolean): CandidateAction[] {
  const sA = strengthOf(w, attacker), sD = strengthOf(w, defender);
  const odds = sD / (sA + sD);
  const faster = speedOf(w, defender) / Math.max(0.1, speedOf(w, attacker));
  const options = [
    cand("respond", "respond:fight", "fight back", {
      dest: null,
      duration: 0,
      option: "fight",
      risk: clamp01(1 - odds),
      effects: { health: (odds - 0.5) * (lethal ? 0.8 : 0.4), security: 0.2, grudge: Math.max(0, -(defender.relationships[attacker.id]?.trust ?? 0)) },
    }),
    cand("respond", "respond:flee", "run", {
      dest: null,
      duration: 0,
      option: "flee",
      risk: clamp01(0.6 - 0.3 * faster),
      effects: { health: (faster - 1) * 0.3 + (lethal ? 0.2 : 0), security: 0.1 },
    }),
    cand("respond", "respond:yield", "give in", {
      dest: null,
      duration: 0,
      option: "yield",
      risk: lethal ? 0.9 : 0.2,
      effects: { health: lethal ? -0.5 : 0.1, status: -0.2 },
    }),
  ];
  // Someone who cannot walk cannot run.
  return cannotWalk(defender) ? options.filter((o) => o.option !== "flee") : options;
}

interface Blow {
  by: number;
  hit: boolean;
  damage: number;
}

export interface FightOutcome {
  attackerDied: boolean;
  defenderDied: boolean;
  defenderFled: boolean;
  crime: Crime | null;
}

/** Turns a landed blow into a wound on some part of the body. */
function wound(w: World, rng: Rng, from: Person, to: Person, damage: number, maim: boolean): void {
  const part = pickPart(rng, maim ? MAIM_PARTS : BLOW_PARTS);
  const armed = from.inventory.tool > 0;
  const sev = Math.min(1, damage * (maim ? 3.4 : 2.6) + (maim ? 0.15 : 0));
  const bone = part !== "torso" && part !== "left eye" && part !== "right eye";
  let kind: "bruise" | "cut" | "gash" | "fracture" = armed ? (sev >= 0.45 ? "gash" : "cut") : "bruise";
  if (bone && sev >= (maim ? 0.45 : 0.6) && rng.chance(armed ? 0.35 : 0.55)) kind = "fracture";
  injure(w, to, part, kind, sev, maim ? `${firstName(from)} set out to cripple them` : `${firstName(from)} struck them`, from.id);
}

function strike(w: World, rng: Rng, from: Person, to: Person, factor: number, blows: Blow[], maim = false): void {
  const cfg = w.config.fight;
  const sA = strengthOf(w, from), sB = strengthOf(w, to);
  const edge = sA / (sA + sB);
  const hit = rng.chance(cfg.hitBase + 0.1 + 0.5 * (edge - 0.5));
  let damage = 0;
  if (hit) {
    damage = (cfg.damageMin + rng.next() * (cfg.damageMax - cfg.damageMin)) * 2 * edge * factor;
    if (from.inventory.tool > 0) damage *= cfg.toolFactor;
  }
  // Someone set on maiming holds back from killing.
  if (maim) damage = Math.min(damage, Math.max(0, to.survival.health - 0.15));
  damage = Math.round(damage * 1000) / 1000;
  to.survival.health = clamp01(to.survival.health - damage);
  if (damage >= 0.03 && to.survival.health > 0) wound(w, rng, from, to, damage, maim);
  to.lossCause.wounds += damage;
  if (damage >= 0.08) {
    // Blood gets on the weapon and on both of them.
    if (from.inventory.tool > 0) from.bloodyTool = true;
    if (rng.chance(0.6)) from.bloodyClothes = true;
    to.bloodyClothes = true;
  }
  blows.push({ by: from.id, hit, damage });
}

/**
 * Resolves a fight. `lethal` means the attacker means to kill and keeps going;
 * otherwise it is a brawl that ends after a couple of exchanges.
 */
export function fight(
  w: World,
  attacker: Person,
  defender: Person,
  choice: DefenseChoice,
  opts: { lethal: boolean; motive: string; robbery?: boolean; raidPlotId?: number; lawful?: boolean; maim?: boolean },
  ctx: ResolveCtx,
): FightOutcome {
  const cfg = w.config.fight;
  const rng = ctx.rng;
  const place = { x: defender.x, y: defender.y };
  const blows: Blow[] = [];
  let defenderFled = false;
  let attackerBrokeOff = false;
  interruptPlan(w, defender, "attacked");

  let shot = false;
  const loaded = !(attacker.cooldowns["reload"] !== undefined && w.tick < attacker.cooldowns["reload"]);
  if (attacker.inventory.musket > 0 && loaded && (opts.lethal || Math.max(Math.abs(attacker.x - defender.x), Math.abs(attacker.y - defender.y)) > 1)) {
    const m = w.config.muskets;
    shot = true;
    attacker.cooldowns["reload"] = w.tick + w.config.muskets.reloadTicks;
    gunshot(w, attacker, { x: attacker.x, y: attacker.y }, "fight");
    const hit = rng.chance(m.hitChance);
    const damage = hit ? Math.round((m.damage[0] + rng.next() * (m.damage[1] - m.damage[0])) * 1000) / 1000 : 0;
    defender.survival.health = clamp01(defender.survival.health - damage);
    defender.lossCause.wounds += damage;
    if (damage > 0) defender.bloodyClothes = true;
    if (damage > 0 && defender.survival.health > 0) injure(w, defender, pickPart(rng, BLOW_PARTS), "gunshot", damage * 1.1, `${firstName(attacker)} shot them`, attacker.id);
    blows.push({ by: attacker.id, hit, damage });
  }
  const adjacent = Math.max(Math.abs(attacker.x - defender.x), Math.abs(attacker.y - defender.y)) <= 1;
  const rounds = shot && !(adjacent || choice === "fight") ? 0 : opts.lethal || opts.maim ? cfg.rounds : 2;
  if (shot && rounds === 0 && defender.survival.health > 0) defenderFled = choice === "flee";
  for (let r = 0; r < rounds && defender.survival.health > 0; r++) {
    strike(w, rng, attacker, defender, opts.lethal ? cfg.lethalFactor : opts.maim ? 1.3 : 1, blows, opts.maim);
    if (defender.survival.health <= 0) break;
    if (opts.maim && defender.survival.health < 0.35) break;
    if (choice === "yield") break;
    if (choice === "flee" || defender.survival.health < cfg.fleeBelow) {
      const odds = speedOf(w, defender) / (speedOf(w, defender) + speedOf(w, attacker));
      if (rng.chance(0.25 + odds * 0.6)) {
        defenderFled = true;
        break;
      }
      choice = "fight";
    }
    strike(w, rng, defender, attacker, 1.1, blows);
    if (attacker.survival.health <= 0) break;
    if (attacker.survival.health < cfg.breakOffBelow && !(opts.lethal && attacker.personality.boldness > 0.7)) {
      attackerBrokeOff = true;
      break;
    }
  }

  const attackerDied = attacker.survival.health <= 0;
  const defenderDied = defender.survival.health <= 0;
  const total = blows.filter((b) => b.by === attacker.id).reduce((a, b) => a + b.damage, 0);
  if (opts.lawful) {
    // Subduing a thief is not a crime; it is logged as a scuffle.
    ctx.emit("scuffle", [attacker.id, defender.id], { by: attacker.id, against: defender.id, motive: opts.motive, blows, response: choice });
    createTrace(w, "sound", place, [{ kind: "person", id: attacker.id }, { kind: "person", id: defender.id }], { what: "scuffle" }, null);
    if (defenderDied) kill(w, defender, "wounds", attacker.id, null);
    if (attackerDied) kill(w, attacker, "wounds", defender.id, null);
    return { attackerDied, defenderDied, defenderFled, crime: null };
  }
  const ev = ctx.emit("attack", [attacker.id, defender.id], {
    attacker: attacker.id,
    victim: defender.id,
    motive: opts.motive,
    lethalIntent: opts.lethal,
    response: choice,
    blows,
    damage: Math.round(total * 1000) / 1000,
    outcome: defenderDied ? "victim_killed" : attackerDied ? "attacker_killed" : defenderFled ? "victim_fled" : attackerBrokeOff ? "attacker_broke_off" : "ended",
    raid: opts.raidPlotId ?? null,
    weapon: shot ? "musket" : attacker.inventory.tool > 0 ? "tool" : "hands",
  });
  const crime = recordCrime(w, defenderDied ? "murder" : "assault", attacker.id, { t: "person", id: defender.id }, place, ev.seq, 0);
  const victimRef: EntityRef = { kind: "person", id: defender.id };
  const traces = [
    createTrace(w, "sound", place, [{ kind: "person", id: attacker.id }, victimRef], { what: shot ? "gunshot" : "struggle" }, crime.id),
    createTrace(w, "wound", place, [victimRef], { severity: total > 0.4 ? "severe" : total > 0.15 ? "moderate" : "light", weapon: shot ? "musket" : attacker.inventory.tool > 0 ? "tool" : "hands" }, crime.id),
  ];
  if (total >= 0.1 || attackerDied) traces.push(createTrace(w, "blood", place, [victimRef], {}, crime.id));
  for (const tr of traces) crime.traceIds.push(tr.id);

  witnessAction(w, attacker, rng, { predicate: defenderDied ? "killed" : "attacked", object: victimRef, crimeId: crime.id, boost: w.config.detection.attackBoost, exclude: [defender.id] });
  selfKnowledge(w, attacker, defenderDied ? "killed" : "attacked", victimRef, place, ev.seq, crime.id);
  attacker.emotions.guilt = clamp01(attacker.emotions.guilt + 0.3 * attacker.personality.empathy);
  rel(defender, attacker.id, w.tick).negative += 0.5;

  if (opts.robbery && !defenderDied && (choice === "yield" || !defenderFled)) {
    for (let i = 0; i < 2; i++) {
      const kind = bestFood(defender.inventory);
      if (!kind) break;
      transfer(w, { t: "person", id: defender.id }, { t: "person", id: attacker.id }, kind, 1, "robbed", [attacker.id]);
    }
  }

  if (defenderDied) {
    kill(w, defender, "wounds", attacker.id, crime.id);
    const body = w.traces[w.traces.length - 1];
    if (body && body.kind === "body") crime.traceIds.push(body.id);
    feel(w, attacker, "guilty", `killed ${firstName(defender)}`, 0.4 + 0.5 * attacker.personality.empathy);
  } else {
    const ident = perceiveIdentity(w, defender, attacker, rng);
    const vev = ctx.emit("action_witnessed", [defender.id], { observer: defender.id, perceived: ident.subject, predicate: "attacked", at: [attacker.x, attacker.y], p: 1 });
    w.pendingObservations.push({
      observerId: defender.id,
      eventSeq: vev.seq,
      crimeId: crime.id,
      belief: { subject: ident.subject, predicate: "attacked", object: victimRef, time: w.tick, confidence: Math.max(0.7, ident.confidence), source: "saw", place },
    });
    defender.wants.security = clamp01(defender.wants.security - 0.4);
    const who = ident.subject.kind === "person" ? w.maybePerson(ident.subject.id) : null;
    if (who) {
      adjustTrust(defender, who.id, -0.8, w.tick);
      adjustBond(defender, who.id, -0.3, w.tick);
      defender.grievances[who.id] = { reason: "attacked", tick: w.tick };
    }
    feel(w, defender, choice === "fight" ? "angry" : "afraid", `${who ? firstName(who) : "someone"} attacked them${defenderFled ? " and they ran" : choice === "fight" ? " and they fought back" : ""}`, 0.7);
    if (defenderFled) defender.cooldowns["fleeing"] = w.tick + 6;
  }

  if (attackerDied) {
    kill(w, attacker, "wounds", defender.id, null);
    ctx.emit("self_defense", defenderDied ? [] : [defender.id], { defender: defender.id, attacker: attacker.id });
    if (!defenderDied) feel(w, defender, "afraid", `killed ${firstName(attacker)} defending themselves`, 0.8);
  } else if (!defenderDied && choice === "fight" && attacker.survival.health < 0.6) {
    feel(w, attacker, "afraid", `${firstName(defender)} fought back hard`, 0.5);
  }
  return { attackerDied, defenderDied, defenderFled, crime };
}
