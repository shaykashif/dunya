// Tactical geometry: where to stand, where to hide, how to get round a flank.
// Everything here reads only the map, the squad's own contacts and the side's
// exposure map, which is built from those contacts.
import type { Building } from "../world/layout.ts";
import { cheb, dist, findPath } from "../world/map.ts";
import type { Point, Posture, Side, Soldier } from "../world/types.ts";
import type { World } from "../world/world.ts";

/** Average protection at a tile from fire coming from each threat. */
export function coverFrom(w: World, at: Point, threats: readonly Point[], posture: Posture): number {
  if (threats.length === 0) return w.map.besideCover(at.x, at.y) ? 0.5 : 0;
  let c = 0;
  for (const t of threats) c += w.map.cover(at, t, posture);
  return c / threats.length;
}

/** Can a man at `at` put fire on `target` (by sight line, ignoring smoke)? Floors count. */
export function canFireOn(w: World, at: Point, target: Point): boolean {
  return w.map.visibility(at.x, at.y, target.x, target.y, null, at.z ?? 0, target.z ?? 0) >= w.config.perception.minVisibility;
}

/**
 * What a spot is worth as a vantage point for looking at `toward`: how much
 * higher it stands, and how much of the ground out there it can see.
 */
export function vantage(w: World, p: Point, toward: Point): number {
  const z = p.z ?? 0;
  const up = w.map.heightAt(p.x, p.y, z) - w.map.heightAt(Math.max(0, Math.min(w.map.width - 1, toward.x)), Math.max(0, Math.min(w.map.height - 1, toward.y)));
  let seen = 0, n = 0;
  const dx = toward.x - p.x, dy = toward.y - p.y;
  const d = Math.hypot(dx, dy) || 1;
  // Sample the ground ahead: the point itself, and either side of it.
  for (const f of [0.6, 1, 1.3]) {
    for (const side of [-0.25, 0, 0.25]) {
      const x = Math.round(p.x + (dx * f - dy * side)), y = Math.round(p.y + (dy * f + dx * side));
      if (!w.map.inBounds(x, y)) continue;
      n++;
      seen += w.map.visibility(p.x, p.y, x, y, null, z, 0);
    }
  }
  return Math.max(-0.2, Math.min(0.35, up * 0.03)) + (n > 0 ? (seen / n) * 0.6 : 0) - Math.min(0.2, Math.abs(d - 60) * 0.001);
}

/**
 * Best nearby spot to take cover in. With `fireAt`, the spot must also let him
 * shoot back at it (a fighting position); otherwise it is just shelter.
 */
export function findCover(w: World, s: Soldier, threats: readonly Point[], radius: number, fireAt: Point | null): Point | null {
  const ex = w.exposure[s.side];
  let best: Point | null = null;
  let bestScore = -Infinity;
  const z = s.z;
  const hereScore = scoreSpot(w, s, s, threats, fireAt, ex);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = s.x + dx, y = s.y + dy;
      if ((dx === 0 && dy === 0) || !w.isFree(x, y, s.id, z)) continue;
      const p = z > 0 ? { x, y, z } : { x, y };
      if (!w.map.reachable(s, p)) continue;
      const score = scoreSpot(w, s, p, threats, fireAt, ex) - 0.04 * Math.hypot(dx, dy);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }
  return best && bestScore > hereScore + 0.08 ? best : null;
}

function scoreSpot(w: World, s: Soldier, p: Point, threats: readonly Point[], fireAt: Point | null, ex: Float32Array): number {
  const i = w.map.idx(p.x, p.y);
  let score = coverFrom(w, p, threats, "crouch") - 0.25 * Math.min(2, ex[i]!);
  const t = w.map.at(p.x, p.y);
  if (t === "foxhole" || t === "ditch") score += 0.2;
  if (fireAt) {
    score += canFireOn(w, p, fireAt) ? 0.45 : -0.6;
    // A little higher is a little better, for seeing and for shooting down.
    const up = w.map.heightAt(p.x, p.y, p.z ?? 0) - w.map.heightAt(s.x, s.y, s.z);
    score += Math.max(-0.1, Math.min(0.1, up * 0.03));
  }
  // Behind a friendly tank or gun, with it between him and the threat.
  if (w.tanks.size > 0 && threats.length > 0) {
    const th = threats[0]!;
    for (const t of w.tanks.values()) {
      if (t.side !== s.side || t.state === "abandoned") continue;
      const v = w.soldier(t.id);
      if (v.id === s.id || Math.max(Math.abs(p.x - v.x), Math.abs(p.y - v.y)) > 3) continue;
      if (Math.hypot(v.x - th.x, v.y - th.y) < Math.hypot(p.x - th.x, p.y - th.y) - 1) {
        score += 0.5;
        break;
      }
    }
  }
  // Not right on top of a friend: one burst would get both.
  const z = p.z ?? 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!w.map.inBounds(p.x + dx, p.y + dy)) continue;
      const o = w.occupancy[w.map.cell(p.x + dx, p.y + dy, z)]!;
      if (o !== 0 && o !== s.id) score -= 0.12;
    }
  }
  return score;
}

/**
 * Spots for a group of men around a point: spread out, beside cover that faces
 * the enemy, each on his own tile. If the point is upstairs, the house's upper
 * floor is used too, windows first. Machine gunners, automatic riflemen and
 * snipers get first pick, and pick for vantage: height and a field of fire.
 * Returns soldier id to spot.
 */
export function pickPositions(w: World, men: readonly Soldier[], center: Point, facing: Point, spacing: number, radius: number, fireAt: Point | null = null): Record<number, Point> {
  const out: Record<number, Point> = {};
  const taken: Point[] = [];
  const cands: { p: Point; score: number }[] = [];
  const threat = { x: center.x + facing.x * 30, y: center.y + facing.y * 30 };
  const ex = men.length > 0 ? w.exposure[men[0]!.side] : null;
  const floors = center.z && center.z > 0 ? [0, center.z] : [0];
  for (const z of floors) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = center.x + dx, y = center.y + dy;
        if (!w.map.passable(x, y, z)) continue;
        const t = w.map.at(x, y);
        if (t === "hedge" || t === "water") continue;
        const p = z > 0 ? { x, y, z } : { x, y };
        if (w.map.passable(center.x, center.y, center.z ?? 0) && !w.map.reachable(center, p)) continue;
        let score = w.map.cover(p, threat, "crouch") - 0.03 * Math.hypot(dx, dy);
        // Forward is better than back, for a line facing the enemy.
        score += 0.02 * (dx * facing.x + dy * facing.y);
        if (fireAt && !canFireOn(w, p, fireAt)) score -= 0.5;
        if (ex) score -= 0.15 * Math.min(2, ex[w.map.idx(x, y)]!);
        if (t === "foxhole" || t === "ditch") score += 0.25;
        if (z > 0 && (w.map.besideWindow(x, y) || w.map.isTower(x, y))) score += 0.35;
        cands.push({ p, score });
      }
    }
  }
  cands.sort((a, b) => b.score - a.score || (a.p.z ?? 0) - (b.p.z ?? 0) || a.p.y - b.p.y || a.p.x - b.p.x);
  const look = fireAt ?? threat;
  const keen = (m: Soldier) => m.role === "machine_gunner" || m.role === "auto_rifleman" || m.role === "sniper";
  const order = [...men.filter(keen), ...men.filter((m) => !keen(m))];
  for (const m of order) {
    let pick: Point | null = null;
    // The gunner weighs the best few spots for the view they give him.
    const pool = keen(m) ? cands.slice(0, 40).map((c) => ({ p: c.p, score: c.score + vantage(w, c.p, look) + ((c.p.z ?? 0) > 0 && w.map.isTower(c.p.x, c.p.y) ? 0.6 : 0) })).sort((a, b) => b.score - a.score || a.p.y - b.p.y || a.p.x - b.p.x) : cands;
    for (const gap of [spacing, Math.max(1, spacing - 1), 1]) {
      for (const c of pool) {
        if (taken.some((t) => cheb(t, c.p) < gap && (t.z ?? 0) === (c.p.z ?? 0))) continue;
        const occ = w.occupancy[w.map.cell(c.p.x, c.p.y, c.p.z ?? 0)]!;
        if (occ !== 0 && !men.some((o) => o.id === occ)) continue;
        pick = c.p;
        break;
      }
      if (pick) break;
    }
    if (!pick) pick = w.freeTileNear(center, radius + 4, m.id) ?? { x: m.x, y: m.y };
    taken.push(pick);
    out[m.id] = pick;
  }
  return out;
}

/** A unit vector from a toward b, on the grid. */
export function facingFrom(a: Point, b: Point): Point {
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}

export function centroid(ps: readonly Point[]): Point {
  if (ps.length === 0) return { x: 0, y: 0 };
  let x = 0, y = 0;
  for (const p of ps) {
    x += p.x;
    y += p.y;
  }
  return { x: Math.round(x / ps.length), y: Math.round(y / ps.length) };
}

/**
 * A flanking position: off to one side of the enemy position, about `range`
 * tiles from it, reached by the least exposed route. Tries both sides and
 * several angles and returns the best, or null if nothing is reachable.
 */
export function flankPoint(w: World, side: Side, from: Point, focus: Point, range: number): Point | null {
  const base = Math.atan2(from.y - focus.y, from.x - focus.x);
  const ex = w.exposure[side];
  let best: Point | null = null, bestScore = Infinity;
  for (const deg of [70, -70, 95, -95, 50, -50]) {
    const a = base + (deg * Math.PI) / 180;
    const p = { x: Math.round(focus.x + Math.cos(a) * range), y: Math.round(focus.y + Math.sin(a) * range) };
    if (!w.map.inBounds(p.x, p.y)) continue;
    const spot = w.freeTileNear(p, 4) ?? null;
    if (!spot || !w.map.reachable(from, spot)) continue;
    const n = w.map.tiles;
    const path = findPath(w.map, w.map.cell(from.x, from.y, from.z ?? 0), w.map.cell(spot.x, spot.y, spot.z ?? 0), { extra: w.tacticalCost(side, w.config.movement.exposureWeight), maxExpand: 25000 });
    if (!path) continue;
    let exposure = 0, cost = 0;
    const painMap = w.pain[side];
    for (const c of path) {
      exposure += ex[c % n]! + painMap[c % n]! * 0.7;
      cost += w.map.cellCost(c);
    }
    // Being able to fire on the position from there, from cover, is what makes a flank.
    const sees = canFireOn(w, spot, focus) ? 0 : 30;
    const score = exposure * 4 + cost * 0.3 + sees - w.map.cover(spot, focus, "crouch") * 15;
    if (score < bestScore) {
      bestScore = score;
      best = spot;
    }
  }
  return best;
}

/**
 * The route to an objective, broken into bounds: each bound ends at a hedge or
 * wall to shelter behind, roughly a field at a time.
 */
export function boundsTo(w: World, side: Side, from: Point, to: Point): Point[] {
  const n = w.map.tiles;
  const pain = w.pain[side];
  const pw = w.config.movement.painWeight;
  const tac = w.tacticalCost(side, w.config.movement.exposureWeight)!;
  const path = findPath(w.map, w.map.cell(from.x, from.y, from.z ?? 0), w.map.cell(to.x, to.y, to.z ?? 0), { extra: (c) => tac(c) + pain[c % n]! * pw + (w.map.terrain[c % n] === "hedge" ? 6 : 0), maxExpand: 40000 });
  if (!path) return [to];
  const out: Point[] = [];
  let last = from;
  for (let k = 0; k < path.length; k++) {
    const p = w.map.pt(path[k]!);
    const d = dist(last, p);
    const t = w.map.at(p.x, p.y);
    // Stop short of each hedge: the near side of the bank.
    const next = k + 1 < path.length ? w.map.at(w.map.pt(path[k + 1]!).x, w.map.pt(path[k + 1]!).y) : null;
    const atHedge = t !== "hedge" && next === "hedge";
    const atGap = t !== "hedge" && w.map.besideCover(p.x, p.y) && d >= 14;
    if ((atHedge && d >= 8) || atGap || d >= 24) {
      out.push(p);
      last = p;
    }
  }
  if (out.length === 0 || dist(out[out.length - 1]!, to) > 3) out.push(to);
  return out;
}

// ---------- Fighting in a city ----------

/** The standing building at a point, if any. */
export function houseAt(w: World, p: Point): Building | null {
  if (!w.map.inBounds(p.x, p.y)) return null;
  const id = w.map.building[w.map.idx(p.x, p.y)]!;
  if (id < 0) return null;
  const b = w.buildings[id]!;
  return b.destroyed ? null : b;
}

/** Tiles from a point to the nearest tile of a building (0 if on it). */
export function gapTo(b: Building, p: Point): number {
  return Math.max(b.x - p.x, 0, p.x - (b.x + b.w - 1), b.y - p.y, p.y - (b.y + b.h - 1));
}

const keenRole = (m: Soldier) => m.role === "machine_gunner" || m.role === "auto_rifleman" || m.role === "sniper";

/**
 * Spots for a team holding a building: at the windows on the side facing
 * `toward`, on every floor (only from floor `minZ` up, if given), the machine
 * gun, automatic rifle and sniper highest and with the best view, the rest
 * spread through the rooms, one to a tile, off the stairs. Men it has no room
 * for take any free spot nearby.
 */
export function buildingPositions(w: World, men: readonly Soldier[], b: Building, toward: Point, minZ = 0, exclude: readonly Point[] = []): Record<number, Point> {
  const out: Record<number, Point> = {};
  const cands: { p: Point; score: number }[] = [];
  const map = w.map;
  for (let y = b.y + 1; y < b.y + b.h - 1; y++) {
    for (let x = b.x + 1; x < b.x + b.w - 1; x++) {
      const levels = map.levels[map.idx(x, y)]!;
      for (let z = minZ; z < levels; z++) {
        if (!map.passable(x, y, z)) continue;
        const p = z > 0 ? { x, y, z } : { x, y };
        if (exclude.some((q) => q.x === x && q.y === y && (q.z ?? 0) === z)) continue;
        const t = map.at(x, y);
        let score = z * 0.15;
        if (map.isTower(x, y) && z > 0) score += 1.4;
        let facing = false, window = false;
        for (const q of map.neighbors4(x, y)) {
          if (map.at(q.x, q.y) !== "window" && map.at(q.x, q.y) !== "rubble") continue;
          window = true;
          if ((q.x - x) * (toward.x - x) + (q.y - y) * (toward.y - y) > 0) facing = true;
        }
        if (facing) score += 1 + (canFireOn(w, p, toward) ? 0.4 : 0);
        else if (window) score += 0.25;
        if (t === "stairs") score -= 0.8;
        else if (t === "door") score -= 0.4;
        cands.push({ p, score });
      }
    }
  }
  cands.sort((a, c) => c.score - a.score || (c.p.z ?? 0) - (a.p.z ?? 0) || a.p.y - c.p.y || a.p.x - c.p.x);
  const taken: Point[] = [];
  const order = [...men.filter(keenRole), ...men.filter((m) => !keenRole(m))];
  const left: Soldier[] = [];
  for (const m of order) {
    let pick: Point | null = null;
    for (const gap of [2, 1]) {
      for (const c of cands) {
        if (taken.some((t) => cheb(t, c.p) < gap && (t.z ?? 0) === (c.p.z ?? 0))) continue;
        const occ = w.occupancy[map.cell(c.p.x, c.p.y, c.p.z ?? 0)]!;
        if (occ !== 0 && !men.some((o) => o.id === occ)) continue;
        pick = c.p;
        break;
      }
      if (pick) break;
    }
    if (!pick) {
      left.push(m);
      continue;
    }
    taken.push(pick);
    out[m.id] = pick;
  }
  if (left.length > 0) {
    const centre = { x: b.x + Math.floor(b.w / 2), y: b.y + b.h + 1 };
    const rest = pickPositions(w, left, w.freeTileNear(centre, 6) ?? centre, facingFrom(centre, toward), 2, 5);
    Object.assign(out, rest);
  }
  return out;
}

/**
 * The route to an objective through a city, in bounds from building to
 * building: each bound ends inside the next house on the way (to be cleared
 * and held), or failing that at the next cover, never more than a short dash
 * across open street.
 */
export function urbanBoundsTo(w: World, side: Side, from: Point, to: Point): Point[] {
  const n = w.map.tiles;
  const pain = w.pain[side];
  const pw = w.config.movement.painWeight;
  const tac = w.tacticalCost(side, w.config.movement.exposureWeight)!;
  const path = findPath(w.map, w.map.cell(from.x, from.y, from.z ?? 0), w.map.cell(to.x, to.y, to.z ?? 0), { extra: (c) => tac(c) + pain[c % n]! * pw, maxExpand: 60000 });
  if (!path) return boundsTo(w, side, from, to);
  const max = w.config.urban.boundMax;
  const out: Point[] = [];
  let last = from;
  let inHouse = w.map.building[w.map.idx(from.x, from.y)]!;
  for (const c of path) {
    if (c >= n) continue;
    const p = w.map.pt(c);
    const i = w.map.idx(p.x, p.y);
    const b = w.map.building[i]!;
    const d = dist(last, p);
    if (b >= 0 && w.map.indoors(p.x, p.y) && b !== inHouse && !w.buildings[b]!.destroyed) {
      inHouse = b;
      if (d >= 5) {
        out.push(p);
        last = p;
      }
      continue;
    }
    if (b < 0) inHouse = -1;
    if ((d >= max && w.map.open[i] === 0) || d >= max + 8) {
      out.push(p);
      last = p;
    }
  }
  if (out.length === 0 || dist(out[out.length - 1]!, to) > 3) out.push(to);
  return out;
}

/**
 * Where a team should get to in a city to go for a position: close in, in
 * dead ground under its window where it cannot fire on them, indoors or hard
 * against a wall, off the line of the base of fire, and ideally right up
 * against the house it is in, ready to stack on the walls and post grenades.
 */
export function urbanFlankPoint(w: World, side: Side, from: Point, focus: Point, range: number): Point | null {
  const fz = focus.z ?? 0;
  const ex = w.exposure[side];
  const fx = Math.max(0, Math.min(w.map.width - 1, focus.x)), fy = Math.max(0, Math.min(w.map.height - 1, focus.y));
  const target = w.map.building[w.map.idx(fx, fy)]!;
  const house = target >= 0 ? w.buildings[target]! : null;
  const base = Math.atan2(from.y - focus.y, from.x - focus.x);
  const R = range + 3;
  let best: Point | null = null, bestScore = -Infinity;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx, dy);
      if (d < 2 || d > R) continue;
      const x = focus.x + dx, y = focus.y + dy;
      if (!w.isFree(x, y, 0, 0)) continue;
      const i = w.map.idx(x, y);
      if (target >= 0 && w.map.building[i] === target) continue;
      const p = { x, y };
      if (!w.map.reachable(from, p)) continue;
      let score = 0;
      const seen = w.map.visibility(fx, fy, x, y, null, fz, 0);
      score += seen < w.config.perception.minVisibility ? 1.6 : -seen * 1.2;
      if (w.map.indoors(x, y)) score += 0.7;
      else if (w.map.open[i] === 0) score += 0.4;
      if (house) {
        const gap = gapTo(house, p);
        score += gap <= 1 ? 0.8 : gap <= 4 ? 0.4 : 0;
      }
      let off = Math.atan2(y - focus.y, x - focus.x) - base;
      while (off > Math.PI) off -= 2 * Math.PI;
      while (off < -Math.PI) off += 2 * Math.PI;
      score += Math.min(1, Math.abs(off) / (Math.PI / 2)) * 0.6;
      score -= 0.4 * Math.min(2, ex[i]!);
      score -= Math.abs(d - range) * 0.05 + dist(p, from) * 0.004;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }
  return best;
}
