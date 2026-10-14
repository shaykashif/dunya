// The ground a battle is fought over. Every map is Normandy, June 1944, but
// the seed picks what kind of place: a bocage hamlet at a crossroads, open
// farmland on a ridge, a highway junction lined with houses, or a market
// town. All of them have fields boxed in by hedgerows, a stream across the
// south, rising and falling ground, and buildings with rooms and upper floors.
// The defenders hold a hedge line south of the settlement; the attackers come
// up from the south.
import type { Rng } from "../engine/rng.ts";
import type { SimConfig } from "../scenario/config.ts";
import { GameMap } from "./map.ts";
import type { MapKind, Point, Terrain } from "./types.ts";

export type BuildingKind = "farmhouse" | "barn" | "cottage" | "church" | "house" | "shop";

export interface Building {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: BuildingKind;
  name: string;
  /** Storeys: 1 is the ground floor only. */
  floors: number;
  /** Shelled until it fell in: no roof, no upper floors. */
  destroyed: boolean;
}

export interface Layout {
  kind: MapKind;
  /** What the place is, for the chronicle: "a bocage hamlet". */
  name: string;
  /** What the attackers are after: "the crossroads". */
  objectiveName: string;
  map: GameMap;
  buildings: Building[];
  objective: Point;
  /** The defended hedge line: the row of the hedge at each column. */
  line: { y: number; rowAt: number[] };
  /** Firing positions just behind the defended hedge. */
  linePositions: Point[];
  /** Field corners on the line, where machine guns can fire along the hedges. */
  mgPositions: Point[];
  /** Firing positions in the settlement: inside windows facing south (upstairs too), behind walls. */
  hamletPositions: Point[];
  roadX: number[];
  hamletY: number;
  streamY: number;
}

interface KindSpec {
  name: string;
  objectiveName: string;
  fieldWidth: [number, number];
  fieldHeight: [number, number];
  mergeChance: number;
  /** Share of fields under grass, wheat and orchard; the rest is woodland. */
  crops: [number, number, number];
  copses: [number, number];
  /** Where the settlement sits, and how far south of it the defended hedge is. */
  settlementRow: number;
  lineGap: number;
  /** Half-width and north/south extent of the settlement's cleared ground. */
  area: { w: number; n: number; s: number };
}

const KINDS: Record<MapKind, KindSpec> = {
  hamlet: { name: "a bocage hamlet", objectiveName: "the crossroads", fieldWidth: [24, 40], fieldHeight: [13, 19], mergeChance: 0.14, crops: [0.42, 0.68, 0.88], copses: [6, 10], settlementRow: 26, lineGap: 22, area: { w: 21, n: 11, s: 10 } },
  rural: { name: "open farmland on a ridge", objectiveName: "the farm", fieldWidth: [34, 52], fieldHeight: [17, 25], mergeChance: 0.32, crops: [0.4, 0.82, 0.9], copses: [3, 6], settlementRow: 24, lineGap: 22, area: { w: 18, n: 10, s: 10 } },
  road: { name: "a highway junction", objectiveName: "the road junction", fieldWidth: [26, 42], fieldHeight: [14, 20], mergeChance: 0.2, crops: [0.45, 0.75, 0.9], copses: [4, 8], settlementRow: 26, lineGap: 22, area: { w: 16, n: 16, s: 10 } },
  town: { name: "a market town", objectiveName: "the town square", fieldWidth: [24, 38], fieldHeight: [13, 18], mergeChance: 0.14, crops: [0.45, 0.7, 0.9], copses: [4, 7], settlementRow: 28, lineGap: 27, area: { w: 41, n: 19, s: 19 } },
};

/** Stable per-tile noise, independent of draw order. */
function hashTile(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function randInt(rng: Rng, lo: number, hi: number): number {
  return lo + rng.int(hi - lo + 1);
}

/** A smooth wobble, so hedge lines and lanes meander rather than run ruler-straight. */
function wobble(rng: Rng, n: number, amp: number): number[] {
  const out: number[] = [];
  const f1 = 0.05 + rng.next() * 0.08, f2 = 0.15 + rng.next() * 0.1;
  const p1 = rng.next() * 7, p2 = rng.next() * 7;
  for (let i = 0; i < n; i++) out.push(Math.round(amp * (0.75 * Math.sin(i * f1 + p1) + 0.35 * Math.sin(i * f2 + p2))));
  return out;
}

function pickKind(cfg: SimConfig, rng: Rng): MapKind {
  const weights = cfg.map.kindWeights;
  const kinds = Object.keys(weights) as MapKind[];
  const total = kinds.reduce((a, k) => a + weights[k], 0);
  let r = rng.next() * total;
  for (const k of kinds) {
    r -= weights[k];
    if (r < 0) return k;
  }
  return kinds[kinds.length - 1]!;
}

/**
 * How far apart the two sides must start: beyond the longest sight on the
 * field, a sniper's scope in clear weather, so nobody can see anybody, let
 * alone shoot, until the attackers have moved.
 */
export function startClearance(cfg: SimConfig): number {
  return Math.ceil(cfg.perception.maxRange * cfg.perception.scope) + cfg.map.startMargin;
}

export function generateLayout(cfg: SimConfig, rng: Rng): Layout {
  const kind = cfg.map.kind ?? pickKind(cfg, rng);
  const spec = KINDS[kind];
  const W = cfg.map.width, H = cfg.map.height;
  const map = new GameMap(W, H, cfg.terrain);
  const set = (x: number, y: number, t: Terrain) => map.set(x, y, t);
  // The default bocage keeps the configured field sizes; the other kinds have their own.
  const fieldWidth = kind === "hamlet" ? cfg.map.fieldWidth : spec.fieldWidth;
  const fieldHeight = kind === "hamlet" ? cfg.map.fieldHeight : spec.fieldHeight;
  const mergeChance = kind === "hamlet" ? cfg.map.mergeChance : spec.mergeChance;

  // ---- Field boundaries ----
  const cols: number[] = [];
  for (let x = randInt(rng, 14, fieldWidth[0]); x < W - 12; x += randInt(rng, fieldWidth[0], fieldWidth[1])) cols.push(x);
  const rows: number[] = [];
  for (let y = randInt(rng, 10, fieldHeight[0]); y < H - 10; y += randInt(rng, fieldHeight[0], fieldHeight[1])) rows.push(y);

  const hamletY = rows.reduce((best, r) => (Math.abs(r - spec.settlementRow) < Math.abs(best - spec.settlementRow) ? r : best), rows[0]!);
  // The defended line is the next hedge south of the settlement, two fields or so.
  // It stays out of sight of the line of departure: the attackers form up as far
  // as 16 rows up from the south edge, and a defender may be placed a few tiles
  // in front of his hedge.
  const minGap = spec.area.s + 4;
  const lastLine = H - 16 - startClearance(cfg) - 6;
  const lineRow = rows.filter((r) => r >= hamletY + minGap && r <= lastLine).sort((a, b) => Math.abs(a - (hamletY + spec.lineGap)) - Math.abs(b - (hamletY + spec.lineGap)))[0] ?? Math.min(lastLine, hamletY + spec.lineGap);
  if (!rows.includes(lineRow)) rows.push(lineRow);
  // No hedge inside the settlement.
  for (let k = rows.length - 1; k >= 0; k--) if (rows[k] !== hamletY && rows[k]! > hamletY - spec.area.n && rows[k]! < hamletY + spec.area.s && kind === "town") rows.splice(k, 1);
  // The line of departure: a hedge the attackers form up behind, out of sight.
  const startRow = H - 13 + rng.int(3);
  for (let k = rows.length - 1; k >= 0; k--) if (rows[k]! > startRow - 9 && rows[k] !== lineRow) rows.splice(k, 1);
  rows.push(startRow);
  rows.sort((a, b) => a - b);

  // Row of each horizontal hedge at each column, and column of each vertical hedge at each row.
  const rowAt = new Map<number, number[]>();
  for (const r of rows) rowAt.set(r, wobble(rng, W, 2).map((o) => r + o));
  if (!rowAt.has(hamletY)) rowAt.set(hamletY, wobble(rng, W, 2).map((o) => hamletY + o));
  const colAt = new Map<number, number[]>();
  for (const c of cols) colAt.set(c, wobble(rng, H, 2).map((o) => c + o));

  const gapRanges = (len: number): [number, number][] => {
    const gaps: [number, number][] = [];
    const n = rng.chance(0.3) ? 2 : 1;
    for (let k = 0; k < n && len > 10; k++) {
      const wdt = randInt(rng, cfg.map.gapWidth[0], cfg.map.gapWidth[1]);
      const at = randInt(rng, 4, Math.max(4, len - 4 - wdt));
      gaps.push([at, at + wdt - 1]);
    }
    return gaps;
  };
  const inGap = (gaps: [number, number][], t: number) => gaps.some(([a, b]) => t >= a && t <= b);

  // Horizontal hedges, segment by segment between vertical lines.
  const xCuts = [0, ...cols, W - 1];
  for (const r of rows) {
    const line = rowAt.get(r)!;
    for (let s = 0; s + 1 < xCuts.length; s++) {
      const x0 = xCuts[s]!, x1 = xCuts[s + 1]!;
      if (r !== lineRow && r !== startRow && rng.chance(mergeChance)) continue;
      const gaps = gapRanges(x1 - x0);
      let prev = line[x0]!;
      for (let x = x0; x <= x1; x++) {
        const y = line[x]!;
        if (!inGap(gaps, x - x0)) for (let yy = Math.min(prev, y); yy <= Math.max(prev, y); yy++) set(x, yy, "hedge");
        prev = y;
      }
    }
  }
  // Vertical hedges, segment by segment between horizontal lines.
  for (const c of cols) {
    const line = colAt.get(c)!;
    const yCuts = [0, ...rows, H - 1];
    for (let s = 0; s + 1 < yCuts.length; s++) {
      const y0 = yCuts[s]!, y1 = yCuts[s + 1]!;
      if (rng.chance(mergeChance)) continue;
      const gaps = gapRanges(y1 - y0);
      let prev = line[y0]!;
      for (let y = y0; y <= y1; y++) {
        const x = line[y]!;
        if (!inGap(gaps, y - y0)) for (let xx = Math.min(prev, x); xx <= Math.max(prev, x); xx++) set(xx, y, "hedge");
        prev = x;
      }
    }
  }

  // ---- Field contents: each field is pasture, wheat, orchard or a wood ----
  const [pGrass, pWheat, pOrchard] = spec.crops;
  const cellKind = new Map<string, Terrain>();
  const cellOf = (x: number, y: number) => `${cols.filter((c) => c <= x).length},${rows.filter((r) => r <= y).length}`;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = map.idx(x, y);
      if (map.terrain[i] === "hedge") continue;
      const key = cellOf(x, y);
      let k = cellKind.get(key);
      if (!k) {
        const roll = rng.next();
        k = roll < pGrass ? "grass" : roll < pWheat ? "wheat" : roll < pOrchard ? "orchard" : "woods";
        cellKind.set(key, k);
      }
      if (k === "woods") map.terrain[i] = hashTile(x, y) < 0.85 ? "woods" : hashTile(y, x) < 0.5 ? "brush" : "grass";
      else if (k !== "grass") map.terrain[i] = k;
    }
  }
  // A copse here and there in the pastures, edged with scrub.
  for (let k = 0; k < spec.copses[0] + rng.int(spec.copses[1] - spec.copses[0] + 1); k++) {
    const c = { x: 4 + rng.int(W - 8), y: 4 + rng.int(H - 8) };
    const rad = 2 + rng.int(3);
    for (let y = c.y - rad - 1; y <= c.y + rad + 1; y++) {
      for (let x = c.x - rad - 1; x <= c.x + rad + 1; x++) {
        if (!map.inBounds(x, y) || map.at(x, y) === "hedge") continue;
        const d = Math.hypot(x - c.x, y - c.y);
        if (d <= rad + rng.next() * 0.8) map.set(x, y, "woods");
        else if (d <= rad + 1.6 && hashTile(x, y) < 0.6) map.set(x, y, "brush");
      }
    }
  }
  // Out in open country, brambles grow along the hedges.
  if (kind === "rural" || kind === "road") {
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (map.at(x, y) !== "grass" && map.at(x, y) !== "wheat") continue;
        const byHedge = map.at(x, y - 1) === "hedge" || map.at(x, y + 1) === "hedge" || map.at(x - 1, y) === "hedge" || map.at(x + 1, y) === "hedge";
        if (byHedge && hashTile(x * 3, y * 7) < 0.22) map.set(x, y, "brush");
      }
    }
  }

  // ---- Roads ----
  const roadBase = Math.round(W / 2 + (rng.next() - 0.5) * 24);
  const roadOff = wobble(rng, H, kind === "road" ? 1 : 4);
  const roadX: number[] = [];
  for (let y = 0; y < H; y++) roadX.push(roadBase + roadOff[y]!);
  const hamRow = rowAt.get(hamletY)!;
  // The highway is wide and straight; everywhere else it is a lane.
  const half = kind === "road" || kind === "town" ? 1 : 0;
  for (let y = 0; y < H; y++) {
    const x = roadX[y]!, px = y > 0 ? roadX[y - 1]! : x;
    for (let xx = Math.min(px, x) - half; xx <= Math.max(px, x) + 1; xx++) set(xx, y, "road");
  }
  for (let x = 0; x < W; x++) {
    const y = hamRow[x]!;
    const py = x > 0 ? hamRow[x - 1]! : y;
    for (let yy = Math.min(py, y); yy <= Math.max(py, y) + 1; yy++) set(x, yy, "road");
  }
  if (kind === "road") {
    // Ditches either side of the highway, and rows of poplars beyond them.
    for (let y = 0; y < H; y++) {
      if (y >= hamletY - spec.area.n - 1 && y <= hamletY + spec.area.s + 1) continue;
      const x = roadX[y]!;
      for (const dx of [-2, 2]) if (map.inBounds(x + dx, y) && map.at(x + dx, y) !== "road") set(x + dx, y, "ditch");
      if (y % 3 === 0) for (const dx of [-4, 4]) if (map.inBounds(x + dx, y) && map.at(x + dx, y) !== "road") set(x + dx, y, "woods");
    }
  } else {
    // The lane is sunken between hedges for stretches, with gates into the fields.
    for (let y = 0; y < H; y++) {
      if (Math.abs(y - hamletY) < (kind === "town" ? 22 : 14)) continue;
      if ((Math.floor(y / 9) + roadBase) % (kind === "rural" ? 2 : 3) === 0) continue;
      if (y % 11 === 5 || y % 11 === 6) continue;
      for (const side of [-1 - half, 2]) {
        const x = roadX[y]! + side;
        if (map.inBounds(x, y) && map.at(x, y) !== "road") set(x, y, "hedge");
      }
    }
  }

  // ---- Stream ----
  // The stream runs through the middle of a field between the line and the start, not along a hedge.
  const south = rows.filter((r) => r > lineRow);
  let streamY = Math.round((lineRow + startRow) / 2);
  let gap = 0;
  for (let k = 0; k + 1 < south.length; k++) {
    const a = south[k]!, b = south[k + 1]!;
    if (b - a > gap) {
      gap = b - a;
      streamY = Math.round((a + b) / 2);
    }
  }
  const sOff = wobble(rng, W, 3);
  const streamAt: number[] = [];
  for (let x = 0; x < W; x++) {
    const y = streamY + sOff[x]!;
    streamAt.push(y);
    const py = x > 0 ? streamY + sOff[x - 1]! : y;
    for (let yy = Math.min(py, y); yy <= Math.max(py, y); yy++) {
      const t = map.at(x, yy);
      set(x, yy, t === "road" ? "bridge" : "water");
      if (rng.chance(0.25) && map.inBounds(x, yy - 1) && map.at(x, yy - 1) !== "road" && map.at(x, yy - 1) !== "hedge") set(x, yy - 1, "woods");
      // Wet meadow along the banks.
      for (const dy of [-2, -1, 1, 2]) {
        const ty = yy + dy;
        if (!map.inBounds(x, ty)) continue;
        const tt = map.at(x, ty);
        if ((tt === "grass" || tt === "wheat") && hashTile(x * 5, ty) < (Math.abs(dy) === 1 ? 0.55 : 0.25)) set(x, ty, "marsh");
      }
    }
  }

  // ---- The settlement ----
  const cx = roadX[hamletY]!;
  const cy = hamletY;
  const A = spec.area;
  for (let y = cy - A.n; y <= cy + A.s; y++) {
    for (let x = cx - A.w; x <= cx + A.w + 1; x++) {
      if (!map.inBounds(x, y)) continue;
      const t = map.at(x, y);
      if (t !== "road") set(x, y, "grass");
    }
  }
  const buildings: Building[] = [];
  const hamletPositions: Point[] = [];
  const place = (k: BuildingKind, name: string, x: number, y: number, w: number, h: number, doorSide: "n" | "s" | "e" | "w", floors: number, terrace = false): Building | null => {
    // Never on top of another building or off the map; out in the country, not wall to wall either.
    const m = terrace ? 0 : 1;
    for (let yy = y - m; yy < y + h + m; yy++) for (let xx = x - m; xx < x + w + m; xx++) if (!map.inBounds(xx, yy) || map.building[map.idx(xx, yy)]! >= 0) return null;
    const b: Building = { id: buildings.length, x, y, w, h, kind: k, name, floors, destroyed: false };
    buildings.push(b);
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const edge = yy === y || yy === y + h - 1 || xx === x || xx === x + w - 1;
        set(xx, yy, edge ? "building" : "floor");
        map.building[map.idx(xx, yy)] = b.id;
        map.levels[map.idx(xx, yy)] = floors;
      }
    }
    // Rooms: a wall down the middle of a wide house, one across a deep one, with a doorway into every room.
    const rooms = k !== "barn" && k !== "church";
    const py = rooms && h >= 7 ? y + Math.floor(h / 2) : -1;
    const px = rooms && w >= 8 ? x + Math.floor(w / 2) + (rng.chance(0.5) ? 0 : -1) : -1;
    if (px > 0) {
      for (let yy = y + 1; yy < y + h - 1; yy++) set(px, yy, "building");
      const top = py > 0 ? py - 1 : y + h - 2;
      set(px, randInt(rng, y + 1, top), "door");
      if (py > 0) set(px, randInt(rng, py + 1, y + h - 2), "door");
    }
    if (py > 0) {
      for (let xx = x + 1; xx < x + w - 1; xx++) if (xx !== px) set(xx, py, "building");
      if (px > 0) {
        set(randInt(rng, x + 1, px - 1), py, "door");
        set(randInt(rng, px + 1, x + w - 2), py, "door");
      } else set(randInt(rng, x + 1, x + w - 2), py, "door");
    }
    // Windows every few tiles along each wall (not at corners), a door or two.
    for (let xx = x + 2; xx < x + w - 2; xx += 3) {
      set(xx, y, "window");
      set(xx, y + h - 1, "window");
    }
    for (let yy = y + 2; yy < y + h - 2; yy += 3) {
      set(x, yy, "window");
      set(x + w - 1, yy, "window");
    }
    const doorAt = doorSide === "n" ? { x: x + Math.floor(w / 2), y } : doorSide === "s" ? { x: x + Math.floor(w / 2), y: y + h - 1 } : doorSide === "w" ? { x, y: y + Math.floor(h / 2) } : { x: x + w - 1, y: y + Math.floor(h / 2) };
    set(doorAt.x, doorAt.y, "door");
    // A back door too, so no one is trapped.
    const back = doorSide === "n" || doorSide === "s" ? { x: x + 1 + rng.int(w - 2), y: doorSide === "n" ? y + h - 1 : y } : { x: doorSide === "w" ? x + w - 1 : x, y: y + 1 + rng.int(h - 2) };
    set(back.x, back.y, "door");
    // A door that opens onto an inner wall gets a doorway through it.
    for (const d of [doorAt, back]) {
      const inward = { x: d.x + (d.x === x ? 1 : d.x === x + w - 1 ? -1 : 0), y: d.y + (d.y === y ? 1 : d.y === y + h - 1 ? -1 : 0) };
      if (map.at(inward.x, inward.y) === "building") set(inward.x, inward.y, "door");
    }
    // Stairs in a back corner of a house with an upper floor.
    if (floors > 1) {
      const corners = [{ x: x + 1, y: y + 1 }, { x: x + w - 2, y: y + 1 }, { x: x + 1, y: y + h - 2 }, { x: x + w - 2, y: y + h - 2 }];
      const st = corners.find((p) => map.at(p.x, p.y) === "floor" && map.at(p.x, p.y + 1) !== "door" && map.at(p.x, p.y - 1) !== "door") ?? corners[0]!;
      set(st.x, st.y, "stairs");
    }
    // The chapel's bell tower: a stair just inside the door that climbs two floors up.
    if (k === "church") {
      const t = { x: x + Math.floor(w / 2), y: y + h - 2 };
      set(t.x, t.y, "stairs");
      map.levels[map.idx(t.x, t.y)] = 3;
      // Tall storeys: the belfry is some ten metres up.
      map.storey[map.idx(t.x, t.y)] = 5;
    }
    return b;
  };

  let objective: Point = { x: cx + 1, y: cy + 1 };
  if (kind === "hamlet") {
    const fw = randInt(rng, 9, 11), fh = randInt(rng, 6, 7);
    place("farmhouse", "the farmhouse", cx - 3 - fw, cy + 3, fw, fh, "n", 2);
    place("barn", "the barn", cx + 4, cy + 3, randInt(rng, 10, 13), randInt(rng, 7, 8), "n", 2);
    place("cottage", "the cottage", cx - 3 - randInt(rng, 7, 8), cy - 3 - 6, 7, 6, "s", rng.chance(0.5) ? 2 : 1);
    place("church", "the chapel", cx + 4, cy - 3 - 9, 7, 9, "s", 1);
    // The farmyard wall, south of the farmhouse and barn, with gates.
    const wallY = cy + 3 + Math.max(fh, 8) + 2;
    for (let x = cx - 18; x <= cx + 19; x++) {
      if (!map.inBounds(x, wallY)) continue;
      const t = map.at(x, wallY);
      if (t === "road" || Math.abs(x - (cx - 9)) <= 1 || Math.abs(x - (cx + 11)) <= 1) continue;
      set(x, wallY, "wall");
      if (x % 3 === 0) hamletPositions.push({ x, y: wallY - 1 });
    }
  } else if (kind === "rural") {
    // One big walled farm off the lane, around a courtyard.
    const fx = cx + 4, fy = cy - 8;
    const court = { x0: fx, y0: fy + 7, x1: fx + 19, y1: fy + 17 };
    place("farmhouse", "the farmhouse", fx + 1, fy, 11, 7, "s", 2);
    place("barn", "the great barn", court.x1 - 7, court.y0 + 1, 8, 10, "w", 2);
    place("cottage", "the stable", fx, court.y0 + 2, 6, 7, "e", 1);
    for (let x = court.x0; x <= court.x1; x++) {
      if (Math.abs(x - (fx + 10)) <= 1) continue;
      set(x, court.y1 + 1, "wall");
      if (x % 3 === 0) hamletPositions.push({ x, y: court.y1 });
    }
    objective = { x: fx + 10, y: court.y0 + 4 };
    // A field barn or two out in the open, and a cottage by the lane.
    place("barn", "the field barn", cx - 18 - rng.int(6), cy + 2 + rng.int(4), 7, 6, "e", 2);
    place("cottage", "the lane cottage", cx - 9, cy - 9, 6, 6, "e", 2);
    for (let k = 0; k < 6 && buildings.length < 7; k++) {
      const bx = 8 + rng.int(W - 22), by = hamletY + 12 + rng.int(Math.max(1, lineRow - hamletY - 18));
      if (hasRoad(map, bx - 1, by - 1, 9, 8)) continue;
      clearFor(map, bx, by, 7, 6);
      place("barn", "an outlying barn", bx, by, 7, 6, rng.chance(0.5) ? "e" : "w", rng.chance(0.5) ? 2 : 1);
    }
  } else if (kind === "road") {
    // Houses lining the highway either side of the junction, a café on the corner, a garage.
    place("shop", "the café", cx + 3, cy - 9, 8, 7, "w", 2);
    place("barn", "the garage", cx - 12, cy + 3, 9, 7, "e", 1);
    let y = cy - A.n + 1;
    while (y < cy - 3) {
      const h = randInt(rng, 5, 7);
      if (y + h < cy - 1) place(rng.chance(0.6) ? "house" : "cottage", "a roadside house", cx - 9, y, 7, h, "e", rng.chance(0.65) ? 2 : 1);
      y += h + 1 + rng.int(2);
    }
    y = cy + 3;
    while (y < cy + A.s - 4) {
      const h = randInt(rng, 5, 6);
      place(rng.chance(0.5) ? "house" : "cottage", "a roadside house", cx + 3, y, 7, h, "w", rng.chance(0.5) ? 2 : 1);
      y += h + 2 + rng.int(2);
    }
    place("church", "the chapel", cx - 10 - 7, cy - 12, 7, 9, "e", 1);
    objective = { x: cx + 1, y: cy + 1 };
  } else {
    // A market town: streets on a grid around the square, terraced houses along them, the church on the square.
    const xs = [cx - 34, cx - 17, cx + 18, cx + 35];
    const ys = [cy - A.n + 1, cy + A.s - 1];
    for (const sx of xs) for (let y = cy - A.n; y <= cy + A.s; y++) if (map.inBounds(sx, y)) { set(sx, y, "road"); set(sx + 1, y, "road"); }
    for (const sy of ys) for (let x = cx - A.w; x <= cx + A.w; x++) if (map.inBounds(x, sy)) { set(x, sy, "road"); set(x, sy + 1, "road"); }
    // The square.
    for (let y = cy - 4; y <= cy + 5; y++) for (let x = cx - 7; x <= cx + 8; x++) if (map.inBounds(x, y)) set(x, y, "road");
    objective = { x: cx + 1, y: cy + 1 };
    place("church", "the church", cx - 3, cy - 15, 8, 10, "s", 1);
    // Blocks between the streets: a row of houses facing each street.
    const xEdges = [cx - A.w, ...xs.flatMap((x) => [x, x + 1]), cx + A.w + 1].sort((a, b) => a - b);
    let shops = 0;
    for (let k = 0; k + 1 < xEdges.length; k += 2) {
      const bx0 = xEdges[k]! + 1, bx1 = xEdges[k + 1]! - 1;
      if (bx1 - bx0 < 5) continue;
      // A row facing the square or main street from the north, one from the south, and one along the north street.
      for (const row of [{ y: cy - 11, h: 7, door: "s" as const }, { y: cy + 6, h: 6, door: "n" as const }, { y: cy - A.n + 3, h: 5, door: "n" as const }, { y: cy + A.s - 7, h: 5, door: "s" as const }]) {
        if (row.y === cy + A.s - 7 && row.y < cy + 12) continue;
        let x = bx0;
        while (x + 4 <= bx1) {
          const w = Math.min(bx1 - x + 1, randInt(rng, 5, 8));
          if (w < 5) break;
          // Never across the main road.
          if (hasRoad(map, x, row.y, w, row.h)) {
            x++;
            continue;
          }
          const onSquare = x + w >= cx - 7 && x <= cx + 8;
          const k2: BuildingKind = onSquare && row.y !== cy - A.n + 3 && shops < 4 && rng.chance(0.6) ? "shop" : "house";
          if (k2 === "shop") shops++;
          place(k2, k2 === "shop" ? "a shop on the square" : "a town house", x, row.y, w, row.h, row.door, 2 + (rng.chance(0.35) ? 1 : 0), true);
          // Terraced, wall to wall, with now and then an alley between.
          x += w + (rng.chance(0.2) ? 2 : 0);
        }
      }
    }
    // Garden walls along the town's southern edge.
    for (let x = cx - A.w; x <= cx + A.w; x++) {
      const y = cy + A.s - 3;
      if (!map.inBounds(x, y) || map.at(x, y) !== "grass" || hashTile(x, 3) < 0.15) continue;
      set(x, y, "wall");
      if (x % 3 === 0) hamletPositions.push({ x, y: y - 1 });
    }
    // Some houses have already been shelled.
    for (const b of buildings) {
      if (b.kind === "church" || !rng.chance(0.18)) continue;
      for (let k = 0; k < 4; k++) {
        const xx = b.x + rng.int(b.w), yy = b.y + (rng.chance(0.5) ? 0 : b.h - 1);
        if (map.at(xx, yy) === "building" || map.at(xx, yy) === "window") set(xx, yy, "rubble");
      }
    }
  }
  if (kind !== "town") {
    // One house took a shell already.
    const pool = buildings.filter((b) => b.kind !== "church");
    const hit = pool[rng.int(pool.length)];
    if (hit) {
      for (let k = 0; k < 5; k++) {
        const xx = hit.x + rng.int(hit.w), yy = hit.y + (rng.chance(0.5) ? 0 : hit.h - 1);
        if (map.at(xx, yy) === "building" || map.at(xx, yy) === "window") set(xx, yy, "rubble");
      }
    }
  }
  // Firing positions: inside each south-facing window, on every floor.
  for (const b of buildings) {
    for (let xx = b.x + 1; xx < b.x + b.w - 1; xx++) {
      if (map.at(xx, b.y + b.h - 1) !== "window") continue;
      for (let z = 0; z < b.floors; z++) hamletPositions.push(z > 0 ? { x: xx, y: b.y + b.h - 2, z } : { x: xx, y: b.y + b.h - 2 });
    }
    // The belfry, looking out every way.
    if (b.kind === "church") hamletPositions.push({ x: b.x + Math.floor(b.w / 2), y: b.y + b.h - 2, z: 2 });
  }

  // ---- Old shell holes ----
  for (let k = 0; k < 10 + rng.int(8); k++) {
    const x = 4 + rng.int(W - 8), y = 4 + rng.int(H - 8);
    const t = map.at(x, y);
    if (t === "grass" || t === "wheat" || t === "orchard") set(x, y, "crater");
  }

  // ---- The lie of the land ----
  shapeGround(map, kind, rng, { lineRow, startRow, hamletY, streamAt, roadX, buildings, objective });

  // ---- The defended line ----
  const lineRowAt = rowAt.get(lineRow)!;
  const linePositions: Point[] = [];
  const mgPositions: Point[] = [];
  for (let x = 3; x < W - 3; x++) {
    const y = lineRowAt[x]!;
    if (map.at(x, y) !== "hedge") continue;
    // The tile just north of the hedge, if it is open ground.
    const py = y - 1;
    if (!map.inBounds(x, py) || map.at(x, py) === "hedge" || !map.passable(x, py)) continue;
    linePositions.push({ x, y: py });
  }
  for (const c of [...cols, roadBase]) {
    // Field corners: where a hedge running north meets the line.
    const col = colAt.get(c);
    const x0 = col ? col[lineRowAt[c] ?? lineRow]! : c;
    for (const dx of [-2, 2]) {
      const x = x0 + dx;
      if (x < 3 || x >= W - 3) continue;
      const y = lineRowAt[x]! - 1;
      if (map.passable(x, y) && map.at(x, y) !== "hedge" && map.at(x, y + 1) === "hedge") mgPositions.push({ x, y });
    }
  }

  // Every stretch of wall can take so many hits.
  for (let i = 0; i < W * H; i++) map.wallHp[i] = cfg.destruction.wallHp[map.terrain[i]!] ?? 0;
  map.finalize();
  return {
    kind,
    name: spec.name,
    objectiveName: spec.objectiveName,
    map,
    buildings,
    objective,
    line: { y: lineRow, rowAt: lineRowAt },
    linePositions,
    mgPositions,
    hamletPositions: hamletPositions.filter((p) => map.passable(p.x, p.y, p.z ?? 0)),
    roadX,
    hamletY,
    streamY,
  };
}

/** True if a road, stream or bridge crosses the rectangle. */
function hasRoad(map: GameMap, x: number, y: number, w: number, h: number): boolean {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (!map.inBounds(xx, yy)) continue;
      const t = map.at(xx, yy);
      if (t === "road" || t === "water" || t === "bridge") return true;
    }
  }
  return false;
}

/** Clears a patch of ground (and a margin) for a building out in the fields. */
function clearFor(map: GameMap, x: number, y: number, w: number, h: number): void {
  for (let yy = y - 1; yy <= y + h; yy++) {
    for (let xx = x - 1; xx <= x + w; xx++) {
      if (!map.inBounds(xx, yy) || map.building[map.idx(xx, yy)]! >= 0) continue;
      const t = map.at(xx, yy);
      if (t !== "road" && t !== "water" && t !== "bridge") map.set(xx, yy, "grass");
    }
  }
}

/**
 * Heights, in metres. Each kind of place has its own lie of the land: gentle
 * rolling bocage rising a little to the north, a long ridge with the defended
 * hedge along its crest, a railway embankment across the highway, a town on a
 * low rise. The stream sits in a shallow valley, and every house stands level.
 */
function shapeGround(map: GameMap, kind: MapKind, rng: Rng, at: { lineRow: number; startRow: number; hamletY: number; streamAt: number[]; roadX: number[]; buildings: Building[]; objective: Point }): void {
  const W = map.width, H = map.height;
  const e = map.elev;
  const hill = (hx: number, hy: number, r: number, amp: number) => {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d2 = (x - hx) ** 2 + (y - hy) ** 2;
        if (d2 > 9 * r * r) continue;
        e[y * W + x]! += amp * Math.exp(-d2 / (2 * r * r));
      }
    }
  };
  // Land rising gently toward the north, where the defenders are.
  const tilt = kind === "town" ? 2 : kind === "rural" ? 1.5 : 3;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) e[y * W + x] = tilt * (1 - y / H);
  const hills = kind === "rural" ? 2 : kind === "town" ? 2 : 4;
  for (let k = 0; k < hills; k++) hill(rng.int(W), rng.int(H), 14 + rng.int(20), (rng.next() - 0.35) * (kind === "town" ? 3 : 7));
  if (kind === "rural") {
    // A ridge, its crest just behind the defended hedge.
    const amp = 7 + rng.next() * 4, sigma = 9 + rng.next() * 5;
    const f1 = 0.04 + rng.next() * 0.05, p1 = rng.next() * 7;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) e[y * W + x]! += amp * Math.exp(-((y - (at.lineRow - 3 + 3 * Math.sin(x * f1 + p1))) ** 2) / (2 * sigma * sigma));
  } else if (kind === "road") {
    // The railway embankment, between the line and the start, with a crossing on the highway.
    const ry = Math.round((at.lineRow + at.startRow) / 2) + (rng.chance(0.5) ? -6 : 5);
    for (let x = 0; x < W; x++) {
      if (Math.abs(x - at.roadX[ry]!) <= 2) continue;
      for (let dy = -2; dy <= 2; dy++) {
        const y = ry + dy;
        if (y < 0 || y >= H) continue;
        const i = y * W + x;
        if (map.terrain[i] === "water") continue;
        e[i]! += Math.abs(dy) <= 1 ? 3 : 1.4;
        if (Math.abs(dy) === 2 && map.terrain[i] !== "road" && hashTile(x, y) < 0.5) map.terrain[i] = "brush";
      }
    }
  } else if (kind === "town") {
    hill(at.objective.x, at.objective.y, 22, 2.5);
  }
  // The stream's shallow valley.
  for (let x = 0; x < W; x++) {
    const sy = at.streamAt[x]!;
    for (let dy = -9; dy <= 9; dy++) {
      const y = sy + dy;
      if (y < 0 || y >= H) continue;
      const f = Math.max(0, 1 - (dy / 9.5) ** 2);
      e[y * W + x]! -= 2.2 * f * f;
    }
  }
  // Smooth out the steps left by tile-sized features.
  for (let pass = 0; pass < 2; pass++) {
    const src = Float32Array.from(e);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0, n = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            sum += src[yy * W + xx]!;
            n++;
          }
        }
        e[y * W + x] = sum / n;
      }
    }
  }
  // Ditches are dug a little down.
  for (let i = 0; i < W * H; i++) if (map.terrain[i] === "ditch") e[i]! -= 0.7;
  // Houses stand level.
  for (const b of at.buildings) {
    let sum = 0;
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) sum += e[y * W + x]!;
    const lvl = sum / (b.w * b.h);
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) e[y * W + x] = lvl;
  }
  let min = Infinity;
  for (let i = 0; i < W * H; i++) min = Math.min(min, e[i]!);
  for (let i = 0; i < W * H; i++) e[i] = Math.round((e[i]! - min) * 100) / 100;
}
