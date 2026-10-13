// The battlefield grid: terrain, ground height, buildings and their floors,
// sight lines, cover and paths. A "cell" is a tile on one floor: tile index
// plus floor times the number of tiles. Upper floors exist only in buildings.
import { MAX_FLOORS, type Point, type Posture, type Terrain } from "./types.ts";

export interface TerrainRules {
  moveCost: Record<Terrain, number>;
  seeThrough: Partial<Record<Terrain, number>>;
  edgeCover: Partial<Record<Terrain, number>>;
  ownCover: Partial<Record<Terrain, number>>;
  concealment: Partial<Record<Terrain, number>>;
  /** How tall what grows or stands on a tile is, in metres: a sight line passing higher is not blocked. */
  height: Partial<Record<Terrain, number>>;
  /** Metres per floor of a building. */
  floorHeight: number;
  /** Height of a man's eyes, and of the middle of a target, above the floor he is on. */
  eye: number;
  body: number;
  /** Extra move cost per metre climbed, and the saving per metre going down. */
  climbCost: number;
  downhill: number;
  /** Cost of going up or down one flight of stairs. */
  stairsCost: number;
  /** How much a shooter's height over his target strips the cover in front of it, per unit of slope. */
  plunge: number;
}

/** Hedges, walls and openings in walls can be seen and shot through by a man right beside them. */
const PORT: Partial<Record<Terrain, number>> = { hedge: 0.5, wall: 1, window: 0.85, door: 0.85, building: 0 };

const WALLS = new Set<Terrain>(["building", "window", "door"]);
/** Ground that turns to mud in the rain. */
const MUDDY = new Set<Terrain>(["grass", "wheat", "orchard", "marsh", "crater", "foxhole", "ditch", "brush", "woods", "deadfall"]);

export class GameMap {
  readonly width: number;
  readonly height: number;
  readonly terrain: Terrain[];
  /** Building id per tile (walls, windows, doors, floor), -1 outside. */
  readonly building: number[];
  /** Ground height of each tile, in metres. */
  readonly elev: Float32Array;
  /** Floors of the building over each tile (1 for a single storey), 0 outside. */
  readonly levels: Uint8Array;
  readonly rules: TerrainRules;
  /** Connected passable area of each cell, for quick reachability. */
  region: Int32Array = new Int32Array(0);
  /** Tiles that can be walked on an upper floor (floor, stairs, inner doorways). */
  private upper: Uint8Array;
  /** Per tile, kept by finalize(): the top of what stands there, the sight left after passing through it, and through it from right beside it (-1 if no different). */
  private top: Float32Array;
  private seeAt: Float32Array;
  private portAt: Float32Array;
  /** Bumped whenever terrain changes (craters, rubble), so viewers redraw. */
  version = 0;
  /** How much heavier going rain makes open ground. */
  mud = 1;
  /** Hits each stretch of wall can still take before it is breached (0 for anything else). */
  readonly wallHp: Uint8Array;
  /** Shell hits each tile of a roof has taken. */
  readonly roofHits: Uint8Array;
  /** Metres per storey on each tile: a church tower's storeys are tall, putting its belfry high above the roofs. */
  readonly storey: Float32Array;
  /** Bullet strikes on each stretch of wall. */
  readonly holes: Uint8Array;
  /** Bumped when a wall's bullet holes reach a new step, so viewers redraw it. */
  scars = 0;

  constructor(width: number, height: number, rules: TerrainRules) {
    this.width = width;
    this.height = height;
    this.rules = rules;
    this.terrain = new Array<Terrain>(width * height).fill("grass");
    this.building = new Array<number>(width * height).fill(-1);
    this.elev = new Float32Array(width * height);
    this.levels = new Uint8Array(width * height);
    this.upper = new Uint8Array(width * height);
    this.top = new Float32Array(width * height);
    this.wallHp = new Uint8Array(width * height);
    this.roofHits = new Uint8Array(width * height);
    this.holes = new Uint8Array(width * height);
    this.storey = new Float32Array(width * height).fill(rules.floorHeight);
    this.seeAt = new Float32Array(width * height).fill(1);
    this.portAt = new Float32Array(width * height).fill(-1);
  }

  /** Tiles on one floor. */
  get tiles(): number {
    return this.width * this.height;
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  /** The cell of a tile on a floor. */
  cell(x: number, y: number, z = 0): number {
    return z * this.width * this.height + y * this.width + x;
  }

  /** The tile (and floor) of a tile index or a cell. */
  pt(i: number): Point {
    const n = this.width * this.height;
    const t = i % n;
    return { x: t % this.width, y: Math.floor(t / this.width) };
  }

  ptz(c: number): Point & { z: number } {
    const n = this.width * this.height;
    const t = c % n;
    return { x: t % this.width, y: Math.floor(t / this.width), z: Math.floor(c / n) };
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  at(x: number, y: number): Terrain {
    return this.terrain[this.idx(x, y)]!;
  }

  set(x: number, y: number, t: Terrain): void {
    if (this.inBounds(x, y)) this.terrain[this.idx(x, y)] = t;
  }

  passable(x: number, y: number, z = 0): boolean {
    if (!this.inBounds(x, y)) return false;
    if (z === 0) return Number.isFinite(this.rules.moveCost[this.at(x, y)]);
    const i = this.idx(x, y);
    return z < MAX_FLOORS && this.levels[i]! > z && this.upper[i] === 1;
  }

  passableCell(c: number): boolean {
    const p = this.ptz(c);
    return this.passable(p.x, p.y, p.z);
  }

  /** Ground move cost of a tile (the ground floor), mud included. */
  cost(i: number): number {
    const t = this.terrain[i % (this.width * this.height)]!;
    return this.rules.moveCost[t] * (this.mud !== 1 && MUDDY.has(t) ? this.mud : 1);
  }

  /** Move cost of entering a cell on its own floor. */
  cellCost(c: number): number {
    const n = this.width * this.height;
    if (c < n) return this.cost(c);
    return this.upper[c % n] === 1 && this.levels[c % n]! > Math.floor(c / n) ? this.rules.moveCost[this.terrain[c % n]!] : Infinity;
  }

  /** Cost of one step between neighbouring cells: uphill is harder going, stairs are a climb. */
  stepCost(from: number, to: number): number {
    const n = this.width * this.height;
    const a = from % n, b = to % n;
    if (a === b) return this.rules.stairsCost;
    const base = this.cellCost(to);
    const dh = this.elev[b]! - this.elev[a]!;
    if (dh > 0) return base * (1 + this.rules.climbCost * dh);
    return base * Math.max(0.85, 1 + this.rules.downhill * dh);
  }

  /** Height in metres of the floor a man stands on. */
  heightAt(x: number, y: number, z = 0): number {
    const i = this.idx(x, y);
    return this.elev[i]! + z * this.storey[i]!;
  }

  /** A tower: storeys taller than a house's, with openings on every side at the top. */
  isTower(x: number, y: number): boolean {
    return this.storey[this.idx(x, y)]! > this.rules.floorHeight;
  }

  /** Indoors: on a building's floor, stairs or doorway, or anywhere upstairs. */
  indoors(x: number, y: number, z = 0): boolean {
    if (z > 0) return true;
    const t = this.at(x, y);
    return this.building[this.idx(x, y)]! >= 0 && (t === "floor" || t === "door" || t === "stairs");
  }

  /** Top of what stands on a tile, in metres above sea level: walls up to the eaves, trees to their crowns. */
  private topOf(i: number): number {
    const t = this.terrain[i]!;
    if (WALLS.has(t) && this.building[i]! >= 0) return this.elev[i]! + this.levels[i]! * this.rules.floorHeight + 1;
    return this.elev[i]! + (this.rules.height[t] ?? 0);
  }

  /**
   * How clearly a can see b, in [0, 1]: 0 is no line of sight. The line runs
   * from a's eyes to b's body, each on its floor. Rising ground blocks it.
   * Hedges, walls, trees and smoke thin or block it only where it passes below
   * their tops, so a man on high ground or upstairs sees over the hedgerows.
   * Hedges and walls do not block a man right beside them.
   */
  visibility(ax: number, ay: number, bx: number, by: number, smoke: Float32Array | null = null, az = 0, bz = 0): number {
    let v = 1;
    let x = ax, y = ay;
    const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
    let err = dx + dy;
    const ha = this.heightAt(ax, ay, az) + this.rules.eye, hb = this.heightAt(bx, by, bz) + this.rules.body;
    const len = Math.max(dx, -dy);
    if (smoke) {
      if (az === 0) v *= smoke[this.idx(ax, ay)]!;
      if (bz === 0) v *= smoke[this.idx(bx, by)]!;
    }
    let k = 0;
    const W = this.width, elev = this.elev, top = this.top, seeAt = this.seeAt, portAt = this.portAt;
    while (!(x === bx && y === by)) {
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
      if (x === bx && y === by) break;
      k++;
      const i = y * W + x;
      const h = ha + ((hb - ha) * k) / len;
      // A crest between them.
      if (h < elev[i]! + 0.15) return 0;
      if (h < top[i]!) {
        const near = (x - ax <= 1 && ax - x <= 1 && y - ay <= 1 && ay - y <= 1) || (x - bx <= 1 && bx - x <= 1 && y - by <= 1 && by - y <= 1);
        const port = near ? portAt[i]! : -1;
        v *= port >= 0 ? port : seeAt[i]!;
      }
      if (smoke && h < elev[i]! + 8) v *= smoke[i]!;
      if (v < 0.02) return 0;
    }
    return v;
  }

  /** The first tile from `from` toward `to` (the one right beside `from` on that line). */
  stepToward(from: Point, to: Point): Point {
    const dx = Math.abs(to.x - from.x), dy = -Math.abs(to.y - from.y);
    const sx = from.x < to.x ? 1 : -1, sy = from.y < to.y ? 1 : -1;
    let x = from.x, y = from.y;
    const e2 = 2 * (dx + dy);
    if (e2 >= dy) x += sx;
    if (e2 <= dx) y += sy;
    return { x, y };
  }

  /**
   * Protection in [0, 1] a man at `at` has from fire coming from `from`:
   * what lies right in front of him on that line, and the ground he lies in.
   * Fire plunging from higher up comes in over the bank or wall in front of him.
   */
  cover(at: Point, from: Point, posture: Posture): number {
    if (at.x === from.x && at.y === from.y) return 0;
    const step = this.stepToward(at, from);
    const front = this.inBounds(step.x, step.y) ? this.at(step.x, step.y) : "grass";
    let edge = this.rules.edgeCover[front] ?? 0;
    if (front === "wall" && posture === "stand") edge *= 0.5;
    const az = at.z ?? 0;
    if (edge > 0 && this.inBounds(from.x, from.y)) {
      const drop = this.heightAt(from.x, from.y, from.z ?? 0) + this.rules.eye - (this.heightAt(at.x, at.y, az) + this.rules.body);
      const range = Math.max(1, Math.hypot(from.x - at.x, from.y - at.y)) * 3;
      if (drop > 0) edge *= Math.max(0.35, 1 - (drop / range) * this.rules.plunge);
    }
    // A man in a window or doorway is behind the wall beside him.
    const here = this.at(at.x, at.y);
    let own = az > 0 ? 0 : this.rules.ownCover[here] ?? 0;
    if ((here === "foxhole" || here === "crater" || here === "ditch") && posture === "stand") own *= 0.35;
    if (here === "crater" && posture === "crouch") own *= 0.6;
    return 1 - (1 - edge) * (1 - own);
  }

  /** True if a hedge, wall or building lies right beside the point. */
  besideCover(x: number, y: number): boolean {
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = x + dx, ny = y + dy;
      if (!this.inBounds(nx, ny)) continue;
      const t = this.at(nx, ny);
      if (t === "hedge" || t === "wall" || t === "building" || t === "window") return true;
    }
    return false;
  }

  /** A round strikes a wall: one more pockmark. */
  scar(x: number, y: number): void {
    const i = this.idx(x, y);
    const before = this.holes[i]!;
    if (before >= 255) return;
    this.holes[i] = before + 1;
    if (holeStep(before + 1) !== holeStep(before)) this.scars++;
  }

  /** True if a window is right beside the point (a man upstairs can fire from it). */
  besideWindow(x: number, y: number): boolean {
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = x + dx, ny = y + dy;
      if (this.inBounds(nx, ny) && this.at(nx, ny) === "window") return true;
    }
    return false;
  }

  neighbors4(x: number, y: number): Point[] {
    const out: Point[] = [];
    if (y > 0) out.push({ x, y: y - 1 });
    if (x < this.width - 1) out.push({ x: x + 1, y });
    if (y < this.height - 1) out.push({ x, y: y + 1 });
    if (x > 0) out.push({ x: x - 1, y });
    return out;
  }

  /** Cells next to a cell: the four tiles around on the same floor, and up or down a staircase. */
  cellNeighbors(c: number, out: number[]): number {
    const n = this.width * this.height;
    const t = c % n, z = Math.floor(c / n);
    const x = t % this.width, y = (t - x) / this.width;
    let k = 0;
    if (y > 0) out[k++] = c - this.width;
    if (x < this.width - 1) out[k++] = c + 1;
    if (y < this.height - 1) out[k++] = c + this.width;
    if (x > 0) out[k++] = c - 1;
    if (this.terrain[t] === "stairs") {
      if (z + 1 < MAX_FLOORS && this.levels[t]! > z + 1) out[k++] = c + n;
      if (z > 0) out[k++] = c - n;
    }
    return k;
  }

  /** Labels connected passable areas, floors included. Call after the layout or any terrain change. */
  finalize(): void {
    const n = this.width * this.height;
    for (let i = 0; i < n; i++) {
      const t = this.terrain[i]!;
      this.top[i] = this.topOf(i);
      this.seeAt[i] = this.rules.seeThrough[t] ?? 1;
      this.portAt[i] = PORT[t] ?? -1;
    }
    for (let i = 0; i < n; i++) {
      const t = this.terrain[i]!;
      const b = this.building[i]!;
      let up = 0;
      if (b >= 0 && this.levels[i]! > 1) {
        if (t === "floor" || t === "stairs") up = 1;
        else if (t === "door") {
          // An inner doorway, between rooms, is there on every floor; the front door is not.
          const x = i % this.width, y = (i - x) / this.width;
          up = this.neighbors4(x, y).every((p) => this.building[this.idx(p.x, p.y)] === b) ? 1 : 0;
        }
      }
      this.upper[i] = up;
    }
    const N = n * MAX_FLOORS;
    this.region = new Int32Array(N).fill(-1);
    const queue = new Int32Array(N);
    const nb: number[] = [0, 0, 0, 0, 0, 0];
    let next = 0;
    for (let s = 0; s < N; s++) {
      if (this.region[s] !== -1 || !this.passableCell(s)) continue;
      let head = 0, tail = 0;
      queue[tail++] = s;
      this.region[s] = next;
      while (head < tail) {
        const cur = queue[head++]!;
        const m = this.cellNeighbors(cur, nb);
        for (let k = 0; k < m; k++) {
          const c = nb[k]!;
          if (this.region[c] !== -1 || !this.passableCell(c)) continue;
          this.region[c] = next;
          queue[tail++] = c;
        }
      }
      next++;
    }
    this.version++;
  }

  reachable(a: Point, b: Point): boolean {
    const ra = this.region[this.cell(a.x, a.y, a.z ?? 0)]!;
    return ra >= 0 && this.region[this.cell(b.x, b.y, b.z ?? 0)] === ra;
  }
}

let scratch: { g: Float64Array; came: Int32Array; stamp: Uint32Array; closedStamp: Uint32Array; gen: number } | null = null;

/**
 * A* over cells (tiles on each floor, four neighbours, stairs between floors),
 * deterministic (ties broken by cell index). `from` and `to` are cells.
 * `blocked` marks extra impassable cells (men in the way); `extra` adds cost
 * per cell, such as exposure to known enemy positions.
 */
export function findPath(map: GameMap, from: number, to: number, opts: { blocked?: (c: number) => boolean; extra?: (c: number) => number; maxExpand?: number } = {}): number[] | null {
  if (from === to) return [];
  if (!map.passableCell(to)) return null;
  if (map.region.length > 0 && map.region[from]! >= 0 && map.region[from] !== map.region[to]) return null;
  const n = map.tiles * MAX_FLOORS;
  if (!scratch || scratch.stamp.length !== n) scratch = { g: new Float64Array(n), came: new Int32Array(n), stamp: new Uint32Array(n), closedStamp: new Uint32Array(n), gen: 0 };
  const sc = scratch;
  sc.gen++;
  const gen = sc.gen;
  const gAt = (i: number) => (sc.stamp[i] === gen ? sc.g[i]! : Infinity);
  const setG = (i: number, v: number, f: number) => { sc.g[i] = v; sc.came[i] = f; sc.stamp[i] = gen; };
  const closedAt = (i: number) => sc.closedStamp[i] === gen;
  const heapF: number[] = [];
  const heapI: number[] = [];
  const less = (a: number, b: number) => heapF[a]! < heapF[b]! || (heapF[a] === heapF[b] && heapI[a]! < heapI[b]!);
  const swap = (a: number, b: number) => {
    const f = heapF[a]!; heapF[a] = heapF[b]!; heapF[b] = f;
    const i = heapI[a]!; heapI[a] = heapI[b]!; heapI[b] = i;
  };
  const push = (f: number, i: number) => {
    heapF.push(f); heapI.push(i);
    let c = heapF.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (less(c, p)) { swap(c, p); c = p; } else break;
    }
  };
  const pop = (): number => {
    const top = heapI[0]!;
    const lastF = heapF.pop()!, lastI = heapI.pop()!;
    if (heapF.length > 0) {
      heapF[0] = lastF; heapI[0] = lastI;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1, r = l + 1;
        let m = c;
        if (l < heapF.length && less(l, m)) m = l;
        if (r < heapF.length && less(r, m)) m = r;
        if (m === c) break;
        swap(c, m); c = m;
      }
    }
    return top;
  };
  const W = map.width, T = map.tiles;
  const toT = to % T, toZ = Math.floor(to / T);
  const tx = toT % W, ty = Math.floor(toT / W);
  const h = (c: number) => {
    const t = c % T;
    return (Math.abs((t % W) - tx) + Math.abs(Math.floor(t / W) - ty)) * 0.9 + Math.abs(Math.floor(c / T) - toZ) * 2;
  };
  setG(from, 0, -1);
  push(h(from), from);
  let expanded = 0;
  const maxExpand = opts.maxExpand ?? Infinity;
  const nb: number[] = [0, 0, 0, 0, 0, 0];
  while (heapF.length > 0) {
    const cur = pop();
    if (closedAt(cur)) continue;
    if (cur === to) break;
    if (++expanded > maxExpand) return null;
    sc.closedStamp[cur] = gen;
    const m = map.cellNeighbors(cur, nb);
    for (let k = 0; k < m; k++) {
      const ni = nb[k]!;
      if (closedAt(ni)) continue;
      if (!Number.isFinite(map.cellCost(ni))) continue;
      let c = map.stepCost(cur, ni);
      if (opts.blocked && ni !== to && opts.blocked(ni)) continue;
      if (opts.extra) c += opts.extra(ni);
      const ng = gAt(cur) + c;
      if (ng < gAt(ni)) {
        setG(ni, ng, cur);
        push(ng + h(ni), ni);
      }
    }
  }
  if (!Number.isFinite(gAt(to))) return null;
  const path: number[] = [];
  for (let c = to; c !== from; c = sc.came[c]!) path.push(c);
  path.reverse();
  return path;
}

/** Bullet holes counted in steps, for drawing: none, a few, many, riddled. */
export function holeStep(n: number): number {
  return n === 0 ? 0 : n < 4 ? 1 : n < 12 ? 2 : n < 30 ? 3 : 4;
}

export function cheb(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
