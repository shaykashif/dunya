// Light defences along the roads, on every kind of ground: the Germans had
// months to wire and sandbag the routes in. A checkpoint is a chicane of
// sandbags that leaves one lane through, with coils of barbed wire out on the
// verges so traffic has to come down the road; the defended hedge has a
// roadblock where the road crosses it; the ways into the settlement and the
// north end of the bridge have a sandbagged post. None of it closes a road.
import type { Rng } from "../engine/rng.ts";
import type { GameMap } from "./map.ts";
import type { Point, Terrain } from "./types.ts";

/** Ground a sandbag wall or a coil of wire can go on. */
const OPEN = new Set<Terrain>(["road", "grass", "wheat", "orchard", "brush", "crater"]);

export interface RoadDefences {
  /** Firing positions behind the roadblock on the defended line. */
  line: Point[];
  /** Firing positions behind the other posts. */
  posts: Point[];
}

export function roadDefences(map: GameMap, rng: Rng, o: { roadX: number[]; laneAt: number[]; lineAt: number[]; lineRow: number; startRow: number; cx: number; cy: number; areaW: number }): RoadDefences {
  const out: RoadDefences = { line: [], posts: [] };
  const ok = (x: number, y: number) => map.inBounds(x, y) && map.building[map.idx(x, y)]! < 0 && OPEN.has(map.at(x, y));
  const bag = (x: number, y: number) => {
    if (ok(x, y)) map.set(x, y, "sandbags");
  };
  const wire = (x: number, y: number) => {
    if (ok(x, y) && map.at(x, y) !== "road") map.set(x, y, "wire");
  };
  /** The run of road across row y at the north-south road. */
  const spanAt = (y: number): [number, number] | null => {
    if (y < 0 || y >= map.height) return null;
    const x0 = o.roadX[y]!;
    const x = [0, 1, -1, 2, -2].map((d) => x0 + d).find((xx) => map.inBounds(xx, y) && map.at(xx, y) === "road");
    if (x === undefined) return null;
    let xl = x, xr = x;
    while (map.inBounds(xl - 1, y) && map.at(xl - 1, y) === "road") xl--;
    while (map.inBounds(xr + 1, y) && map.at(xr + 1, y) === "road") xr++;
    return xr - xl > 6 ? null : [xl, xr];
  };
  const postBehind = (x: number, y: number) => {
    if (map.inBounds(x, y - 1) && OPEN.has(map.at(x, y - 1)) && map.building[map.idx(x, y - 1)]! < 0) out.posts.push({ x, y: y - 1 });
  };

  /** A chicane across the north-south road at row y: sandbags in from one side, then in from the other two rows on, wire on the verges. */
  const chicane = (y: number) => {
    const a = spanAt(y), b = spanAt(y + 2);
    if (!a || !b) return;
    const left = rng.chance(0.5);
    const reach = (s: [number, number]) => Math.max(1, Math.floor((s[1] - s[0] + 1) / 2));
    for (const [row, s, fromLeft] of [[y, a, left], [y + 2, b, !left]] as const) {
      const n = reach(s);
      for (let k = 0; k < n; k++) bag(fromLeft ? s[0] + k : s[1] - k, row);
      // And out over the verge.
      for (let k = 1; k <= 2; k++) bag(fromLeft ? s[0] - k : s[1] + k, row);
      postBehind(fromLeft ? s[0] : s[1], row);
    }
    for (let k = 3; k <= 5; k++) {
      wire(a[0] - k, y + 1);
      wire(a[1] + k, y + 1);
    }
  };

  // Checkpoints up the road, but not near the crossroads or the attackers' start.
  for (let y = 8 + rng.int(10); y < o.startRow - 28; y += 22 + rng.int(13)) {
    if (Math.abs(y - o.cy) < 7 || Math.abs(y - o.lineRow) < 6) continue;
    if (rng.chance(0.7)) chicane(y);
  }

  // The roadblock where the road crosses the defended hedge: sandbags across all but one lane, wire in front.
  const lx = o.roadX[o.lineRow]!;
  const row = o.lineAt[Math.max(0, Math.min(o.lineAt.length - 1, lx))]!;
  const s = spanAt(row);
  if (s) {
    const gap = rng.chance(0.5) ? s[0] : s[1];
    for (let x = s[0] - 1; x <= s[1] + 1; x++) {
      if (x === gap) continue;
      bag(x, row);
      if (map.inBounds(x, row - 1) && map.at(x, row - 1) !== "hedge") out.line.push({ x, y: row - 1 });
    }
    for (let x = s[0] - 3; x <= s[1] + 3; x++) if (x !== gap && x !== gap + (gap === s[0] ? -1 : 1)) wire(x, row + 2);
    for (let x = s[0]; x <= s[1]; x++) if (x !== gap && rng.chance(0.5) && map.at(x, row + 3) === "road") map.set(x, row + 3, "wire");
  }

  // Posts at the ways into the settlement along the lane, and here and there along it outside.
  const laneSpan = (x: number): [number, number] | null => {
    const y0 = o.laneAt[x];
    if (y0 === undefined) return null;
    let yt = y0, yb = y0;
    if (map.at(x, yt) !== "road") return null;
    while (map.inBounds(x, yt - 1) && map.at(x, yt - 1) === "road") yt--;
    while (map.inBounds(x, yb + 1) && map.at(x, yb + 1) === "road") yb++;
    return yb - yt > 4 ? null : [yt, yb];
  };
  const laneBlock = (x: number, outward: number) => {
    const a = laneSpan(x), b = laneSpan(x + 2 * outward);
    if (!a || !b) return;
    bag(x, a[0]);
    bag(x, a[0] - 1);
    bag(x + 2 * outward, b[1]);
    bag(x + 2 * outward, b[1] + 1);
    for (let k = 2; k <= 4; k++) {
      wire(x + outward, a[0] - k);
      wire(x + outward, b[1] + k);
    }
    const p = { x: x - outward, y: a[0] };
    if (map.inBounds(p.x, p.y) && map.at(p.x, p.y) === "road") out.posts.push(p);
  };
  for (const side of [-1, 1]) {
    const x = o.cx + side * (o.areaW + 3);
    if (x > 4 && x < map.width - 5) laneBlock(x, side);
  }
  for (let x = 10 + rng.int(20); x < map.width - 10; x += 34 + rng.int(20)) {
    if (Math.abs(x - o.cx) < o.areaW + 10 || Math.abs(x - o.roadX[o.laneAt[x] ?? 0]!) < 8) continue;
    if (rng.chance(0.5)) laneBlock(x, x < o.cx ? -1 : 1);
  }

  // The north end of the bridge.
  for (let y = 1; y < map.height - 1; y++) {
    const x = o.roadX[y]!;
    if (map.at(x, y) !== "bridge" || map.at(x, y - 1) === "bridge") continue;
    const sp = spanAt(y - 2);
    if (sp) {
      bag(sp[0] - 1, y - 2);
      bag(sp[0] - 2, y - 2);
      bag(sp[1] + 1, y - 2);
      bag(sp[1] + 2, y - 2);
      bag(sp[0], y - 3);
      postBehind(sp[0] - 1, y - 2);
      postBehind(sp[1] + 1, y - 2);
    }
    break;
  }

  // The roads are a mess: potholes, shell holes, debris from the fighting, carts and lorries abandoned at the verge.
  const nearBlock = (x: number, y: number) => Math.abs(y - row) <= 4 && Math.abs(x - lx) <= 6;
  for (let y = 1; y < o.startRow - 6; y++) {
    for (let x = 1; x < map.width - 1; x++) {
      if (map.at(x, y) !== "road" || nearBlock(x, y)) continue;
      const roll = rng.next();
      if (roll < 0.045) map.set(x, y, "pothole");
      else if (roll < 0.075) map.set(x, y, "debris");
      else if (roll < 0.083) map.set(x, y, "crater");
    }
  }
  let wrecks = 0;
  for (let k = 0; k < 80 && wrecks < 7; k++) {
    const y = 6 + rng.int(Math.max(1, o.startRow - 20));
    if (Math.abs(y - o.lineRow) < 6) continue;
    const a = spanAt(y), b = spanAt(y + 1);
    if (!a || !b || a[1] - a[0] < 1 || b[1] - b[0] < 1) continue;
    const left = rng.chance(0.5);
    const xa = left ? a[0] : a[1], xb = left ? b[0] : b[1];
    if (xa !== xb) continue;
    // Pulled over onto the verge side: the other lane stays open, and there is a way round.
    const verge = xa + (left ? -1 : 1);
    if (!ok(verge, y) || !ok(verge, y + 1)) continue;
    map.set(xa, y, "wreck");
    map.set(xa, y + 1, "wreck");
    wrecks++;
  }
  return out;
}
