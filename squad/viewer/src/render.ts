// Draws the battlefield: bocage terrain, the hamlet, soldiers, smoke, tracers
// and explosions, and the overlays (orders, sight lines, names).
import { cannotWalk } from "../../src/entities/body.ts";
import type { Building } from "../../src/world/layout.ts";
import type { Soldier, Terrain } from "../../src/world/types.ts";
import type { World } from "../../src/world/world.ts";
import { blastShake, drawBlast, drawCollapse, drawDebris, shotShake, drawSmokeCloud, dustSpurt, muzzleFlash, shellShadow, smokePop } from "./fx.ts";
import { Flora, buildingBounds, wallHeight, buildingShadow, buildingSprite, groundShadow, pick, type Prop } from "./scenery.ts";
import { blastStep, holeStep } from "../../src/world/map.ts";
import { SIDE_COLORS, TILE, hash2, soldierSprite } from "./sprites.ts";

export interface ViewOptions {
  roofs: boolean;
  names: boolean;
  orders: boolean;
  sight: boolean;
  chronicle: boolean;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export type Effect =
  | { kind: "tracer"; x0: number; y0: number; x1: number; y1: number; color: string; born: number; dur: number; delay: number; by?: number }
  | { kind: "flash"; x: number; y: number; born: number; dur: number; delay: number; r: number; by?: number }
  | { kind: "puff"; x: number; y: number; born: number; dur: number; delay: number; color: string }
  | { kind: "boom"; x: number; y: number; born: number; dur: number; delay: number; size: number; seed: number }
  | { kind: "pop"; x: number; y: number; born: number; dur: number; delay: number; seed: number }
  | { kind: "arc"; x0: number; y0: number; x1: number; y1: number; born: number; dur: number; delay: number; smoke: boolean }
  | { kind: "shell"; x: number; y: number; born: number; dur: number; delay: number }
  | { kind: "debris"; x: number; y: number; born: number; dur: number; delay: number; seed: number; stuff: number }
  | { kind: "collapse"; x: number; y: number; w: number; h: number; born: number; dur: number; delay: number; seed: number }
  | { kind: "signal"; x0: number; y0: number; x1: number; y1: number; born: number; dur: number; delay: number; color: string }
  | { kind: "round"; x0: number; y0: number; x1: number; y1: number; born: number; dur: number; delay: number }
  | { kind: "text"; x: number; y: number; text: string; color: string; born: number; dur: number; delay: number; follow: number | null };

const BASE: Record<Terrain, string> = {
  grass: "#5d8a3a",
  wheat: "#c4a44a",
  road: "#9a8058",
  orchard: "#5a8a3c",
  woods: "#4a7a32",
  hedge: "#5d8a3a",
  wall: "#8a8a82",
  building: "#6e6458",
  floor: "#8a6a48",
  door: "#5a3a20",
  window: "#6e6458",
  water: "#3a6a9a",
  bridge: "#8a6a48",
  rubble: "#7a7266",
  crater: "#5d8a3a",
  foxhole: "#5d8a3a",
  stairs: "#8a6a48",
  marsh: "#4e7a46",
  brush: "#58843a",
  ditch: "#4a6a30",
  deadfall: "#5a6a3a",
};

/** Tiles to a side of one grid square: lettered west to east, numbered north to south. */
export const GRID = 16;

/** The grid square a tile lies in, as a map reference reads it: "C4". */
export function gridSquare(x: number, y: number): string {
  return `${String.fromCharCode(65 + Math.floor(x / GRID))}${Math.floor(y / GRID) + 1}`;
}

/** Colours for the minimap. */
export const MINI: Record<Terrain, string> = { ...BASE, deadfall: "#4a4a30", hedge: "#24481e", woods: "#2a5022", orchard: "#4a7a30", building: "#4a4038", window: "#4a4038", crater: "#5a4630", foxhole: "#3a2e20", brush: "#3e6a2c", ditch: "#3a5426", marsh: "#4a6e5a" };

let flora: Flora | undefined;

interface Placed {
  p: Prop;
  x: number;
  y: number;
  /** The tile it grows on. */
  i: number;
}

/** One tile of ground: its colour, texture and anything dug into it. */
function drawTile(g: CanvasRenderingContext2D, w: World, tx: number, ty: number): void {
  const px = (x: number, y: number, col: string, ww = 1, hh = 1) => {
    g.fillStyle = col;
    g.fillRect(x, y, ww, hh);
  };
  const t = w.map.at(tx, ty);
  const x = tx * TILE, y = ty * TILE;
  px(x, y, BASE[t], TILE, TILE);
  const r = (k: number) => hash2(tx, ty, k);
  switch (t) {
    case "grass":
    case "orchard":
    case "hedge":
    case "crater":
    case "foxhole":
      for (let k = 0; k < 6; k++) px(x + Math.floor(r(k) * 16), y + Math.floor(r(k + 9) * 16), r(k + 20) < 0.5 ? "#6a9a42" : "#507a32", 1, 2);
      // Tufts of grass and a few wild flowers.
      if (r(30) < 0.35) {
        const gx = x + 2 + Math.floor(r(31) * 11), gy = y + 3 + Math.floor(r(32) * 10);
        px(gx, gy + 1, "#3e6a28", 3, 1);
        px(gx, gy - 1, "#7aae4a", 1, 2);
        px(gx + 2, gy - 1, "#7aae4a", 1, 2);
        px(gx + 1, gy - 2, "#8cc056", 1, 3);
      }
      if (t === "grass" && r(33) < 0.06) {
        const fx = x + 3 + Math.floor(r(34) * 10), fy = y + 3 + Math.floor(r(35) * 10);
        const fc = r(36) < 0.4 ? "#f4f0e0" : r(36) < 0.7 ? "#f0d040" : r(36) < 0.85 ? "#c04a40" : "#9a7ad0";
        px(fx, fy, fc);
        px(fx + 2, fy + 1, fc);
        px(fx + 1, fy + 3, fc);
      }
      break;
    case "brush":
      for (let k = 0; k < 6; k++) px(x + Math.floor(r(k) * 16), y + Math.floor(r(k + 9) * 16), r(k + 20) < 0.5 ? "#6a9a42" : "#4a7430", 1, 2);
      break;
    case "marsh":
      // Tussocks and standing water.
      for (let k = 0; k < 3; k++) px(x + Math.floor(r(k) * 12), y + Math.floor(r(k + 5) * 14), "#5a8aa8", 4, 1);
      for (let k = 0; k < 5; k++) {
        const rx = x + Math.floor(r(k + 30) * 15), ry = y + 2 + Math.floor(r(k + 40) * 12);
        px(rx, ry - 2, "#7aa04a", 1, 3);
        px(rx + 1, ry - 1, "#6a8a3a", 1, 2);
      }
      break;
    case "ditch":
      // A trench of wet earth between grassy lips.
      px(x, y + 3, "#3e5a28", 16, 10);
      px(x, y + 5, "#4a3a26", 16, 6);
      px(x, y + 7, "#3a5a6a", 16, 2);
      for (let k = 0; k < 4; k++) px(x + Math.floor(r(k) * 15), y + 3, "#6a9a42", 1, 2);
      break;
    case "stairs":
      for (let row = 0; row < 16; row += 4) px(x, y + row, "#7a5a3a", 16, 1);
      for (let k = 0; k < 4; k++) {
        px(x + 2, y + 2 + k * 3, "#a88660", 12, 2);
        px(x + 2, y + 4 + k * 3, "#5a3e24", 12, 1);
      }
      break;
    case "deadfall": {
      // Shattered trees: stumps, splintered trunks lying every which way, torn-up earth.
      for (let k = 0; k < 5; k++) px(x + Math.floor(r(k) * 15), y + Math.floor(r(k + 9) * 15), r(k + 20) < 0.5 ? "#4a3a26" : "#6a8a3a", 2, 1);
      const sx = x + 3 + Math.floor(r(50) * 8), sy = y + 4 + Math.floor(r(51) * 6);
      px(sx, sy, "#3a2a1a", 4, 4);
      px(sx + 1, sy - 2, "#5a4028", 2, 3);
      px(sx + 1, sy, "#c8a878", 2, 1);
      const lx = x + Math.floor(r(53) * 6), ly = y + 2 + Math.floor(r(54) * 10);
      if (r(52) < 0.5) {
        px(lx, ly, "#2e2216", 10, 3);
        px(lx, ly, "#6a4a2c", 10, 1);
        px(lx + 10, ly, "#d8b888", 1, 3);
      } else {
        px(lx + 4, ly - 4, "#2e2216", 3, 8);
        px(lx + 4, ly - 4, "#6a4a2c", 1, 8);
      }
      for (let k = 0; k < 3; k++) px(x + Math.floor(r(k + 60) * 14), y + Math.floor(r(k + 63) * 14), "#3e6a28", 2, 2);
      break;
    }
    case "wheat":
      for (let row = 1; row < 16; row += 3) px(x, y + row, "#a88a38", 16, 1);
      for (let k = 0; k < 7; k++) px(x + Math.floor(r(k) * 16), y + Math.floor(r(k + 9) * 16), "#e0c870", 1, 1);
      break;
    case "road":
    case "bridge":
      if (t === "road") {
        px(x, y + 4, "#8a7048", 16, 1);
        px(x, y + 11, "#8a7048", 16, 1);
        for (let k = 0; k < 3; k++) px(x + Math.floor(r(k) * 15), y + Math.floor(r(k + 5) * 15), "#b09a70", 2, 1);
      } else for (let row = 0; row < 16; row += 4) px(x, y + row, "#6a4a30", 16, 1);
      break;
    case "water":
      for (let k = 0; k < 3; k++) px(x + Math.floor(r(k) * 12), y + Math.floor(r(k + 5) * 15), "#5a8aba", 4, 1);
      break;
    case "floor":
      for (let row = 0; row < 16; row += 4) px(x, y + row, "#7a5a3a", 16, 1);
      break;
    case "wall":
      px(x, y + 3, "#9a9a92", 16, 9);
      px(x, y + 7, "#6a6a62", 16, 1);
      for (let k = 0; k < 16; k += 5) px(x + k + (ty % 2) * 2, y + 3, "#6a6a62", 1, 4);
      px(x, y + 12, "#4a4a42", 16, 2);
      break;
    case "building":
    case "window":
      for (let row = 0; row < 16; row += 4) px(x, y + row, "#5a5248", 16, 1);
      for (let k = 0; k < 4; k++) px(x + ((k * 5 + ty * 3) % 16), y + k * 4, "#5a5248", 1, 4);
      if (t === "window") {
        px(x + 3, y + 3, "#2a3440", 10, 10);
        px(x + 4, y + 4, "#4a6070", 3, 3);
      }
      break;
    case "door":
      px(x + 2, y + 1, "#3a2414", 12, 14);
      break;
    case "rubble":
      for (let k = 0; k < 8; k++) px(x + Math.floor(r(k) * 14), y + Math.floor(r(k + 9) * 14), r(k + 3) < 0.5 ? "#9a9288" : "#5a544a", 3, 2);
      break;
    default:
      break;
  }
  if (t === "crater") {
    // A shell hole: a lip of thrown-up earth round a dark pit.
    for (let yy = -6; yy <= 6; yy++) {
      const half = Math.round(7 * Math.sqrt(1 - (yy / 6.5) ** 2));
      px(x + 8 - half, y + 8 + yy, yy < 0 ? "#7a6040" : "#5e4a30", half * 2, 1);
    }
    for (let yy = -4; yy <= 4; yy++) {
      const half = Math.round(5 * Math.sqrt(1 - (yy / 4.5) ** 2));
      px(x + 8 - half, y + 9 + yy, yy < -1 ? "#2e2418" : "#3e3222", half * 2, 1);
    }
    px(x + 4, y + 2, "#8a7050", 3, 1);
    px(x + 10, y + 3, "#8a7050", 2, 1);
  } else if (t === "foxhole") {
    px(x + 2, y + 3, "#7a6040", 12, 10);
    px(x + 4, y + 5, "#2a2218", 8, 6);
  }
  // A house wall seen with its roof off shows its height on the open side.
  if ((t === "building" || t === "window") && ty + 1 < w.map.height) {
    const below = w.map.at(tx, ty + 1);
    if (below !== "building" && below !== "window" && below !== "door" && below !== "rubble") {
      px(x, y + 11, "#8a8274", 16, 5);
      px(x, y + 13, "#6e665a", 16, 1);
      for (let k = (ty * 3) % 6; k < 16; k += 6) px(x + k, y + 11, "#6e665a", 1, 2);
      px(x, y + 15, "#3a342c", 16, 1);
    }
  }
  // Hedgerows: an earthen bank under the bushes.
  if (t === "hedge") {
    px(x, y + 3, "#6a5638", TILE, TILE - 4);
    px(x, y + TILE - 3, "#4e3e26", TILE, 2);
    for (let k = 0; k < 3; k++) px(x + Math.floor(hash2(tx, ty, k + 70) * 15), y + 4 + Math.floor(hash2(tx, ty, k + 80) * 8), "#806a48", 2, 1);
  }
  terrace(g, w, tx, ty);
  // Bullet holes pocking a wall.
  const holes = holeStep(w.map.holes[w.map.idx(tx, ty)]!);
  if (holes > 0 && (t === "building" || t === "window" || t === "door" || t === "wall")) {
    for (let k = 0; k < holes * 4; k++) {
      const hx = x + 1 + Math.floor(hash2(tx, ty, k + 200) * 14), hy = y + (t === "wall" ? 3 : 1) + Math.floor(hash2(tx, ty, k + 230) * (t === "wall" ? 9 : 14));
      px(hx, hy, "#1e1a16");
      px(hx + 1, hy, "#d8d0bc");
    }
  }
}

/** Height in steps, for the terraced look. */
const STEP = 1.25;
function levelAt(w: World, x: number, y: number): number {
  return Math.floor(w.map.elev[w.map.idx(x, y)]! / STEP);
}

/**
 * Ground drawn as terraces, the way an isometric map shows height: where the
 * land steps down to the south, the higher ground's earth face shows on the
 * lower tile, under a lit grass lip, with a shadow at its foot; steps to the
 * side throw a shadow edge. Houses stand on level ground and get none.
 */
function terrace(g: CanvasRenderingContext2D, w: World, tx: number, ty: number): void {
  const map = w.map;
  const i = map.idx(tx, ty);
  if (map.building[i]! >= 0) return;
  const L = levelAt(w, tx, ty);
  const x = tx * TILE, y = ty * TILE;
  const px = (xx: number, yy: number, col: string, ww = 1, hh = 1) => {
    g.fillStyle = col;
    g.fillRect(xx, yy, ww, hh);
  };
  if (ty > 0 && map.building[i - map.width]! < 0) {
    const up = levelAt(w, tx, ty - 1) - L;
    if (up > 0) {
      // The face of the step above, hanging down over this tile.
      const h = Math.min(10, 3 * up + 1);
      const water = map.terrain[i - map.width] === "water";
      px(x, y, water ? "#2e5478" : "#5e4c32", TILE, h);
      for (let k = 2; k < h; k += 3) px(x, y + k, water ? "#284a6a" : "#4e3e28", TILE, 1);
      for (let k = 0; k < 3; k++) px(x + Math.floor(hash2(tx, ty, k + 300) * 15), y + 1 + Math.floor(hash2(tx, ty, k + 310) * Math.max(1, h - 2)), "#7a6444", 2, 1);
      px(x, y, water ? "#4a7aa8" : "#7aae4a", TILE, 1);
      px(x, y + h, "rgba(10,16,6,0.35)", TILE, 2);
    }
  }
  if (ty + 1 < map.height && levelAt(w, tx, ty + 1) < L) px(x, y + TILE - 1, "rgba(255,250,210,0.18)", TILE, 1);
  if (tx > 0 && levelAt(w, tx - 1, ty) > L) px(x, y, "rgba(10,16,6,0.28)", 2, TILE);
  if (tx + 1 < map.width && levelAt(w, tx + 1, ty) > L) px(x + TILE - 1, y, "rgba(10,16,6,0.16)", 1, TILE);
  if (tx > 0 && levelAt(w, tx - 1, ty) < L) px(x, y, "rgba(255,250,210,0.14)", 1, TILE);
}

/** The trees and bushes growing on one tile. */
function propsAt(w: World, tx: number, ty: number, out: Placed[]): void {
  const f = (flora ??= new Flora());
  const i = w.map.idx(tx, ty);
  const add = (p: Prop, x: number, y: number) => out.push({ p, x: Math.round(x), y: Math.round(y), i });
  const t = w.map.terrain[i]!;
  const x = tx * TILE + 8, y = ty * TILE + 8;
  const r = (k: number) => hash2(tx, ty, k);
  if (t === "hedge") {
    add(pick(f.hedge, tx, ty, 41), x - 4 + r(42) * 3, y + r(43) * 3);
    add(pick(f.hedge, tx, ty, 44), x + 1 + r(45) * 3, y + 2 + r(46) * 3);
    add(pick(f.bushes, tx, ty, 50), x - 5 + r(51) * 10, y + 6);
    if (r(47) < 0.14) add(pick(r(48) < 0.5 ? f.bigOaks : f.oaks, tx, ty, 49), x, y + 7);
  } else if (t === "woods") {
    const roll = r(90);
    if (roll < 0.08) add(pick(f.bushes, tx, ty, 91), x - 2 + r(92) * 4, y + 4);
    else add(pick(roll < 0.2 ? f.pines : roll < 0.6 ? f.bigOaks : f.oaks, tx, ty, 93), x - 4 + r(94) * 8, y + 2 + r(95) * 6);
  } else if (t === "orchard" && (tx + ty * 2) % 4 === 0 && ty % 2 === 0) {
    add(pick(f.apples, tx, ty, 96), x + r(97) * 2 - 1, y + 5);
  } else if (t === "brush") {
    add(pick(f.shrubs, tx, ty, 101), x - 3 + r(102) * 6, y + 3 + r(103) * 4);
    if (r(104) < 0.5) add(pick(f.bushes, tx, ty, 105), x - 2 + r(106) * 4, y + 6);
  } else if ((t === "grass" || t === "orchard") && r(98) < 0.012) {
    add(pick(f.shrubs, tx, ty, 99), x, y + 5);
  }
}

const backToFront = (a: Placed, b: Placed) => a.y - b.y || a.x - b.x;

/** Shadows, then plants, over ground already drawn; only those touching the box when one is given. */
function drawProps(g: CanvasRenderingContext2D, w: World, props: Placed[], box?: [number, number, number, number]): void {
  const near = (x0: number, y0: number, x1: number, y1: number) => !box || (x1 > box[0] && x0 < box[2] && y1 > box[1] && y0 < box[3]);
  for (const b of w.buildings) buildingShadow(g, b);
  for (const { p, x, y } of props) if (near(x - p.shadow, y - p.shadow, x + p.shadow, y + p.shadow)) groundShadow(g, x, y, p.shadow);
  for (const { p, x, y } of props) if (near(x - p.ax, y - p.ay, x - p.ax + p.img.width, y - p.ay + p.img.height)) g.drawImage(p.img, x - p.ax, y - p.ay);
}

/**
 * Light and shade from the lie of the land, at a quarter-tile grid: slopes
 * facing the morning sun in the north-west are lit, the far sides darker,
 * and high ground a little paler. Drawn over the ground, under the plants.
 */
function hillShade(w: World): HTMLCanvasElement {
  const W = w.map.width, H = w.map.height, S = 4;
  const c = document.createElement("canvas");
  c.width = W * S;
  c.height = H * S;
  const g = c.getContext("2d")!;
  const img = g.createImageData(W * S, H * S);
  const e = w.map.elev;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < W * H; i++) {
    lo = Math.min(lo, e[i]!);
    hi = Math.max(hi, e[i]!);
  }
  const at = (x: number, y: number) => {
    const cx = Math.max(0, Math.min(W - 1.001, x)), cy = Math.max(0, Math.min(H - 1.001, y));
    const x0 = Math.floor(cx), y0 = Math.floor(cy), fx = cx - x0, fy = cy - y0;
    const i = y0 * W + x0;
    const a = e[i]!, b = e[Math.min(i + 1, W * H - 1)]!, cc = e[Math.min(i + W, W * H - 1)]!, d = e[Math.min(i + W + 1, W * H - 1)]!;
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + cc * (1 - fx) * fy + d * fx * fy;
  };
  for (let by = 0; by < H * S; by++) {
    for (let bx = 0; bx < W * S; bx++) {
      const x = (bx + 0.5) / S - 0.5, y = (by + 0.5) / S - 0.5;
      // Rising toward the south-east means facing the north-west light.
      const lit = (at(x + 0.6, y + 0.6) - at(x - 0.6, y - 0.6)) * 0.5;
      const height = hi > lo ? (at(x, y) - lo) / (hi - lo) - 0.5 : 0;
      // Quantised into a few steps, for the pixel look.
      const v = Math.round(Math.max(-0.26, Math.min(0.26, lit * 0.55 + height * 0.08)) / 0.04) * 0.04;
      const o = (by * W * S + bx) * 4;
      const light = v > 0;
      img.data[o] = light ? 255 : 10;
      img.data[o + 1] = light ? 246 : 18;
      img.data[o + 2] = light ? 200 : 30;
      img.data[o + 3] = Math.round(Math.abs(v) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * The ground and everything growing on it, drawn once into one big canvas.
 * When shells change a few tiles, only those tiles are painted again.
 */
class TerrainLayer {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly seen: Terrain[];
  private readonly seenHoles: Uint8Array;
  private props: Placed[] = [];
  readonly world: World;
  version: number;
  scars: number;
  private readonly shade: HTMLCanvasElement;

  constructor(w: World) {
    this.world = w;
    this.shade = hillShade(w);
    this.canvas = document.createElement("canvas");
    this.canvas.width = w.map.width * TILE;
    this.canvas.height = w.map.height * TILE;
    this.g = this.canvas.getContext("2d")!;
    for (let ty = 0; ty < w.map.height; ty++) for (let tx = 0; tx < w.map.width; tx++) drawTile(this.g, w, tx, ty);
    this.g.imageSmoothingEnabled = false;
    this.g.drawImage(this.shade, 0, 0, w.map.width * TILE, w.map.height * TILE);
    for (let ty = 0; ty < w.map.height; ty++) for (let tx = 0; tx < w.map.width; tx++) propsAt(w, tx, ty, this.props);
    this.props.sort(backToFront);
    drawProps(this.g, w, this.props);
    this.seen = [...w.map.terrain];
    this.seenHoles = Uint8Array.from(w.map.holes, holeStep);
    this.version = w.map.version;
    this.scars = w.map.scars;
  }

  update(): void {
    const w = this.world, g = this.g;
    this.version = w.map.version;
    this.scars = w.map.scars;
    const changed: number[] = [];
    for (let i = 0; i < this.seen.length; i++) {
      const holes = holeStep(w.map.holes[i]!);
      if (this.seen[i] !== w.map.terrain[i] || this.seenHoles[i] !== holes) {
        this.seenHoles[i] = holes;
        changed.push(i);
      }
    }
    if (changed.length === 0) return;
    // Whatever grew on a changed tile goes; whatever grows on it now is added.
    const gone = new Set(changed);
    this.props = this.props.filter((p) => !gone.has(p.i));
    for (const i of changed) propsAt(w, i % w.map.width, Math.floor(i / w.map.width), this.props);
    this.props.sort(backToFront);
    const props = this.props;
    for (const i of changed) {
      this.seen[i] = w.map.terrain[i]!;
      const tx = i % w.map.width, ty = Math.floor(i / w.map.width);
      // A wall's look depends on the tile south of it, so repaint that one's neighbour too.
      for (const [x, y] of [[tx, ty], [tx, ty - 1]] as const) {
        if (y < 0) continue;
        const box: [number, number, number, number] = [x * TILE, y * TILE, x * TILE + TILE, y * TILE + TILE];
        g.save();
        g.beginPath();
        g.rect(box[0], box[1], TILE, TILE);
        g.clip();
        drawTile(g, w, x, y);
        g.imageSmoothingEnabled = false;
        g.drawImage(this.shade, x * 4, y * 4, 4, 4, x * TILE, y * TILE, TILE, TILE);
        drawProps(g, w, props, box);
        g.restore();
      }
    }
  }
}

/** Where a sprite's figure sits: sprites carry a one-pixel outline, so place the figure inside it. */
function figureBox(spr: HTMLCanvasElement, p: { x: number; y: number }, bob: number): { sx: number; sy: number; iw: number; prone: boolean } {
  const prone = spr.width > spr.height;
  const iw = spr.width - 2, ih = spr.height - 2;
  return { sx: Math.round(p.x - iw / 2), sy: Math.round(p.y + (prone ? 6 - ih : 7 - ih) + bob), iw, prone };
}

/** The weapon in a man's hands, by posture and facing, and the muzzle at its far end. */
function weaponShape(s: Soldier, sx: number, sy: number, iw: number, prone: boolean): { x: number; y: number; w: number; h: number; muzzle: { x: number; y: number }; bipod: { x: number; y: number } | null } | null {
  if (!s.weapon || s.status !== "active") return null;
  const big = s.weapon === "mg42" || s.weapon === "bar";
  const len = big ? 7 : s.weapon === "thompson" || s.weapon === "mp40" ? 4 : 6;
  const left = s.dir < 0;
  if (prone) {
    const x = left ? sx - len + 2 : sx + iw - 2, y = sy + 1;
    return { x, y, w: len, h: 1, muzzle: { x: left ? x - 1 : x + len, y: y + 0.5 }, bipod: big ? { x: left ? x : x + len - 2, y: sy + 2 } : null };
  }
  const x = left ? sx - len + 3 : sx + iw - 3, y = sy + (s.posture === "crouch" ? 4 : 6);
  return { x, y, w: len, h: big ? 2 : 1, muzzle: { x: left ? x - 1 : x + len, y: y + (big ? 1 : 0.5) }, bipod: null };
}

const STAR_BADGE = ["...x...", "...x...", "xxxxxxx", ".xxxxx.", "..xxx..", ".xx.xx.", ".x...x."];
const CROSSHAIR_BADGE = ["...xxx...", "..x.x.x..", ".x..x..x.", "xxxxxxxxx", ".x..x..x.", "..x.x.x..", "...xxx..."];
const GUN_BADGE = ["...xxx.....", "xxxxxxxxxxx", "xxxxx......", "xx....x.x..", "......x..x."];

const FLAG_MARK = ["x....", "xxxx.", "xxxxx", "xxxx.", "x....", "x...."];
const PIN_MARK = ["xxxxx", ".xxx.", "..x.."];

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private terrain: TerrainLayer | null = null;
  private effects: Effect[] = [];
  private readonly spriteCache = new Map<string, HTMLCanvasElement>();
  private readonly houses = new Map<number, { version: number; world: World; look: string; img: HTMLCanvasElement }>();
  hoverBuilding = -1;
  alpha = 1;
  trails = new Map<number, number[]>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d")!;
  }

  reset(): void {
    this.terrain = null;
    this.effects = [];
    this.houses.clear();
    // Soldier ids restart with every battle, and the same id may be on the other side now.
    this.spriteCache.clear();
    this.floorView.clear();
  }

  addEffect(e: Effect): void {
    this.effects.push(e);
    if (this.effects.length > 1500) this.effects.splice(0, this.effects.length - 1500);
  }

  /** Pixel position of a soldier, eased between his last two tiles. */
  worldPos(s: Soldier, prev: Map<number, { x: number; y: number }>, alpha: number): { x: number; y: number } {
    const p = prev.get(s.id);
    const a = Math.max(0, Math.min(1, alpha));
    if (!p || (p.x === s.x && p.y === s.y) || Math.abs(p.x - s.x) + Math.abs(p.y - s.y) > 6) return { x: s.x * TILE + 8, y: s.y * TILE + 8 };
    return { x: (p.x + (s.x - p.x) * a) * TILE + 8, y: (p.y + (s.y - p.y) * a) * TILE + 8 };
  }

  screenOf(s: Soldier, cam: Camera, prev: Map<number, { x: number; y: number }>): { x: number; y: number } {
    const p = this.worldPos(s, prev, this.alpha);
    return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
  }

  private sprite(s: Soldier, walking: boolean): HTMLCanvasElement {
    const dead = s.status === "dead";
    const posture = dead || s.status === "casualty" || s.carriedById !== null ? "prone" : s.posture;
    const key = `${s.id}|${s.side}|${s.role === "medic" ? 1 : 0}|${posture}|${walking ? 1 : 0}|${s.dir}|${s.status}`;
    let spr = this.spriteCache.get(key);
    if (!spr) {
      spr = soldierSprite({ side: s.side, posture, walking, medic: s.role === "medic", surrendered: s.status === "surrendered" || s.status === "captured", flip: s.dir < 0, dead, id: s.id });
      this.spriteCache.set(key, spr);
      if (this.spriteCache.size > 3000) this.spriteCache.clear();
    }
    return spr;
  }

  draw(w: World, cam: Camera, opts: ViewOptions, prev: Map<number, { x: number; y: number }>, alpha: number, selected: number | null, time: number): void {
    this.alpha = alpha;
    this.zoomNow = cam.zoom;
    const g = this.g;
    const dpr = window.devicePixelRatio || 1;
    const vw = this.canvas.width / dpr, vh = this.canvas.height / dpr;
    if (!this.terrain || this.terrain.world !== w) this.terrain = new TerrainLayer(w);
    else if (this.terrain.version !== w.map.version || this.terrain.scars !== w.map.scars) this.terrain.update();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#1a1c14";
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // Gunfire and blasts jolt the view, in whole screen pixels.
    const shake = this.shake(time, cam, vw, vh);
    const kx = Math.round(Math.sin(time * 97) * shake), ky = Math.round(Math.cos(time * 83) * shake);
    g.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, (kx - cam.x * cam.zoom) * dpr, (ky - cam.y * cam.zoom) * dpr);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.terrain.canvas, 0, 0);
    const x0 = cam.x - 32, y0 = cam.y - 32, x1 = cam.x + vw / cam.zoom + 32, y1 = cam.y + vh / cam.zoom + 32;
    const visible = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

    // Objective flag.
    const obj = w.platoons[w.attacker].objective;
    this.drawFlag(obj.x * TILE + 8, obj.y * TILE + 8, w.phase === "over" && w.result?.winner ? SIDE_COLORS[w.result.winner].name : "#f2c84a");

    // The fallen first, then everyone else from back to front. Men upstairs, or
    // on a floor of a house that is cut away above them, are drawn with that floor.
    this.drawMortarPits(w);
    const sel = selected !== null ? w.maybe(selected) : null;
    const views = new Map<number, number>();
    for (const b of w.buildings) views.set(b.id, this.viewOf(w, b, sel, opts));
    const houseOf = (s: Soldier) => {
      const b = w.map.building[w.map.idx(s.x, s.y)]!;
      return b >= 0 && w.map.indoors(s.x, s.y, s.z) ? b : -1;
    };
    const order = w.soldiers.filter((s) => s.status !== "routed" && s.status !== "aboard" && s.carriedById === null).sort((a, b) => (a.status === "dead" ? 0 : 1) - (b.status === "dead" ? 0 : 1) || a.y - b.y || a.id - b.id);
    const upstairs = new Map<number, Soldier[]>();
    for (const s of order) {
      const p = this.worldPos(s, prev, alpha);
      if (!visible(p.x, p.y)) continue;
      const house = houseOf(s);
      if (house >= 0 && (s.z > 0 || (views.get(house) ?? -1) > 0)) {
        if (s.z > 0 && views.get(house) === s.z) {
          const list = upstairs.get(house) ?? [];
          list.push(s);
          upstairs.set(house, list);
        }
        continue;
      }
      this.drawCorpseStain(s, p);
      this.drawSoldier(w, s, p, prev, time, s === sel);
    }
    this.drawOrdnance(w, alpha);

    // Mist lies on the ground, round the men's legs; the houses stand up out of it.
    this.drawGroundFog(w, time);

    // Roofs, unless looking inside; an upper floor cut away, with the men on it.
    for (const b of w.buildings) {
      const v = views.get(b.id) ?? -1;
      if (v < 0) this.drawBuilding(w, b);
      else if (v > 0) {
        this.drawUpperFloor(w, b, v);
        for (const s of upstairs.get(b.id) ?? []) {
          const p = this.worldPos(s, prev, alpha);
          this.drawCorpseStain(s, p);
          this.drawSoldier(w, s, p, prev, time, s === sel);
        }
      }
    }

    this.drawSmoke(w, time);
    this.drawBadges(w, prev, time);
    this.drawEffects(time, w, cam, prev);
    if (opts.orders) this.drawOrders(w, prev);
    if (sel && opts.sight) this.drawSight(w, sel, prev);
    if (opts.names) this.drawNames(w, cam, prev);
    if (cam.zoom < SQUAD_BANNER_ZOOM + SQUAD_BANNER_FADE) {
      g.globalAlpha = Math.min(1, (SQUAD_BANNER_ZOOM + SQUAD_BANNER_FADE - cam.zoom) / SQUAD_BANNER_FADE);
      this.drawSquadBanners(w, cam, prev, time);
      g.globalAlpha = 1;
    }

    // Screen space from here: the weather over everything, and the floor buttons.
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawWeather(w, vw, vh, time);
    this.drawFloorButtons(w, cam, vw, vh, views);
  }

  /** Floor shown for each building: the roof (-1), or a floor cut away for looking inside. */
  floorView = new Map<number, number>();
  /** The man under the pointer, set by the page each frame. */
  hovered: number | null = null;
  private zoomNow = 1;
  private buttons: { id: number; x: number; y: number; w: number; h: number }[] = [];

  /** How many floors a building has, counting a church tower. */
  floorsOf(w: World, id: number): number {
    const b = w.buildings[id]!;
    let n = 1;
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) n = Math.max(n, w.map.levels[w.map.idx(x, y)]!);
    return n;
  }

  private viewOf(w: World, b: Building, sel: Soldier | null, opts: ViewOptions): number {
    const set = this.floorView.get(b.id);
    if (set !== undefined && set >= 0) return set;
    if (sel && w.map.building[w.map.idx(sel.x, sel.y)] === b.id && w.map.indoors(sel.x, sel.y, sel.z)) return sel.z;
    if (b.id === this.hoverBuilding || !opts.roofs) return 0;
    return -1;
  }

  /** The floor button under a point on the screen (CSS pixels), or -1. */
  buttonAt(x: number, y: number): number {
    for (const r of this.buttons) if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.id;
    return -1;
  }

  /** Roof, ground floor, first floor and so on, then the roof again. */
  cycleFloor(w: World, id: number): number {
    const cur = this.floorView.get(id) ?? -1;
    const next = cur + 1 >= this.floorsOf(w, id) ? -1 : cur + 1;
    this.floorView.set(id, next);
    return next;
  }

  private drawCorpseStain(s: Soldier, p: { x: number; y: number }): void {
    if (s.status !== "dead" && s.status !== "casualty") return;
    if (s.role === "tank" || s.role === "field_gun") return;
    const g = this.g;
    // A pool of square blocks on the world's 2-pixel grid: ragged at the edge, darker in the middle.
    const B = 2;
    const rx = s.status === "dead" ? 8 : 5, ry = s.status === "dead" ? 4 : 2.5;
    const ox = Math.floor(p.x / B) * B, oy = Math.floor((p.y + 4) / B) * B;
    for (let gy = -Math.ceil(ry / B) * B; gy <= Math.ceil(ry / B) * B; gy += B) {
      for (let gx = -Math.ceil(rx / B) * B; gx <= Math.ceil(rx / B) * B; gx += B) {
        const nx = gx / rx, ny = gy / ry;
        const d = nx * nx + ny * ny + (hash2(s.id, gx, gy) - 0.5) * 0.9;
        if (d >= 1) continue;
        g.fillStyle = d < 0.35 ? "#4a0808" : d < 0.7 ? "#6e0f0f" : "#8a1a16";
        g.fillRect(ox + gx, oy + gy, B, B);
      }
    }
  }

  /** An upper floor seen from above with the roof off: boards, inner walls, windows, the stairs. */
  private drawUpperFloor(w: World, b: Building, z: number): void {
    const g = this.g;
    const px = (x: number, y: number, col: string, ww = 1, hh = 1) => {
      g.fillStyle = col;
      g.fillRect(x, y, ww, hh);
    };
    for (let ty = b.y; ty < b.y + b.h; ty++) {
      for (let tx = b.x; tx < b.x + b.w; tx++) {
        const x = tx * TILE, y = ty * TILE;
        const t = w.map.at(tx, ty);
        if (w.map.passable(tx, ty, z)) {
          px(x, y, "#9a7650", TILE, TILE);
          for (let row = 0; row < 16; row += 4) px(x, y + row, "#86643f", 16, 1);
          for (let k = 0; k < 4; k++) px(x + ((k * 7 + ty * 5) % 16), y + k * 4, "#7a5a38", 1, 4);
          // Scorched and splintered where blasts have gone off.
          const burn = blastStep(w.map.blasts[w.map.idx(tx, ty)]!);
          for (let k = 0; k < burn * 5; k++) {
            px(x + Math.floor(hash2(tx, ty, k + 400) * 14), y + Math.floor(hash2(ty, tx, k + 430) * 14), k % 3 === 0 ? "#1c140e" : "#3a2a1a", 2, 2);
          }
          for (let k = 0; k < burn * 2; k++) px(x + Math.floor(hash2(tx, ty, k + 460) * 14), y + Math.floor(hash2(ty, tx, k + 490) * 14), "#d4b88a", 2, 1);
          if (t === "stairs") {
            for (let k = 0; k < 4; k++) {
              px(x + 2, y + 2 + k * 3, "#b8946a", 12, 2);
              px(x + 2, y + 4 + k * 3, "#5a3e24", 12, 1);
            }
          }
        } else if (w.map.levels[w.map.idx(tx, ty)]! > z) {
          // Walls, with the window openings of this floor.
          px(x, y, "#5a5248", TILE, TILE);
          px(x, y, "#7a7266", TILE, 3);
          if (t === "window") {
            px(x + 3, y + 3, "#2a3440", 10, 10);
            px(x + 4, y + 4, "#5a7a94", 3, 3);
          } else if (t === "rubble") {
            px(x + 2, y + 2, "#2a2218", 12, 12);
          }
          // Pocked and scorched by blasts and bullets.
          const pocks = holeStep(w.map.holes[w.map.idx(tx, ty)]!) + blastStep(w.map.blasts[w.map.idx(tx, ty)]!);
          for (let k = 0; k < pocks * 3; k++) {
            const hx = x + 1 + Math.floor(hash2(tx, ty, k + 500) * 14), hy = y + 1 + Math.floor(hash2(ty, tx, k + 530) * 14);
            px(hx, hy, "#1e1a16", 2, 2);
            px(hx + 2, hy, "#a89c84");
          }
        } else {
          // Below the tower: the church roof.
          px(x, y, "#54545e", TILE, TILE);
        }
      }
    }
    // A shadow along the inside of the north and west walls, for depth.
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.fillRect(b.x * TILE + TILE, b.y * TILE + TILE, (b.w - 2) * TILE, 3);
    g.fillRect(b.x * TILE + TILE, b.y * TILE + TILE, 3, (b.h - 2) * TILE);
  }

  /** A small button by each house on screen: the floor shown, click to go up a floor. */
  private drawFloorButtons(w: World, cam: Camera, vw: number, vh: number, views: Map<number, number>): void {
    this.buttons = [];
    if (cam.zoom < 0.7) return;
    const g = this.g;
    g.font = `bold 9px "Silkscreen", monospace`;
    for (const b of w.buildings) {
      const floors = this.floorsOf(w, b.id);
      const B = buildingBounds(b);
      const x = Math.round((B.x + B.w - cam.x) * cam.zoom) + 2, y = Math.round((B.y + 6 - cam.y) * cam.zoom);
      const bw = 16 + floors * 3, bh = 16;
      if (x > vw || y > vh || x + bw < 0 || y + bh < 0) continue;
      const v = views.get(b.id) ?? -1;
      g.fillStyle = "rgba(20,22,14,0.88)";
      g.fillRect(x, y, bw, bh);
      g.strokeStyle = v >= 0 ? "#f2c84a" : "#8a8a70";
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
      // A little stack of floors, the one shown lit; a roof when none is.
      for (let f = 0; f < floors; f++) {
        g.fillStyle = f === v ? "#f2c84a" : "#6a6a5a";
        g.fillRect(x + 3, y + 11 - f * 3, 8, 2);
      }
      g.fillStyle = v < 0 ? "#f2c84a" : "#6a6a5a";
      g.fillRect(x + 4, y + 11 - floors * 3, 6, 1);
      g.fillRect(x + 5, y + 10 - floors * 3, 4, 1);
      g.fillStyle = "#e8e0c8";
      g.fillText(v < 0 ? "R" : String(v + 1), x + 13, y + 12);
      this.buttons.push({ id: b.id, x, y, w: bw, h: bh });
    }
  }

  /** Rain streaking down, fog drifting, or a grey sky, over the whole view. */
  private drawWeather(w: World, vw: number, vh: number, time: number): void {
    const g = this.g;
    const kind = w.weather.kind;
    if (kind === "overcast") {
      g.fillStyle = "rgba(40,48,58,0.12)";
      g.fillRect(0, 0, vw, vh);
    } else if (kind === "rain") {
      g.fillStyle = "rgba(24,36,58,0.2)";
      g.fillRect(0, 0, vw, vh);
      const n = Math.round((vw * vh) / 5000);
      g.fillStyle = "rgba(180,200,225,0.5)";
      g.beginPath();
      for (let k = 0; k < n; k++) {
        const x = Math.floor(((hash2(k, 1) * (vw + 120) + time * 90) % (vw + 120)) - 60) & ~1;
        const y = Math.floor(((hash2(k, 2) * (vh + 60) + time * (420 + hash2(k, 3) * 160)) % (vh + 60)) - 30) & ~1;
        g.rect(x, y, 2, 6);
        g.rect(x + 2, y + 6, 2, 4);
      }
      g.fill();
    }
  }

  /**
   * Fog lying on the ground: banks of it in chunky blocks on the world grid,
   * thicker in the low ground and thinning over the rises, drifting slowly
   * east. Drawn over the field and the men, under the houses. The banks are
   * worked out a few times a second into a small image, one pixel a block,
   * which is then stretched over the whole map in a single draw.
   */
  private fog: { world: World; canvas: HTMLCanvasElement; img: ImageData; low: Float32Array; cols: number; stamp: number; row: number } | null = null;

  private drawGroundFog(w: World, time: number): void {
    if (w.weather.kind !== "fog") return;
    const P = 12;
    if (!this.fog || this.fog.world !== w) {
      const cols = Math.ceil((w.map.width * TILE) / P), rows = Math.ceil((w.map.height * TILE) / P);
      const canvas = document.createElement("canvas");
      canvas.width = cols;
      canvas.height = rows;
      // How low each block lies, 1 in the deepest hollow and 0 on the highest rise: fog pools there.
      const W = w.map.width, H = w.map.height;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < W * H; i++) {
        lo = Math.min(lo, w.map.elev[i]!);
        hi = Math.max(hi, w.map.elev[i]!);
      }
      const low = new Float32Array(cols * rows);
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const tx = Math.min(W - 1, Math.floor((gx * P) / TILE)), ty = Math.min(H - 1, Math.floor((gy * P) / TILE));
          low[gy * cols + gx] = hi > lo ? 1 - (w.map.elev[ty * W + tx]! - lo) / (hi - lo) : 0.5;
        }
      }
      this.fog = { world: w, canvas, img: new ImageData(cols, rows), low, cols, stamp: -1, row: 0 };
    }
    const fog = this.fog;
    const cols = fog.cols, rows = fog.canvas.height;
    // Refreshed a slice of rows a frame, so each frame costs the same however far out the camera is.
    const per = Math.max(1, Math.ceil(rows / 14));
    const drift = time * 1.5, flicker = Math.floor(time * 0.5);
    const d = fog.img.data;
    const alpha = [0, Math.round(0.22 * 255), Math.round(0.38 * 255), Math.round(0.55 * 255)];
    const first = fog.stamp < 0 ? 0 : fog.row;
    const count = fog.stamp < 0 ? rows : per;
    fog.stamp = 0;
    for (let n = 0; n < count; n++) {
      const gy = (first + n) % rows;
      const wy = (gy * P) / 72, fy0 = Math.floor(wy), fy = wy - fy0;
      for (let gx = 0; gx < cols; gx++) {
        const wx = (gx * P - drift) / 96, fx0 = Math.floor(wx), fx = wx - fx0;
        const a = hash2(fx0, fy0, 9), b = hash2(fx0 + 1, fy0, 9), c = hash2(fx0, fy0 + 1, 9), e = hash2(fx0 + 1, fy0 + 1, 9);
        let v = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + e * fx * fy;
        v = v * 0.7 + fog.low[gy * cols + gx]! * 0.45 + (hash2(gx, gy, flicker) - 0.5) * 0.06;
        const k = (gy * cols + gx) * 4;
        d[k] = 222;
        d[k + 1] = 226;
        d[k + 2] = 228;
        d[k + 3] = alpha[v > 0.78 ? 3 : v > 0.58 ? 2 : v > 0.4 ? 1 : 0]!;
      }
    }
    fog.row = (first + count) % rows;
    const ctx = fog.canvas.getContext("2d")!;
    if (first + count <= rows) ctx.putImageData(fog.img, 0, 0, 0, first, cols, count);
    else {
      ctx.putImageData(fog.img, 0, 0, 0, first, cols, rows - first);
      ctx.putImageData(fog.img, 0, 0, 0, 0, cols, first + count - rows);
    }
    // Only the part of the fog bank on screen, and none of it outside the world.
    const g = this.g, m = g.getTransform();
    const cw = g.canvas.width, ch = g.canvas.height;
    const x0 = Math.max(0, Math.floor((-m.e / m.a) / P)), x1 = Math.min(cols, Math.ceil(((cw - m.e) / m.a) / P));
    const y0 = Math.max(0, Math.floor((-m.f / m.d) / P)), y1 = Math.min(rows, Math.ceil(((ch - m.f) / m.d) / P));
    if (x1 > x0 && y1 > y0) g.drawImage(fog.canvas, x0, y0, x1 - x0, y1 - y0, x0 * P, y0 * P, (x1 - x0) * P, (y1 - y0) * P);
  }

  private drawFlag(x: number, y: number, color: string): void {
    const g = this.g;
    g.fillStyle = "#3a2a1a";
    g.fillRect(x - 1, y - 18, 2, 20);
    g.fillStyle = color;
    g.fillRect(x + 1, y - 18, 10, 6);
    g.fillStyle = "rgba(0,0,0,0.5)";
    pxBox(g, Math.round(x) + 1, Math.round(y) - 18, 10, 6);
  }

  private drawSoldier(w: World, s: Soldier, p: { x: number; y: number }, prev: Map<number, { x: number; y: number }>, time: number, selected: boolean): void {
    if (s.role === "tank" || s.role === "field_gun") {
      this.drawVehicle(w, s, p, selected, time);
      return;
    }
    const g = this.g;
    const last = prev.get(s.id);
    const walking = !!last && (last.x !== s.x || last.y !== s.y) && s.status === "active";
    const step = walking && Math.floor(time * 6 + s.id) % 2 === 0;
    const spr = this.sprite(s, step);
    const sq = w.squad(s.squadId);
    // Squad colour under the feet.
    if (s.status === "active" || s.status === "casualty") {
      g.fillStyle = sq.color;
      g.globalAlpha = 0.85;
      g.fillRect(p.x - 3, p.y + 6, 6, 1);
      g.globalAlpha = 1;
    }
    // A soft shadow under every man, and a ring under the one the pointer is over or that is selected.
    if (s.status === "active" || s.status === "casualty") {
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.fillRect(Math.round(p.x) - 4, Math.round(p.y) + 5, 8, 2);
      g.fillRect(Math.round(p.x) - 3, Math.round(p.y) + 4, 6, 1);
    }
    if (selected || s.id === this.hovered) {
      g.fillStyle = selected ? "#ffe14a" : "#ffffff";
      pxEllipse(g, Math.round(p.x), Math.round(p.y) + 5, 8, 4);
      if (!selected) {
        g.fillStyle = "rgba(255,255,255,0.22)";
        g.fillRect(Math.round(p.x) - 6, Math.round(p.y) + 4, 12, 2);
      }
    }
    // Zoomed out, a man is a speck: a bold block of his side's colour above him keeps him findable.
    if (this.zoomNow < 1.25 && (s.status === "active" || s.status === "surrendered")) {
      const m = Math.max(2, Math.round(1.7 / this.zoomNow));
      g.fillStyle = "#000000cc";
      g.fillRect(Math.round(p.x) - Math.ceil(m / 2) - 1, Math.round(p.y) - 9 - m, m + 2, m + 2);
      g.fillStyle = SIDE_COLORS[s.side].name;
      g.fillRect(Math.round(p.x) - Math.ceil(m / 2), Math.round(p.y) - 8 - m, m, m);
    }
    const { sx, sy, iw, prone } = figureBox(spr, p, walking ? (step ? -1 : 0) : 0);
    if (s.status === "captured") g.globalAlpha = 0.75;
    g.drawImage(spr, sx - 1, sy - 1);
    g.globalAlpha = 1;
    // The weapon.
    const gun = weaponShape(s, sx, sy, iw, prone);
    if (gun) {
      g.fillStyle = "#2a2420";
      g.fillRect(gun.x, gun.y, gun.w, gun.h);
      if (gun.bipod) {
        g.fillStyle = "#3a3430";
        g.fillRect(gun.bipod.x, gun.bipod.y, 1, 2);
      }
    }
    // Carrying a wounded man over the shoulder.
    if (s.carryingId !== null) {
      g.fillStyle = SIDE_COLORS[w.soldier(s.carryingId).side].coat;
      g.fillRect(sx - 2, sy + 2, iw + 4, 3);
    }
    // State marks: pinned, broken, wounded, unconscious.
    let mark: string | null = null, col = "#fff";
    if (s.status === "casualty") {
      mark = s.conscious ? (cannotWalk(s) ? "+" : "+") : "z";
      col = s.injuries.some((i) => i.bleeding > 0.05) ? "#ff4a3a" : "#f4f0e8";
    } else if (s.status === "surrendered") {
      mark = "flag";
      col = "#f4f0e8";
    } else if (s.status === "active" && s.broken) {
      mark = "!";
      col = "#b08ae8";
    } else if (s.status === "active" && s.pinned) {
      mark = "pin";
      col = "#f0963a";
    }
    if (mark) {
      const bmp = mark === "flag" ? FLAG_MARK : mark === "pin" ? PIN_MARK : null;
      if (bmp) {
        // Drawn in square pixels rather than a font glyph.
        const bx = Math.round(p.x - bmp[0]!.length / 2), by = Math.round(sy - bmp.length - 1);
        for (const [dx, dy, fill] of [[1, 1, "#000a"], [0, 0, col]] as const) {
          g.fillStyle = fill;
          bmp.forEach((row, ry) => {
            for (let rx = 0; rx < row.length; rx++) if (row[rx] === "x") g.fillRect(bx + rx + dx, by + ry + dy, 1, 1);
          });
        }
      } else {
        g.font = "bold 7px monospace";
        g.fillStyle = "#000a";
        g.fillText(mark, p.x - 2, sy - 1);
        g.fillStyle = col;
        g.fillText(mark, p.x - 2.5, sy - 1.5);
      }
    }
  }

  /** Where a man's weapon muzzle is drawn right now, for flashes and tracers. */
  muzzleOf(s: Soldier, prev: Map<number, { x: number; y: number }>): { x: number; y: number } {
    const p = this.worldPos(s, prev, this.alpha);
    const box = figureBox(this.sprite(s, false), p, 0);
    const gun = weaponShape(s, box.sx, box.sy, box.iw, box.prone);
    return gun ? gun.muzzle : { x: p.x, y: p.y };
  }

  /** Grenades from the moment they leave a hand until they burst: arcing through the air, then lying where they landed. */
  private drawOrdnance(w: World, alpha: number): void {
    const g = this.g;
    for (const o of w.ordnance) {
      if (o.kind !== "frag" && o.kind !== "stick" && o.kind !== "rifle_grenade" && o.kind !== "smoke_grenade") continue;
      if (o.burstTick <= w.tick) continue;
      const total = Math.max(1, o.burstTick - o.thrownTick);
      const age = w.tick - o.thrownTick + Math.max(0, Math.min(1, alpha));
      const flight = o.kind === "rifle_grenade" ? total * 0.9 : Math.max(1, total * 0.45);
      const t = Math.min(1, age / flight);
      const fx = o.from.x * TILE + 8, fy = o.from.y * TILE + 6, tx = o.x * TILE + 8, ty = o.y * TILE + 8;
      const dist = Math.hypot(tx - fx, ty - fy);
      const lift = t < 1 ? Math.sin(Math.PI * t) * Math.min(18, 5 + dist * 0.18) : 0;
      const x = Math.round(fx + (tx - fx) * t), y = Math.round(fy + (ty - fy) * t - lift);
      // Its shadow on the ground, then the grenade itself.
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.fillRect(Math.round(fx + (tx - fx) * t) - 1, Math.round(fy + (ty - fy) * t) + 1, 3, 1);
      const blink = t >= 1 && o.burstTick - w.tick <= 1 && Math.floor(this.alpha * 4) % 2 === 0;
      if (o.kind === "stick") {
        g.fillStyle = "#7a5a34";
        g.fillRect(x, y - 1, 1, 4);
        g.fillStyle = blink ? "#fff4c8" : "#4a5a30";
        g.fillRect(x - 1, y - 3, 3, 3);
      } else if (o.kind === "smoke_grenade") {
        g.fillStyle = "#8a8a82";
        g.fillRect(x - 1, y - 2, 3, 4);
        g.fillStyle = "#d8d8d0";
        g.fillRect(x - 1, y - 2, 3, 1);
      } else if (o.kind === "rifle_grenade") {
        g.fillStyle = "#3a3a30";
        g.fillRect(x - 1, y - 1, 3, 3);
        g.fillStyle = blink ? "#fff4c8" : "#9a9a8a";
        g.fillRect(x, y - 2, 1, 1);
      } else {
        g.fillStyle = "#1a1a12";
        g.fillRect(x - 2, y - 3, 4, 5);
        g.fillStyle = blink ? "#fff4c8" : "#4e5e34";
        g.fillRect(x - 1, y - 2, 2, 3);
        g.fillStyle = "#b0b0a0";
        g.fillRect(x + 1, y - 3, 1, 1);
      }
    }
  }

  /** A platoon's mortar in its pit: base plate, tube on its bipod, ammunition beside it. */
  private drawMortarPits(w: World): void {
    const g = this.g;
    for (const side of ["us", "de"] as const) {
      const pit = w.platoons[side]?.mortarPit;
      if (!pit) continue;
      const x = pit.x * TILE, y = pit.y * TILE;
      g.fillStyle = "#2a2a24";
      g.fillRect(x + 4, y + 11, 9, 3);
      g.fillStyle = "#4a4a40";
      g.fillRect(x + 5, y + 11, 7, 1);
      g.fillStyle = "#6a6a5c";
      pxLine(g, x + 9, y + 11, x + 6, y + 2);
      pxLine(g, x + 10, y + 11, x + 7, y + 2);
      g.fillStyle = "#2c2f2a";
      pxLine(g, x + 8, y + 10, x + 5, y + 3);
      g.fillStyle = "#16160f";
      g.fillRect(x + 4, y + 1, 4, 2);
      g.fillStyle = "#8a8a7c";
      pxLine(g, x + 12, y + 7, x + 15, y + 13);
      pxLine(g, x + 6, y + 8, x + 3, y + 13);
      g.fillStyle = "#6a5a38";
      g.fillRect(x + 11, y + 1, 4, 3);
      g.fillStyle = "#4a3e26";
      g.fillRect(x + 11, y + 3, 4, 1);
      g.fillStyle = "#9a8a50";
      g.fillRect(x + 1, y + 6, 2, 4);
      g.fillRect(x + 1, y + 11, 2, 3);
    }
  }

  /**
   * A tank or an anti-tank gun at three-quarter view, like the houses: a lit
   * top, a darker south face under it, a raised turret, the barrel laid on what
   * it last fired at. Square pixels throughout.
   */
  private drawVehicle(w: World, s: Soldier, p: { x: number; y: number }, selected: boolean, time: number): void {
    const t = w.tanks.get(s.id);
    if (!t) return;
    const g = this.g;
    const cx = Math.round(p.x), cy = Math.round(p.y);
    const dead = t.state === "wrecked" || t.state === "abandoned";
    const us = t.side === "us";
    const top = dead ? "#403d36" : us ? "#6a7b44" : "#8a8a7e";
    const topL = dead ? "#4e4a42" : us ? "#8a9c5a" : "#aaaa9c";
    const face = dead ? "#2a2822" : us ? "#46522c" : "#5e5e56";
    const faceD = dead ? "#1c1b18" : us ? "#323c1e" : "#44443e";
    const trk = dead ? "#16150f" : "#1e1e19";
    const px = (x: number, y: number, w2: number, h2: number, c: string) => {
      g.fillStyle = c;
      g.fillRect(x, y, w2, h2);
    };
    const th = t.turret;
    const tx = Math.abs(th.x) >= Math.abs(th.y);
    if (t.kind === "tank") {
      const hx = Math.abs(t.hull.x) >= Math.abs(t.hull.y);
      const faceH = t.hull.x < 0 ? -1 : 1;
      const W = hx ? 30 : 20, L = hx ? 14 : 26;
      const x0 = cx - W / 2, base = cy + 6;
      const D = 6;
      // Ground shadow.
      px(x0 - 1, base - 2, W + 3, 5, "rgba(0,0,0,0.3)");
      // Lower hull and tracks: the south face, with its road wheels.
      px(x0, base - D, W, D, face);
      px(x0, base - 1, W, 1, faceD);
      px(x0 - 1, base - D - 1, 3, D + 2, trk);
      px(x0 + W - 2, base - D - 1, 3, D + 2, trk);
      if (hx) {
        px(x0, base - D, W, 3, trk);
        for (let k = 2; k < W - 2; k += 3) px(x0 + k, base - D + 1, 2, 2, "#5a5a50");
        if (t.state === "tracked") {
          px(x0 + 1, base - D, 10, 3, "#7a4a2a");
          px(x0 + 11, base - 1, 5, 2, trk);
        }
      }
      // Upper hull: the lit top, a glacis at the front.
      const topY = base - D - L;
      px(x0 + 1, topY, W - 2, L, top);
      px(x0 + 1, topY, W - 2, 2, topL);
      if (hx) {
        px(faceH > 0 ? x0 + W - 8 : x0 + 1, topY, 7, L, topL);
        px(faceH > 0 ? x0 + 3 : x0 + W - 12, topY + 3, 8, L - 6, face);
      } else {
        px(x0 + 1, t.hull.y > 0 ? topY + L - 7 : topY, W - 2, 7, topL);
        px(x0 + 4, t.hull.y > 0 ? topY + 3 : topY + L - 10, W - 8, 7, face);
      }
      // The turret, standing up off the hull: lit top, shadowed front.
      const off = dead ? 3 : 0;
      const tcx = cx + off, tcy = topY + L / 2 + off;
      const bar = dead ? "#16150f" : "#25251f";
      if (tx) {
        const dir = th.x < 0 ? -1 : 1;
        px(tcx + (dir > 0 ? 3 : -17), tcy - 4, 14, 2, bar);
        px(tcx + (dir > 0 ? 16 : -19), tcy - 5, 3, 4, bar);
      } else {
        const dir = th.y < 0 ? -1 : 1;
        px(tcx - 1, tcy + (dir > 0 ? 0 : -16), 2, 16, bar);
        px(tcx - 2, tcy + (dir > 0 ? 15 : -18), 4, 3, bar);
      }
      px(tcx - 7, tcy - 3, 14, 4, faceD);
      px(tcx - 6, tcy - 9, 12, 8, face);
      px(tcx - 6, tcy - 9, 12, 7, top);
      px(tcx - 6, tcy - 9, 12, 2, topL);
      px(tcx - 2, tcy - 7, 4, 3, dead ? "#16150f" : "#2a2a24");
      if (!dead) {
        px(tcx + 2, tcy - 8, 3, 1, "#f4f0e8");
        if (!us) px(tcx + 3, tcy - 9, 1, 3, "#f4f0e8");
      }
      // Mud on the tracks, when bogged down.
      if (w.tick < t.stuckUntil) for (let k = 0; k < 7; k++) px(x0 + 1 + k * 4, base - 2 + (k % 2), 3, 2, "#5a4630");
    } else {
      // The gun in three-quarter view: trails behind, wheels, cradle, a slab of shield, and the barrel laid on its target.
      // Alive it stands square; wrecked it sits scorched, one wheel gone, shield torn and the barrel drooping.
      const dir = th.x < 0 ? -1 : 1;
      const base = cy + 6;
      const disc = (x: number, y: number, rx: number, ry: number, c: string) => {
        g.fillStyle = c;
        for (let dy = -ry; dy <= ry; dy++) {
          const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry + 0.01))));
          g.fillRect(x - half, y + dy, half * 2 + 1, 1);
        }
      };
      const steel = dead ? "#201f1a" : "#3a3b30";
      const steelL = dead ? "#2c2a24" : "#5a5b4c";
      const tire = dead ? "#0e0e0a" : "#16160f";
      // Ground: a soft shadow, and scorching under a wreck.
      px(cx - 12, base - 2, 26, 5, "rgba(0,0,0,0.3)");
      if (dead) px(cx - 14, base - 4, 30, 9, "rgba(10,8,6,0.5)");
      // Trails: two legs splayed behind the gun, ending in spades; on a wreck one is buckled short.
      g.fillStyle = steel;
      const rear = -dir;
      pxLine(g, cx + rear * 2, base - 6, cx + rear * (dead ? 8 : 15), base - 1);
      pxLine(g, cx + rear * 2, base - 5, cx + rear * (dead ? 8 : 15), base);
      pxLine(g, cx + rear * 2, base - 6, cx + rear * (dead ? 12 : 12), base + 3);
      pxLine(g, cx + rear * 2, base - 5, cx + rear * (dead ? 12 : 12), base + 4);
      g.fillStyle = tire;
      g.fillRect(cx + rear * (dead ? 8 : 15) - (rear > 0 ? 0 : 2), base - 1, 3, 3);
      if (!dead) g.fillRect(cx + rear * 12 - (rear > 0 ? 0 : 2), base + 3, 3, 2);
      // Far wheel, half hidden behind the carriage, then the cradle and axle.
      disc(cx - dir * 1, base - 8, 4, 4, tire);
      disc(cx - dir * 1, base - 8, 2, 2, steelL);
      px(cx - 4, base - 9, 9, 4, dead ? "#2a2822" : "#46522c");
      px(cx - 4, base - 9, 9, 1, dead ? "#4e4a42" : "#8a9c5a");
      px(cx - 4, base - 6, 9, 1, faceD);
      // Near wheel: a full tyre with rim, hub and spokes; collapsed flat on a wreck.
      if (dead) {
        disc(cx + dir * 2, base - 1, 6, 2, tire);
        px(cx + dir * 2 - 2, base - 2, 2, 1, steelL);
        px(cx + dir * 2 + 2, base - 1, 3, 1, steelL);
      } else {
        disc(cx + dir * 2, base - 4, 6, 6, tire);
        disc(cx + dir * 2, base - 4, 4, 4, steelL);
        disc(cx + dir * 2, base - 4, 3, 3, "#25251f");
        px(cx + dir * 2 - 3, base - 4, 7, 1, steelL);
        px(cx + dir * 2, base - 7, 1, 7, steelL);
        px(cx + dir * 2 - 1, base - 5, 2, 2, "#8a8a7c");
      }
      if (tx) {
        // Seen from the side: a slanted slab of shield and the barrel through its port.
        const sx = cx + dir * 4;
        const H = dead ? 8 : 12;
        for (let c = 0; c < 4; c++) {
          const col = dir > 0 ? sx + c : sx - c - 1;
          const lean = dead ? c * 2 : c;
          const jag = dead && c % 2 === 1 ? 2 : 0;
          const yTop = base - 6 - H + lean + jag;
          px(col, yTop, 1, H - jag, c === 0 ? topL : c === 3 ? faceD : top);
          if (c === 0 || c === 3) px(col, yTop, 1, 1, dead ? "#5a5648" : "#c8d4a0");
        }
        if (dead) px(sx + (dir > 0 ? 1 : -2), base - 11, 2, 2, "#0a0a07");
        else px(sx + (dir > 0 ? 0 : -1), base - 11, 2, 3, "#16160f");
        // Barrel: raised toward its aim; a wreck's lies drooped on the ground.
        const elev = dead ? 0 : Math.max(-3, Math.min(3, Math.round(-th.y * 4)));
        const x1 = cx + dir * 19, y1 = dead ? base - 1 : base - 11 - elev;
        g.fillStyle = dead ? "#1c1b18" : "#25251f";
        pxLine(g, sx + dir * 2, base - 10, x1, y1);
        pxLine(g, sx + dir * 2, base - 9, x1, y1 + 1);
        if (!dead) {
          g.fillStyle = "#6a6a5a";
          pxLine(g, sx + dir * 2, base - 11, x1, y1 - 1);
        }
        px(x1 - (dir < 0 ? 2 : 0), y1 - 1, 3, 3, "#0e0e0a");
      } else {
        // Seen end-on: the shield is a broad face, the barrel a short stub or a dark muzzle.
        const toward = th.y > 0;
        const H = dead ? 8 : 12;
        for (let c = -5; c <= 5; c++) {
          const jag = dead && Math.abs(c) % 2 === 1 ? 2 : 0;
          const yTop = base - 6 - H + jag + (dead ? Math.abs(c) : 0);
          px(cx + c, yTop, 1, H - jag, toward ? (c < -3 ? topL : top) : faceD);
        }
        px(cx - 5, base - 6 - H + (dead ? 5 : 0), 11, 1, toward ? topL : steel);
        if (dead) px(cx + 1, base - 12, 2, 2, "#0a0a07");
        if (toward) {
          disc(cx, base - 10, 2, 2, "#0e0e0a");
          px(cx - 1, base - 11, 2, 1, "#4a4a40");
        } else {
          px(cx - 1, base - 6 - H - 6, 2, 6, dead ? "#1c1b18" : "#25251f");
          px(cx - 2, base - 6 - H - 7, 4, 2, "#0e0e0a");
        }
      }
    }
    // Fire on a burning one, and on a wreck still burning out.
    if (t.state === "burning" || (t.state === "wrecked" && t.burnTick >= 0 && w.tick - t.burnTick < 140)) {
      const f = Math.floor(time * 9);
      for (let k = 0; k < 10; k++) {
        const ox = ((k * 7 + f * 3) % 22) - 11, oy = -((k * 5 + f * 2) % 16) - 4;
        px(cx + ox, cy + oy, 2, 2, k % 3 === 0 ? "#ffe070" : k % 3 === 1 ? "#ff9a2a" : "#e04a1a");
      }
    }
    if (selected || s.id === this.hovered) {
      g.fillStyle = selected ? "#ffe14a" : "#ffffff";
      pxEllipse(g, cx, cy + 4, 18, 8);
    }
  }

  /** Small badges over buildings with a sniper or a machine gun in them, and a star over each platoon leader. */
  private drawBadges(w: World, prev: Map<number, { x: number; y: number }>, time: number): void {
    const g = this.g;
    const blit = (rows: string[], x0: number, y0: number, color: string) => {
      // A heavy black outline, two pixels out, so the badge reads against any roof.
      g.fillStyle = "#000000";
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1], [-2, 0], [2, 0], [0, -2], [0, 2]] as const) {
        for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r]!.length; c++) if (rows[r]![c] === "x") g.fillRect(x0 + c + dx, y0 + r + dy, 1, 1);
      }
      g.fillStyle = color;
      for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r]!.length; c++) if (rows[r]![c] === "x") g.fillRect(x0 + c, y0 + r, 1, 1);
    };
    const inHouse = new Map<number, { sniper: Soldier | null; gun: Soldier | null }>();
    for (const s of w.soldiers) {
      if (s.status !== "active" && s.status !== "casualty") continue;
      if (s.role === "platoon_leader" && s.status === "active") {
        const p = this.worldPos(s, prev, this.alpha);
        const house = w.map.building[w.map.idx(s.x, s.y)]!;
        // A leader inside a house is shown on its roof with the other badges.
        if (house < 0 || !w.map.indoors(s.x, s.y, s.z)) blit(STAR_BADGE, Math.round(p.x) - 3, Math.round(p.y) - 18, s.side === "us" ? "#ffd84a" : "#ff6a5a");
      }
      const b = w.map.building[w.map.idx(s.x, s.y)]!;
      if (b < 0 || !w.map.indoors(s.x, s.y, s.z) || w.buildings[b]!.destroyed) continue;
      const rec = inHouse.get(b) ?? { sniper: null, gun: null };
      if (s.role === "sniper" && s.status === "active") rec.sniper = s;
      else if (s.status === "active" && (s.role === "machine_gunner" || s.role === "auto_rifleman" || s.weapon === "mg42")) rec.gun = s;
      else if (s.role === "platoon_leader" && s.status === "active") rec.gun = rec.gun ?? null;
      inHouse.set(b, rec);
    }
    for (const [id, rec] of inHouse) {
      const b = w.buildings[id]!;
      // Sits just over the highest point: the cross on a chapel's spire, the ridge of any other roof. Bobs gently.
      const cx = Math.round(b.x * TILE + (b.w * TILE) / 2);
      const top = b.kind === "church" ? (b.y + b.h) * TILE - (wallHeight(b) + 46) - 22 - 9 : b.y * TILE - wallHeight(b);
      const y = Math.round(top) - 3 + Math.round(Math.sin(time * 3.2 + id) * 1.6);
      const items: { rows: string[]; color: string; wd: number }[] = [];
      if (rec.sniper) items.push({ rows: CROSSHAIR_BADGE, color: rec.sniper.side === "us" ? "#ffd84a" : "#ff6a5a", wd: 9 });
      if (rec.gun) items.push({ rows: GUN_BADGE, color: rec.gun.side === "us" ? "#ffd84a" : "#ff6a5a", wd: 11 });
      let x = cx - Math.round((items.reduce((a, i) => a + i.wd + 3, -3)) / 2);
      for (const it of items) {
        blit(it.rows, x, y - it.rows.length, it.color);
        x += it.wd + 3;
      }
    }
  }

  /** A building at three-quarter view: its south wall and its roof. */
  private drawBuilding(w: World, b: Building): void {
    let c = this.houses.get(b.id);
    const stamp = w.map.version * 100000 + w.map.scars;
    if (!c || c.version !== stamp || c.world !== w) {
      // Only redraw when a shell has changed this house's own tiles.
      let look = b.destroyed ? "X" : "";
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) look += w.map.at(x, y)[0] + String(Math.min(9, w.map.roofHits[w.map.idx(x, y)]!)) + holeStep(w.map.holes[w.map.idx(x, y)]!) + blastStep(w.map.blasts[w.map.idx(x, y)]!);
      if (!c || c.world !== w || c.look !== look) c = { version: stamp, world: w, look, img: buildingSprite(w, b) };
      c.version = stamp;
      this.houses.set(b.id, c);
    }
    const B = buildingBounds(b);
    this.g.drawImage(c.img, B.x, B.y);
  }

  /**
   * How far gunfire and blasts shake the view, in screen pixels: hardest for
   * what is near the middle of the view, and only felt when zoomed in close.
   */
  private shake(time: number, cam: Camera, vw: number, vh: number): number {
    const close = Math.max(0, Math.min(1, (cam.zoom - 1.2) / 2.8));
    if (close === 0) return 0;
    const cx = cam.x + vw / cam.zoom / 2, cy = cam.y + vh / cam.zoom / 2;
    const reach = Math.hypot(vw, vh) / cam.zoom / 2;
    let blast = 0, shots = 0;
    for (const e of this.effects) {
      if (e.kind !== "boom" && e.kind !== "flash") continue;
      const T = time - e.born - e.delay;
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (e.kind === "boom") blast = Math.max(blast, blastShake(e.size, T) * Math.max(0, 1 - d / (reach * 2.5)));
      else shots += shotShake(e.r > 2.75, T) * Math.max(0, 1 - d / (reach * 1.3));
    }
    return (blast + Math.min(3, shots)) * close;
  }


  private drawSmoke(w: World, time: number): void {
    for (const c of w.clouds) drawSmokeCloud(this.g, c, w.tick, time);
  }

  private drawEffects(time: number, w: World, cam: Camera, prev: Map<number, { x: number; y: number }>): void {
    const g = this.g;
    const keep: Effect[] = [];
    for (const e of this.effects) {
      const t = (time - e.born - e.delay) / e.dur;
      if (t > 1) continue;
      keep.push(e);
      if (t < 0) continue;
      switch (e.kind) {
        case "tracer": {
          const by = e.by !== undefined ? w.maybe(e.by) : null;
          if (by && by.weapon) {
            const m = this.muzzleOf(by, prev);
            e.x0 = m.x;
            e.y0 = m.y;
          }
          const a = Math.max(0, t - 0.25), b = Math.min(1, t + 0.1);
          g.fillStyle = e.color;
          g.globalAlpha = 0.95;
          pxLine(g, e.x0 + (e.x1 - e.x0) * a, e.y0 + (e.y1 - e.y0) * a, e.x0 + (e.x1 - e.x0) * b, e.y0 + (e.y1 - e.y0) * b);
          g.globalAlpha = 1;
          break;
        }
        case "flash": {
          // From the muzzle as the man is drawn now: he may have dropped prone or turned.
          const by = e.by !== undefined ? w.maybe(e.by) : null;
          const m = by && by.weapon ? this.muzzleOf(by, prev) : e;
          muzzleFlash(g, m.x, m.y, e.r, t);
          break;
        }
        case "puff":
          dustSpurt(g, e.x, e.y, Math.floor(e.born * 1000 + e.x), t);
          break;
        case "signal": {
          // A packet of light running down the line, with a jagged trail behind it.
          const px = e.x0 + (e.x1 - e.x0) * t, py = e.y0 + (e.y1 - e.y0) * t;
          const len = Math.hypot(e.x1 - e.x0, e.y1 - e.y0) || 1;
          const ux = (e.x1 - e.x0) / len, uy = (e.y1 - e.y0) / len;
          g.fillStyle = "rgba(255,240,160,0.35)";
          pxLine(g, e.x0, e.y0, e.x1, e.y1, 3);
          for (let k = 0; k < 14; k++) {
            const back = k * 3.2;
            const jx = Math.round(Math.sin(k * 2.3 + t * 40) * 2.2), jy = Math.round(Math.cos(k * 1.7 + t * 33) * 2.2);
            g.fillStyle = k < 3 ? "#ffffff" : k < 8 ? e.color : "rgba(255,200,60,0.55)";
            g.fillRect(Math.round(px - ux * back + -uy * jx), Math.round(py - uy * back + ux * jx + jy * 0), 2, 2);
          }
          g.fillStyle = "#ffffff";
          g.fillRect(Math.round(px) - 2, Math.round(py) - 2, 5, 5);
          g.fillStyle = e.color;
          g.fillRect(Math.round(px) - 1, Math.round(py) - 1, 3, 3);
          // A bolt at each end as it leaves and arrives.
          if (t < 0.12 || t > 0.88) {
            g.fillStyle = "rgba(255,255,255,0.8)";
            pxEllipse(g, Math.round(t < 0.5 ? e.x0 : e.x1), Math.round(t < 0.5 ? e.y0 : e.y1), 5 + Math.round(Math.sin(t * 90) * 2), 5);
          }
          break;
        }
        case "round": {
          // A mortar round going up and coming down.
          const x = e.x0 + (e.x1 - e.x0) * t, ground = e.y0 + (e.y1 - e.y0) * t;
          const span = Math.hypot(e.x1 - e.x0, e.y1 - e.y0);
          const lift = Math.sin(Math.PI * t) * Math.min(90, 14 + span * 0.45);
          const y = ground - lift;
          g.fillStyle = "rgba(0,0,0,0.35)";
          g.fillRect(Math.round(x) - 1, Math.round(ground), 3, 1);
          for (let k = 1; k <= 7; k++) {
            const tt = Math.max(0, t - k * 0.012);
            const lx = e.x0 + (e.x1 - e.x0) * tt, ly = e.y0 + (e.y1 - e.y0) * tt - Math.sin(Math.PI * tt) * Math.min(90, 14 + span * 0.45);
            g.fillStyle = k < 3 ? "rgba(255,200,120,0.85)" : "rgba(210,210,200," + (0.6 - k * 0.07) + ")";
            g.fillRect(Math.round(lx), Math.round(ly), 2, 2);
          }
          g.fillStyle = "#1a1a12";
          g.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 5);
          g.fillStyle = "#b8b8a8";
          g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
          break;
        }
        case "boom":
          drawBlast(g, e, t * e.dur);
          break;
        case "pop":
          smokePop(g, e.x, e.y, e.seed, t * e.dur, e.dur);
          break;
        case "debris":
          drawDebris(g, e.x, e.y, e.seed, e.stuff, t * e.dur, e.dur);
          break;
        case "collapse":
          drawCollapse(g, e.x, e.y, e.w, e.h, e.seed, t * e.dur, e.dur);
          break;
        case "arc": {
          const x = Math.round(e.x0 + (e.x1 - e.x0) * t), gy = e.y0 + (e.y1 - e.y0) * t;
          const y = Math.round(gy - Math.sin(t * Math.PI) * 18);
          g.fillStyle = "rgba(10,14,6,0.35)";
          g.fillRect(x - 1, Math.round(gy) + 2, 3, 1);
          if (e.smoke) {
            g.fillStyle = "#e8e8e0";
            g.fillRect(Math.round(x - (e.x1 - e.x0) * 0.04) - 1, Math.round(y + 1), 1, 1);
          }
          g.fillStyle = "#14160e";
          g.fillRect(x - 1, y - 1, 3, 3);
          g.fillStyle = e.smoke ? "#c8c8c0" : "#3a4a28";
          g.fillRect(x - 1, y - 1, 2, 2);
          break;
        }
        case "shell":
          shellShadow(g, e.x, e.y, t);
          break;
        case "text": {
          let x = e.x, y = e.y;
          if (e.follow !== null) {
            const s = w.maybe(e.follow);
            if (s) {
              const p = this.worldPos(s, prev, this.alpha);
              x = p.x;
              y = p.y - 14;
            }
          }
          const fs = Math.max(4, 9 / Math.max(0.7, cam.zoom));
          g.font = `${fs}px "VT323", monospace`;
          const tw = g.measureText(e.text).width;
          g.globalAlpha = t > 0.8 ? (1 - t) * 5 : 1;
          g.fillStyle = "rgba(20,18,14,0.75)";
          g.fillRect(x - tw / 2 - 2, y - t * 4 - fs, tw + 4, fs + 2);
          g.fillStyle = e.color;
          g.fillText(e.text, x - tw / 2, y - t * 4 - 1);
          g.globalAlpha = 1;
          break;
        }
      }
    }
    this.effects = keep;
  }

  private drawOrders(w: World, prev: Map<number, { x: number; y: number }>): void {
    const g = this.g;
    for (const sq of w.squads) {
      const color = sq.color;
      for (const el of ["A", "B"] as const) {
        const o = sq.orders[el];
        if (sq.isHQ && el === "B") continue;
        for (const [id, pos] of Object.entries(o.positions)) {
          const s = w.maybe(Number(id));
          if (!s || !w.able(s)) continue;
          const p = this.worldPos(s, prev, this.alpha);
          const tx = pos.x * TILE + 8, ty = pos.y * TILE + 8;
          if (Math.hypot(tx - p.x, ty - p.y) < 6) continue;
          g.fillStyle = color;
          g.globalAlpha = 0.45;
          pxLine(g, p.x, p.y, tx, ty, o.kind === "move" || o.kind === "assault" || o.kind === "withdraw" ? 0 : 2);
          g.globalAlpha = 0.9;
          pxBox(g, Math.round(tx) - 2, Math.round(ty) - 2, 4, 4);
          g.globalAlpha = 1;
        }
        if (o.kind === "suppress" && o.target) {
          const tx = o.target.x * TILE + 8, ty = o.target.y * TILE + 8;
          g.fillStyle = color;
          g.globalAlpha = 0.85;
          pxEllipse(g, Math.round(tx), Math.round(ty), 10, 10);
          g.globalAlpha = 1;
        }
      }
      if (sq.focus && sq.state !== "advance") {
        const fx = sq.focus.x * TILE + 8, fy = sq.focus.y * TILE + 8;
        g.fillStyle = "#ff5a4a";
        for (const o of [0, 1]) {
          pxLine(g, fx - 4 + o, fy - 4, fx + 4 + o, fy + 4);
          pxLine(g, fx + 4 + o, fy - 4, fx - 4 + o, fy + 4);
        }
      }
      if (sq.flankPoint && (sq.state === "flank" || sq.state === "assault")) {
        const fx = sq.flankPoint.x * TILE + 8, fy = sq.flankPoint.y * TILE + 8;
        g.fillStyle = color;
        pxEllipse(g, Math.round(fx), Math.round(fy), 14, 14, 3);
      }
    }
  }

  private drawSight(w: World, s: Soldier, prev: Map<number, { x: number; y: number }>): void {
    const g = this.g;
    const p = this.worldPos(s, prev, this.alpha);
    for (const id of s.sees) {
      const e = w.maybe(id);
      if (!e) continue;
      const q = this.worldPos(e, prev, this.alpha);
      g.fillStyle = "rgba(255,225,74,0.7)";
      pxLine(g, p.x, p.y, q.x, q.y, 3);
    }
    if (s.underFire && w.tick - s.underFire.tick < 10) {
      g.fillStyle = "rgba(255,90,74,0.75)";
      pxEllipse(g, Math.round(s.underFire.x * TILE + 8), Math.round(s.underFire.y * TILE + 8), 6, 6);
    }
  }

  /** Per squad: when it last spotted contact, and what it last decided (shown briefly on its banner). */
  squadFlash = new Map<number, { contact: number; decision: string; decidedAt: number }>();

  /** Zoomed right out: a banner over each squad saying what it is doing, how many are able, and what it just noticed or decided. */
  private drawSquadBanners(w: World, cam: Camera, prev: Map<number, { x: number; y: number }>, time: number): void {
    const g = this.g;
    const k = 1 / cam.zoom;
    const fs = 12 * k;
    g.font = `${fs}px "VT323", monospace`;
    for (const sq of w.squads) {
      let n = 0, cx = 0, top = Infinity;
      for (const id of sq.members) {
        const s = w.maybe(id);
        if (!s || !w.able(s)) continue;
        const p = this.worldPos(s, prev, this.alpha);
        cx += p.x;
        top = Math.min(top, p.y);
        n++;
      }
      if (n === 0) continue;
      cx /= n;
      const fl = this.squadFlash.get(sq.id);
      const spotted = fl ? time - fl.contact : Infinity;
      const decided = fl ? time - fl.decidedAt : Infinity;
      const title = `${sq.name} · ${SQUAD_DOING[sq.state] ?? sq.state} · ${n}/${sq.members.length}`;
      const sub = decided < 6 && fl ? `→ ${fl.decision}` : "";
      const pad = 4 * k, icon = spotted < 5 ? fs + pad : 0;
      const tw = Math.max(g.measureText(title).width, sub ? g.measureText(sub).width : 0);
      const rows = sub ? 2 : 1, h = fs * rows + pad * (rows + 1) * 0.6;
      const flagW = Math.round(fs * 1.5);
      const wBox = tw + pad * 2 + icon + flagW + pad;
      const x = Math.round(cx - wBox / 2), y = Math.round(top - 10 * k - h);
      g.fillStyle = "rgba(20,18,14,0.85)";
      g.fillRect(x, y, wBox, h);
      g.fillStyle = sq.color;
      g.fillRect(x, y, pad * 0.7, h);
      // The side's flag, so the two armies can be told apart at a glance.
      const fx = x + pad * 1.2, fy = y + pad * 0.6, fh = Math.round(fs * 0.95);
      if (sq.side === "us") {
        for (let r = 0; r < 5; r++) {
          g.fillStyle = r % 2 === 0 ? "#c8302a" : "#f2f0e6";
          g.fillRect(fx, fy + (fh * r) / 5, flagW, fh / 5 + 0.01);
        }
        g.fillStyle = "#2a3f8a";
        g.fillRect(fx, fy, flagW * 0.45, fh * 0.6);
      } else {
        const cols = ["#16140f", "#f2f0e6", "#c8302a"];
        for (let r = 0; r < 3; r++) {
          g.fillStyle = cols[r]!;
          g.fillRect(fx, fy + (fh * r) / 3, flagW, fh / 3 + 0.01);
        }
      }
      g.strokeStyle = "rgba(0,0,0,0.7)";
      g.lineWidth = Math.max(0.5, k * 0.8);
      g.strokeRect(fx, fy, flagW, fh);
      let tx = fx + flagW + pad;
      if (icon) {
        // A bold red warning block that blinks while the contact is fresh.
        const on = spotted > 2 || Math.floor(spotted * 6) % 2 === 0;
        g.fillStyle = on ? "#e8442e" : "#8a2a1e";
        g.fillRect(tx, y + pad * 0.6, fs, fs + pad * 0.4);
        g.fillStyle = "#fff4d8";
        g.fillText("!", tx + fs * 0.36, y + pad * 0.6 + fs * 0.9);
        tx += icon;
      }
      g.fillStyle = "#e8e8d0";
      g.fillText(title, tx, y + pad * 0.6 + fs * 0.85);
      if (sub) {
        g.fillStyle = "#ffe070";
        g.fillText(sub, tx, y + pad * 0.6 + fs * 1.85 + pad * 0.4);
      }
    }
  }

  private drawNames(w: World, cam: Camera, prev: Map<number, { x: number; y: number }>): void {
    const g = this.g;
    const fs = Math.max(4, 8 / Math.max(0.8, cam.zoom));
    g.font = `${fs}px "VT323", monospace`;
    for (const s of w.soldiers) {
      if (!(w.onField(s) || s.status === "surrendered" || s.status === "captured") || s.carriedById !== null) continue;
      const p = this.worldPos(s, prev, this.alpha);
      const text = s.last;
      const tw = g.measureText(text).width;
      g.fillStyle = "rgba(0,0,0,0.6)";
      g.fillText(text, p.x - tw / 2 + 0.5, p.y + 13.5);
      g.fillStyle = SIDE_COLORS[s.side].name;
      g.fillText(text, p.x - tw / 2, p.y + 13);
    }
  }
}

/** Below this zoom, squads get an activity banner. */
const SQUAD_BANNER_ZOOM = 0.9;
/** Over this much more zoom the banners crossfade out instead of vanishing. */
const SQUAD_BANNER_FADE = 0.25;

const SQUAD_DOING: Record<string, string> = {
  deploy: "Deploying",
  advance: "Advancing",
  react: "Reacting",
  fix: "Pinning the enemy",
  flank: "Flanking",
  assault: "Assaulting",
  consolidate: "Consolidating",
  hold: "Holding",
  fall_back: "Falling back",
  withdraw: "Withdrawing",
  broken: "Broken",
  support: "Giving fire support",
  displace: "Under mortar fire",
  ambush: "In ambush",
  reinforce: "Reinforcing",
  stage: "Waiting to go in",
};

/** A line in square 1-pixel blocks (Bresenham); `dash` > 0 draws that many on, that many off. */
function pxLine(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, dash = 0): void {
  let x = Math.round(x0), y = Math.round(y0);
  const X = Math.round(x1), Y = Math.round(y1);
  const dx = Math.abs(X - x), dy = -Math.abs(Y - y), sx = x < X ? 1 : -1, sy = y < Y ? 1 : -1;
  let err = dx + dy, n = 0;
  for (let guard = 0; guard < 5000; guard++) {
    if (dash === 0 || n % (dash * 2) < dash) g.fillRect(x, y, 1, 1);
    n++;
    if (x === X && y === Y) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** An ellipse outline in square 1-pixel blocks. */
function pxEllipse(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, dash = 0): void {
  const n = Math.max(12, Math.ceil(Math.PI * 2 * Math.max(rx, ry)));
  let lx = NaN, ly = NaN, k = 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * rx), y = Math.round(cy + Math.sin(a) * ry);
    if (x === lx && y === ly) continue;
    lx = x;
    ly = y;
    if (dash === 0 || k++ % (dash * 2) < dash) g.fillRect(x, y, 1, 1);
  }
}

/** A hollow square in 1-pixel blocks. */
function pxBox(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.fillRect(x, y, w, 1);
  g.fillRect(x, y + h - 1, w, 1);
  g.fillRect(x, y, 1, h);
  g.fillRect(x + w - 1, y, 1, h);
}

/** The whole field in miniature, with both sides as dots and the camera's view. */
export function drawMinimap(canvas: HTMLCanvasElement, w: World, cam: Camera, viewW: number, viewH: number, base: { img: ImageData | null; version: number; world: World | null }): void {
  const W = w.map.width, H = w.map.height;
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const g = canvas.getContext("2d")!;
  if (!base.img || base.version !== w.map.version || base.world !== w) {
    const img = g.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const n = parseInt(MINI[w.map.terrain[i]!].slice(1), 16);
      img.data[i * 4] = (n >> 16) & 255;
      img.data[i * 4 + 1] = (n >> 8) & 255;
      img.data[i * 4 + 2] = n & 255;
      img.data[i * 4 + 3] = 255;
      // Dotted grid lines, so a square named under the map can be found on it.
      const x = i % W, y = (i - x) / W;
      if ((x % GRID === 0 || y % GRID === 0) && (x + y) % 2 === 0) for (let c = 0; c < 3; c++) img.data[i * 4 + c] = img.data[i * 4 + c]! * 0.55;
    }
    base.img = img;
    base.version = w.map.version;
    base.world = w;
  }
  g.putImageData(base.img, 0, 0);
  for (const s of w.soldiers) {
    if (s.status === "routed" || s.status === "aboard" || s.carriedById !== null) continue;
    if (s.role === "tank" || s.role === "field_gun") {
      // Armour: a bigger block with a dark ring, grey when knocked out.
      const t = w.tanks.get(s.id);
      const live = t !== undefined && (t.state === "ready" || t.state === "tracked");
      g.fillStyle = "#000000";
      g.fillRect(s.x - 2, s.y - 2, 5, 5);
      g.fillStyle = live ? (s.side === "us" ? "#ffd84a" : "#ff5a5a") : "#808078";
      g.fillRect(s.x - 1, s.y - 1, 3, 3);
      continue;
    }
    g.fillStyle = s.status === "dead" ? "#000" : s.status === "active" ? (s.side === "us" ? "#ffd84a" : "#ff5a5a") : "#f4f0e8";
    g.fillRect(s.x, s.y, s.status === "active" ? 2 : 1, s.status === "active" ? 2 : 1);
  }
  // Points of interest: where mortar and artillery rounds have landed, where they are about to, and each headquarters.
  const px = (x: number, y: number, c: string, n = 1) => {
    g.fillStyle = c;
    g.fillRect(Math.round(x), Math.round(y), n, n);
  };
  for (const im of w.impacts) {
    if (im.kind !== "mortar" && im.kind !== "artillery") continue;
    const age = w.tick - im.tick;
    const r = im.kind === "artillery" ? 3 : 2;
    const col = age < 15 ? "#ffffff" : age < 40 ? "#ff9a2a" : "#b8481e";
    const x = im.x, y = im.y;
    for (let k = -r; k <= r; k++) {
      px(x + k, y, col);
      px(x, y + k, col);
    }
    px(x, y, "#fff4c8");
  }
  for (const o of w.ordnance) {
    if ((o.kind !== "mortar" && o.kind !== "artillery") || o.burstTick <= w.tick) continue;
    // A round in the air: a blinking ring where it will land.
    if (Math.floor(w.tick) % 2 !== 0 && o.burstTick - w.tick > 1) continue;
    const r = o.kind === "artillery" ? 4 : 3;
    for (const [dx, dy] of [[-r, -r], [r, -r], [-r, r], [r, r], [0, -r], [0, r], [-r, 0], [r, 0]] as const) px(o.x + dx, o.y + dy, "#ff3a2a");
  }
  for (const side of ["us", "de"] as const) {
    const pl = w.platoons[side];
    if (!pl) continue;
    const hq = w.squad(pl.hqSquadId);
    const men = hq.members.map((id) => w.soldier(id)).filter((m) => m.status !== "dead" && m.status !== "routed" && m.carriedById === null);
    if (men.length === 0) continue;
    const cx = men.reduce((a, m) => a + m.x, 0) / men.length, cy = men.reduce((a, m) => a + m.y, 0) / men.length;
    const col = side === "us" ? "#ffd84a" : "#ff5a5a";
    // A hollow square with a dark ring round it, so it reads on any ground.
    g.fillStyle = "#000000";
    g.fillRect(Math.round(cx) - 3, Math.round(cy) - 3, 7, 7);
    g.fillStyle = col;
    g.fillRect(Math.round(cx) - 2, Math.round(cy) - 2, 5, 5);
    g.fillStyle = "#000000";
    g.fillRect(Math.round(cx) - 1, Math.round(cy) - 1, 3, 3);
    px(cx, cy, col);
    if (pl.mortarPit) {
      px(pl.mortarPit.x, pl.mortarPit.y - 1, col);
      px(pl.mortarPit.x - 1, pl.mortarPit.y, col);
      px(pl.mortarPit.x + 1, pl.mortarPit.y, col);
      px(pl.mortarPit.x, pl.mortarPit.y + 1, col);
    }
  }
  g.strokeStyle = "#fff";
  g.lineWidth = 1;
  g.strokeRect(cam.x / TILE, cam.y / TILE, viewW / cam.zoom / TILE, viewH / cam.zoom / TILE);
}
