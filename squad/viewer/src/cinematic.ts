// What the cinematic start needs to know about a battle: where the fighting is, how close the sides
// are, and a place a one-tap barrage can land that is inside the picture. Pure functions of the world.
import type { Soldier } from "../../src/world/types.ts";
import type { World } from "../../src/world/world.ts";

export interface Spot {
  x: number;
  y: number;
}

export interface Fight extends Spot {
  /** The enemy side of the fight (where a barrage would go). */
  ex: number;
  ey: number;
  score: number;
}

const OPEN = new Set(["grass", "wheat", "road", "rubble", "crater", "foxhole", "ditch", "bridge", "marsh"]);

function onField(world: World): Soldier[] {
  return world.soldiers.filter((m) => m.status !== "dead" && m.conscious !== false && world.onField(m));
}

/** Tiles between the closest pair of opposing men still in the fight (Infinity if one side is gone). */
export function contactDistance(world: World): number {
  const men = onField(world);
  const us = men.filter((m) => m.side === "us"), de = men.filter((m) => m.side !== "us");
  let best = Infinity;
  for (const a of us) for (const b of de) {
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d < best) best = d;
  }
  return best;
}

/** The midpoint of the closest pair of opposing men: where the two sides really meet. */
export function frontLine(world: World): (Spot & { ex: number; ey: number }) | null {
  const men = onField(world);
  const us = men.filter((m) => m.side === "us"), de = men.filter((m) => m.side !== "us");
  let best: { d: number; a: Soldier; b: Soldier } | null = null;
  for (const a of us) for (const b of de) {
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (!best || d < best.d) best = { d, a, b };
  }
  return best ? { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2, ex: best.b.x, ey: best.b.y } : null;
}

/**
 * The busiest fight a viewer can actually see: men on open ground (not inside a house or the trees,
 * where they are hidden) who have just fired or been hit, scored by how many are in it and whether both
 * sides are there. `around` limits the search to the neighbourhood of the camera, so it drifts rather than jumps.
 */
export function busiestFight(world: World, around: (Spot & { r: number }) | null = null): Fight | null {
  const t = world.tick;
  const inHouse = (m: Soldier) => world.buildings.some((b) => !b.destroyed && m.x >= b.x && m.x < b.x + b.w && m.y >= b.y && m.y < b.y + b.h);
  const men = onField(world).filter((m) => !inHouse(m) && OPEN.has(world.map.at(Math.floor(m.x), Math.floor(m.y))));
  const firing = men.filter((m) => t - m.lastFiredTick < 8 || t - m.lastHitTick < 8);
  let best: Fight | null = null;
  for (const m of firing) {
    if (around && Math.hypot(around.x - m.x, around.y - m.y) > around.r) continue;
    const near = men.filter((o) => Math.hypot(o.x - m.x, o.y - m.y) < 11);
    if (near.length < 5) continue;
    const us = near.filter((o) => o.side === "us").length, de = near.length - us;
    const sc = near.filter((o) => t - o.lastFiredTick < 8).length * 2 + near.filter((o) => t - o.lastHitTick < 12).length * 3 + near.length * 0.8;
    const score = sc * (us > 1 && de > 1 ? 1.6 : 1) + Math.min(us, de) * 2;
    if (best && score <= best.score) continue;
    const foes = near.filter((o) => o.side !== "us");
    const e = foes.length ? foes : near;
    best = {
      score,
      x: near.reduce((q, o) => q + o.x, 0) / near.length,
      y: near.reduce((q, o) => q + o.y, 0) / near.length,
      ex: e.reduce((q, o) => q + o.x, 0) / e.length,
      ey: e.reduce((q, o) => q + o.y, 0) / e.length,
    };
  }
  return best;
}

/**
 * The framing that shows the most going on: for each man, the men a view centred on him would hold, counted
 * if they can be seen (not inside a house or deep in trees) and weighted heavily if they are firing or hit.
 * The result is centred on the men it counts. `around` keeps the search near where the camera already is.
 */
export function bestFraming(world: World, halfW: number, halfH: number, around: (Spot & { r: number }) | null = null): Fight | null {
  const t = world.tick;
  const inHouse = (m: Soldier) => world.buildings.some((b) => !b.destroyed && m.x >= b.x && m.x < b.x + b.w && m.y >= b.y && m.y < b.y + b.h);
  const men = onField(world).filter((m) => !inHouse(m) && world.map.at(Math.floor(m.x), Math.floor(m.y)) !== "woods");
  const active = (m: Soldier) => t - m.lastFiredTick < 10 || t - m.lastHitTick < 12;
  let best: Fight | null = null;
  for (const c of men) {
    if (around && Math.hypot(around.x - c.x, around.y - c.y) > around.r) continue;
    let score = 0, us = 0, de = 0, sx = 0, sy = 0, n = 0, ex = 0, ey = 0;
    for (const m of men) {
      if (Math.abs(m.x - c.x) > halfW * 0.85 || Math.abs(m.y - c.y) > halfH * 0.85) continue;
      score += active(m) ? 4 : 1;
      sx += m.x;
      sy += m.y;
      n++;
      if (m.side === "us") us++;
      else {
        de++;
        ex += m.x;
        ey += m.y;
      }
    }
    if (n < 3) continue;
    score *= us >= 2 && de >= 2 ? 1.5 : 1;
    if (best && score <= best.score) continue;
    best = { score, x: sx / n, y: sy / n, ex: de ? ex / de : sx / n, ey: de ? ey / de : sy / n };
  }
  return best;
}

/**
 * Where one tap of "call in a barrage" lands: on the enemy nearest the middle of the view if there is one
 * on screen, otherwise just off the middle, so the shells are always in the picture.
 */
export function barrageTarget(world: World, centre: Spot, halfW: number, halfH: number): Spot & { seen: boolean; men: number } {
  const foes = onField(world).filter((m) => m.side !== "us");
  const seen = foes.filter((m) => Math.abs(m.x - centre.x) < halfW * 0.9 && Math.abs(m.y - centre.y) < halfH * 0.8);
  if (seen.length > 0) {
    seen.sort((a, b) => Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y));
    const lead = seen[0]!;
    const group = seen.filter((m) => Math.hypot(m.x - lead.x, m.y - lead.y) < 9);
    return { x: group.reduce((q, m) => q + m.x, 0) / group.length, y: group.reduce((q, m) => q + m.y, 0) / group.length, seen: true, men: group.length };
  }
  return { x: centre.x + halfW * 0.2, y: centre.y - halfH * 0.15, seen: false, men: 0 };
}

/** The zoom that shows about this many tiles across a canvas this wide, so men are big enough to read. */
export function framingZoom(canvasWidthPx: number, tilePx: number): number {
  const tiles = canvasWidthPx <= 520 ? 15 : canvasWidthPx <= 900 ? 18 : 30;
  return Math.max(1.4, Math.min(5, canvasWidthPx / (tiles * tilePx)));
}
