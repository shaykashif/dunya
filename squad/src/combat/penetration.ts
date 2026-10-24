// Rounds through cover. A rifle bullet goes through a wooden door, a log wall
// or a tree trunk, and now and then through the earth and brush of a hedgerow
// bank; a pistol or a submachine gun barely through a door; a .50 through most
// of it. Stone walls and houses stop all of them but the .50, and that only
// just. What comes through has lost most of its punch and its reach: it hits
// less often, wounds less, and only close in. All of it is in
// `config.penetration`: each weapon's `pen` against each material's `resist`.
import type { WeaponSpec } from "../scenario/config.ts";
import type { Point, Soldier, Terrain } from "../world/types.ts";
import type { World } from "../world/world.ts";

/** How much stopping power one tile of this ground has, in the same units as a weapon's `pen`. */
export function resistAt(w: World, x: number, y: number): number {
  if (!w.map.inBounds(x, y)) return 0;
  const t = w.map.at(x, y);
  const res = w.config.penetration.resist;
  // A log cabin's walls are timber, not stone.
  if ((t === "building" || t === "window") && w.buildings[w.map.building[w.map.idx(x, y)]!]?.kind === "cabin") return res.timber ?? 0;
  return res[t] ?? 0;
}

/** The share of rounds that get through so much stopping power. */
export function through(spec: WeaponSpec, resist: number): number {
  if (resist <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - resist / spec.pen));
}

/** What comes through loses its reach: it only hits close in. */
export function reach(w: World, range: number): number {
  return Math.exp(-range / w.config.penetration.range);
}

/**
 * Stopping power of everything solid on the line from the shooter to the
 * target, the two ends left out: the hedge bank, the walls, the wrecks. Only
 * what blocks sight is counted (trees and windows are seen through, and are
 * dealt with as cover beside the target).
 */
export function lineResist(w: World, from: Point, to: Point): { resist: number; what: Terrain | null } {
  let x = from.x, y = from.y;
  const dx = Math.abs(to.x - x), dy = -Math.abs(to.y - y);
  const sx = x < to.x ? 1 : -1, sy = y < to.y ? 1 : -1;
  let err = dx + dy, resist = 0;
  let what: Terrain | null = null, most = 0;
  for (let k = 0; k < 400; k++) {
    if (x === to.x && y === to.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    if (x === to.x && y === to.y) break;
    const t = w.map.at(x, y);
    if ((w.config.terrain.seeThrough[t] ?? 1) >= 0.5) continue;
    const r = resistAt(w, x, y);
    resist += r;
    if (r > most) {
      most = r;
      what = t;
    }
  }
  return { resist, what };
}

/**
 * Of the hits a round would score on a man behind cover, the share that comes
 * through the cover beside him rather than over or round it; and the chance
 * multiplier for it. Used to tell a clean hit from one through the planks.
 */
export function throughCover(w: World, shooter: Soldier, target: Soldier, spec: WeaponSpec): { edge: number; own: number; pass: number } {
  const parts = w.map.coverParts(target, shooter, target.posture);
  const pass = parts.front ? through(spec, resistAt(w, parts.front.x, parts.front.y)) * reach(w, Math.hypot(target.x - shooter.x, target.y - shooter.y)) : 0;
  return { edge: parts.edge, own: parts.own, pass };
}

/** Names for what a man fires through, for his reasons. */
export const THROUGH_NAME: Partial<Record<Terrain, string>> = {
  hedge: "the hedge",
  building: "the wall",
  window: "the window",
  door: "the door",
  wall: "the wall",
  wreck: "the wreck",
  sandbags: "the sandbags",
  woods: "the trees",
  stall: "the stall",
  debris: "the junk",
};
