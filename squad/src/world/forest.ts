// A forest line, the way the winter of 1944 was fought in the Ardennes and the
// Hürtgen: no fields and no village, only fir and beech forest over rocky
// ridges, cut by a logging track and a forest road that cross at the
// objective. Each side holds a trench line dug across the whole width of the
// map: the defenders in the north, behind a belt of wire with log-covered
// machine-gun bunkers, and a reserve trench back at the crossroads by the
// forester's lodge; the attackers in the south, where they form up. Between
// them lies no man's land: forest smashed by months of shelling into stumps,
// deadfall and craters, with rocks and the odd stand of trees still upright,
// and the firebreaks open lanes across it.
import { Rng } from "../engine/rng.ts";
import type { SimConfig } from "../scenario/config.ts";
import { GameMap } from "./map.ts";
import { shapeGround, startClearance, type Building, type BuildingKind, type Layout } from "./layout.ts";
import type { Point, Season, Terrain } from "./types.ts";

/** Stable per-tile noise, independent of draw order. */
function hashTile(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function randInt(rng: Rng, lo: number, hi: number): number {
  return lo + rng.int(hi - lo + 1);
}

/** A smooth wobble, so trench lines and tracks meander. */
function wobble(rng: Rng, n: number, amp: number): number[] {
  const out: number[] = [];
  const f1 = 0.05 + rng.next() * 0.08, f2 = 0.15 + rng.next() * 0.1;
  const p1 = rng.next() * 7, p2 = rng.next() * 7;
  for (let i = 0; i < n; i++) out.push(Math.round(amp * (0.75 * Math.sin(i * f1 + p1) + 0.35 * Math.sin(i * f2 + p2))));
  return out;
}

export function generateForest(cfg: SimConfig, rng: Rng, season: Season = "winter"): Layout {
  const W = cfg.map.width, H = cfg.map.height;
  const F = cfg.forest;
  const map = new GameMap(W, H, cfg.terrain);
  const deco = new Rng(Math.floor(rng.next() * 2147483646) + 1, "forest");
  const set = (x: number, y: number, t: Terrain) => {
    if (map.inBounds(x, y) && map.building[map.idx(x, y)]! < 0) map.set(x, y, t);
  };
  const at = (x: number, y: number): Terrain | null => (map.inBounds(x, y) ? map.at(x, y) : null);

  // ---- Where the lines run ----
  // The defenders' trench stays out of sight of the line of departure, as every map's line does.
  const lastLine = H - 16 - startClearance(cfg) - 6;
  const L = lastLine - deco.int(4);
  const lineAt = wobble(deco, W, 2).map((o) => L + o);
  // The attackers' own trench, just in front of where they form up.
  const A = H - 14;
  const theirAt = wobble(deco, W, 1).map((o) => A + o);
  const hamletY = Math.max(16, L - randInt(deco, 30, 38));

  // ---- The forest ----
  // Thick forest behind each line; in no man's land the shelling has smashed it to stumps,
  // deadfall and craters, thinning toward the middle, with stands of trees still upright.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = hashTile(x, y), r2 = hashTile(y * 3 + 7, x * 5 + 1);
      const front = lineAt[x]!, back = theirAt[x]!;
      let t: Terrain;
      if (y > front + 1 && y < back - 1) {
        // How far into no man's land, 0 at either line and 1 in the middle; and stands of trees in smooth patches.
        const depth = Math.min(y - front, back - y) / ((back - front) / 2);
        const stand = 0.5 + 0.5 * Math.sin(x * 0.11 + Math.sin(y * 0.07) * 2.3) * Math.cos(y * 0.09 + x * 0.013);
        const torn = F.torn * (0.55 + 0.45 * Math.min(1, depth * 1.6)) * (1 - 0.6 * stand);
        t = r < torn * 0.45 ? "deadfall" : r < torn * 0.62 ? "crater" : r < torn ? "grass" : r2 < 0.1 ? "brush" : "woods";
      } else t = r < 0.06 ? "brush" : r < 0.075 ? "deadfall" : "woods";
      map.terrain[y * W + x] = t;
    }
  }
  // Clearings in the forest behind the lines.
  for (let k = 0; k < F.clearings[0] + deco.int(F.clearings[1] - F.clearings[0] + 1); k++) {
    const cx = 6 + deco.int(W - 12);
    const cy = deco.chance(0.5) ? 6 + deco.int(Math.max(1, L - 14)) : A + 2 + deco.int(Math.max(1, H - A - 4));
    const rx = 3 + deco.int(5), ry = 2 + deco.int(4);
    for (let y = cy - ry - 1; y <= cy + ry + 1; y++) {
      for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (d <= 1) set(x, y, "grass");
        else if (d <= 1.5 && hashTile(x, y) < 0.5) set(x, y, "brush");
      }
    }
  }
  // Firebreaks: straight open lanes east to west, slow to cross under fire.
  const breaks: number[] = [];
  for (let k = 0; k < F.firebreaks; k++) {
    const y = L + 12 + deco.int(Math.max(1, A - L - 30));
    if (breaks.some((b) => Math.abs(b - y) < 14)) continue;
    breaks.push(y);
    for (let x = 0; x < W; x++) for (const dy of [0, 1, 2]) if (at(x, y + dy) === "woods" || at(x, y + dy) === "deadfall") set(x, y + dy, hashTile(x, y + dy) < 0.12 ? "brush" : "grass");
  }

  // ---- Tracks ----
  // A logging track north to south, and the forest road east to west; they cross at the objective.
  const roadBase = Math.round(W / 2 + (deco.next() - 0.5) * 30);
  const roadOff = wobble(deco, H, 4);
  const roadX: number[] = [];
  for (let y = 0; y < H; y++) roadX.push(roadBase + roadOff[y]!);
  for (let y = 0; y < H; y++) {
    const x = roadX[y]!, px = y > 0 ? roadX[y - 1]! : x;
    for (let xx = Math.min(px, x); xx <= Math.max(px, x) + 1; xx++) set(xx, y, "road");
  }
  const laneAt = wobble(deco, W, 2).map((o) => hamletY + o);
  for (let x = 0; x < W; x++) {
    const y = laneAt[x]!, py = x > 0 ? laneAt[x - 1]! : y;
    for (let yy = Math.min(py, y); yy <= Math.max(py, y) + 1; yy++) set(x, yy, "road");
  }
  const cx = roadX[hamletY]!, cy = laneAt[cx]!;
  const objective: Point = { x: cx + 3, y: cy + 3 };

  // ---- Rocks ----
  // Outcrops of a few boulders each, all over, but never on a track.
  for (let k = 0, made = 0; k < 2000 && made < F.rocks[0] + deco.int(F.rocks[1] - F.rocks[0] + 1); k++) {
    const x = 3 + deco.int(W - 6), y = 3 + deco.int(H - 6);
    if (Math.abs(x - roadX[y]!) < 4 || Math.abs(y - laneAt[x]!) < 4 || Math.abs(y - lineAt[x]!) < 3 || Math.abs(y - theirAt[x]!) < 3 || y > H - 13) continue;
    const n = 1 + deco.int(3);
    for (let i = 0; i < n; i++) set(x + (i === 1 ? 1 : 0), y + (i === 2 ? 1 : 0), "rock");
    made++;
  }

  // ---- Buildings: the forester's lodge at the crossroads, and a hut or two ----
  const buildings: Building[] = [];
  const place = (kind: BuildingKind, name: string, x: number, y: number, w: number, h: number, door: "n" | "s" | "e" | "w", floors: number): Building | null => {
    for (let yy = y - 1; yy <= y + h; yy++) for (let xx = x - 1; xx <= x + w; xx++) if (!map.inBounds(xx, yy) || map.building[map.idx(xx, yy)]! >= 0 || at(xx, yy) === "road") return null;
    // A clearing round it.
    for (let yy = y - 2; yy <= y + h + 1; yy++) for (let xx = x - 2; xx <= x + w + 1; xx++) if (at(xx, yy) !== "road") set(xx, yy, "grass");
    const b: Building = { id: buildings.length, x, y, w, h, kind, name, floors, destroyed: false };
    buildings.push(b);
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const edge = yy === y || yy === y + h - 1 || xx === x || xx === x + w - 1;
        map.set(xx, yy, edge ? "building" : "floor");
        map.building[map.idx(xx, yy)] = b.id;
        map.levels[map.idx(xx, yy)] = floors;
      }
    }
    for (let xx = x + 2; xx < x + w - 2; xx += 3) {
      map.set(xx, y, "window");
      map.set(xx, y + h - 1, "window");
    }
    for (let yy = y + 2; yy < y + h - 2; yy += 3) {
      map.set(x, yy, "window");
      map.set(x + w - 1, yy, "window");
    }
    const front = door === "n" ? { x: x + Math.floor(w / 2), y } : door === "s" ? { x: x + Math.floor(w / 2), y: y + h - 1 } : door === "w" ? { x, y: y + Math.floor(h / 2) } : { x: x + w - 1, y: y + Math.floor(h / 2) };
    const back = door === "n" || door === "s" ? { x: x + 1 + deco.int(w - 2), y: door === "n" ? y + h - 1 : y } : { x: door === "w" ? x + w - 1 : x, y: y + 1 + deco.int(h - 2) };
    map.set(front.x, front.y, "door");
    map.set(back.x, back.y, "door");
    if (floors > 1) map.set(x + 1, y + 1, "stairs");
    return b;
  };
  let lodge: Building | null = null;
  for (const [dx, dy] of [[4, 4], [-12, 4], [4, 6], [-12, 6], [6, 5], [-14, 5], [4, -11], [-12, -11]] as const) if (!lodge) lodge = place("cabin", "the forester's lodge", cx + dx, cy + dy, 8, 6, dy > 0 ? "n" : "s", 2);
  const huts = [
    ["a woodcutter's hut", cx - 12, cy - 9],
    ["a log shed", cx + 8, cy - 9],
    ["a woodcutter's hut", cx - 14, cy + 4],
  ] as const;
  for (const [name, x, y] of huts) {
    if (buildings.length >= 1 + F.huts) break;
    place("cabin", name, x, y, 6, 5, "s", 1);
  }
  if (lodge) {
    objective.x = lodge.x + Math.floor(lodge.w / 2);
    objective.y = lodge.y - 2;
  }

  // ---- The defenders' line ----
  const linePositions: Point[] = [];
  const mgPositions: Point[] = [];
  const hamletPositions: Point[] = [];
  const dug = (x: number, y: number) => {
    const t = at(x, y);
    return t !== null && t !== "road" && t !== "rock" && map.building[map.idx(x, y)]! < 0;
  };
  // A zig-zag trench across the whole width, with a step forward every few paces.
  const trenchRow: number[] = [];
  for (let x = 2; x < W - 2; x++) {
    const y = lineAt[x]! + (Math.floor(x / 6) % 2 === 0 ? 0 : -1);
    trenchRow[x] = y;
    if (at(x, y) === "road") continue;
    set(x, y, "ditch");
    // Fields of fire cut in front of it.
    for (let dy = 1; dy <= 3; dy++) if (at(x, y + dy) === "woods" && hashTile(x, y + dy) < 0.75) set(x, y + dy, hashTile(y + dy, x) < 0.5 ? "deadfall" : "grass");
    if (x % 3 === 0) linePositions.push({ x, y });
  }
  // Wire a few paces out, with gaps the patrols use.
  for (let x = 2; x < W - 2; x++) {
    const y = lineAt[x]! + 5;
    if (Math.abs(x - roadX[y]!) <= 2 || x % 23 < 3) continue;
    if (dug(x, y)) set(x, y, "wire");
  }
  // Log-covered bunkers for the machine guns: a pit with a parapet of logs and earth in front and to the sides.
  for (let x = 8 + deco.int(6); x < W - 8; x += randInt(deco, 18, 26)) {
    const y = (trenchRow[x] ?? lineAt[x]!) + 1;
    if (!dug(x, y)) continue;
    set(x, y, "foxhole");
    for (const [dx, dy] of [[-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) if (dug(x + dx, y + dy)) set(x + dx, y + dy, "sandbags");
    mgPositions.push({ x, y });
  }
  // Foxholes either side of each bunker, and communication trenches back toward the crossroads.
  for (const m of mgPositions) {
    for (const dx of [-4, 4]) {
      const x = m.x + dx, y = (trenchRow[x] ?? lineAt[x]!) + 1;
      if (dug(x, y) && at(x, y) !== "sandbags") {
        set(x, y, "foxhole");
        linePositions.push({ x, y });
      }
    }
  }
  for (let k = 0; k < 3; k++) {
    const x0 = 20 + Math.floor(((W - 40) * (k + 0.5)) / 3) + deco.int(9) - 4;
    for (let y = lineAt[x0]! - 1; y > hamletY + 8; y--) {
      const x = x0 + (Math.floor(y / 5) % 2 === 0 ? 0 : 1);
      if (dug(x, y)) set(x, y, "ditch");
    }
  }
  // The reserve trench, south of the crossroads, and positions in the lodge's windows.
  const R = cy + 12;
  for (let x = cx - 30; x <= cx + 30; x++) {
    const y = R + (Math.floor(x / 5) % 2 === 0 ? 0 : 1);
    if (!dug(x, y)) continue;
    set(x, y, "ditch");
    if (x % 3 === 0) hamletPositions.push({ x, y });
  }
  for (const b of buildings) {
    for (let xx = b.x + 1; xx < b.x + b.w - 1; xx++) {
      if (map.at(xx, b.y + b.h - 1) !== "window") continue;
      for (let z = 0; z < b.floors; z++) hamletPositions.push(z > 0 ? { x: xx, y: b.y + b.h - 2, z } : { x: xx, y: b.y + b.h - 2 });
    }
  }

  // ---- The attackers' trench ----
  for (let x = 2; x < W - 2; x++) {
    const y = theirAt[x]! + (Math.floor(x / 7) % 2 === 0 ? 0 : 1);
    if (Math.abs(x - roadX[y]!) <= 2 || x % 17 === 0) continue;
    set(x, y, "ditch");
    if (x % 9 === 4 && dug(x, y - 1)) set(x, y - 1, "foxhole");
  }
  // Their assembly area behind it: a clearing by the track for the mortar and the headquarters.
  for (let y = A + 3; y < H - 1; y++) for (let x = roadX[y]! - 14; x <= roadX[y]! + 16; x++) if (at(x, y) === "woods" && hashTile(x, y) < 0.55) set(x, y, "grass");

  // ---- Old shell holes everywhere ----
  for (let k = 0; k < 30 + deco.int(20); k++) {
    const x = 3 + deco.int(W - 6), y = 3 + deco.int(H - 6);
    if (at(x, y) === "woods" || at(x, y) === "grass") set(x, y, "crater");
  }

  // ---- The lie of the land: rocky ridges ----
  shapeGround(map, "forest", rng, { lineRow: L, startRow: A, hamletY, streamAt: [], roadX, buildings, objective });

  // ---- Where scouts can lie up: in the trees ahead of the line, beyond sight of the line of departure ----
  const scoutSpots: Point[] = [];
  {
    const lastRow = H - 8 - startClearance(cfg);
    const cands: { p: Point; s: number }[] = [];
    for (let y = L + 6; y <= lastRow; y++) {
      for (let x = 6; x < W - 6; x++) {
        if (!map.passable(x, y) || map.building[map.idx(x, y)]! >= 0) continue;
        const t = map.at(x, y);
        const hide = t === "woods" ? 1 : t === "brush" || t === "deadfall" ? 0.85 : 0;
        if (hide === 0) continue;
        cands.push({ p: { x, y }, s: hide + hashTile(x, y) * 0.3 - Math.abs(x - cx) / W });
      }
    }
    cands.sort((a, b) => b.s - a.s);
    for (const c of cands) {
      if (scoutSpots.length >= 4) break;
      if (scoutSpots.every((q) => Math.hypot(q.x - c.p.x, q.y - c.p.y) >= 42)) scoutSpots.push(c.p);
    }
    scoutSpots.sort((a, b) => a.x - b.x);
  }

  for (let i = 0; i < W * H; i++) map.wallHp[i] = cfg.destruction.wallHp[map.terrain[i]!] ?? 0;
  map.finalize();
  return {
    kind: "forest",
    season,
    name: season === "winter" ? "a frozen forest line in the Ardennes" : "a forest line in the Ardennes",
    objectiveName: "the forest crossroads",
    map,
    buildings,
    objective,
    line: { y: L, rowAt: lineAt },
    linePositions: linePositions.filter((p) => map.passable(p.x, p.y)),
    mgPositions: mgPositions.filter((p) => map.passable(p.x, p.y)),
    hamletPositions: hamletPositions.filter((p) => map.passable(p.x, p.y, p.z ?? 0)),
    roadX,
    hamletY,
    streamY: Math.round((L + A) / 2),
    scoutSpots,
  };
}
