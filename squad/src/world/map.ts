// The battlefield grid: terrain, buildings, sight lines, cover and paths.
import type { Point, Posture, Terrain } from "./types.ts";

export interface TerrainRules {
  moveCost: Record<Terrain, number>;
  seeThrough: Partial<Record<Terrain, number>>;
  edgeCover: Partial<Record<Terrain, number>>;
  ownCover: Partial<Record<Terrain, number>>;
  concealment: Partial<Record<Terrain, number>>;
}

/** Hedges, walls and openings in walls can be seen and shot through by a man right beside them. */
const PORT: Partial<Record<Terrain, number>> = { hedge: 0.5, wall: 1, window: 0.85, door: 0.85, building: 0 };

export class GameMap {
  readonly width: number;
  readonly height: number;
  readonly terrain: Terrain[];
  /** Building id per tile (walls, windows, doors, floor), -1 outside. */
  readonly building: number[];
  readonly rules: TerrainRules;
  /** Connected passable area of each tile, for quick reachability. */
  region: Int32Array = new Int32Array(0);
  /** Bumped whenever terrain changes (craters, rubble), so viewers redraw. */
  version = 0;

  constructor(width: number, height: number, rules: TerrainRules) {
    this.width = width;
    this.height = height;
    this.rules = rules;
    this.terrain = new Array<Terrain>(width * height).fill("grass");
    this.building = new Array<number>(width * height).fill(-1);
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  pt(i: number): Point {
    return { x: i % this.width, y: Math.floor(i / this.width) };
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

  passable(x: number, y: number): boolean {
    return this.inBounds(x, y) && Number.isFinite(this.rules.moveCost[this.at(x, y)]);
  }

  cost(i: number): number {
    return this.rules.moveCost[this.terrain[i]!];
  }

  /** Indoors: on a building's floor or in its doorway. */
  indoors(x: number, y: number): boolean {
    const t = this.at(x, y);
    return this.building[this.idx(x, y)]! >= 0 && (t === "floor" || t === "door");
  }

  /**
   * How clearly a can see b, in [0, 1]: 0 is no line of sight. Hedges and
   * walls block it unless a man is right beside them; woods, orchards and
   * smoke thin it. `smoke` gives the visibility left on each tile.
   */
  visibility(ax: number, ay: number, bx: number, by: number, smoke: Float32Array | null = null): number {
    let v = 1;
    let x = ax, y = ay;
    const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
    let err = dx + dy;
    const see = this.rules.seeThrough;
    if (smoke) v *= smoke[this.idx(ax, ay)]! * smoke[this.idx(bx, by)]!;
    while (!(x === bx && y === by)) {
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
      if (x === bx && y === by) break;
      const i = y * this.width + x;
      const t = this.terrain[i]!;
      const near = (Math.abs(x - ax) <= 1 && Math.abs(y - ay) <= 1) || (Math.abs(x - bx) <= 1 && Math.abs(y - by) <= 1);
      const port = near ? PORT[t] : undefined;
      if (port !== undefined) v *= port;
      else {
        const s = see[t];
        if (s !== undefined) v *= s;
      }
      if (smoke) v *= smoke[i]!;
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
   */
  cover(at: Point, from: Point, posture: Posture): number {
    if (at.x === from.x && at.y === from.y) return 0;
    const step = this.stepToward(at, from);
    const front = this.inBounds(step.x, step.y) ? this.at(step.x, step.y) : "grass";
    let edge = this.rules.edgeCover[front] ?? 0;
    if (front === "wall" && posture === "stand") edge *= 0.5;
    // A man in a window or doorway is behind the wall beside him.
    const here = this.at(at.x, at.y);
    let own = this.rules.ownCover[here] ?? 0;
    if ((here === "foxhole" || here === "crater") && posture === "stand") own *= 0.35;
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

  neighbors4(x: number, y: number): Point[] {
    const out: Point[] = [];
    if (y > 0) out.push({ x, y: y - 1 });
    if (x < this.width - 1) out.push({ x: x + 1, y });
    if (y < this.height - 1) out.push({ x, y: y + 1 });
    if (x > 0) out.push({ x: x - 1, y });
    return out;
  }

  /** Labels connected passable areas. Call after the layout or any terrain change. */
  finalize(): void {
    const n = this.width * this.height;
    this.region = new Int32Array(n).fill(-1);
    const queue = new Int32Array(n);
    let next = 0;
    for (let s = 0; s < n; s++) {
      if (this.region[s] !== -1 || !Number.isFinite(this.cost(s))) continue;
      let head = 0, tail = 0;
      queue[tail++] = s;
      this.region[s] = next;
      while (head < tail) {
        const cur = queue[head++]!;
        const x = cur % this.width, y = (cur - x) / this.width;
        for (const nb of this.neighbors4(x, y)) {
          const i = this.idx(nb.x, nb.y);
          if (this.region[i] !== -1 || !Number.isFinite(this.cost(i))) continue;
          this.region[i] = next;
          queue[tail++] = i;
        }
      }
      next++;
    }
    this.version++;
  }

  reachable(a: Point, b: Point): boolean {
    const ra = this.region[this.idx(a.x, a.y)]!;
    return ra >= 0 && this.region[this.idx(b.x, b.y)] === ra;
  }
}

let scratch: { g: Float64Array; came: Int32Array; stamp: Uint32Array; closedStamp: Uint32Array; gen: number } | null = null;

/**
 * A* over 4-neighbour tiles, deterministic (ties broken by tile index).
 * `blocked` marks extra impassable tiles (men in the way); `extra` adds cost
 * per tile, such as exposure to known enemy positions.
 */
export function findPath(map: GameMap, from: number, to: number, opts: { blocked?: (i: number) => boolean; extra?: (i: number) => number; maxExpand?: number } = {}): number[] | null {
  if (from === to) return [];
  const toPt = map.pt(to);
  if (!map.passable(toPt.x, toPt.y)) return null;
  if (map.region.length > 0 && map.region[from]! >= 0 && map.region[from] !== map.region[to]) return null;
  const n = map.width * map.height;
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
  const W = map.width;
  const h = (i: number) => (Math.abs((i % W) - toPt.x) + Math.abs(Math.floor(i / W) - toPt.y)) * 0.9;
  setG(from, 0, -1);
  push(h(from), from);
  let expanded = 0;
  const maxExpand = opts.maxExpand ?? Infinity;
  while (heapF.length > 0) {
    const cur = pop();
    if (closedAt(cur)) continue;
    if (cur === to) break;
    if (++expanded > maxExpand) return null;
    sc.closedStamp[cur] = gen;
    const cx = cur % W, cy = (cur - cx) / W;
    for (let k = 0; k < 4; k++) {
      const nx = k === 1 ? cx + 1 : k === 3 ? cx - 1 : cx;
      const ny = k === 0 ? cy - 1 : k === 2 ? cy + 1 : cy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= map.height) continue;
      const ni = ny * W + nx;
      if (closedAt(ni)) continue;
      let c = map.cost(ni);
      if (!Number.isFinite(c)) continue;
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

export function cheb(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
