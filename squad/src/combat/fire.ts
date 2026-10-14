// Small-arms fire. Each tick of firing puts a few rounds downrange; each round
// may hit, and every round snapping past presses down the men near where it
// lands. Most fire misses: its real work is suppression.
import { aimFactor, sightFactor } from "../entities/body.ts";
import { kill } from "../entities/death.ts";
import { HIT_LEGS, hitWeights, impactHealth, injure, pickPart } from "../entities/injuries.ts";
import { moraleOnLoss, shakeMorale, suppress } from "../entities/morale.ts";
import { clamp01, gasp, label, note, shout } from "../entities/soldier.ts";
import type { Rng } from "../engine/rng.ts";
import { r3 } from "../log/events.ts";
import type { WeaponSpec } from "../scenario/config.ts";
import { cheb, dist } from "../world/map.ts";
import type { Point, Soldier } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { smallArmsOnVehicle } from "./armour.ts";
import { concealment, hearShot } from "./perception.ts";

export function weaponOf(w: World, s: Soldier): WeaponSpec | null {
  return s.weapon ? w.config.weapons[s.weapon] : null;
}

/** True if the man moved this tick (spoils his aim, and makes him easier to spot). */
export function movedThisTick(w: World, s: Soldier): boolean {
  const t = w.trails.get(s.id);
  return t !== undefined && t.length > 0;
}

/**
 * Chance one round hits `target`, as the engine judges it. Shooter skill,
 * wounds, suppression and posture; range; the target's size and cover.
 */
export function hitChance(w: World, shooter: Soldier, target: Soldier, spec: WeaponSpec, vis: number): number {
  const d = dist(shooter, target);
  if (d > spec.maxRange) return 0;
  const cfg = w.config;
  const skill = (0.6 + 0.8 * shooter.traits.marksmanship) * (shooter.experience === "veteran" ? 1.12 : shooter.experience === "green" ? 0.85 : 1);
  const cover = w.map.cover(target, shooter, target.posture);
  // Falls away quickly with range, but never to nothing within the weapon's reach: wild long-range fire still hits now and then.
  const floor = cfg.fire.longRangeFloor;
  let p = spec.accuracy * (floor + (1 - floor) * Math.exp(-d / spec.rangeScale)) * skill;
  p *= cfg.posture.steadiness[shooter.posture] * (1 - cfg.suppression.accuracyLoss * shooter.suppression) * aimFactor(shooter);
  // Blown from running, a man's aim wavers; rain and fog spoil everyone's.
  p *= (1 - cfg.fatigue.aimLoss * shooter.fatigue) * w.weather.aim;
  // Firing down from higher ground is a little easier, and up at a man on a crest a little harder.
  const above = w.map.heightAt(shooter.x, shooter.y, shooter.z) - w.map.heightAt(target.x, target.y, target.z);
  p *= 1 + Math.max(-cfg.highGround.max, Math.min(cfg.highGround.max, above * cfg.highGround.perMetre));
  p *= Math.pow(vis, 0.7) * cfg.posture.size[target.posture] * (1 - cover);
  if (movedThisTick(w, shooter)) p *= cfg.fire.movingShooter;
  if (movedThisTick(w, target)) p *= cfg.fire.movingTarget;
  // A friendly tank or gun shield between him and the shooter takes most of it.
  if (w.tanks.size > 0) {
    const dx = target.x - shooter.x, dy = target.y - shooter.y;
    const len2 = dx * dx + dy * dy || 1;
    for (const t of w.tanks.values()) {
      if (t.side !== target.side || t.id === target.id) continue;
      const v = w.soldier(t.id);
      const u = ((v.x - shooter.x) * dx + (v.y - shooter.y) * dy) / len2;
      if (u < 0.5 || u >= 1) continue;
      const off = Math.abs((v.x - shooter.x) * dy - (v.y - shooter.y) * dx) / Math.sqrt(len2);
      if (off <= 1.3) {
        p *= 0.3;
        break;
      }
    }
  }
  return clamp01(p);
}

/** What a bullet does to a man: a wound to some part, the health it costs, perhaps death. */
export function bulletWound(w: World, rng: Rng, shooter: Soldier | null, target: Soldier, spec: WeaponSpec, range: number, cause: string): void {
  // Small arms on armour: a ping off the plate.
  if (target.role === "tank" || target.role === "field_gun") {
    smallArmsOnVehicle(w, target, shooter);
    return;
  }
  const cover = shooter ? w.map.cover(target, shooter, target.posture) : 0;
  // A sniper working on a wounded man who is dragging himself away goes for the legs.
  const crawling = shooter?.role === "sniper" && target.status === "casualty";
  const part = pickPart(rng, crawling ? HIT_LEGS : hitWeights(target.posture, cover));
  const sev = Math.min(1, (spec.severity[0] + rng.next() * (spec.severity[1] - spec.severity[0])) * (1 - 0.3 * Math.min(1, range / spec.maxRange)));
  const health = impactHealth(w, part, sev);
  injure(w, target, part, "gunshot", sev, cause, shooter?.id ?? null, health);
  // A heavy round can break the bone it passes through.
  const limb = part.endsWith("arm") || part.endsWith("leg");
  if (limb && sev > 0.65 && rng.chance(0.35)) injure(w, target, part, "fracture", sev * 0.9, cause, shooter?.id ?? null);
  target.act = null;
  target.lastHitTick = w.tick;
  target.posture = "prone";
  suppress(w, target, 0.35);
  if (target.survival.health <= 0) {
    kill(w, target, "killed", shooter?.id ?? null);
    return;
  }
  shakeMorale(w, target, w.config.morale.selfHit);
  moraleOnLoss(w, target, false);
}

/**
 * One tick of fire at a seen man (`targetId`) or at a remembered position
 * (`at` only). Returns the number of rounds fired.
 */
export function fireTick(w: World, shooter: Soldier, at: Point, targetId: number | null, purpose: "aimed" | "suppress"): number {
  const spec = weaponOf(w, shooter);
  if (!spec || shooter.reloadLeft > 0 || shooter.loaded <= 0) return 0;
  const cfg = w.config;
  const rng = w.rng.get("fire");
  let rate = spec.rate;
  if (shooter.weapon === "mg42") {
    // Someone has to feed the belt.
    const fed = w.friendsNear(shooter, 2).some((f) => w.able(f) && (f.role === "asst_gunner" || f.role === "ammo_bearer"));
    if (!fed) rate *= cfg.fire.unfedFactor;
  }
  if (shooter.pinned) rate *= 0.5;
  shooter.fireAcc += rate;
  let rounds = Math.min(Math.floor(shooter.fireAcc), shooter.loaded);
  shooter.fireAcc -= Math.floor(shooter.fireAcc);
  if (rounds <= 0) return 0;
  shooter.loaded -= rounds;
  shooter.shots += rounds;
  shooter.lastFiredTick = w.tick;
  shooter.dir = at.x < shooter.x ? -1 : at.x > shooter.x ? 1 : shooter.dir;
  if (shooter.role === "sniper") shooter.cooldowns["hideShots"] = (shooter.cooldowns["hideShots"] ?? 0) + 1;

  const target = w.maybe(targetId);
  const hits: number[] = [];
  const range = dist(shooter, at);
  // Who is actually near the aim point: the target, or whoever happens to be there.
  const near = w.soldiers.filter((o) => o.id !== shooter.id && w.onField(o) && dist(o, at) <= cfg.fire.suppressRadius + 0.5);
  const smoke = w.smoke;
  // A wall in front of the aim point, or the aim point itself if it is a wall: where the misses strike.
  const wall = struckWall(w, at, shooter);
  for (let r = 0; r < rounds; r++) {
    let victim: Soldier | null = null;
    if (target && w.onField(target) && purpose === "aimed") {
      const vis = w.map.visibility(shooter.x, shooter.y, target.x, target.y, smoke, shooter.z, target.z);
      if (vis > 0 && rng.chance(hitChance(w, shooter, target, spec, vis))) victim = target;
    } else {
      // Fire at a hedge line or window: anyone right there may be hit, at long odds.
      for (const o of near) {
        if (o.side === shooter.side || cheb(o, at) > 1 || (at.z !== undefined && o.z !== at.z)) continue;
        const vis = w.map.visibility(shooter.x, shooter.y, o.x, o.y, smoke, shooter.z, o.z);
        if (vis > 0 && rng.chance(hitChance(w, shooter, o, spec, vis) * cfg.fire.blindFactor)) {
          victim = o;
          break;
        }
      }
    }
    // A stray round may find a friend standing right by the aim point.
    if (!victim) {
      for (const o of near) {
        if (o.side !== shooter.side || cheb(o, at) > 1 || o.posture === "prone") continue;
        if (rng.chance(cfg.fire.friendlyFireChance)) {
          victim = o;
          w.emit("friendly_fire", [shooter.id, o.id], { by: shooter.id, victim: o.id });
          break;
        }
      }
    }
    if (victim && victim.status !== "dead") {
      hits.push(victim.id);
      shooter.hits++;
      bulletWound(w, rng, shooter, victim, spec, range, `${label(shooter)}'s ${spec.name}`);
    } else if (wall && rng.chance(0.55)) w.map.scar(wall.x, wall.y);
  }

  // Every round snapping past presses down the men around the aim point.
  for (const o of near) {
    if (o.status !== "active" || o.side === shooter.side) continue;
    const d = dist(o, at);
    const fall = 1 - Math.min(1, d / (cfg.fire.suppressRadius + 0.5));
    suppress(w, o, spec.suppression * rounds * fall);
    // Caught by surprise: a German who was not already under fire swears.
    if (o.side === "de" && (o.underFire === null || w.tick - o.underFire.tick > 40)) gasp(w, o);
    o.underFire = fireBearing(w, o, shooter);
  }
  if (target && target.status === "active") target.underFire = fireBearing(w, target, shooter);
  // A shot from nowhere, a man dropped or a round cracking past: "Sniper!" The squad goes to ground and hunts for him.
  if (shooter.role === "sniper" && target) {
    const felt = target.underFire ?? fireBearing(w, target, shooter);
    const sq = w.squad(target.squadId);
    const fresh = !sq.sniperAlert || w.tick - sq.sniperAlert.tick > 20;
    sq.sniperAlert = { x: felt.x, y: felt.y, tick: w.tick };
    const witness = hits.length > 0 ? w.friendsNear(target, 8).find((f) => w.able(f) && !f.sees.includes(shooter.id)) : w.able(target) && !target.sees.includes(shooter.id) ? target : null;
    if (witness && fresh) {
      shout(w, witness, witness.side === "us" ? "Sniper! Get down!" : "Scharfschütze! Deckung!", "shout-sniper", 30);
      w.emit("sniper_alert", [witness.id], { squad: sq.id, at: [felt.x, felt.y], by: witness.id });
    }
  }

  // Machine-gun barrels heat up.
  if (spec.heat > 0) {
    shooter.heat = clamp01(shooter.heat + spec.heat * rounds);
    if (shooter.heat >= 1) {
      shooter.reloadLeft = cfg.fire.barrelChangeTicks;
      shooter.heat = 0.3;
      w.emit("barrel_change", [shooter.id], { by: shooter.id });
      note(w, shooter, "changed the hot barrel");
    }
  }
  w.emit("fire", [shooter.id], { by: shooter.id, weapon: shooter.weapon, from: [shooter.x, shooter.y], at: [at.x, at.y], target: targetId, rounds, hits, purpose, side: shooter.side });
  hearShot(w, shooter, spec);
  if (shooter.loaded === 0 && shooter.ammo > 0 && shooter.reloadLeft === 0) startReload(w, shooter);
  return rounds;
}

const WALLS = new Set(["building", "window", "door", "wall"]);

/** The stretch of wall a miss at `at` hits: the one right in front of it on the line of fire, or the aim point itself. */
function struckWall(w: World, at: Point, shooter: Point): Point | null {
  if (!w.map.inBounds(at.x, at.y)) return null;
  if (WALLS.has(w.map.at(at.x, at.y))) return { x: at.x, y: at.y };
  const front = w.map.stepToward(at, shooter);
  return w.map.inBounds(front.x, front.y) && WALLS.has(w.map.at(front.x, front.y)) ? front : null;
}

/**
 * Where a man under fire thinks it is coming from. If he can see the shooter
 * he knows; if not, he judges by the crack and thump, and a man firing from
 * cover, or a sniper, is hard to place.
 */
function fireBearing(w: World, victim: Soldier, shooter: Soldier): { by: number; x: number; y: number; tick: number } {
  if (victim.sees.includes(shooter.id)) return { by: shooter.id, x: shooter.x, y: shooter.y, tick: w.tick };
  const cfg = w.config.perception;
  const rng = w.rng.get("perception");
  const hidden = concealment(w, shooter, victim);
  const off = Math.round(dist(victim, shooter) * cfg.fireBearingError * (hidden < 0.5 ? 2 : 1) * (shooter.role === "sniper" ? 3 : 1));
  const jitter = () => (off > 0 ? rng.int(2 * off + 1) - off : 0);
  const x = Math.max(0, Math.min(w.map.width - 1, shooter.x + jitter()));
  const y = Math.max(0, Math.min(w.map.height - 1, shooter.y + jitter()));
  return { by: shooter.id, x, y, tick: w.tick };
}

export function startReload(w: World, s: Soldier): void {
  const spec = weaponOf(w, s);
  if (!spec || s.ammo <= 0 || s.loaded >= spec.capacity) return;
  s.reloadLeft = Math.max(1, Math.round(spec.reload * (1.6 - 0.6 * aimFactor(s)) * (s.experience === "green" ? 1.2 : 1)));
  w.emit("reload", [s.id], { by: s.id, weapon: s.weapon });
}

/** Called each tick: reloads and barrel changes come to an end; barrels cool. */
export function weaponStep(w: World): void {
  for (const s of w.soldiers) {
    if (s.status !== "active" && s.status !== "casualty") continue;
    if (s.heat > 0) s.heat = Math.max(0, s.heat - w.config.fire.coolPerTick);
    if (s.reloadLeft <= 0) continue;
    s.reloadLeft--;
    if (s.reloadLeft === 0) {
      const spec = weaponOf(w, s);
      if (!spec) continue;
      const take = Math.min(spec.capacity - s.loaded, s.ammo);
      s.loaded += take;
      s.ammo -= take;
    }
  }
}

/** True if a man still has anything to shoot with. */
export function hasAmmo(s: Soldier): boolean {
  return s.weapon !== null && s.loaded + s.ammo > 0;
}

export function sightRange(w: World, s: Soldier): number {
  return w.config.perception.maxRange * sightFactor(s) * w.weather.sight * (s.role === "sniper" ? w.config.perception.scope : 1);
}

export { r3 };
