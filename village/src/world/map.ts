import type { Point, Terrain } from "./types.ts";

const MOVE_COST: Record<Terrain, number> = {
  ground: 1,
  path: 0.8,
  floor: 1,
  door: 1,
  field: 1.5,
  forest: 2,
  water: Infinity,
  wall: Infinity,
  well: Infinity,
};

export class GameMap {
  readonly width: number;
  readonly height: number;
  readonly terrain: Terrain[];
  /** Building id per tile (walls, floor and door), -1 outside. */
  readonly building: number[];
  forest: Point[] = [];
  bank: Point[] = [];
  field: Point[] = [];
  /** The town well; `wells` lists every well, including one per compound. */
  well: Point = { x: 0, y: 0 };
  wells: Point[] = [];
  /** Inside the courthouse, where the council sits. */
  meeting: Point = { x: 0, y: 0 };
  /** The open town square, where people gather. */
  square: Point = { x: 0, y: 0 };
  /** Household id owning each farm tile, -1 elsewhere. */
  farmOf: number[] = [];
  private nearestForestIdx: number[] = [];
  private nearestBankIdx: number[] = [];
  private nearestFieldIdx: number[] = [];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.terrain = new Array<Terrain>(width * height).fill("ground");
    this.building = new Array<number>(width * height).fill(-1);
    this.farmOf = new Array<number>(width * height).fill(-1);
  }

  nearestWell(from: Point): Point {
    let best = this.wells[0] ?? this.well, bestD = Infinity;
    for (const wl of this.wells) {
      const d = Math.abs(wl.x - from.x) + Math.abs(wl.y - from.y);
      if (d < bestD) { bestD = d; best = wl; }
    }
    return best;
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
    this.terrain[this.idx(x, y)] = t;
  }

  buildingAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return -1;
    return this.building[this.idx(x, y)]!;
  }

  /** Floor and door tiles of a building are under a roof. */
  roofed(x: number, y: number): boolean {
    const t = this.at(x, y);
    return this.buildingAt(x, y) >= 0 && (t === "floor" || t === "door");
  }

  /** Building id if standing on its floor, -2 on a door (both sides), -1 outside. */
  zone(x: number, y: number): number {
    const t = this.at(x, y);
    if (t === "door") return -2;
    if (t === "floor") return this.buildingAt(x, y);
    return -1;
  }

  passable(x: number, y: number): boolean {
    return this.inBounds(x, y) && Number.isFinite(MOVE_COST[this.at(x, y)]);
  }

  cost(i: number): number {
    return MOVE_COST[this.terrain[i]!];
  }

  /** Walls block sight; entering or leaving a building requires the line to pass a door. */
  lineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    const za = this.zone(ax, ay);
    const zb = this.zone(bx, by);
    let sawDoor = za === -2 || zb === -2;
    let x = ax, y = ay;
    const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
    let err = dx + dy;
    while (!(x === bx && y === by)) {
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
      if (x === bx && y === by) break;
      const t = this.terrain[this.idx(x, y)];
      if (t === "wall") return false;
      if (t === "door") sawDoor = true;
    }
    if (za !== zb && !(za === -2 || zb === -2) && !sawDoor) return false;
    return true;
  }

  /** Forest tiles between observer and target, including the target's tile. */
  forestCover(ax: number, ay: number, bx: number, by: number): number {
    let n = 0;
    let x = ax, y = ay;
    const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
    let err = dx + dy;
    while (!(x === bx && y === by)) {
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
      if (this.terrain[this.idx(x, y)] === "forest") n++;
    }
    return n;
  }

  /** Builds terrain lists and nearest-site lookup tables. Call once after layout. */
  finalize(): void {
    this.forest = [];
    this.bank = [];
    this.field = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const t = this.at(x, y);
        if (t === "forest") {
          // Only forest tiles reachable from open ground are useful work sites.
          if (this.neighbors4(x, y).some((p) => this.at(p.x, p.y) !== "forest" && this.passable(p.x, p.y))) this.forest.push({ x, y });
        } else if (t === "field") {
          this.field.push({ x, y });
        } else if (this.passable(x, y) && this.neighbors4(x, y).some((p) => this.at(p.x, p.y) === "water")) {
          this.bank.push({ x, y });
        }
      }
    }
    this.nearestForestIdx = this.nearestTable(this.forest);
    this.nearestBankIdx = this.nearestTable(this.bank);
    this.nearestFieldIdx = this.nearestTable(this.field);
  }

  nearest(kind: "forest" | "bank" | "field", from: Point): Point {
    const table = kind === "forest" ? this.nearestForestIdx : kind === "bank" ? this.nearestBankIdx : this.nearestFieldIdx;
    return this.pt(table[this.idx(from.x, from.y)]!);
  }

  neighbors4(x: number, y: number): Point[] {
    const out: Point[] = [];
    if (y > 0) out.push({ x, y: y - 1 });
    if (x < this.width - 1) out.push({ x: x + 1, y });
    if (y < this.height - 1) out.push({ x, y: y + 1 });
    if (x > 0) out.push({ x: x - 1, y });
    return out;
  }

  /** Multi-source breadth-first search: nearest site by grid steps, ties to the earliest site in scan order. */
  private nearestTable(sites: Point[]): number[] {
    const n = this.width * this.height;
    const table = new Array<number>(n).fill(-1);
    const queue = new Int32Array(n);
    let head = 0, tail = 0;
    for (const s of sites) {
      const i = this.idx(s.x, s.y);
      if (table[i] !== -1) continue;
      table[i] = i;
      queue[tail++] = i;
    }
    while (head < tail) {
      const cur = queue[head++]!;
      const x = cur % this.width, y = (cur - x) / this.width;
      const src = table[cur]!;
      if (y > 0 && table[cur - this.width] === -1) { table[cur - this.width] = src; queue[tail++] = cur - this.width; }
      if (x < this.width - 1 && table[cur + 1] === -1) { table[cur + 1] = src; queue[tail++] = cur + 1; }
      if (y < this.height - 1 && table[cur + this.width] === -1) { table[cur + this.width] = src; queue[tail++] = cur + this.width; }
      if (x > 0 && table[cur - 1] === -1) { table[cur - 1] = src; queue[tail++] = cur - 1; }
    }
    for (let i = 0; i < n; i++) if (table[i] === -1) table[i] = i;
    return table;
  }
}

/**
 * A* over 4-neighbour tiles. Deterministic tie-breaking by tile index.
 * `blocked` marks extra impassable tiles (people standing in the way) for detours.
 */
export function findPath(map: GameMap, from: number, to: number, blocked?: (i: number) => boolean, maxExpand = Infinity): number[] | null {
  if (from === to) return [];
  const toPt = map.pt(to);
  if (!map.passable(toPt.x, toPt.y)) return null;
  const n = map.width * map.height;
  const g = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
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
  const h = (i: number) => {
    const x = i % map.width, y = Math.floor(i / map.width);
    return (Math.abs(x - toPt.x) + Math.abs(y - toPt.y)) * 0.8;
  };
  g[from] = 0;
  push(h(from), from);
  let expanded = 0;
  while (heapF.length > 0) {
    const cur = pop();
    if (closed[cur]) continue;
    if (cur === to) break;
    if (++expanded > maxExpand) return null;
    closed[cur] = 1;
    const cx = cur % map.width, cy = Math.floor(cur / map.width);
    for (const nb of map.neighbors4(cx, cy)) {
      const ni = map.idx(nb.x, nb.y);
      if (closed[ni]) continue;
      const c = map.cost(ni);
      if (!Number.isFinite(c)) continue;
      if (blocked && ni !== to && blocked(ni)) continue;
      const ng = g[cur]! + c;
      if (ng < g[ni]!) {
        g[ni] = ng;
        came[ni] = cur;
        push(ng + h(ni), ni);
      }
    }
  }
  if (!Number.isFinite(g[to]!)) return null;
  const path: number[] = [];
  for (let c = to; c !== from; c = came[c]!) path.push(c);
  path.reverse();
  return path;
}
