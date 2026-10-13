// Map layout: family compounds in forest clearings around a town, joined by winding roads.
import type { Rng } from "../engine/rng.ts";
import { r3 } from "../log/events.ts";
import { GameMap } from "../world/map.ts";
import { emptyInventory, type Building, type Compound, type Point } from "../world/types.ts";
import type { SimConfig } from "./config.ts";

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function clearDisc(map: GameMap, c: Point, radius: number, rng: Rng): void {
  for (let y = c.y - radius - 2; y <= c.y + radius + 2; y++) {
    for (let x = c.x - radius - 2; x <= c.x + radius + 2; x++) {
      if (!map.inBounds(x, y) || map.at(x, y) === "water") continue;
      const d = Math.hypot(x - c.x, y - c.y);
      if (d <= radius + (rng.next() - 0.5) * 2.5) map.set(x, y, "ground");
    }
  }
}

/** Carves a road, `width` tiles wide; crossing water makes a bridge. Buildings, fields and wells are left alone. */
function carve(map: GameMap, x: number, y: number): void {
  if (!map.inBounds(x, y)) return;
  const t = map.at(x, y);
  if (t === "forest" || t === "ground" || t === "water") map.set(x, y, "path");
}

/** Bresenham line; diagonal steps also carve the corner tile so the road stays walkable on 4 neighbours. */
function line(map: GameMap, a: Point, b: Point, wide: boolean): void {
  let x = a.x, y = a.y;
  const dx = Math.abs(b.x - a.x), dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1, sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  const put = (px: number, py: number) => {
    carve(map, px, py);
    if (wide) {
      carve(map, px + 1, py);
      carve(map, px, py + 1);
    }
  };
  put(x, y);
  while (x !== b.x || y !== b.y) {
    const e2 = 2 * err;
    const stepX = e2 >= dy, stepY = e2 <= dx;
    if (stepX) {
      err += dy;
      x += sx;
    }
    if (stepX && stepY) put(x, y);
    if (stepY) {
      err += dx;
      y += sy;
    }
    put(x, y);
  }
}

/** A road that wanders: waypoints along the straight line, pushed sideways by a sine plus a random walk. */
function windingRoad(map: GameMap, a: Point, b: Point, rng: Rng, wide: boolean): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(2, Math.round(len / 6));
  const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
  const amp = Math.min(7, len / 6) * (0.5 + rng.next());
  const phase = rng.next() * Math.PI * 2;
  let drift = 0;
  let prev = a;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    drift += (rng.next() - 0.5) * 2;
    const taper = Math.sin(Math.PI * t);
    const off = (amp * Math.sin(phase + t * Math.PI * 2) + drift) * taper;
    const p = i === steps ? b : { x: Math.round(a.x + (b.x - a.x) * t + nx * off), y: Math.round(a.y + (b.y - a.y) * t + ny * off) };
    const q = { x: Math.max(1, Math.min(map.width - 2, p.x)), y: Math.max(1, Math.min(map.height - 2, p.y)) };
    line(map, prev, q, wide);
    prev = q;
  }
}

function placeBuilding(map: GameMap, buildings: Building[], kind: Building["kind"], r: Rect, door: Point, householdId: number | null, rng: Rng): Building {
  const id = buildings.length;
  const interior: Point[] = [];
  for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      const edge = x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1;
      map.set(x, y, edge ? "wall" : "floor");
      map.building[map.idx(x, y)] = id;
      if (!edge) interior.push({ x, y });
    }
  }
  map.set(door.x, door.y, "door");
  const cx = Math.floor((r.x0 + r.x1) / 2), cy = Math.floor((r.y0 + r.y1) / 2);
  const far = interior
    .slice()
    .sort((a, b) => Math.abs(b.x - door.x) + Math.abs(b.y - door.y) - (Math.abs(a.x - door.x) + Math.abs(a.y - door.y)) || a.y - b.y || a.x - b.x)[0]!;
  const b: Building = {
    id,
    kind,
    householdId,
    x0: r.x0,
    y0: r.y0,
    x1: r.x1,
    y1: r.y1,
    door: { ...door },
    interior,
    bed: far,
    hearthSpot: { x: cx, y: cy },
    condition: kind === "house" ? r3(0.6 + rng.next() * 0.3) : 0.9,
    hearth: kind === "store" ? null : emptyInventory(),
    burnAcc: 0,
    lit: false,
  };
  buildings.push(b);
  return b;
}

export interface Layout {
  map: GameMap;
  buildings: Building[];
  compounds: Compound[];
}

/**
 * Builds the map: dense forest with meadows, a meandering river on the east,
 * a town clearing with the courthouse, communal store and well, and one
 * compound per house on a ring around town, each with a dwelling, a farm and
 * a well. Winding roads join every compound to town and to its neighbours.
 */
export function buildLayout(cfg: SimConfig, rng: Rng, houses: number): Layout {
  const mc = cfg.map;
  const map = new GameMap(mc.width, mc.height);
  map.terrain.fill("forest");

  for (let i = 0; i < mc.meadows; i++) {
    clearDisc(map, { x: 6 + rng.int(mc.width - 30), y: 6 + rng.int(mc.height - 12) }, 2 + rng.int(4), rng);
  }

  // Rocky outcrops in the forest, where stone can be quarried; a couple in the corner beyond the river.
  for (let i = 0; i < mc.rockOutcrops; i++) {
    const beyond = i < 2;
    const c = beyond ? { x: mc.width - 18 + rng.int(14), y: 4 + rng.int(12) } : { x: 6 + rng.int(mc.width - 12), y: 6 + rng.int(mc.height - 12) };
    const r = 1 + rng.int(3);
    for (let y = c.y - r - 1; y <= c.y + r + 1; y++) {
      for (let x = c.x - r - 1; x <= c.x + r + 1; x++) {
        if (map.inBounds(x, y) && Math.hypot(x - c.x, y - c.y) <= r + (rng.next() - 0.5) * 1.5) map.set(x, y, "rock");
      }
    }
  }

  // A meandering river, three tiles wide, that comes in at the top edge and leaves by the right,
  // bowing toward town: it cuts off only the north-east corner of the woods.
  const p0 = { x: Math.round(mc.width * (0.58 + rng.next() * 0.08)), y: -2 };
  const p2 = { x: mc.width + 1, y: Math.round(mc.height * (0.5 + rng.next() * 0.1)) };
  const ctrl = { x: p0.x + (p2.x - p0.x) * 0.15, y: p2.y * 0.85 };
  const ph = rng.next() * 6;
  const steps = Math.ceil((Math.hypot(p2.x - p0.x, p2.y - p0.y) + 40) * 3);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const bx = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * ctrl.x + t * t * p2.x;
    const by = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * ctrl.y + t * t * p2.y;
    // Tangent, for a sideways meander.
    const tx = 2 * (1 - t) * (ctrl.x - p0.x) + 2 * t * (p2.x - ctrl.x), ty = 2 * (1 - t) * (ctrl.y - p0.y) + 2 * t * (p2.y - ctrl.y);
    const tl = Math.hypot(tx, ty) || 1;
    const wob = 3 * Math.sin(t * 14 + ph) + 1.5 * Math.sin(t * 37 + ph * 2);
    const cx = bx - (ty / tl) * wob, cy = by + (tx / tl) * wob;
    for (let y = Math.floor(cy - 2); y <= Math.ceil(cy + 2); y++) {
      for (let x = Math.floor(cx - 2); x <= Math.ceil(cx + 2); x++) {
        if (map.inBounds(x, y) && Math.hypot(x - cx, y - cy) <= 1.5) map.set(x, y, "water");
      }
    }
  }

  const town = { x: Math.floor(mc.width / 2) - 8, y: Math.floor(mc.height / 2) };
  /** A compound must sit clear of the river, on the town's side of it. */
  const blocked = (c: Point): boolean => {
    for (let y = c.y - mc.compoundRadius - 3; y <= c.y + mc.compoundRadius + 3; y++) {
      for (let x = c.x - mc.compoundRadius - 3; x <= c.x + mc.compoundRadius + 3; x++) if (map.inBounds(x, y) && map.at(x, y) === "water") return true;
    }
    const n = Math.max(Math.abs(c.x - town.x), Math.abs(c.y - town.y));
    for (let k = 0; k <= n; k++) {
      const x = Math.round(town.x + ((c.x - town.x) * k) / n), y = Math.round(town.y + ((c.y - town.y) * k) / n);
      if (map.at(x, y) === "water") return true;
    }
    return false;
  };
  clearDisc(map, town, mc.townRadius, rng);

  // Compounds on a ring around town.
  const centers: Point[] = [];
  const start = rng.next() * Math.PI * 2;
  for (let i = 0; i < houses; i++) {
    const a0 = start + (i * Math.PI * 2) / houses + (rng.next() - 0.5) * 0.4;
    let r = mc.compoundDistance + (rng.next() - 0.5) * 8;
    const margin = mc.compoundRadius + 2;
    const at = (a: number, rr: number): Point => ({
      x: Math.max(margin, Math.min(mc.width - margin - 1, Math.round(town.x + Math.cos(a) * rr * 1.3))),
      y: Math.max(margin, Math.min(mc.height - margin - 1, Math.round(town.y + Math.sin(a) * rr))),
    });
    // Swing round the ring, then draw in toward town, until the spot is clear of the river.
    let c = at(a0, r);
    for (let tries = 0; blocked(c) && tries < 60; tries++) {
      const k = (tries % 20) + 1;
      c = at(a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.12, r);
      if (tries % 20 === 19) r *= 0.85;
    }
    centers.push(c);
    clearDisc(map, c, mc.compoundRadius, rng);
  }

  // Roads first, so buildings and fields placed afterwards are never cut by them.
  const gates = centers.map((c) => {
    const dx = town.x - c.x, dy = town.y - c.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x: Math.round(c.x + (dx / d) * (mc.compoundRadius - 1)), y: Math.round(c.y + (dy / d) * (mc.compoundRadius - 1)) };
  });
  for (let i = 0; i < houses; i++) {
    const tdx = gates[i]!.x - town.x, tdy = gates[i]!.y - town.y;
    const td = Math.hypot(tdx, tdy) || 1;
    const townEdge = { x: Math.round(town.x + (tdx / td) * (mc.townRadius - 2)), y: Math.round(town.y + (tdy / td) * (mc.townRadius - 2)) };
    windingRoad(map, gates[i]!, townEdge, rng, true);
    windingRoad(map, centers[i]!, centers[(i + 1) % houses]!, rng, false);
  }

  const buildings: Building[] = [];
  const compounds: Compound[] = [];
  for (let i = 0; i < houses; i++) {
    const c = centers[i]!;
    const house = placeBuilding(map, buildings, "house", { x0: c.x - 6, y0: c.y - 9, x1: c.x + 4, y1: c.y - 2 }, { x: c.x - 1, y: c.y - 2 }, i, rng);
    const farm: Point[] = [];
    for (let y = c.y + 3; y <= c.y + 8; y++) {
      for (let x = c.x - 6; x <= c.x + 5; x++) {
        map.set(x, y, "field");
        map.farmOf[map.idx(x, y)] = i;
        farm.push({ x, y });
      }
    }
    const well = { x: c.x + 8, y: c.y - 1 };
    map.set(well.x, well.y, "well");
    map.wells.push(well);
    // A yard path from the door to the gate.
    line(map, { x: c.x - 1, y: c.y - 1 }, { x: c.x - 1, y: c.y + 1 }, false);
    line(map, { x: c.x - 1, y: c.y + 1 }, gates[i]!, false);
    compounds.push({ householdId: i, center: c, buildingId: house.id, farm, well, gate: gates[i]! });
  }

  // Town: courthouse to the north of the square, communal store to the south-east, well in the middle.
  const hall = placeBuilding(map, buildings, "hall", { x0: town.x - 7, y0: town.y - 12, x1: town.x + 7, y1: town.y - 4 }, { x: town.x, y: town.y - 4 }, null, rng);
  placeBuilding(map, buildings, "store", { x0: town.x + 5, y0: town.y + 3, x1: town.x + 11, y1: town.y + 8 }, { x: town.x + 5, y: town.y + 5 }, null, rng);
  map.well = { x: town.x, y: town.y + 1 };
  map.set(map.well.x, map.well.y, "well");
  map.wells.unshift(map.well);
  map.meeting = { ...hall.hearthSpot };
  map.square = { x: town.x - 3, y: town.y + 1 };
  for (let y = town.y - 3; y <= town.y + 3; y++) for (let x = town.x - 5; x <= town.x + 4; x++) if (map.at(x, y) === "ground") map.set(x, y, "path");
  line(map, { x: town.x, y: town.y - 3 }, { x: town.x, y: town.y - 3 }, false);
  line(map, { x: town.x + 4, y: town.y + 5 }, { x: town.x + 2, y: town.y + 2 }, false);
  map.finalize();
  return { map, buildings, compounds };
}
