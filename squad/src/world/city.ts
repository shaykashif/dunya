// A city: no hedgerows and no fields, but street after street of terraced
// houses, shops and apartment blocks, many of them knocked about already, with
// rubble, shell holes, potholes and burnt-out vehicles in the streets. The
// streets of each block-row are offset from the next, so they end in T-junctions
// that a machine gun in an upper window can sweep. The defenders hold a
// barricaded boulevard across the city (sandbags across the mouths of the
// streets, wire in front), with guns in the high windows and the church tower
// behind it, and the town hall on its square beyond. The attackers form up in
// a park on the southern edge, out of sight, and fight their way north house
// by house.
import { Rng } from "../engine/rng.ts";
import type { SimConfig } from "../scenario/config.ts";
import { GameMap } from "./map.ts";
import { shapeGround, startClearance, type Building, type BuildingKind, type Layout } from "./layout.ts";
import type { Point, Terrain } from "./types.ts";

/** Stable per-tile noise, independent of draw order. */
function hashTile(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function randInt(rng: Rng, lo: number, hi: number): number {
  return lo + rng.int(hi - lo + 1);
}

/** An east-west street: its first row of roadway and how many rows wide; a pavement either side. */
interface Street {
  y: number;
  w: number;
}

/** A band of blocks between two east-west streets, and the north-south streets that cross it. */
interface Band {
  top: number;
  bottom: number;
  /** North-south streets: first column of roadway and width; a pavement either side. */
  cols: { x: number; w: number }[];
}

const SAINTS = ["Saint-Jean", "Notre-Dame", "Saint-Pierre", "Sainte-Croix", "Saint-Gilles", "Saint-Sauveur"];

export function generateCity(cfg: SimConfig, rng: Rng): Layout {
  const W = cfg.map.width, H = cfg.map.height;
  const map = new GameMap(W, H, cfg.terrain);
  map.openCost = cfg.movement.openCost.urban;
  const deco = new Rng(Math.floor(rng.next() * 2147483646) + 1, "city");
  const set = (x: number, y: number, t: Terrain) => map.set(x, y, t);
  const at = (x: number, y: number): Terrain | null => (map.inBounds(x, y) ? map.at(x, y) : null);
  const bld = (x: number, y: number) => (map.inBounds(x, y) ? map.building[map.idx(x, y)]! : -1);
  const fill = (x0: number, y0: number, x1: number, y1: number, t: Terrain) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (map.inBounds(x, y)) set(x, y, t);
  };
  for (let i = 0; i < W * H; i++) map.terrain[i] = "paving";

  // ---- East-west streets ----
  // The defended boulevard: the sandbags across the street mouths on its north
  // side stay out of sight of the line of departure.
  const lastLine = H - 16 - startClearance(cfg) - 6;
  const L = lastLine + 1 - deco.int(4);
  const line: Street = { y: L, w: 3 };
  const boulevard: Street = { y: H - 23, w: 3 };
  const streets: Street[] = [line, boulevard];
  for (let y = L - randInt(deco, 20, 25); y >= 16; y -= randInt(deco, 20, 25)) streets.push({ y, w: 2 });
  for (let y = L + line.w + randInt(deco, 20, 25); y + 2 < boulevard.y - 16; y += randInt(deco, 20, 25)) streets.push({ y, w: 2 });
  streets.sort((a, b) => a.y - b.y);

  // ---- Bands of blocks between them, each with its own north-south streets ----
  const avenueX = Math.round(W / 2 + (deco.next() - 0.5) * 16);
  const avenue = { x: avenueX - 2, w: 4 };
  const baseCols: number[] = [];
  for (let x = 6 + deco.int(6); x < W - 10; x += randInt(deco, 26, 32)) if (Math.abs(x - avenueX) > 14) baseCols.push(x);
  const bands: Band[] = [];
  let top = 0;
  for (const st of [...streets]) {
    const bottom = st.y - 2;
    if (bottom - top >= 6) bands.push({ top, bottom, cols: [] });
    top = st.y + st.w + 1;
  }
  for (const band of bands) {
    // Old streets do not run straight: each block-row's side streets are offset from the next one's.
    const cols = [avenue];
    for (const c of baseCols) {
      const x = c + deco.int(11) - 5;
      if (Math.abs(x - avenueX) > 12 && x > 4 && x < W - 6 && cols.every((o) => Math.abs(o.x - x) > 14)) cols.push({ x, w: 2 });
    }
    band.cols = cols.sort((a, b) => a.x - b.x);
  }
  // Roadway and pavements.
  for (const st of streets) {
    fill(0, st.y - 1, W - 1, st.y + st.w, "paving");
    fill(0, st.y, W - 1, st.y + st.w - 1, "road");
  }
  for (const band of bands) {
    for (const c of band.cols) {
      fill(c.x - 1, band.top, c.x + c.w, band.bottom, "paving");
      fill(c.x, band.top - 1, c.x + c.w - 1, band.bottom + 1, "road");
    }
  }
  // The avenue runs on south through the park to the edge of the map.
  fill(avenue.x, boulevard.y, avenue.x + avenue.w - 1, H - 1, "road");

  // ---- The park on the southern edge, where the attackers form up ----
  const parkTop = boulevard.y + boulevard.w + 1;
  for (let y = parkTop; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (at(x, y) === "road") continue;
      const path = (x + y * 2) % 37 === 0 || (x - y * 2 + 400) % 41 === 0;
      set(x, y, path ? "paving" : hashTile(x, y) < 0.07 ? "woods" : hashTile(y, x) < 0.05 ? "brush" : "grass");
    }
  }

  // ---- Buildings ----
  const buildings: Building[] = [];
  const place = (kind: BuildingKind, name: string, x: number, y: number, w: number, h: number, door: "n" | "s" | "e" | "w", floors: number): Building | null => {
    if (w < 4 || h < 4) return null;
    // Never on another building, a reserved square or garden, or a street.
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (!map.inBounds(xx, yy) || bld(xx, yy) !== -1 || at(xx, yy) === "road") return null;
    const b: Building = { id: buildings.length, x, y, w, h, kind, name, floors, destroyed: false };
    buildings.push(b);
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const edge = yy === y || yy === y + h - 1 || xx === x || xx === x + w - 1;
        set(xx, yy, edge ? "building" : "floor");
        map.building[map.idx(xx, yy)] = b.id;
        map.levels[map.idx(xx, yy)] = floors;
      }
    }
    // Rooms: a wall across a deep house, one down a wide one, two down a long block; a doorway into every room.
    const open = kind === "warehouse" || kind === "church";
    const py = !open && h >= 7 ? y + Math.floor(h / 2) : -1;
    const pxs: number[] = [];
    if (!open && w >= 8) {
      if (w >= 13) pxs.push(x + Math.floor(w / 3), x + Math.floor((2 * w) / 3));
      else pxs.push(x + Math.floor(w / 2) + (deco.chance(0.5) ? 0 : -1));
    }
    for (const px of pxs) {
      for (let yy = y + 1; yy < y + h - 1; yy++) set(px, yy, "building");
      set(px, randInt(deco, y + 1, py > 0 ? py - 1 : y + h - 2), "door");
      if (py > 0) set(px, randInt(deco, py + 1, y + h - 2), "door");
    }
    if (py > 0) {
      const cuts = [x, ...pxs, x + w - 1];
      for (let xx = x + 1; xx < x + w - 1; xx++) if (!pxs.includes(xx)) set(xx, py, "building");
      for (let k = 0; k + 1 < cuts.length; k++) if (cuts[k + 1]! - cuts[k]! >= 2) set(randInt(deco, cuts[k]! + 1, cuts[k + 1]! - 1), py, "door");
    }
    // Windows every few tiles along each wall; walls against a neighbour lose theirs afterwards.
    for (let xx = x + 2; xx < x + w - 2; xx += kind === "warehouse" ? 4 : 2 + (xx % 2)) {
      set(xx, y, "window");
      set(xx, y + h - 1, "window");
    }
    for (let yy = y + 2; yy < y + h - 2; yy += 3) {
      set(x, yy, "window");
      set(x + w - 1, yy, "window");
    }
    const mid = (a: number, n: number) => a + Math.floor(n / 2) + (n >= 6 && deco.chance(0.5) ? -1 : 0);
    const front = door === "n" ? { x: mid(x, w), y } : door === "s" ? { x: mid(x, w), y: y + h - 1 } : door === "w" ? { x, y: mid(y, h) } : { x: x + w - 1, y: mid(y, h) };
    const back = door === "n" || door === "s" ? { x: x + 1 + deco.int(w - 2), y: door === "n" ? y + h - 1 : y } : { x: door === "w" ? x + w - 1 : x, y: y + 1 + deco.int(h - 2) };
    for (const d of [front, back]) {
      set(d.x, d.y, "door");
      const inward = { x: d.x + (d.x === x ? 1 : d.x === x + w - 1 ? -1 : 0), y: d.y + (d.y === y ? 1 : d.y === y + h - 1 ? -1 : 0) };
      if (at(inward.x, inward.y) === "building") set(inward.x, inward.y, "door");
    }
    if (floors > 1 && kind !== "church") {
      const corners = [{ x: x + 1, y: y + 1 }, { x: x + w - 2, y: y + 1 }, { x: x + 1, y: y + h - 2 }, { x: x + w - 2, y: y + h - 2 }];
      const ok = (p: Point) => at(p.x, p.y) === "floor" && map.neighbors4(p.x, p.y).every((q) => at(q.x, q.y) !== "door");
      const st = corners.find(ok) ?? corners.find((p) => at(p.x, p.y) === "floor") ?? corners[0]!;
      set(st.x, st.y, "stairs");
      // A big block has a second stair at the other end.
      if (w >= 12) {
        const far = corners.filter((p) => Math.abs(p.x - st.x) > 4).find(ok);
        if (far) set(far.x, far.y, "stairs");
      }
    }
    return b;
  };

  /** A church: a nave, and a bell tower over the door climbing three tall storeys to the belfry. */
  const church = (name: string, x: number, y: number, door: "n" | "s"): Building | null => {
    const b = place("church", name, x, y, 9, 14, door, 1);
    if (!b) return null;
    const t = { x: x + 4, y: door === "s" ? y + b.h - 2 : y + 1 };
    // The tower stair, not blocking the door into the nave.
    set(t.x, t.y, "stairs");
    for (const q of map.neighbors4(t.x, t.y)) if (at(q.x, q.y) === "door" && bld(q.x, q.y) === b.id && (q.x === x || q.x === x + b.w - 1 || q.y === y || q.y === y + b.h - 1)) set(q.x, q.y, "window");
    set(t.x + 1, door === "s" ? y + b.h - 1 : y, "door");
    map.levels[map.idx(t.x, t.y)] = 4;
    map.storey[map.idx(t.x, t.y)] = 5;
    return b;
  };

  /** A fountain: a round stone basin, three tiles across. */
  const fountain = (cx: number, cy: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (map.inBounds(cx + dx, cy + dy) && bld(cx + dx, cy + dy) < 0) set(cx + dx, cy + dy, "fountain");
  };
  const statue = (x: number, y: number) => {
    if (map.inBounds(x, y) && bld(x, y) < 0) set(x, y, "statue");
  };

  // The plaza and the town hall: in the second band north of the boulevard, on the avenue. The hall stands across
  // the plaza's north side, the last place the defenders will give up; a fountain plays in the middle, statues on
  // their plinths either side.
  const north = bands.filter((b) => b.bottom < L);
  const squareBand = north.length >= 2 ? north[north.length - 2]! : north[0]!;
  const sq = { x0: avenueX - 15, x1: avenueX + 15, y0: squareBand.top, y1: squareBand.bottom };
  const hallH = Math.min(11, Math.max(7, sq.y1 - sq.y0 - 8));
  // The avenue stops at the plaza: the plaza is all paving, the hall across its north side.
  fill(sq.x0, sq.y0, sq.x1, sq.y1, "paving");
  const hall = place("townhall", "the town hall", avenueX - 8, sq.y0, 17, hallH, "s", 3);
  let objective: Point = { x: avenueX, y: sq.y0 + hallH + 3 };
  if (hall) {
    // Doors on every side.
    for (const d of [{ x: hall.x, y: hall.y + Math.floor(hall.h / 2) + 1 }, { x: hall.x + hall.w - 1, y: hall.y + Math.floor(hall.h / 2) + 1 }, { x: avenueX - 4, y: hall.y + hall.h - 1 }, { x: avenueX + 4, y: hall.y + hall.h - 1 }]) {
      set(d.x, d.y, "door");
      const inward = { x: d.x + (d.x === hall.x ? 1 : d.x === hall.x + hall.w - 1 ? -1 : 0), y: d.y + (d.y === hall.y + hall.h - 1 ? -1 : 0) };
      if (at(inward.x, inward.y) === "building") set(inward.x, inward.y, "door");
    }
    // What the attackers must take: the middle of the hall itself.
    let best: Point | null = null;
    for (let y = hall.y + 1; y < hall.y + hall.h - 1; y++) for (let x = hall.x + 1; x < hall.x + hall.w - 1; x++) if (at(x, y) === "floor" && (!best || Math.hypot(x - avenueX, y - (hall.y + hall.h / 2)) < Math.hypot(best.x - avenueX, best.y - (hall.y + hall.h / 2)))) best = { x, y };
    if (best) objective = best;
  }
  const plazaMid = Math.round((sq.y0 + hallH + sq.y1) / 2);
  fountain(avenueX, plazaMid);
  statue(sq.x0 + 4, plazaMid);
  statue(sq.x1 - 4, plazaMid);
  for (let y = sq.y0; y <= sq.y1; y++) for (let x = sq.x0; x <= sq.x1; x++) if (bld(x, y) === -1) map.building[map.idx(x, y)] = -2;

  // The defenders' church faces the boulevard, a block off the avenue: its tower looks straight down the streets beyond.
  const lineBand = north[north.length - 1]!;
  const sideCols = lineBand.cols.filter((c) => c !== avenue);
  let churchB: Building | null = null;
  for (const c of [...sideCols].sort((a, b) => Math.abs(a.x - avenueX) - Math.abs(b.x - avenueX))) {
    for (const dx of [c.w + 2, -11]) {
      const x = c.x + dx;
      const y = lineBand.bottom - 13;
      if (y < lineBand.top || Math.abs(x - avenueX) < 8) continue;
      churchB = church(`the church of ${SAINTS[deco.int(3)]}`, x, y, "s");
      if (churchB) break;
    }
    if (churchB) break;
  }

  // A public garden behind the town hall, where the defenders' mortar can stand.
  const gardenBand = north.length >= 3 ? north[north.length - 3]! : null;
  if (gardenBand) {
    for (let y = gardenBand.top; y <= gardenBand.bottom; y++) {
      for (let x = avenueX + 4; x <= avenueX + 22; x++) {
        if (!map.inBounds(x, y) || at(x, y) === "road" || bld(x, y) >= 0) continue;
        set(x, y, hashTile(x, y) < 0.1 ? "woods" : "grass");
        map.building[map.idx(x, y)] = -2;
      }
    }
  }

  // A warehouse in one of the southern bands, and a chapel further on.
  const south = bands.filter((b) => b.top > L + 2);
  const depotBand = south.length > 0 ? south[Math.floor(south.length / 2)]! : null;
  let chapel: Building | null = null;

  // Blocks: terraced rows along each street, yards behind them; here and there an open-air market or a little plaza instead.
  let markets = 0, plazas = 0;
  const reserve = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (bld(x, y) === -1) map.building[map.idx(x, y)] = -2;
  };
  for (const band of bands) {
    const edges = [-1, ...band.cols.flatMap((c) => [c.x - 1, c.x + c.w]), W];
    for (let k = 0; k + 1 < edges.length; k += 2) {
      const bx0 = edges[k]! + 1, bx1 = edges[k + 1]! - 1;
      if (bx1 - bx0 < 5) continue;
      const bh = band.bottom - band.top + 1;
      const onAvenue = bx1 + 2 >= avenue.x - 1 && bx0 - 2 <= avenue.x + avenue.w;
      if (band === depotBand && !onAvenue && !buildings.some((b) => b.kind === "warehouse") && bx1 - bx0 >= 16 && bh >= 12) {
        place("warehouse", "the warehouse", bx0 + 1, band.top + 1, Math.min(22, bx1 - bx0 - 1), bh - 3, "s", 2);
        continue;
      }
      if (!chapel && south.length >= 2 && band === south[south.length - 1] && !onAvenue && bx1 - bx0 >= 12 && bh >= 15) {
        chapel = church(`the chapel of ${SAINTS[3 + deco.int(3)]}`, bx0 + 2, band.top, "n");
        if (chapel) continue;
      }
      const special = !onAvenue && band !== lineBand && band !== squareBand && bx1 - bx0 >= 14 && bh >= 12;
      if (special && markets < 2 && deco.chance(0.2)) {
        // An open-air market: rows of stalls under striped awnings, aisles between.
        markets++;
        fill(bx0, band.top, bx1, band.bottom, "paving");
        for (let y = band.top + 2; y <= band.bottom - 2; y += 3) for (let x = bx0 + 2; x <= bx1 - 2; x++) if ((x - bx0) % 5 < 3) set(x, y, "stall");
        statue(Math.round((bx0 + bx1) / 2), band.top + 1);
        reserve(bx0, band.top, bx1, band.bottom);
        continue;
      }
      if (special && plazas < 3 && deco.chance(0.16)) {
        // A little plaza: a fountain or a statue, plane trees round the edge.
        plazas++;
        fill(bx0, band.top, bx1, band.bottom, "paving");
        const cx = Math.round((bx0 + bx1) / 2), cy = Math.round((band.top + band.bottom) / 2);
        if (deco.chance(0.5)) fountain(cx, cy);
        else statue(cx, cy);
        for (let x = bx0 + 1; x <= bx1 - 1; x += 4) {
          set(x, band.top + 1, "woods");
          set(x, band.bottom - 1, "woods");
        }
        reserve(bx0, band.top, bx1, band.bottom);
        continue;
      }
      // Alleys right through the block, between the yards from one street to the next.
      const alleys: number[] = [];
      for (let ax = bx0 + 6 + deco.int(6); ax + 7 < bx1; ax += 14 + deco.int(10)) if (deco.chance(0.55)) alleys.push(ax);
      const inAlley = (x: number) => alleys.some((a) => x >= a && x <= a + 1);
      const rows: { y: number; h: number; door: "n" | "s" }[] = [];
      if (bh >= 13) {
        const dN = randInt(deco, 5, 7), dS = randInt(deco, 5, 7);
        rows.push({ y: band.top, h: dN, door: "n" }, { y: band.bottom - dS + 1, h: dS, door: "s" });
        // Back yards between, split by garden walls with gates.
        const wy = band.top + dN + Math.floor((bh - dN - dS) / 2);
        for (let x = bx0; x <= bx1; x++) {
          for (let y = band.top + dN; y <= band.bottom - dS; y++) if (bld(x, y) === -1 && at(x, y) === "paving") set(x, y, hashTile(x, y) < 0.7 ? "grass" : "paving");
          if (bh - dN - dS >= 3 && hashTile(x, wy) > 0.18 && bld(x, wy) === -1 && !inAlley(x)) set(x, wy, "wall");
        }
      } else rows.push({ y: band.top, h: bh, door: band.bottom + 2 >= L ? "s" : "n" });
      for (const row of rows) {
        let x = bx0;
        while (x + 4 <= bx1) {
          if (inAlley(x)) {
            x++;
            continue;
          }
          const apt = deco.chance(0.24);
          let w = Math.min(bx1 - x + 1, apt ? randInt(deco, 9, 13) : randInt(deco, 5, 9));
          if (bx1 - (x + w) + 1 < 5) w = bx1 - x + 1;
          // Stop short of an alley.
          const next = alleys.find((a) => a >= x && a < x + w);
          if (next !== undefined) {
            w = next - x;
            if (w < 4) {
              x = next + 2;
              continue;
            }
          }
          const facesSquare = row.y + row.h - 1 >= sq.y0 - 2 && row.y <= sq.y1 + 2 && x + w >= sq.x0 - 2 && x <= sq.x1 + 2;
          const kind: BuildingKind = apt ? "apartment" : onAvenue || facesSquare ? (deco.chance(0.65) ? "shop" : "house") : "house";
          const floors = kind === "apartment" ? randInt(deco, 3, 4) : kind === "shop" ? randInt(deco, 2, 3) : deco.chance(0.55) ? 2 : 3;
          const name = kind === "apartment" ? "an apartment block" : kind === "shop" ? (deco.chance(0.3) ? "a café" : "a shop") : "a town house";
          place(kind, name, x, row.y, w, row.h, row.door, floors);
          // Terraced, wall to wall, with now and then an alley through to the yards.
          x += w + (deco.chance(0.18) ? 1 + deco.int(2) : 0);
        }
      }
    }
  }

  // Party walls: where two houses stand wall to wall, they lose their windows, and many have a doorway knocked through, on every floor.
  for (const b of buildings) {
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        const t = at(x, y);
        if (t !== "window" && t !== "door") continue;
        if (!(x === b.x || y === b.y || x === b.x + b.w - 1 || y === b.y + b.h - 1)) continue;
        const out = map.neighbors4(x, y).filter((q) => bld(q.x, q.y) !== b.id);
        if (out.some((q) => bld(q.x, q.y) >= 0)) set(x, y, "building");
      }
    }
  }
  const byId = (id: number) => buildings[id]!;
  for (const a of buildings) {
    if (a.kind === "church" || a.kind === "townhall") continue;
    const ex = a.x + a.w - 1;
    const right = bld(ex + 1, a.y + 1);
    if (right < 0 || !deco.chance(0.6)) continue;
    const b = byId(right);
    if (b.kind === "church" || b.kind === "townhall") continue;
    const ys: number[] = [];
    for (let y = Math.max(a.y, b.y) + 1; y <= Math.min(a.y + a.h, b.y + b.h) - 2; y++) if (at(ex - 1, y) === "floor" && at(ex + 2, y) === "floor" && at(ex, y) === "building" && at(ex + 1, y) === "building") ys.push(y);
    if (ys.length === 0) continue;
    const y = ys[deco.int(ys.length)]!;
    set(ex, y, "door");
    set(ex + 1, y, "door");
  }

  // ---- Damage: the city has been fought over and shelled already ----
  const ruined: Building[] = [];
  for (const b of buildings) {
    if (b.kind === "church" || b.kind === "townhall") continue;
    const southOfLine = b.y > L;
    const roll = deco.next();
    if (roll < (southOfLine ? 0.13 : 0.06)) {
      // Fallen in: roof and floors down, heaps of rubble, a few walls standing.
      b.destroyed = true;
      ruined.push(b);
      for (let y = b.y; y < b.y + b.h; y++) {
        for (let x = b.x; x < b.x + b.w; x++) {
          const i = map.idx(x, y);
          map.levels[i] = 1;
          const edge = x === b.x || y === b.y || x === b.x + b.w - 1 || y === b.y + b.h - 1;
          if ((edge && deco.chance(0.5)) || (!edge && (map.terrain[i] === "stairs" || deco.chance(0.45)))) map.terrain[i] = "rubble";
          map.blastMark(x, y, 4 + deco.int(4));
        }
      }
    } else if (roll < (southOfLine ? 0.42 : 0.25)) {
      // Knocked about: a breach or two in the walls, scorched floors.
      const n = 1 + deco.int(3);
      for (let k = 0; k < n; k++) {
        const xx = b.x + 1 + deco.int(b.w - 2), yy = deco.chance(0.5) ? b.y : b.y + b.h - 1;
        if (at(xx, yy) === "building" || at(xx, yy) === "window") set(xx, yy, "rubble");
      }
      for (let k = 0; k < 4; k++) map.blastMark(b.x + deco.int(b.w), b.y + deco.int(b.h), 2 + deco.int(4));
    }
  }
  // Rubble spilled into the street in front of the ruins and the breaches.
  const streetish = (t: Terrain | null) => t === "road" || t === "paving";
  for (const b of buildings) {
    for (let x = b.x; x < b.x + b.w; x++) {
      for (const [y, dy] of [[b.y, -1], [b.y + b.h - 1, 1]] as const) {
        if (at(x, y) !== "rubble" && !b.destroyed) continue;
        for (let k = 1; k <= (b.destroyed ? 3 : 1); k++) {
          if (streetish(at(x, y + dy * k)) && deco.chance(b.destroyed ? 0.7 / k : 0.5)) set(x, y + dy * k, "rubble");
        }
      }
    }
  }

  // ---- Barricades on the boulevard: sandbags across the mouth of every street, wire in front ----
  const linePositions: Point[] = [];
  const mgPositions: Point[] = [];
  const hamletPositions: Point[] = [];
  const sandbag = (x: number, y: number) => {
    const t = at(x, y);
    if (t === "road" || t === "paving" || t === "grass" || t === "rubble" || t === "pothole") set(x, y, "sandbags");
  };
  const wireAt = (x: number, y: number) => {
    const t = at(x, y);
    if (t === "road" || t === "paving" || t === "grass") set(x, y, "wire");
  };
  for (const c of lineBand.cols) {
    const x0 = c.x - 1, x1 = c.x + c.w;
    const gapLeft = deco.chance(0.5);
    for (let x = x0; x <= x1; x++) {
      if ((gapLeft && x === x0) || (!gapLeft && x === x1)) continue;
      sandbag(x, L - 1);
      if (at(x, L - 2) === "road" || at(x, L - 2) === "paving") linePositions.push({ x, y: L - 2 });
    }
    mgPositions.push({ x: Math.round((x0 + x1) / 2), y: L - 2 });
  }
  // Wire across the boulevard, in staggered lengths with gaps between.
  for (let x = 2; x < W - 2; ) {
    const len = randInt(deco, 4, 9);
    const y = L + 1 + (deco.chance(0.5) ? 0 : 1);
    if (deco.chance(0.65)) for (let k = 0; k < len; k++) wireAt(x + k, y);
    x += len + randInt(deco, 2, 6);
  }
  // A second line round the square: sandbags at its corners and across the avenue, wire at the street ends.
  for (const [x, y] of [[sq.x0 + 1, sq.y1 - 1], [sq.x1 - 1, sq.y1 - 1], [sq.x0 + 1, sq.y0 + hallH + 1], [sq.x1 - 1, sq.y0 + hallH + 1]] as const) {
    for (let k = -1; k <= 1; k++) {
      sandbag(x + k, y);
      sandbag(x, y + k);
    }
    hamletPositions.push({ x: x + (x < avenueX ? 1 : -1), y: y - 1 });
  }
  for (let x = avenueX - 3; x <= avenueX + 3; x++) if (x !== avenueX) sandbag(x, sq.y1);
  hamletPositions.push({ x: avenueX - 2, y: sq.y1 - 1 }, { x: avenueX + 2, y: sq.y1 - 1 });
  // Machine-gun nests at crossings behind the line, and a few abandoned ones out in front.
  const nest = (x: number, y: number, facing: number): boolean => {
    if (!streetish(at(x, y)) || !streetish(at(x - 1, y + facing)) || !streetish(at(x + 1, y + facing))) return false;
    for (const dx of [-1, 0, 1]) sandbag(x + dx, y + facing);
    sandbag(x - 1, y);
    sandbag(x + 1, y);
    return true;
  };
  for (const st of streets) {
    if (st.y >= L) continue;
    for (const c of bands.find((b) => b.top === st.y + st.w + 1)?.cols ?? []) {
      if (deco.chance(0.5) && nest(c.x + Math.floor(c.w / 2), st.y + st.w + 1, 1)) hamletPositions.push({ x: c.x + Math.floor(c.w / 2), y: st.y + st.w + 1 });
    }
  }
  for (let k = 0; k < 9; k++) {
    const x = 6 + deco.int(W - 12), y = L + 8 + deco.int(Math.max(1, boulevard.y - L - 14));
    nest(x, y, deco.chance(0.5) ? 1 : -1);
  }
  // Odd coils of wire across side streets and pavements out in front.
  for (let k = 0; k < 12; k++) {
    const x = 4 + deco.int(W - 8), y = L + 8 + deco.int(Math.max(1, boulevard.y - L - 12));
    const horiz = deco.chance(0.5);
    for (let j = 0; j < 4; j++) wireAt(x + (horiz ? j : 0), y + (horiz ? 0 : j));
  }

  // ---- Burnt-out vehicles at the kerb, shell holes, potholes and heaps of rubble ----
  const wreckOK = (x: number, y: number) => at(x, y) === "road" && bld(x, y) === -1;
  let wrecks = 0;
  for (let k = 0; k < 260 && wrecks < 28; k++) {
    const vertical = deco.chance(0.5);
    const len = deco.chance(0.4) ? 3 : 2;
    const band = bands[deco.int(bands.length)]!;
    // Pulled in at the kerb, along the street, never at a crossing: the other lane and the pavement stay open.
    let tiles: Point[] = [];
    let curb: Point;
    if (vertical) {
      const c = band.cols[deco.int(band.cols.length)]!;
      const x = deco.chance(0.5) ? c.x : c.x + c.w - 1;
      const y = band.top + 2 + deco.int(Math.max(1, band.bottom - band.top - 4 - len));
      tiles = Array.from({ length: len }, (_, j) => ({ x, y: y + j }));
      curb = { x: x === c.x ? -1 : 1, y: 0 };
    } else {
      const st = streets[deco.int(streets.length)]!;
      if (st === boulevard && deco.chance(0.5)) continue;
      const y = deco.chance(0.5) ? st.y : st.y + st.w - 1;
      const x = 3 + deco.int(W - 6 - len);
      tiles = Array.from({ length: len }, (_, j) => ({ x: x + j, y }));
      curb = { x: 0, y: y === st.y ? -1 : 1 };
    }
    if (!tiles.every((p) => wreckOK(p.x, p.y) && wreckOK(p.x - curb.x, p.y - curb.y) && at(p.x + curb.x, p.y + curb.y) === "paving" && bld(p.x + curb.x, p.y + curb.y) === -1)) continue;
    for (const p of tiles) set(p.x, p.y, "wreck");
    wrecks++;
  }
  for (let k = 0; k < 55; k++) {
    const x = deco.int(W), y = L + 4 + deco.int(Math.max(1, boulevard.y - L - 4));
    const t = at(x, y);
    if (t === "road" || t === "paving" || t === "grass") set(x, y, "crater");
  }
  // Debris everywhere: fallen masonry, burnt timbers, smashed furniture thrown out of windows, abandoned carts, bicycles, glass.
  for (let k = 0; k < 900; k++) {
    const x = deco.int(W), y = deco.int(boulevard.y);
    if (!streetish(at(x, y)) || bld(x, y) !== -1) continue;
    const n = 1 + deco.int(3);
    for (let j = 0; j < n; j++) {
      const xx = x + deco.int(3) - 1, yy = y + deco.int(3) - 1;
      if (streetish(at(xx, yy)) && bld(xx, yy) === -1) set(xx, yy, "debris");
    }
  }
  // Clutter along the foot of every wall: what blew out of the houses lies on the pavement below.
  for (let y = 1; y < boulevard.y; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (at(x, y) !== "paving" || bld(x, y) !== -1 || !map.neighbors4(x, y).some((q) => bld(q.x, q.y) >= 0)) continue;
      if (hashTile(x * 13, y * 17) < 0.12) set(x, y, "debris");
    }
  }
  // Potholes where the cobbles are broken, shell-blasted and never mended.
  for (let k = 0; k < 360; k++) {
    const x = deco.int(W), y = deco.int(boulevard.y);
    if (at(x, y) === "road") set(x, y, "pothole");
  }
  for (let k = 0; k < 40; k++) {
    const x = deco.int(W), y = deco.int(boulevard.y);
    if (!streetish(at(x, y))) continue;
    const r = 1 + deco.int(2);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (streetish(at(x + dx, y + dy)) && Math.hypot(dx, dy) <= r + 0.3 && deco.chance(0.7)) set(x + dx, y + dy, "rubble");
  }
  // Walls pocked by old fighting, worse nearer the line.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = map.idx(x, y);
      const t = map.terrain[i]!;
      if (t !== "building" && t !== "window" && t !== "door") continue;
      if (!map.neighbors4(x, y).some((q) => bld(q.x, q.y) < 0)) continue;
      const near = Math.max(0, 1 - Math.abs(y - L) / 60);
      if (hashTile(x * 7, y * 3) < 0.25 + 0.5 * near) map.holes[i] = Math.floor(hashTile(y, x * 5) * (4 + 26 * near));
    }
  }
  for (let i = 0; i < W * H; i++) if (map.building[i] === -2) map.building[i] = -1;

  // ---- The lie of the land: a gentle rise to the north, every house level ----
  shapeGround(map, "urban", rng, { lineRow: L, startRow: H - 13, hamletY: objective.y, streamAt: [], roadX: [], buildings, objective });
  for (let i = 0; i < W * H; i++) map.wallHp[i] = cfg.destruction.wallHp[map.terrain[i]!] ?? 0;
  map.finalize();

  // ---- Firing positions ----
  const insideSouthWindows = (b: Building): Point[] => {
    const out: Point[] = [];
    for (let x = b.x + 1; x < b.x + b.w - 1; x++) {
      if (at(x, b.y + b.h - 1) !== "window") continue;
      for (let z = 0; z < map.levels[map.idx(x, b.y + b.h - 2)]!; z++) if (map.passable(x, b.y + b.h - 2, z)) out.push(z > 0 ? { x, y: b.y + b.h - 2, z } : { x, y: b.y + b.h - 2 });
    }
    return out;
  };
  const belfry = (b: Building): Point | null => {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (map.isTower(x, y)) return { x, y, z: map.levels[map.idx(x, y)]! - 1 };
    return null;
  };
  /** How much of the street ground to the south a spot sees: the measure of a chokepoint. */
  const streetView = (p: Point): number => {
    let n = 0;
    for (let dy = 8; dy <= 64; dy += 4) {
      for (let dx = -12; dx <= 12; dx += 4) {
        const x = p.x + dx, y = p.y + dy;
        if (!map.inBounds(x, y) || !streetish(at(x, y))) continue;
        if (map.visibility(p.x, p.y, x, y, null, p.z ?? 0, 0) >= 0.3) n++;
      }
    }
    return n;
  };
  const front = buildings.filter((b) => !b.destroyed && b.y + b.h - 1 === L - 2);
  for (const b of front) linePositions.push(...insideSouthWindows(b));
  const high: { p: Point; v: number }[] = [];
  for (const b of buildings.filter((x) => !x.destroyed && x.y + x.h - 1 <= L - 2 && x.y + x.h - 1 >= L - 40 && x.floors >= 2)) {
    for (const p of insideSouthWindows(b)) if ((p.z ?? 0) >= 1) high.push({ p, v: streetView(p) + (p.z ?? 0) * 0.5 });
  }
  high.sort((a, b) => b.v - a.v || a.p.x - b.p.x);
  for (const h of high) {
    if (mgPositions.filter((q) => (q.z ?? 0) > 0).length >= 10) break;
    if (h.v < 4) break;
    if (mgPositions.every((q) => Math.abs(q.x - h.p.x) >= 8)) mgPositions.push(h.p);
  }
  if (churchB) {
    const top = belfry(churchB);
    if (top) {
      mgPositions.push(top);
      hamletPositions.push(top);
    }
  }
  for (const b of buildings) if (!b.destroyed && b.y + b.h - 1 <= L - 2) hamletPositions.push(...insideSouthWindows(b));

  // ---- Where forward observers can lie up: a dark room by a south window, ahead of the line ----
  const scoutSpots: Point[] = [];
  {
    const lastRow = H - 8 - startClearance(cfg);
    const cands: { p: Point; s: number }[] = [];
    for (const b of buildings) {
      if (b.destroyed || b.y < L + 4 || b.y + b.h - 2 > lastRow) continue;
      for (const p of insideSouthWindows(b)) if ((p.z ?? 0) === 0) cands.push({ p, s: hashTile(p.x, p.y) * 0.3 - Math.abs(p.x - avenueX) / W });
    }
    cands.sort((a, b) => b.s - a.s);
    for (const c of cands) {
      if (scoutSpots.length >= 4) break;
      if (scoutSpots.every((q) => Math.hypot(q.x - c.p.x, q.y - c.p.y) >= 42)) scoutSpots.push(c.p);
    }
    scoutSpots.sort((a, b) => a.x - b.x);
  }

  return {
    kind: "urban",
    name: "a shell-torn city",
    objectiveName: hall ? "the town hall" : "the square",
    map,
    buildings,
    objective,
    line: { y: L - 1, rowAt: new Array<number>(W).fill(L - 1) },
    linePositions: linePositions.filter((p) => map.passable(p.x, p.y, p.z ?? 0)),
    mgPositions: mgPositions.filter((p) => map.passable(p.x, p.y, p.z ?? 0)),
    hamletPositions: hamletPositions.filter((p) => map.passable(p.x, p.y, p.z ?? 0)),
    roadX: new Array<number>(H).fill(avenueX),
    hamletY: objective.y,
    streamY: Math.min(H - 30, L + 40),
    scoutSpots,
  };
}
