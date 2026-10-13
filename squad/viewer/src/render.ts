// Draws the battlefield: bocage terrain, the hamlet, soldiers, smoke, tracers
// and explosions, and the overlays (orders, sight lines, names).
import { cannotWalk } from "../../src/entities/body.ts";
import type { Building } from "../../src/world/layout.ts";
import type { Soldier, Terrain } from "../../src/world/types.ts";
import type { World } from "../../src/world/world.ts";
import { blastShake, drawBlast, shotShake, drawSmokeCloud, dustSpurt, muzzleFlash, shellShadow, smokePop } from "./fx.ts";
import { Flora, buildingBounds, buildingShadow, buildingSprite, groundShadow, pick, type Prop } from "./scenery.ts";
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
  | { kind: "tracer"; x0: number; y0: number; x1: number; y1: number; color: string; born: number; dur: number; delay: number }
  | { kind: "flash"; x: number; y: number; born: number; dur: number; delay: number; r: number }
  | { kind: "puff"; x: number; y: number; born: number; dur: number; delay: number; color: string }
  | { kind: "boom"; x: number; y: number; born: number; dur: number; delay: number; size: number; seed: number }
  | { kind: "pop"; x: number; y: number; born: number; dur: number; delay: number; seed: number }
  | { kind: "arc"; x0: number; y0: number; x1: number; y1: number; born: number; dur: number; delay: number; smoke: boolean }
  | { kind: "shell"; x: number; y: number; born: number; dur: number; delay: number }
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
};

/** Colours for the minimap. */
export const MINI: Record<Terrain, string> = { ...BASE, hedge: "#24481e", woods: "#2a5022", orchard: "#4a7a30", building: "#4a4038", window: "#4a4038", crater: "#5a4630", foxhole: "#3a2e20" };

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
 * The ground and everything growing on it, drawn once into one big canvas.
 * When shells change a few tiles, only those tiles are painted again.
 */
class TerrainLayer {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly seen: Terrain[];
  private props: Placed[] = [];
  readonly world: World;
  version: number;

  constructor(w: World) {
    this.world = w;
    this.canvas = document.createElement("canvas");
    this.canvas.width = w.map.width * TILE;
    this.canvas.height = w.map.height * TILE;
    this.g = this.canvas.getContext("2d")!;
    for (let ty = 0; ty < w.map.height; ty++) for (let tx = 0; tx < w.map.width; tx++) drawTile(this.g, w, tx, ty);
    for (let ty = 0; ty < w.map.height; ty++) for (let tx = 0; tx < w.map.width; tx++) propsAt(w, tx, ty, this.props);
    this.props.sort(backToFront);
    drawProps(this.g, w, this.props);
    this.seen = [...w.map.terrain];
    this.version = w.map.version;
  }

  update(): void {
    const w = this.world, g = this.g;
    this.version = w.map.version;
    const changed: number[] = [];
    for (let i = 0; i < this.seen.length; i++) if (this.seen[i] !== w.map.terrain[i]) changed.push(i);
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
        drawProps(g, w, props, box);
        g.restore();
      }
    }
  }
}

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
    const key = `${s.id}|${posture}|${walking ? 1 : 0}|${s.dir}|${s.status}`;
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
    const g = this.g;
    const dpr = window.devicePixelRatio || 1;
    const vw = this.canvas.width / dpr, vh = this.canvas.height / dpr;
    if (!this.terrain || this.terrain.world !== w) this.terrain = new TerrainLayer(w);
    else if (this.terrain.version !== w.map.version) this.terrain.update();
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

    // The fallen first, then everyone else from back to front.
    const sel = selected !== null ? w.maybe(selected) : null;
    const order = w.soldiers.filter((s) => s.status !== "routed" && s.carriedById === null).sort((a, b) => (a.status === "dead" ? 0 : 1) - (b.status === "dead" ? 0 : 1) || a.y - b.y || a.id - b.id);
    for (const s of order) {
      const p = this.worldPos(s, prev, alpha);
      if (!visible(p.x, p.y)) continue;
      if (s.status === "dead" || s.bloodied) {
        if (s.status === "dead" || s.status === "casualty") {
          g.fillStyle = "rgba(120,10,10,0.55)";
          g.beginPath();
          g.ellipse(p.x, p.y + 4, s.status === "dead" ? 7 : 4, s.status === "dead" ? 3.5 : 2, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
      this.drawSoldier(w, s, p, prev, time, s === sel);
    }

    // Roofs, unless looking inside.
    for (const b of w.buildings) {
      const inside = sel && w.map.building[w.map.idx(sel.x, sel.y)] === b.id;
      if (!opts.roofs || b.id === this.hoverBuilding || inside) continue;
      this.drawBuilding(w, b);
    }

    this.drawSmoke(w, time);
    this.drawEffects(time, w, cam, prev);
    if (opts.orders) this.drawOrders(w, prev);
    if (sel && opts.sight) this.drawSight(w, sel, prev);
    if (opts.names) this.drawNames(w, cam, prev);
  }

  private drawFlag(x: number, y: number, color: string): void {
    const g = this.g;
    g.fillStyle = "#3a2a1a";
    g.fillRect(x - 1, y - 18, 2, 20);
    g.fillStyle = color;
    g.fillRect(x + 1, y - 18, 10, 6);
    g.strokeStyle = "rgba(0,0,0,0.5)";
    g.lineWidth = 1;
    g.strokeRect(x + 1, y - 18, 10, 6);
  }

  private drawSoldier(w: World, s: Soldier, p: { x: number; y: number }, prev: Map<number, { x: number; y: number }>, time: number, selected: boolean): void {
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
    if (selected) {
      g.strokeStyle = "#ffe14a";
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(p.x, p.y + 5, 8, 4, 0, 0, Math.PI * 2);
      g.stroke();
    }
    const bob = walking ? (step ? -1 : 0) : 0;
    const prone = spr.width > spr.height;
    // Sprites carry a one-pixel outline; place and dress the figure inside it.
    const iw = spr.width - 2, ih = spr.height - 2;
    const sx = Math.round(p.x - iw / 2), sy = Math.round(p.y + (prone ? 6 - ih : 7 - ih) + bob);
    if (s.status === "captured") g.globalAlpha = 0.75;
    g.drawImage(spr, sx - 1, sy - 1);
    g.globalAlpha = 1;
    // The weapon.
    if (s.weapon && s.status === "active") {
      const big = s.weapon === "mg42" || s.weapon === "bar";
      g.fillStyle = "#2a2420";
      const len = big ? 7 : s.weapon === "thompson" || s.weapon === "mp40" ? 4 : 6;
      if (prone) g.fillRect(s.dir < 0 ? sx - len + 2 : sx + iw - 2, sy + 1, len, 1);
      else g.fillRect(s.dir < 0 ? sx - len + 3 : sx + iw - 3, sy + (s.posture === "crouch" ? 4 : 6), len, big ? 2 : 1);
      if (big && prone) {
        g.fillStyle = "#3a3430";
        g.fillRect(s.dir < 0 ? sx - len + 2 : sx + iw + len - 4, sy + 2, 1, 2);
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
      mark = "⚐";
      col = "#f4f0e8";
    } else if (s.status === "active" && s.broken) {
      mark = "!";
      col = "#b08ae8";
    } else if (s.status === "active" && s.pinned) {
      mark = "▼";
      col = "#f0963a";
    }
    if (mark) {
      g.font = "bold 7px monospace";
      g.fillStyle = "#000a";
      g.fillText(mark, p.x - 2, sy - 1);
      g.fillStyle = col;
      g.fillText(mark, p.x - 2.5, sy - 1.5);
    }
  }

  /** A building at three-quarter view: its south wall and its roof. */
  private drawBuilding(w: World, b: Building): void {
    let c = this.houses.get(b.id);
    if (!c || c.version !== w.map.version || c.world !== w) {
      // Only redraw when a shell has changed this house's own tiles.
      let look = "";
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) look += w.map.at(x, y)[0];
      if (!c || c.world !== w || c.look !== look) c = { version: w.map.version, world: w, look, img: buildingSprite(w, b) };
      c.version = w.map.version;
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
          const a = Math.max(0, t - 0.25), b = Math.min(1, t + 0.1);
          g.strokeStyle = e.color;
          g.globalAlpha = 0.9;
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(e.x0 + (e.x1 - e.x0) * a, e.y0 + (e.y1 - e.y0) * a);
          g.lineTo(e.x0 + (e.x1 - e.x0) * b, e.y0 + (e.y1 - e.y0) * b);
          g.stroke();
          g.globalAlpha = 1;
          break;
        }
        case "flash":
          muzzleFlash(g, e.x, e.y, e.r, t);
          break;
        case "puff":
          dustSpurt(g, e.x, e.y, Math.floor(e.born * 1000 + e.x), t);
          break;
        case "boom":
          drawBlast(g, e, t * e.dur);
          break;
        case "pop":
          smokePop(g, e.x, e.y, e.seed, t * e.dur, e.dur);
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
          g.strokeStyle = color;
          g.globalAlpha = 0.35;
          g.lineWidth = 1;
          g.setLineDash(o.kind === "move" || o.kind === "assault" || o.kind === "withdraw" ? [] : [2, 2]);
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(tx, ty);
          g.stroke();
          g.setLineDash([]);
          g.globalAlpha = 0.8;
          g.strokeRect(tx - 2, ty - 2, 4, 4);
          g.globalAlpha = 1;
        }
        if (o.kind === "suppress" && o.target) {
          const tx = o.target.x * TILE + 8, ty = o.target.y * TILE + 8;
          g.strokeStyle = color;
          g.globalAlpha = 0.7;
          g.beginPath();
          g.arc(tx, ty, 10, 0, Math.PI * 2);
          g.stroke();
          g.globalAlpha = 1;
        }
      }
      if (sq.focus && sq.state !== "advance") {
        const fx = sq.focus.x * TILE + 8, fy = sq.focus.y * TILE + 8;
        g.strokeStyle = "#ff5a4a";
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(fx - 4, fy - 4);
        g.lineTo(fx + 4, fy + 4);
        g.moveTo(fx + 4, fy - 4);
        g.lineTo(fx - 4, fy + 4);
        g.stroke();
      }
      if (sq.flankPoint && (sq.state === "flank" || sq.state === "assault")) {
        const fx = sq.flankPoint.x * TILE + 8, fy = sq.flankPoint.y * TILE + 8;
        g.strokeStyle = color;
        g.lineWidth = 1.5;
        g.setLineDash([4, 3]);
        g.beginPath();
        g.arc(fx, fy, 14, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
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
      g.strokeStyle = "rgba(255,225,74,0.55)";
      g.lineWidth = 0.8;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(q.x, q.y);
      g.stroke();
      g.setLineDash([]);
    }
    if (s.underFire && w.tick - s.underFire.tick < 10) {
      g.strokeStyle = "rgba(255,90,74,0.6)";
      g.beginPath();
      g.arc(s.underFire.x * TILE + 8, s.underFire.y * TILE + 8, 6, 0, Math.PI * 2);
      g.stroke();
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
    }
    base.img = img;
    base.version = w.map.version;
    base.world = w;
  }
  g.putImageData(base.img, 0, 0);
  for (const s of w.soldiers) {
    if (s.status === "routed" || s.carriedById !== null) continue;
    g.fillStyle = s.status === "dead" ? "#000" : s.status === "active" ? (s.side === "us" ? "#ffd84a" : "#ff5a5a") : "#f4f0e8";
    g.fillRect(s.x, s.y, s.status === "active" ? 2 : 1, s.status === "active" ? 2 : 1);
  }
  g.strokeStyle = "#fff";
  g.lineWidth = 1;
  g.strokeRect(cam.x / TILE, cam.y / TILE, viewW / cam.zoom / TILE, viewH / cam.zoom / TILE);
}
