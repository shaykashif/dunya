// Draws the battlefield: bocage terrain, the hamlet, soldiers, smoke, tracers
// and explosions, and the overlays (orders, sight lines, names).
import { cannotWalk } from "../../src/entities/body.ts";
import type { Building } from "../../src/world/layout.ts";
import type { Soldier, Terrain } from "../../src/world/types.ts";
import type { World } from "../../src/world/world.ts";
import { SIDE_COLORS, TILE, hash2, shade, soldierSprite } from "./sprites.ts";

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
  | { kind: "boom"; x: number; y: number; born: number; dur: number; delay: number; r: number }
  | { kind: "arc"; x0: number; y0: number; x1: number; y1: number; born: number; dur: number; delay: number; smoke: boolean }
  | { kind: "shell"; x: number; y: number; born: number; dur: number; delay: number }
  | { kind: "text"; x: number; y: number; text: string; color: string; born: number; dur: number; delay: number; follow: number | null };

const BASE: Record<Terrain, string> = {
  grass: "#5d8a3a",
  wheat: "#c4a44a",
  road: "#9a8058",
  orchard: "#5a8a3c",
  woods: "#33602a",
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

function drawTerrain(w: World): HTMLCanvasElement {
  const W = w.map.width, H = w.map.height;
  const c = document.createElement("canvas");
  c.width = W * TILE;
  c.height = H * TILE;
  const g = c.getContext("2d")!;
  const px = (x: number, y: number, col: string, ww = 1, hh = 1) => {
    g.fillStyle = col;
    g.fillRect(x, y, ww, hh);
  };
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
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
        g.fillStyle = "#6a5236";
        g.beginPath();
        g.ellipse(x + 8, y + 8, 7, 6, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#4a3a26";
        g.beginPath();
        g.ellipse(x + 8, y + 9, 4.5, 3.5, 0, 0, Math.PI * 2);
        g.fill();
      } else if (t === "foxhole") {
        px(x + 2, y + 3, "#7a6040", 12, 10);
        px(x + 4, y + 5, "#2a2218", 8, 6);
      }
    }
  }
  // Hedgerows: an earthen bank under a dense mass of brush and small trees.
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      if (w.map.at(tx, ty) !== "hedge") continue;
      const x = tx * TILE, y = ty * TILE;
      px(x, y + 2, "#6a5638", TILE, TILE - 2);
      for (let k = 0; k < 5; k++) {
        const bx = x + 2 + hash2(tx, ty, k + 40) * 12, by = y + 2 + hash2(tx, ty, k + 50) * 10;
        const rr = 4 + hash2(tx, ty, k + 60) * 4;
        g.fillStyle = k % 3 === 0 ? "#1f3f18" : k % 3 === 1 ? "#2e5a24" : "#3d7030";
        g.beginPath();
        g.arc(bx, by, rr, 0, Math.PI * 2);
        g.fill();
      }
      for (let k = 0; k < 4; k++) px(x + Math.floor(hash2(tx, ty, k + 70) * 15), y + Math.floor(hash2(tx, ty, k + 80) * 12), "#5a9a40", 2, 1);
    }
  }
  // Woods and orchard trees.
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const t = w.map.at(tx, ty);
      const x = tx * TILE + 8, y = ty * TILE + 8;
      if (t === "woods") {
        const rr = 8 + hash2(tx, ty, 90) * 4;
        g.fillStyle = "#24481e";
        g.beginPath();
        g.arc(x + 1, y + 2, rr, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = hash2(tx, ty, 91) < 0.5 ? "#3a6a2e" : "#33622a";
        g.beginPath();
        g.arc(x - 1, y - 1, rr - 2, 0, Math.PI * 2);
        g.fill();
        px(x - 3, y - 4, "#4a7a36", 3, 2);
      } else if (t === "orchard" && (tx + ty * 2) % 4 === 0 && ty % 2 === 0) {
        px(x - 1, y + 2, "#5a3a20", 2, 5);
        g.fillStyle = "#2e6024";
        g.beginPath();
        g.arc(x, y - 1, 6, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#3d7a30";
        g.beginPath();
        g.arc(x - 1, y - 2, 4, 0, Math.PI * 2);
        g.fill();
        for (let k = 0; k < 3; k++) px(x - 4 + Math.floor(hash2(tx, ty, k + 95) * 8), y - 5 + Math.floor(hash2(tx, ty, k + 99) * 7), "#c83a2a", 1, 1);
      }
    }
  }
  return c;
}

const ROOF: Record<Building["kind"], [string, string]> = {
  farmhouse: ["#8a4a3a", "#6a3428"],
  barn: ["#9a8048", "#7a6236"],
  cottage: ["#5e5e68", "#46464e"],
  church: ["#54545e", "#3e3e46"],
};

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private terrain: HTMLCanvasElement | null = null;
  private terrainVersion = -1;
  private terrainWorld: World | null = null;
  private effects: Effect[] = [];
  private readonly spriteCache = new Map<string, HTMLCanvasElement>();
  hoverBuilding = -1;
  alpha = 1;
  trails = new Map<number, number[]>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d")!;
  }

  reset(): void {
    this.terrain = null;
    this.terrainVersion = -1;
    this.effects = [];
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
    if (!this.terrain || this.terrainVersion !== w.map.version || this.terrainWorld !== w) {
      this.terrain = drawTerrain(w);
      this.terrainVersion = w.map.version;
      this.terrainWorld = w;
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#1a1c14";
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, -cam.x * dpr * cam.zoom, -cam.y * dpr * cam.zoom);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.terrain, 0, 0);
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
      this.drawRoof(w, b);
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
    const sx = Math.round(p.x - spr.width / 2), sy = Math.round(p.y + (prone ? 6 - spr.height : 7 - spr.height) + bob);
    if (s.status === "captured") g.globalAlpha = 0.75;
    g.drawImage(spr, sx, sy);
    g.globalAlpha = 1;
    // The weapon.
    if (s.weapon && s.status === "active") {
      const big = s.weapon === "mg42" || s.weapon === "bar";
      g.fillStyle = "#2a2420";
      const len = big ? 7 : s.weapon === "thompson" || s.weapon === "mp40" ? 4 : 6;
      if (prone) g.fillRect(s.dir < 0 ? sx - len + 2 : sx + spr.width - 2, sy + 1, len, 1);
      else g.fillRect(s.dir < 0 ? sx - len + 3 : sx + spr.width - 3, sy + (s.posture === "crouch" ? 4 : 6), len, big ? 2 : 1);
      if (big && prone) {
        g.fillStyle = "#3a3430";
        g.fillRect(s.dir < 0 ? sx - len + 2 : sx + spr.width + len - 4, sy + 2, 1, 2);
      }
    }
    // Carrying a wounded man over the shoulder.
    if (s.carryingId !== null) {
      g.fillStyle = SIDE_COLORS[w.soldier(s.carryingId).side].coat;
      g.fillRect(sx - 2, sy + 2, spr.width + 4, 3);
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

  private drawRoof(w: World, b: Building): void {
    const g = this.g;
    const [roof, dark] = ROOF[b.kind];
    const x = b.x * TILE - 2, y = b.y * TILE - 3, ww = b.w * TILE + 4, hh = b.h * TILE + 4;
    g.fillStyle = dark;
    g.fillRect(x, y + 2, ww, hh);
    g.fillStyle = roof;
    g.fillRect(x, y, ww, hh - 2);
    g.fillStyle = dark;
    const horiz = b.w >= b.h;
    if (horiz) {
      for (let yy = y + 4; yy < y + hh - 2; yy += 5) g.fillRect(x, yy, ww, 1);
      g.fillStyle = shade(roof, 1.2);
      g.fillRect(x, y + Math.floor(hh / 2) - 1, ww, 2);
    } else {
      for (let xx = x + 4; xx < x + ww; xx += 5) g.fillRect(xx, y, 1, hh - 2);
      g.fillStyle = shade(roof, 1.2);
      g.fillRect(x + Math.floor(ww / 2) - 1, y, 2, hh - 2);
    }
    // Shell holes in the roof.
    for (let yy = b.y; yy < b.y + b.h; yy++) {
      for (let xx = b.x; xx < b.x + b.w; xx++) {
        if (w.map.at(xx, yy) !== "rubble") continue;
        g.fillStyle = "#2a2218";
        g.fillRect(xx * TILE + 2, yy * TILE + 2, 12, 12);
      }
    }
    if (b.kind === "church") {
      g.fillStyle = "#6e6a62";
      g.fillRect(x + ww / 2 - 7, y - 8, 14, 16);
      g.fillStyle = "#3a3a42";
      g.fillRect(x + ww / 2 - 8, y - 10, 16, 4);
      g.fillStyle = "#c8c0a0";
      g.fillRect(x + ww / 2 - 1, y - 18, 2, 8);
      g.fillRect(x + ww / 2 - 3, y - 15, 6, 2);
    }
  }

  private drawSmoke(w: World, time: number): void {
    const g = this.g;
    for (const c of w.clouds) {
      const age = w.tick - c.born;
      const grow = Math.min(1, 0.3 + age / 8);
      const fade = Math.min(1, (c.until - w.tick) / 25);
      const cx = (c.x + age * 0.02) * TILE + 8, cy = c.y * TILE + 8;
      const r = c.radius * grow * TILE;
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2 + time * 0.1 + c.id;
        const d = r * 0.45 * (0.6 + 0.4 * hash2(c.id, k));
        g.fillStyle = `rgba(228,228,220,${0.32 * fade})`;
        g.beginPath();
        g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, r * 0.55, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = `rgba(240,240,234,${0.45 * fade})`;
      g.beginPath();
      g.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
      g.fill();
    }
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
        case "flash": {
          g.fillStyle = `rgba(255,236,150,${1 - t})`;
          g.beginPath();
          g.arc(e.x, e.y, e.r * (1 - t * 0.5), 0, Math.PI * 2);
          g.fill();
          break;
        }
        case "puff": {
          g.fillStyle = e.color.replace("A", String(0.6 * (1 - t)));
          g.beginPath();
          g.arc(e.x, e.y, 1.5 + t * 3, 0, Math.PI * 2);
          g.fill();
          break;
        }
        case "boom": {
          const r = e.r * (0.3 + t);
          if (t < 0.25) {
            g.fillStyle = `rgba(255,240,170,${1 - t * 3})`;
            g.beginPath();
            g.arc(e.x, e.y, r * 0.8, 0, Math.PI * 2);
            g.fill();
          }
          g.fillStyle = `rgba(255,140,40,${Math.max(0, 0.8 - t * 1.6)})`;
          g.beginPath();
          g.arc(e.x, e.y, r * 0.55, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = `rgba(60,52,44,${0.6 * (1 - t)})`;
          g.beginPath();
          g.arc(e.x + t * 6, e.y - t * 10, r * 0.6, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = `rgba(255,220,160,${0.7 * (1 - t)})`;
          g.lineWidth = 1;
          g.beginPath();
          g.arc(e.x, e.y, r * 1.2, 0, Math.PI * 2);
          g.stroke();
          break;
        }
        case "arc": {
          const x = e.x0 + (e.x1 - e.x0) * t, y = e.y0 + (e.y1 - e.y0) * t - Math.sin(t * Math.PI) * 18;
          g.fillStyle = e.smoke ? "#c8c8c0" : "#2a3020";
          g.fillRect(x - 1, y - 1, 3, 3);
          break;
        }
        case "shell": {
          g.fillStyle = `rgba(0,0,0,${0.15 + 0.35 * t})`;
          g.beginPath();
          g.ellipse(e.x, e.y + 2, 2 + 8 * t, 1 + 4 * t, 0, 0, Math.PI * 2);
          g.fill();
          break;
        }
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
