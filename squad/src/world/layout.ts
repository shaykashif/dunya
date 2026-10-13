// Normandy bocage: small fields boxed in by hedgerows, a sunken lane running
// north to a hamlet at a crossroads, a stream across the south. The defenders
// hold the hedge line south of the hamlet; the attackers come up from the south.
import type { Rng } from "../engine/rng.ts";
import type { SimConfig } from "../scenario/config.ts";
import { GameMap } from "./map.ts";
import type { Point, Terrain } from "./types.ts";

export interface Building {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "farmhouse" | "barn" | "cottage" | "church";
  name: string;
}

export interface Layout {
  map: GameMap;
  buildings: Building[];
  objective: Point;
  /** The defended hedge line: the row of the hedge at each column. */
  line: { y: number; rowAt: number[] };
  /** Firing positions just behind the defended hedge. */
  linePositions: Point[];
  /** Field corners on the line, where machine guns can fire along the hedges. */
  mgPositions: Point[];
  /** Firing positions in the hamlet: inside windows facing south, behind farmyard walls. */
  hamletPositions: Point[];
  roadX: number[];
  hamletY: number;
  streamY: number;
}

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

export function generateLayout(cfg: SimConfig, rng: Rng): Layout {
  const W = cfg.map.width, H = cfg.map.height;
  const map = new GameMap(W, H, cfg.terrain);
  const set = (x: number, y: number, t: Terrain) => map.set(x, y, t);

  // ---- Field boundaries ----
  const cols: number[] = [];
  for (let x = randInt(rng, 14, cfg.map.fieldWidth[0]); x < W - 12; x += randInt(rng, cfg.map.fieldWidth[0], cfg.map.fieldWidth[1])) cols.push(x);
  const rows: number[] = [];
  for (let y = randInt(rng, 10, cfg.map.fieldHeight[0]); y < H - 10; y += randInt(rng, cfg.map.fieldHeight[0], cfg.map.fieldHeight[1])) rows.push(y);

  const hamletY = rows.reduce((best, r) => (Math.abs(r - 26) < Math.abs(best - 26) ? r : best), rows[0]!);
  // The defended line is the next hedge south of the hamlet, two fields or so.
  const lineRow = rows.filter((r) => r >= hamletY + 14 && r <= H - 38).sort((a, b) => Math.abs(a - (hamletY + 22)) - Math.abs(b - (hamletY + 22)))[0] ?? Math.min(H - 38, hamletY + 20);
  if (!rows.includes(lineRow)) rows.push(lineRow);
  // The line of departure: a hedge the attackers form up behind, out of sight.
  const startRow = H - 13 + rng.int(3);
  for (let k = rows.length - 1; k >= 0; k--) if (rows[k]! > startRow - 9 && rows[k] !== lineRow) rows.splice(k, 1);
  rows.push(startRow);
  rows.sort((a, b) => a - b);

  // Row of each horizontal hedge at each column, and column of each vertical hedge at each row.
  const rowAt = new Map<number, number[]>();
  for (const r of rows) rowAt.set(r, wobble(rng, W, 2).map((o) => r + o));
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
      if (r !== lineRow && r !== startRow && rng.chance(cfg.map.mergeChance)) continue;
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
      if (rng.chance(cfg.map.mergeChance)) continue;
      const gaps = gapRanges(y1 - y0);
      let prev = line[y0]!;
      for (let y = y0; y <= y1; y++) {
        const x = line[y]!;
        if (!inGap(gaps, y - y0)) for (let xx = Math.min(prev, x); xx <= Math.max(prev, x); xx++) set(xx, y, "hedge");
        prev = x;
      }
    }
  }

  // ---- Field contents: each field of the grid is pasture, wheat, orchard or a wood ----
  const cellKind = new Map<string, Terrain>();
  const cellOf = (x: number, y: number) => `${cols.filter((c) => c <= x).length},${rows.filter((r) => r <= y).length}`;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = map.idx(x, y);
      if (map.terrain[i] === "hedge") continue;
      const key = cellOf(x, y);
      let kind = cellKind.get(key);
      if (!kind) {
        const roll = rng.next();
        kind = roll < 0.42 ? "grass" : roll < 0.68 ? "wheat" : roll < 0.88 ? "orchard" : "woods";
        cellKind.set(key, kind);
      }
      if (kind === "woods") map.terrain[i] = hashTile(x, y) < 0.85 ? "woods" : "grass";
      else if (kind !== "grass") map.terrain[i] = kind;
    }
  }
  // A copse here and there in the pastures.
  for (let k = 0; k < 6 + rng.int(5); k++) {
    const c = { x: 4 + rng.int(W - 8), y: 4 + rng.int(H - 8) };
    const rad = 2 + rng.int(3);
    for (let y = c.y - rad; y <= c.y + rad; y++) {
      for (let x = c.x - rad; x <= c.x + rad; x++) {
        if (!map.inBounds(x, y) || map.at(x, y) === "hedge") continue;
        if (Math.hypot(x - c.x, y - c.y) <= rad + rng.next() * 0.8) map.set(x, y, "woods");
      }
    }
  }

  // ---- Roads: a lane north to south, and the road through the hamlet ----
  const roadBase = Math.round(W / 2 + (rng.next() - 0.5) * 24);
  const roadOff = wobble(rng, H, 4);
  const roadX: number[] = [];
  for (let y = 0; y < H; y++) roadX.push(roadBase + roadOff[y]!);
  const hamRow = rowAt.get(hamletY)!;
  for (let y = 0; y < H; y++) {
    const x = roadX[y]!, px = y > 0 ? roadX[y - 1]! : x;
    for (let xx = Math.min(px, x); xx <= Math.max(px, x) + 1; xx++) set(xx, y, "road");
  }
  for (let x = 0; x < W; x++) {
    const y = hamRow[x]!;
    const py = x > 0 ? hamRow[x - 1]! : y;
    for (let yy = Math.min(py, y); yy <= Math.max(py, y) + 1; yy++) set(x, yy, "road");
  }
  // The lane is sunken between hedges for stretches, with gates into the fields.
  for (let y = 0; y < H; y++) {
    if (Math.abs(y - hamletY) < 14) continue;
    if ((Math.floor(y / 9) + roadBase) % 3 === 0) continue;
    if (y % 11 === 5 || y % 11 === 6) continue;
    for (const side of [-1, 2]) {
      const x = roadX[y]! + side;
      if (map.inBounds(x, y) && map.at(x, y) !== "road") set(x, y, "hedge");
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
  for (let x = 0; x < W; x++) {
    const y = streamY + sOff[x]!;
    const py = x > 0 ? streamY + sOff[x - 1]! : y;
    for (let yy = Math.min(py, y); yy <= Math.max(py, y); yy++) {
      const t = map.at(x, yy);
      set(x, yy, t === "road" ? "bridge" : "water");
      if (rng.chance(0.25) && map.inBounds(x, yy - 1) && map.at(x, yy - 1) !== "road" && map.at(x, yy - 1) !== "hedge") set(x, yy - 1, "woods");
    }
  }

  // ---- The hamlet ----
  const cx = roadX[hamletY]!;
  const cy = hamletY;
  for (let y = cy - 11; y <= cy + 10; y++) {
    for (let x = cx - 20; x <= cx + 21; x++) {
      if (!map.inBounds(x, y)) continue;
      const t = map.at(x, y);
      if (t !== "road") set(x, y, "grass");
    }
  }
  const buildings: Building[] = [];
  const hamletPositions: Point[] = [];
  const place = (kind: Building["kind"], name: string, x: number, y: number, w: number, h: number, doorSide: "n" | "s" | "e" | "w") => {
    const b: Building = { id: buildings.length, x, y, w, h, kind, name };
    buildings.push(b);
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const edge = yy === y || yy === y + h - 1 || xx === x || xx === x + w - 1;
        set(xx, yy, edge ? "building" : "floor");
        map.building[map.idx(xx, yy)] = b.id;
      }
    }
    // Windows every few tiles along each wall (not at corners), a door or two.
    for (let xx = x + 2; xx < x + w - 2; xx += 3) {
      set(xx, y, "window");
      set(xx, y + h - 1, "window");
      hamletPositions.push({ x: xx, y: y + h - 2 });
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
  };
  const fw = randInt(rng, 9, 11), fh = randInt(rng, 6, 7);
  place("farmhouse", "the farmhouse", cx - 3 - fw, cy + 3, fw, fh, "n");
  place("barn", "the barn", cx + 4, cy + 3, randInt(rng, 10, 13), randInt(rng, 7, 8), "n");
  place("cottage", "the cottage", cx - 3 - randInt(rng, 7, 8), cy - 3 - 6, 7, 6, "s");
  place("church", "the chapel", cx + 4, cy - 3 - 9, 7, 9, "s");
  // The farmyard wall, south of the farmhouse and barn, with gates.
  const wallY = cy + 3 + Math.max(fh, 8) + 2;
  for (let x = cx - 18; x <= cx + 19; x++) {
    if (!map.inBounds(x, wallY)) continue;
    const t = map.at(x, wallY);
    if (t === "road" || Math.abs(x - (cx - 9)) <= 1 || Math.abs(x - (cx + 11)) <= 1) continue;
    set(x, wallY, "wall");
    if (x % 3 === 0) hamletPositions.push({ x, y: wallY - 1 });
  }
  // One house took a shell already.
  const hit = buildings[1 + rng.int(buildings.length - 1)]!;
  for (let k = 0; k < 5; k++) {
    const xx = hit.x + rng.int(hit.w), yy = hit.y + (rng.chance(0.5) ? 0 : hit.h - 1);
    if (map.at(xx, yy) === "building" || map.at(xx, yy) === "window") set(xx, yy, "rubble");
  }

  // ---- Old shell holes ----
  for (let k = 0; k < 10 + rng.int(8); k++) {
    const x = 4 + rng.int(W - 8), y = 4 + rng.int(H - 8);
    const t = map.at(x, y);
    if (t === "grass" || t === "wheat" || t === "orchard") set(x, y, "crater");
  }

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

  const objective = { x: cx + 1, y: cy + 1 };
  map.finalize();
  return { map, buildings, objective, line: { y: lineRow, rowAt: lineRowAt }, linePositions, mgPositions, hamletPositions: hamletPositions.filter((p) => map.passable(p.x, p.y)), roadX, hamletY, streamY };
}
