// Who sees whom. A man in a hedge or a window is hard to see until he fires;
// shots are heard and give a rough bearing. Each squad pools what its men see
// and hear into one list of contacts, which is all its leader and men act on.
import { sightFactor } from "../entities/body.ts";
import type { WeaponSpec } from "../scenario/config.ts";
import { cheb, dist } from "../world/map.ts";
import { enemyOf, type Contact, type Point, type Side, type Soldier, type Squad } from "../world/types.ts";
import type { World } from "../world/world.ts";

/**
 * How hard a man is to pick out where he is: ground cover and foliage, a
 * hedge or wall at his side, an upstairs room, and the gloom of a room seen
 * from out in the daylight.
 */
export function concealment(w: World, s: Soldier, from: Soldier | null = null): number {
  const cfg = w.config.perception;
  const t = w.map.at(s.x, s.y);
  let c = s.z > 0 ? 0.3 : w.config.terrain.concealment[t] ?? 1;
  if (s.z === 0 && w.map.besideCover(s.x, s.y)) c *= 0.4;
  if (s.posture === "prone") c *= t === "wheat" ? 0.4 : t === "woods" || t === "brush" ? 0.6 : 0.8;
  if (from && w.map.indoors(s.x, s.y, s.z) && !w.map.indoors(from.x, from.y, from.z) && dist(s, from) > cfg.darkRoomRange) c *= cfg.darkRoom;
  return c;
}

/** How much more a shot gives the shooter away: a lot in the open, little from cover, almost nothing for a sniper. */
function firingReveal(w: World, e: Soldier, hidden: number): number {
  const cfg = w.config.perception;
  let f = cfg.firingFactor * (e.weapon === "mg42" && hidden >= 0.5 ? 1.5 : 1);
  if (e.role === "sniper") f = 1 + (f - 1) * cfg.sniperFiring;
  else if (hidden < 0.5) f = 1 + (f - 1) * cfg.concealedFiring;
  return f;
}

function isAutomatic(s: Soldier): boolean {
  return s.weapon === "mg42" || s.weapon === "bar";
}

export function updateContact(w: World, squad: Squad, enemy: Soldier, at: Point, visible: boolean): void {
  const c = squad.contacts[enemy.id];
  const z = visible ? enemy.z : at.z ?? 0;
  if (c) {
    // A man seen a moment ago is not lost again because a shot of his is only heard.
    if (visible || !c.visible || w.tick - c.tick > 3) {
      c.x = at.x;
      c.y = at.y;
      c.z = z;
    }
    c.tick = w.tick;
    c.visible = c.visible || visible;
    c.identified = c.identified || visible;
    if (visible) {
      c.automatic = isAutomatic(enemy);
      c.sniper = enemy.role === "sniper";
      c.down = enemy.status !== "active";
    }
    return;
  }
  squad.contacts[enemy.id] = { id: enemy.id, x: at.x, y: at.y, z, tick: w.tick, visible, identified: visible, automatic: visible ? isAutomatic(enemy) : enemy.weapon === "mg42", sniper: visible && enemy.role === "sniper", down: visible ? enemy.status !== "active" : false };
  if (Object.keys(squad.contacts).length === 1 || squad.firstContactTick === null) {
    squad.firstContactTick ??= w.tick;
    w.emit("contact", [], { squad: squad.id, side: squad.side, enemy: enemy.id, at: [at.x, at.y], visible, automatic: squad.contacts[enemy.id]!.automatic });
  }
}

/**
 * Engine rule each tick: every man able to look looks for the enemy. Spotting
 * is a roll; keeping a man in view once seen is easy.
 */
export function perceptionStep(w: World): void {
  const cfg = w.config.perception;
  const rng = w.rng.get("perception");
  for (const sq of w.squads) for (const c of Object.values(sq.contacts)) c.visible = false;
  const moved = new Set<number>();
  for (const [id, t] of w.trails) if (t.length > 0) moved.add(id);
  const targets = w.soldiers.filter((s) => w.onField(s) || s.status === "surrendered");
  for (const s of w.soldiers) {
    const prev = new Set(s.sees);
    s.sees = [];
    if (!w.onField(s) || !s.conscious || s.carriedById !== null) continue;
    const range = cfg.maxRange * sightFactor(s) * w.weather.sight;
    const squad = w.squad(s.squadId);
    const alert = s.status === "active" ? (s.pinned ? 0.35 : 1) * (s.experience === "veteran" ? 1.2 : s.experience === "green" ? 0.85 : 1) : 0.4;
    // Hunting a sniper: every man scans the tree line or windows where they think he is.
    const hunt = squad.sniperAlert && w.tick - squad.sniperAlert.tick < 45 ? squad.sniperAlert : null;
    for (const e of targets) {
      if (e.side === s.side || e.carriedById !== null) continue;
      const d = dist(s, e);
      if (d > range) continue;
      const vis = w.map.visibility(s.x, s.y, e.x, e.y, w.smoke, s.z, e.z);
      if (vis < cfg.minVisibility) continue;
      let p: number;
      if (prev.has(e.id)) p = 0.95;
      else {
        const hidden = concealment(w, e, s);
        const firing = w.tick - e.lastFiredTick <= 1 ? firingReveal(w, e, hidden) : 1;
        const moving = moved.has(e.id) ? cfg.movingFactor : 1;
        const fall = Math.pow(1 - d / range, 2);
        const looking = hunt && cheb(e, hunt) <= 12 ? 2.5 : 1;
        p = cfg.spotBase * w.weather.spot * vis * w.config.posture.size[e.posture] * hidden * firing * moving * fall * alert * looking;
        if (d <= 6) p = Math.max(p, 0.8 * vis * Math.min(1, hidden * 2));
      }
      if (!rng.chance(Math.min(0.98, p))) continue;
      s.sees.push(e.id);
      updateContact(w, squad, e, e, true);
    }
  }
  // Forget the stale.
  for (const sq of w.squads) {
    for (const key of Object.keys(sq.contacts)) {
      const c = sq.contacts[Number(key)]!;
      if (w.tick - c.tick > cfg.contactMemory) delete sq.contacts[Number(key)];
    }
  }
}

/**
 * A shot is heard; every enemy squad within earshot learns roughly where it
 * came from. A man firing from cover is harder to place, and a sniper's
 * single crack, far off, gives no useful bearing at all.
 */
export function hearShot(w: World, shooter: Soldier, spec: WeaponSpec): void {
  const rng = w.rng.get("perception");
  const cfg = w.config.perception;
  const sniper = shooter.role === "sniper";
  const err = cfg.hearError * (sniper ? cfg.sniperHearError : 1) * (concealment(w, shooter) < 0.5 ? cfg.concealedHearError : 1);
  for (const sq of w.squads) {
    if (sq.side === shooter.side) continue;
    const known = sq.contacts[shooter.id];
    if (known && known.visible) continue;
    let nearest = Infinity;
    for (const id of sq.members) {
      const m = w.maybe(id);
      if (!m || !w.onField(m) || !m.conscious) continue;
      nearest = Math.min(nearest, dist(m, shooter));
    }
    if (nearest > spec.noise * w.weather.hearing || (sniper && nearest > cfg.sniperHeardWithin * w.weather.hearing)) continue;
    const off = Math.round(nearest * err);
    const at = { x: shooter.x + (off > 0 ? rng.int(2 * off + 1) - off : 0), y: shooter.y + (off > 0 ? rng.int(2 * off + 1) - off : 0) };
    const clamped = { x: Math.max(0, Math.min(w.map.width - 1, at.x)), y: Math.max(0, Math.min(w.map.height - 1, at.y)) };
    const z = shooter.z > 0 && w.map.passable(clamped.x, clamped.y, shooter.z) ? shooter.z : 0;
    updateContact(w, sq, shooter, z > 0 ? { ...clamped, z } : clamped, false);
  }
}

/** Known, live enemy contacts of a squad, freshest first. */
export function liveContacts(w: World, squad: Squad, maxAge = 45): Contact[] {
  return Object.values(squad.contacts)
    .filter((c) => !c.down && w.tick - c.tick <= maxAge)
    .sort((a, b) => b.tick - a.tick || a.id - b.id);
}

/** Every live contact a side knows of, merged across its squads. */
export function sideContacts(w: World, side: Side, maxAge = 45): Contact[] {
  const best = new Map<number, Contact>();
  for (const sq of w.squads) {
    if (sq.side !== side) continue;
    for (const c of liveContacts(w, sq, maxAge)) {
      const b = best.get(c.id);
      if (!b || c.tick > b.tick || (c.tick === b.tick && c.visible && !b.visible)) best.set(c.id, c);
    }
  }
  return [...best.values()].sort((a, b) => a.id - b.id);
}

/** Groups contacts that lie close together into positions, strongest first. */
export function clusters(contacts: readonly Contact[], radius = 5): { at: Point; n: number; automatic: boolean; sniper: boolean; identified: boolean; ids: number[] }[] {
  const out: { at: Point; n: number; automatic: boolean; sniper: boolean; identified: boolean; ids: number[]; sx: number; sy: number }[] = [];
  for (const c of contacts) {
    const g = out.find((o) => cheb(o.at, c) <= radius);
    if (g) {
      g.n++;
      g.sx += c.x;
      g.sy += c.y;
      g.at = { x: Math.round(g.sx / g.n), y: Math.round(g.sy / g.n) };
      g.automatic = g.automatic || c.automatic;
      g.sniper = g.sniper || c.sniper;
      g.identified = g.identified || c.identified;
      g.ids.push(c.id);
    } else out.push({ at: c.z > 0 ? { x: c.x, y: c.y, z: c.z } : { x: c.x, y: c.y }, n: 1, automatic: c.automatic, sniper: c.sniper, identified: c.identified, ids: [c.id], sx: c.x, sy: c.y });
  }
  return out
    .map(({ at, n, automatic, sniper, identified, ids }) => ({ at, n, automatic, sniper, identified, ids }))
    .sort((a, b) => (b.automatic || b.sniper ? 1 : 0) - (a.automatic || a.sniper ? 1 : 0) || b.n - a.n || a.at.y - b.at.y || a.at.x - b.at.x);
}

/**
 * Rebuilds, for one side, how exposed each tile is to the enemy positions it
 * knows of. Routes and cover choices avoid what the enemy can see.
 */
export function rebuildExposure(w: World, side: Side): void {
  const grid = w.exposure[side];
  grid.fill(0);
  const groups = clusters(sideContacts(w, side, 90), 4).slice(0, 8);
  if (groups.length === 0) return;
  const W = w.map.width, H = w.map.height;
  const reach = 110;
  for (const g of groups) {
    const weight = (g.automatic ? 1.6 : 1) * Math.min(2, 0.6 + 0.2 * g.n);
    const x0 = Math.max(0, g.at.x - reach), x1 = Math.min(W - 1, g.at.x + reach);
    const y0 = Math.max(0, g.at.y - reach), y1 = Math.min(H - 1, g.at.y + reach);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if (!Number.isFinite(w.map.cost(i))) continue;
        const v = w.map.visibility(g.at.x, g.at.y, x, y, w.smoke);
        if (v <= 0.1) continue;
        const d = Math.hypot(x - g.at.x, y - g.at.y);
        grid[i]! += v * weight * (1 - d / (reach + 10));
      }
    }
  }
}

export { enemyOf };
