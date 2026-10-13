// Tactical geometry: where to stand, where to hide, how to get round a flank.
// Everything here reads only the map, the squad's own contacts and the side's
// exposure map, which is built from those contacts.
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

/** Can a man at `at` put fire on `target` (by sight line, ignoring smoke)? */
export function canFireOn(w: World, at: Point, target: Point): boolean {
  return w.map.visibility(at.x, at.y, target.x, target.y) >= w.config.perception.minVisibility;
}

/**
 * Best nearby spot to take cover in. With `fireAt`, the spot must also let him
 * shoot back at it (a fighting position); otherwise it is just shelter.
 */
export function findCover(w: World, s: Soldier, threats: readonly Point[], radius: number, fireAt: Point | null): Point | null {
  const ex = w.exposure[s.side];
  let best: Point | null = null;
  let bestScore = -Infinity;
  const hereScore = scoreSpot(w, s, s, threats, fireAt, ex);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = s.x + dx, y = s.y + dy;
      if ((dx === 0 && dy === 0) || !w.isFree(x, y, s.id)) continue;
      if (!w.map.reachable(s, { x, y })) continue;
      const score = scoreSpot(w, s, { x, y }, threats, fireAt, ex) - 0.04 * Math.hypot(dx, dy);
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best && bestScore > hereScore + 0.08 ? best : null;
}

function scoreSpot(w: World, s: Soldier, p: Point, threats: readonly Point[], fireAt: Point | null, ex: Float32Array): number {
  const i = w.map.idx(p.x, p.y);
  let score = coverFrom(w, p, threats, "crouch") - 0.25 * Math.min(2, ex[i]!);
  if (w.map.at(p.x, p.y) === "foxhole") score += 0.2;
  if (fireAt) score += canFireOn(w, p, fireAt) ? 0.45 : -0.6;
  // Not right on top of a friend: one burst would get both.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!w.map.inBounds(p.x + dx, p.y + dy)) continue;
      const o = w.occupancy[w.map.idx(p.x + dx, p.y + dy)]!;
      if (o !== 0 && o !== s.id) score -= 0.12;
    }
  }
  return score;
}

/**
 * Spots for a group of men around a point: spread out, beside cover that faces
 * the enemy, each on his own tile. Returns soldier id to spot.
 */
export function pickPositions(w: World, men: readonly Soldier[], center: Point, facing: Point, spacing: number, radius: number, fireAt: Point | null = null): Record<number, Point> {
  const out: Record<number, Point> = {};
  const taken: Point[] = [];
  const cands: { p: Point; score: number }[] = [];
  const threat = { x: center.x + facing.x * 30, y: center.y + facing.y * 30 };
  const ex = men.length > 0 ? w.exposure[men[0]!.side] : null;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = center.x + dx, y = center.y + dy;
      if (!w.map.passable(x, y)) continue;
      const t = w.map.at(x, y);
      if (t === "hedge" || t === "water") continue;
      if (w.map.passable(center.x, center.y) && !w.map.reachable(center, { x, y })) continue;
      let score = w.map.cover({ x, y }, threat, "crouch") - 0.03 * Math.hypot(dx, dy);
      // Forward is better than back, for a line facing the enemy.
      score += 0.02 * (dx * facing.x + dy * facing.y);
      if (fireAt && !canFireOn(w, { x, y }, fireAt)) score -= 0.5;
      if (ex) score -= 0.15 * Math.min(2, ex[w.map.idx(x, y)]!);
      if (t === "foxhole") score += 0.25;
      cands.push({ p: { x, y }, score });
    }
  }
  cands.sort((a, b) => b.score - a.score || a.p.y - b.p.y || a.p.x - b.p.x);
  for (const m of men) {
    let pick: Point | null = null;
    for (const gap of [spacing, Math.max(1, spacing - 1), 1]) {
      for (const c of cands) {
        if (taken.some((t) => cheb(t, c.p) < gap)) continue;
        const occ = w.occupancy[w.map.idx(c.p.x, c.p.y)]!;
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
    const path = findPath(w.map, w.map.idx(from.x, from.y), w.map.idx(spot.x, spot.y), { extra: (i) => ex[i]! * w.config.movement.exposureWeight, maxExpand: 25000 });
    if (!path) continue;
    let exposure = 0, cost = 0;
    for (const i of path) {
      exposure += ex[i]!;
      cost += w.map.cost(i);
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
  const ex = w.exposure[side];
  const path = findPath(w.map, w.map.idx(from.x, from.y), w.map.idx(to.x, to.y), { extra: (i) => ex[i]! * w.config.movement.exposureWeight + (w.map.terrain[i] === "hedge" ? 6 : 0), maxExpand: 40000 });
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
