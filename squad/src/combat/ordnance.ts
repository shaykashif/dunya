// Grenades, rifle grenades, mortar and artillery rounds, and smoke. Grenades
// are lobbed over hedges, which is how the bocage was fought; fragments are
// stopped by banks and walls but find men in the open.
import { kill } from "../entities/death.ts";
import { fragWeights, impactHealth, injure, pickPart } from "../entities/injuries.ts";
import { moraleOnLoss, shakeMorale, suppress } from "../entities/morale.ts";
import { label, note, shout } from "../entities/soldier.ts";
import { cheb, dist } from "../world/map.ts";
import type { FireMission, Ordnance, OrdnanceKind, Point, Side, Soldier } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { shellDamage } from "./destruction.ts";
import { hearShot } from "./perception.ts";

const NAMES: Record<OrdnanceKind, string> = {
  frag: "a Mk 2 grenade",
  stick: "a stick grenade",
  rifle_grenade: "a rifle grenade",
  mortar: "a mortar round",
  artillery: "a shell",
  smoke_grenade: "a smoke grenade",
  smoke_shell: "a smoke shell",
};

function clampToMap(w: World, p: Point): Point {
  return { x: Math.max(0, Math.min(w.map.width - 1, Math.round(p.x))), y: Math.max(0, Math.min(w.map.height - 1, Math.round(p.y))) };
}

/**
 * The floor a round bursts on. A grenade aimed at an upper window goes in if it
 * lands on that house; a shell on a roof bursts on the top floor.
 */
function burstFloor(w: World, at: Point, aimZ: number, fromAbove: boolean): number {
  const i = w.map.idx(at.x, at.y);
  if (w.map.building[i]! < 0) return 0;
  if (fromAbove) {
    for (let z = w.map.levels[i]! - 1; z > 0; z--) if (w.map.passable(at.x, at.y, z)) return z;
    return 0;
  }
  return aimZ > 0 && w.map.passable(at.x, at.y, aimZ) ? aimZ : 0;
}

/** Where a thrown or fired round actually comes down: scattered, and short of any wall it hits. */
function landing(w: World, from: Point, aim: Point, scatter: number): Point {
  const rng = w.rng.get("ordnance");
  const d = dist(from, aim);
  const s = scatter * d + 0.4;
  let p = clampToMap(w, { x: aim.x + (rng.next() * 2 - 1) * s, y: aim.y + (rng.next() * 2 - 1) * s });
  // A grenade bounces off a house wall and drops at its foot.
  const t = w.map.at(p.x, p.y);
  if (t === "building" || t === "window") {
    const back = w.map.stepToward(p, from);
    if (w.map.inBounds(back.x, back.y)) p = back;
  }
  return p;
}

export function throwGrenade(w: World, s: Soldier, aim: Point, smoke = false): void {
  const kind: OrdnanceKind = smoke ? "smoke_grenade" : s.side === "us" ? "frag" : "stick";
  if (smoke) s.smokes--;
  else s.grenades--;
  const at = landing(w, s, aim, w.config.explosives.throwScatter * (1.6 - 0.6 * s.traits.fitness) * (aim.z ? 1.5 : 1));
  const o: Ordnance = { id: w.nextId("ordnance"), kind, side: s.side, byId: s.id, from: { x: s.x, y: s.y }, x: at.x, y: at.y, z: smoke ? 0 : burstFloor(w, at, aim.z ?? 0, false), burstTick: w.tick + 1 + (smoke ? 1 : w.config.explosives.fuseTicks), thrownTick: w.tick, spotting: false };
  w.ordnance.push(o);
  s.dir = aim.x < s.x ? -1 : aim.x > s.x ? 1 : s.dir;
  s.lastFiredTick = w.tick;
  w.emit("grenade_thrown", [s.id], { by: s.id, kind, from: [s.x, s.y], at: [at.x, at.y], aim: [aim.x, aim.y], burst: o.burstTick });
  if (!smoke) shout(w, s, s.side === "us" ? "Grenade!" : "Handgranate!", "shout-grenade", 8);
  else shout(w, s, s.side === "us" ? "Smoke out!" : "Nebel!", "shout-smoke", 30);
  note(w, s, smoke ? "threw smoke" : "threw a grenade");
}

export function fireRifleGrenade(w: World, s: Soldier, aim: Point): void {
  s.rifleGrenades--;
  const at = landing(w, s, aim, 0.05 * (1.5 - 0.5 * s.traits.marksmanship));
  const o: Ordnance = { id: w.nextId("ordnance"), kind: "rifle_grenade", side: s.side, byId: s.id, from: { x: s.x, y: s.y }, x: at.x, y: at.y, z: burstFloor(w, at, aim.z ?? 0, false), burstTick: w.tick + 2, thrownTick: w.tick, spotting: false };
  w.ordnance.push(o);
  s.lastFiredTick = w.tick;
  w.emit("grenade_thrown", [s.id], { by: s.id, kind: "rifle_grenade", from: [s.x, s.y], at: [at.x, at.y], aim: [aim.x, aim.y], burst: o.burstTick });
  hearShot(w, s, w.config.weapons.m1_garand);
  note(w, s, "fired a rifle grenade");
}

/** A round from off the map: mortars, or the player's artillery. */
export function incoming(w: World, kind: "mortar" | "artillery" | "smoke_shell", side: Side | null, aim: Point, scatter: number, byId: number | null, spotting = false): Ordnance {
  const rng = w.rng.get("ordnance");
  const at = clampToMap(w, { x: aim.x + (rng.next() * 2 - 1) * scatter, y: aim.y + (rng.next() * 2 - 1) * scatter });
  const o: Ordnance = { id: w.nextId("ordnance"), kind, side, byId, from: { x: at.x, y: side === "de" ? -20 : side === "us" ? w.map.height + 20 : at.y - 30 }, x: at.x, y: at.y, z: kind === "smoke_shell" ? 0 : burstFloor(w, at, 0, true), burstTick: w.tick + 3, thrownTick: w.tick, spotting };
  w.ordnance.push(o);
  w.emit("incoming", [], { kind, at: [at.x, at.y], side, burst: o.burstTick });
  return o;
}

/** Poisson draw for the number of fragments that strike a man. */
function poisson(w: World, mean: number): number {
  if (mean <= 0) return 0;
  const rng = w.rng.get("ordnance");
  const L = Math.exp(-mean);
  let k = 0, p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > L && k < 12);
  return k - 1;
}

function explode(w: World, o: Ordnance): void {
  if (o.kind === "smoke_grenade" || o.kind === "smoke_shell") {
    const sm = w.config.smoke;
    const shell = o.kind === "smoke_shell";
    w.clouds.push({ id: w.nextId("cloud"), x: o.x, y: o.y, radius: shell ? sm.shellRadius : sm.grenadeRadius, born: w.tick, until: w.tick + (shell ? sm.shellTicks : sm.grenadeTicks) });
    w.emit("smoke", [], { at: [o.x, o.y], by: o.byId, kind: o.kind });
    return;
  }
  const spec = w.config.explosives[o.kind as "frag" | "stick" | "rifle_grenade" | "mortar" | "artillery"];
  const rng = w.rng.get("ordnance");
  const thrower = w.maybe(o.byId);
  const hurt: number[] = [];
  // Indirect fire is nobody's kill: the radioman only called it in.
  const indirect = o.kind === "mortar" || o.kind === "artillery";
  const cause = `${NAMES[o.kind]}${thrower ? (indirect ? ` called in by ${label(thrower)}` : ` from ${label(thrower)}`) : ""}`;
  const by = indirect ? null : o.byId;
  if (indirect) w.impacts.push({ x: o.x, y: o.y, tick: w.tick, kind: o.kind, side: o.side, spotting: o.spotting });
  for (const s of w.soldiers) {
    if (!(w.onField(s) || s.status === "surrendered" || s.status === "captured") || s.carriedById !== null) continue;
    const d = dist(s, o);
    if (d > spec.radius) continue;
    // Floors and ceilings take most of a burst on another floor of the same house.
    const sameHouse = w.map.building[w.map.idx(s.x, s.y)] === w.map.building[w.map.idx(o.x, o.y)] && w.map.building[w.map.idx(o.x, o.y)]! >= 0;
    const floors = s.z !== o.z ? (sameHouse ? Math.pow(0.2, Math.abs(s.z - o.z)) : s.z > 0 || o.z > 0 ? 0.5 : 1) : 1;
    // Banks and walls stop fragments; a man right at the burst gets no shelter.
    const throughFloor = sameHouse && s.z !== o.z;
    const vis = throughFloor ? 1 : d < 1 && s.z === o.z ? 1 : w.map.visibility(o.x, o.y, s.x, s.y, null, o.z, s.z);
    if (vis <= 0) {
      suppress(w, s, w.config.explosives.suppression * 0.4 * (1 - d / spec.radius));
      continue;
    }
    const stance = s.posture === "prone" ? 0.45 : s.posture === "crouch" ? 0.75 : 1;
    const hole = d < 1.5 || s.z > 0 ? 1 : 1 - (w.config.terrain.ownCover[w.map.at(s.x, s.y)] ?? 0);
    const exposure = Math.min(1, vis * 1.2) * stance * hole * floors;
    const n = poisson(w, spec.fragments * Math.exp(-d / spec.falloff) * exposure);
    for (let k = 0; k < n && s.status !== "dead"; k++) {
      const part = pickPart(rng, fragWeights(s.posture));
      const sev = (spec.severity[0] + rng.next() * (spec.severity[1] - spec.severity[0])) * (1 - 0.6 * (d / (spec.radius + 1)));
      injure(w, s, part, "shrapnel", sev, cause, by, impactHealth(w, part, sev) * 0.8);
    }
    // The blast itself, close in.
    if (d <= 1.6 && s.status !== "dead") {
      const force = spec.blast * (1 - d / 1.6) * exposure;
      if (force > 0.06) {
        const part = pickPart(rng, { "left leg": 3, "right leg": 3, torso: 2, head: 1, "left arm": 1, "right arm": 1 });
        injure(w, s, part, force > 0.25 ? "fracture" : "bruise", force * 1.6, `the blast of ${NAMES[o.kind]}`, by, force * 0.4);
      }
    }
    suppress(w, s, w.config.explosives.suppression * (1 - d / spec.radius) * Math.max(0.4, floors));
    if (n > 0 || (d <= 2.5 && floors === 1)) {
      hurt.push(s.id);
      s.act = null;
      s.lastHitTick = w.tick;
      s.posture = "prone";
      if (s.status !== "dead") {
        if (s.survival.health <= 0) kill(w, s, "killed", by);
        else if (n > 0) {
          shakeMorale(w, s, w.config.morale.selfHit);
          moraleOnLoss(w, s, false);
        }
      }
    }
  }
  // Suppression reaches further than fragments.
  for (const s of w.soldiers) {
    if (s.status !== "active") continue;
    const d = dist(s, o);
    if (d > spec.radius && d <= spec.radius * 1.6) suppress(w, s, w.config.explosives.suppression * 0.3);
  }
  // Shells leave holes, knock walls down, bring houses in and smash trees.
  shellDamage(w, o);
  w.emit("explosion", hurt, { kind: o.kind, at: [o.x, o.y], z: o.z, by: o.byId, hurt });
}

/** Men who see a grenade land beside them may throw themselves clear. */
function dive(w: World, o: Ordnance): void {
  const rng = w.rng.get("ordnance");
  for (const s of w.soldiers) {
    if (s.status !== "active" || !s.conscious || cheb(s, o) > 3 || s.z !== o.z) continue;
    if (w.map.visibility(s.x, s.y, o.x, o.y, null, s.z, o.z) < 0.3) continue;
    if (!rng.chance(w.config.explosives.diveChance * (s.pinned ? 0.5 : 1) * (0.6 + 0.4 * s.traits.fitness))) continue;
    s.posture = "prone";
    s.act = null;
    let best: Point | null = null, bd = cheb(s, o);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = s.x + dx, y = s.y + dy;
        if (!w.isFree(x, y, s.id, s.z)) continue;
        const d = cheb({ x, y }, o) + (w.map.visibility(o.x, o.y, x, y, null, o.z, s.z) === 0 ? 3 : 0);
        if (d > bd) {
          bd = d;
          best = { x, y };
        }
      }
    }
    if (best) w.place(s, best.x, best.y, s.z);
    w.emit("dove", [s.id], { person: s.id, at: [s.x, s.y] });
    note(w, s, "threw himself clear of a grenade");
  }
}

/** Engine rule each tick: rounds in flight land, and smoke drifts and thins. */
export function ordnanceStep(w: World): void {
  const rest: Ordnance[] = [];
  for (const o of w.ordnance) {
    if (o.burstTick === w.tick + 2 && (o.kind === "frag" || o.kind === "stick")) dive(w, o);
    if (o.burstTick <= w.tick) explode(w, o);
    else rest.push(o);
  }
  w.ordnance = rest;
  w.impacts = w.impacts.filter((i) => w.tick - i.tick <= 60);
  updateSmoke(w);
}

export function updateSmoke(w: World): void {
  w.clouds = w.clouds.filter((c) => c.until > w.tick);
  w.smoke.fill(1);
  if (w.clouds.length === 0) return;
  const see = w.config.smoke.seeThrough;
  const W = w.map.width;
  for (const c of w.clouds) {
    // Drifts with a light westerly breeze; billows up, then thins away.
    const age = w.tick - c.born;
    const cx = c.x + age * 0.02;
    const grow = Math.min(1, 0.3 + age / 8);
    const fade = Math.min(1, (c.until - w.tick) / 25);
    const r = c.radius * grow * (0.8 + 0.2 * fade);
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(c.y - r)), y1 = Math.min(w.map.height - 1, Math.ceil(c.y + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - c.y);
        if (d > r) continue;
        const thick = fade * (1 - (d / r) * (d / r));
        const v = 1 - (1 - see) * thick;
        const i = y * W + x;
        if (v < w.smoke[i]!) w.smoke[i] = v;
      }
    }
  }
}

/** Fire missions: the spotting round, then fire for effect, unless friends are now too close. */
export function missionStep(w: World): void {
  const cfg = w.config.mortars;
  for (const side of ["us", "de"] as const) {
    const pl = w.platoons[side];
    for (const m of pl.missions) {
      if (m.fired >= m.rounds + 1) continue;
      if (w.tick === m.spotTick) {
        if (dangerClose(w, side, m)) {
          m.fired = m.rounds + 1;
          w.emit("check_fire", [], { side, mission: m.id, at: [m.target.x, m.target.y] });
          continue;
        }
        incoming(w, m.kind, side, m.target, cfg.spotScatter, m.calledBy, true);
        m.fired = 1;
      } else if (w.tick >= m.effectTick && (w.tick - m.effectTick) % cfg.roundInterval === 0 && m.fired >= 1) {
        if (dangerClose(w, side, m)) {
          m.fired = m.rounds + 1;
          w.emit("check_fire", [], { side, mission: m.id, at: [m.target.x, m.target.y] });
          continue;
        }
        incoming(w, m.kind, side, m.target, cfg.effectScatter, m.calledBy);
        m.fired++;
      }
    }
  }
}

function dangerClose(w: World, side: Side, m: FireMission): boolean {
  return w.soldiers.some((s) => s.side === side && w.onField(s) && cheb(s, m.target) < w.config.mortars.dangerClose * 0.6);
}
