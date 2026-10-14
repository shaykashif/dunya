// Ambushes. A defending squad may be sent forward of the main line to lie in
// a wood, scrub or the bank of a hedge beside the way the enemy must come,
// close enough to the route to catch a whole squad in the open. They go flat,
// hold their fire, and spring it all at once (see ambushStep in command.ts).
import { startClearance } from "../world/layout.ts";
import { dist, findPath } from "../world/map.ts";
import { enemyOf, type Point, type Side, type Soldier } from "../world/types.ts";
import type { World } from "../world/world.ts";

const HIDING = new Set(["woods", "brush", "orchard", "deadfall"]);

/** How good a tile is to lie hidden in: foliage, or tucked against a hedge. */
function hiding(w: World, x: number, y: number): number {
  const t = w.map.at(x, y);
  if (HIDING.has(t)) return t === "orchard" ? 0.5 : 1;
  if (w.map.passable(x, y) && t !== "road" && w.map.besideCover(x, y)) return 0.6;
  return 0;
}

/**
 * The best place to lie in wait: hidden ground with room for a squad, a few
 * tiles off the route the attackers will likely take to the objective, in
 * front of the defended hedge, with a clear view of the route.
 */
export function ambushSite(w: World, side: Side): { at: Point; look: Point } | null {
  const cfg = w.config.ambush;
  const enemy = enemyOf(side);
  const attackers = w.side(enemy);
  if (attackers.length === 0) return null;
  const start = { x: Math.round(attackers.reduce((a, s) => a + s.x, 0) / attackers.length), y: Math.round(attackers.reduce((a, s) => a + s.y, 0) / attackers.length) };
  const obj = w.platoons[enemy].objective;
  const route = findPath(w.map, w.map.cell(start.x, start.y), w.map.cell(obj.x, obj.y), { maxExpand: 40000 });
  if (!route) return null;
  const toward = w.platoons[enemy].rearY > obj.y ? 1 : -1;
  const lineAt = w.layout.line.rowAt;
  // Never so far forward that the enemy could see it from where he forms up (the squad spreads a few tiles round the spot).
  const clear = startClearance(w.config) + 4;
  let best: { at: Point; look: Point } | null = null, bestScore = -Infinity;
  for (let k = 0; k < route.length; k += 3) {
    const p = w.map.pt(route[k]!);
    const ahead = (p.y - lineAt[p.x]!) * toward;
    if (ahead < cfg.forward[0] || ahead > cfg.forward[1]) continue;
    for (let dy = -9; dy <= 9; dy++) {
      for (let dx = -9; dx <= 9; dx++) {
        const d = Math.hypot(dx, dy);
        if (d < 4 || d > 9) continue;
        const x = p.x + dx, y = p.y + dy;
        if (!w.map.inBounds(x, y)) continue;
        const h = hiding(w, x, y);
        if (h === 0) continue;
        // Room for the whole squad in cover around it.
        let room = 0;
        for (let yy = y - 3; yy <= y + 3; yy++) for (let xx = x - 3; xx <= x + 3; xx++) if (w.map.inBounds(xx, yy) && hiding(w, xx, yy) > 0) room++;
        if (room < 10) continue;
        if (attackers.some((a) => dist(a, { x, y }) < clear)) continue;
        const view = w.map.visibility(x, y, p.x, p.y);
        if (view < 0.25) continue;
        const score = h + Math.min(1, room / 25) + view - Math.abs(d - 6) * 0.08;
        if (score > bestScore) {
          bestScore = score;
          best = { at: { x, y }, look: p };
        }
      }
    }
  }
  return best;
}

/** Spots for the men around the site, each in cover, spread out, with a view of the route. */
export function ambushSpots(w: World, men: readonly Soldier[], site: { at: Point; look: Point }): Record<number, Point> {
  const cands: { p: Point; score: number }[] = [];
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = site.at.x + dx, y = site.at.y + dy;
      if (!w.isFree(x, y)) continue;
      const h = hiding(w, x, y);
      if (h === 0) continue;
      cands.push({ p: { x, y }, score: h + w.map.visibility(x, y, site.look.x, site.look.y) - Math.hypot(dx, dy) * 0.05 });
    }
  }
  cands.sort((a, b) => b.score - a.score || a.p.y - b.p.y || a.p.x - b.p.x);
  const out: Record<number, Point> = {};
  const taken: Point[] = [];
  // The machine gun first, to the best spot.
  const order = [...men].sort((a, b) => (b.role === "machine_gunner" || b.role === "auto_rifleman" ? 1 : 0) - (a.role === "machine_gunner" || a.role === "auto_rifleman" ? 1 : 0) || a.id - b.id);
  for (const m of order) {
    const c = cands.find((c) => !taken.some((t) => Math.max(Math.abs(t.x - c.p.x), Math.abs(t.y - c.p.y)) < 2)) ?? cands.find((c) => !taken.some((t) => t.x === c.p.x && t.y === c.p.y));
    const p = c ? c.p : (w.freeTileNear(site.at, 6, m.id) ?? site.at);
    taken.push(p);
    out[m.id] = p;
  }
  return out;
}
