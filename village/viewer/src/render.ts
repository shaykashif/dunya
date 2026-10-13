import { cannotWalk, mobility } from "../../src/entities/body.ts";
import type { Animal, Building, Person, Trace } from "../../src/world/types.ts";
import type { World } from "../../src/world/world.ts";
import {
  BODY,
  GRAVE,
  HOUSEHOLD_COLORS,
  HOUSEHOLD_DARK,
  MOUND,
  SEASON_PALETTES,
  TILE,
  animalSprite,
  hash2,
  icon,
  lookFor,
  personSprite,
  treeSprite,
  type SeasonPalette,
} from "./sprites.ts";

export interface ViewOptions {
  roofs: boolean;
  traces: boolean;
  names: boolean;
  chronicle: boolean;
}

export interface Camera {
  x: number; // world pixel at the left edge
  y: number;
  zoom: number;
}

/** Short-lived visual effects: musket flashes, damage numbers, screams. */
export interface Effect {
  kind: "flash" | "text" | "ring";
  x: number; // world pixels
  y: number;
  text?: string;
  color?: string;
  born: number; // seconds
  dur: number;
  delay?: number;
}

type RGB = [number, number, number];

function rgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade([r, g, b]: RGB, f: number): RGB {
  return [Math.max(0, Math.min(255, Math.round(r * f))), Math.max(0, Math.min(255, Math.round(g * f))), Math.max(0, Math.min(255, Math.round(b * f)))];
}

/** Static ground layer, redrawn only when the season or a farm's crop changes noticeably. */
function drawTerrain(w: World, pal: SeasonPalette, season: number): HTMLCanvasElement {
  const W = w.map.width * TILE, H = w.map.height * TILE;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const img = g.createImageData(W, H);
  const d = img.data;
  const grass = pal.grass.map(rgb);
  const put = (px: number, py: number, col: RGB) => {
    const i = (py * W + px) * 4;
    d[i] = col[0];
    d[i + 1] = col[1];
    d[i + 2] = col[2];
    d[i + 3] = 255;
  };
  const pathCols = (pal.snow ? ["#d8d2c8", "#cfc6b8", "#e2ddd4"] : ["#c9a46a", "#bf9a5e", "#d4b07a"]).map(rgb);
  const soilA = rgb(pal.snow ? "#e6ebef" : "#7a4e26"), soilB = rgb(pal.snow ? "#cfd6dc" : "#8e5c2e");
  const crop = rgb(season === 2 ? "#e0c050" : season === 3 ? "#9a8a60" : "#7cc04a");
  const cropDark = shade(crop, 0.75);
  const plankA = rgb("#a07850"), plankB = rgb("#8e6a44"), seam = rgb("#6e5034");
  const stoneA = rgb("#8a8478"), stoneB = rgb("#6e695f");
  const wallA = rgb("#7a5a3c"), wallB = rgb("#5e4430");
  const door = rgb("#4a2e16");
  const water = rgb("#3a7bd5");
  const farmFrac = w.farms.map((f) => Math.min(1, f.crop.grain / Math.max(1, w.config.fields.initialCrop)));

  for (let ty = 0; ty < w.map.height; ty++) {
    for (let tx = 0; tx < w.map.width; tx++) {
      const t = w.map.at(tx, ty);
      const bid = w.map.buildingAt(tx, ty);
      const hall = bid >= 0 && w.buildings[bid]!.kind === "hall";
      const owner = w.map.farmOf[w.map.idx(tx, ty)]!;
      const cropFrac = owner >= 0 ? farmFrac[owner]! : 0;
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const px = tx * TILE + x, py = ty * TILE + y;
          const n = hash2(px >> 1, py >> 1, 1);
          let col: RGB;
          switch (t) {
            case "path":
              col = pathCols[n < 0.6 ? 0 : n < 0.85 ? 1 : 2]!;
              if (hash2(px, py, 5) < 0.03) col = shade(col, 0.75);
              break;
            case "field": {
              const row = (y >> 1) % 2 === 0;
              col = row ? soilA : soilB;
              if (!row && hash2(px, py, 9) < cropFrac * 0.9) col = (y & 1) === 0 ? crop : cropDark;
              break;
            }
            case "floor":
              col = hall ? (((x >> 2) + (y >> 2)) & 1 ? stoneA : stoneB) : y % 4 === 3 ? seam : (((x + (y >> 2) * 5) >> 3) & 1) === 0 ? plankA : plankB;
              break;
            case "wall":
              col = hall ? (y % 4 === 0 || (x + (y >> 2) * 4) % 8 === 0 ? stoneB : stoneA) : y % 5 === 0 || x % 8 === 0 ? wallB : wallA;
              break;
            case "door":
              col = x === 11 && y === 8 ? rgb("#e0c050") : door;
              break;
            case "water":
              col = water;
              break;
            default: {
              col = grass[n < 0.5 ? 0 : n < 0.78 ? 1 : n < 0.93 ? 2 : 3]!;
              if (t === "forest") col = shade(col, 0.82);
              if (!pal.snow && hash2(px, py, 3) < 0.025) col = shade(col, 0.7);
            }
          }
          put(px, py, col);
        }
      }
    }
  }
  g.putImageData(img, 0, 0);

  for (let ty = 0; ty < w.map.height; ty++) {
    for (let tx = 0; tx < w.map.width; tx++) {
      if (w.map.at(tx, ty) !== "forest") continue;
      g.drawImage(treeSprite(season, Math.floor(hash2(tx, ty, 21) * 6)), tx * TILE, ty * TILE);
    }
  }

  for (const wl of w.map.wells) {
    g.fillStyle = "#8a8f98";
    g.fillRect(wl.x * TILE + 2, wl.y * TILE + 3, 12, 11);
    g.fillStyle = "#b8bcc4";
    g.fillRect(wl.x * TILE + 3, wl.y * TILE + 3, 10, 2);
    g.fillStyle = "#2a5aa8";
    g.fillRect(wl.x * TILE + 4, wl.y * TILE + 6, 8, 6);
    g.fillStyle = "#5e4430";
    g.fillRect(wl.x * TILE + 2, wl.y * TILE, 1, 6);
    g.fillRect(wl.x * TILE + 13, wl.y * TILE, 1, 6);
    g.fillRect(wl.x * TILE + 2, wl.y * TILE, 12, 1);
  }
  // Pens: a simple fence around each house's animals.
  for (const cp of w.compounds) {
    const px = (cp.center.x + 8) * TILE, py = (cp.center.y + 5) * TILE;
    g.strokeStyle = "#6a4a2a";
    g.lineWidth = 1;
    g.strokeRect(px - 3 * TILE + 0.5, py - 3 * TILE + 0.5, 7 * TILE, 7 * TILE);
  }
  return c;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private terrain: HTMLCanvasElement | null = null;
  private terrainKey = "";
  private waterTiles: number[] = [];
  private readonly spriteCache = new Map<string, HTMLCanvasElement>();
  private particles: { x: number; y: number; v: number; s: number }[] = [];
  private flash = 0;
  effects: Effect[] = [];
  hoverBuilding = -1;
  selectedAnimal: number | null = null;
  /** Progress through the current tick, for hit-testing moving creatures. */
  alpha = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d")!;
  }

  reset(): void {
    this.terrain = null;
    this.terrainKey = "";
    this.effects = [];
    this.waterTiles = [];
  }

  addEffect(e: Effect): void {
    this.effects.push(e);
    if (this.effects.length > 200) this.effects.shift();
  }

  /** Tiles each person walked through in the last tick, so movement follows the road. */
  trails: Map<number, number[]> = new Map();
  /** Animal positions before the last tick, for smooth movement. */
  prevAnimals: Map<number, { x: number; y: number }> = new Map();
  mapWidth = 1;

  worldPos(p: { id: number; x: number; y: number }, prev: Map<number, { x: number; y: number }>, alpha: number): { x: number; y: number } {
    const from = prev.get(p.id) ?? p;
    const trail = this.trails.get(p.id);
    let x: number, y: number;
    if (trail && trail.length > 0 && alpha < 1) {
      // Walk the trail: the start position, then each tile stepped on, one tile per segment.
      const pts: { x: number; y: number }[] = [from];
      for (const i of trail) pts.push({ x: i % this.mapWidth, y: Math.floor(i / this.mapWidth) });
      const last = pts[pts.length - 1]!;
      if (last.x !== p.x || last.y !== p.y) pts.push(p);
      const t = alpha * (pts.length - 1);
      const k = Math.min(pts.length - 2, Math.floor(t));
      const f = t - k;
      const a = pts[k]!, b = pts[k + 1]!;
      x = a.x + (b.x - a.x) * f;
      y = a.y + (b.y - a.y) * f;
    } else {
      x = from.x + (p.x - from.x) * alpha;
      y = from.y + (p.y - from.y) * alpha;
    }
    return { x: x * TILE + 8, y: y * TILE + 14 };
  }

  animalWorld(a: Animal, alpha: number): { x: number; y: number } {
    const from = this.prevAnimals.get(a.id) ?? a;
    return { x: (from.x + (a.x - from.x) * alpha) * TILE + 8, y: (from.y + (a.y - from.y) * alpha) * TILE + 13 };
  }

  personScreen(p: Person, cam: Camera, prev: Map<number, { x: number; y: number }>, alpha: number): { x: number; y: number } {
    const wp = this.worldPos(p, prev, alpha);
    return { x: (wp.x - cam.x) * cam.zoom, y: (wp.y - cam.y) * cam.zoom };
  }

  private sprite(p: Person, w: World, walking: boolean): HTMLCanvasElement {
    const age = w.ageYears(p);
    const band = age < 2 ? 0 : age < 12 ? 1 : age >= 58 ? 3 : 2;
    const key = `${p.id}:${p.householdId}:${band}:${walking ? 1 : 0}`;
    let c = this.spriteCache.get(key);
    if (!c) {
      c = personSprite(lookFor(p.id, p.householdId, age), p.sex, age, walking);
      this.spriteCache.set(key, c);
    }
    return c;
  }

  private roofHidden(b: Building, opts: ViewOptions): boolean {
    return !opts.roofs || b.id === this.hoverBuilding;
  }

  private insideRoofed(w: World, p: { x: number; y: number }, opts: ViewOptions): boolean {
    const b = w.buildingOf(p);
    return !!b && w.isInside(p, b) && !this.roofHidden(b, opts);
  }

  draw(w: World, cam: Camera, opts: ViewOptions, prev: Map<number, { x: number; y: number }>, alpha: number, selected: number | null, time: number): void {
    const g = this.g;
    this.alpha = alpha;
    const dpr = window.devicePixelRatio || 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#16210f";
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(cam.zoom * dpr, 0, 0, cam.zoom * dpr, -cam.x * cam.zoom * dpr, -cam.y * cam.zoom * dpr);

    const season = w.env.season;
    const pal = SEASON_PALETTES[season]!;
    const key = `${season}:${w.farms.map((f) => Math.round((f.crop.grain / Math.max(1, w.config.fields.initialCrop)) * 6)).join(",")}`;
    if (!this.terrain || key !== this.terrainKey) {
      this.terrain = drawTerrain(w, pal, season);
      this.terrainKey = key;
    }
    g.drawImage(this.terrain, 0, 0);
    this.drawWater(w, time);
    for (const gr of w.graves) g.drawImage(gr.marked ? GRAVE : MOUND, gr.x * TILE + 4, gr.y * TILE + 4);
    if (opts.traces) for (const t of w.traces) this.drawTrace(t, w);

    // Visible region, for culling.
    const vw = this.canvas.width / dpr / cam.zoom, vh = this.canvas.height / dpr / cam.zoom;
    const inView = (x: number, y: number) => x > cam.x - 32 && y > cam.y - 32 && x < cam.x + vw + 32 && y < cam.y + vh + 32;

    for (const den of wolfDens(w)) if (inView(den.x * TILE + 8, den.y * TILE + 8)) this.drawDen(den.x, den.y);

    for (const a of w.animals) {
      if (!a.alive || a.riderId !== null) continue;
      const { x: px, y: py } = this.animalWorld(a, alpha);
      if (!inView(px, py)) continue;
      this.drawAnimal(a, px, py, time);
    }

    const people = w.active().filter((p) => !w.isCarried(p));
    const positions = new Map(people.map((p) => [p.id, this.worldPos(p, prev, alpha)]));
    people.sort((a, b) => positions.get(a.id)!.y - positions.get(b.id)!.y || a.id - b.id);
    for (const p of people) {
      if (this.insideRoofed(w, p, opts)) continue;
      const pos = positions.get(p.id)!;
      if (!inView(pos.x, pos.y)) continue;
      this.drawPerson(w, p, pos, prev, p.id === selected, time);
    }

    for (const b of w.buildings) this.drawBuilding(w, b, opts, time);

    const sel = w.maybePerson(selected);
    if (sel && sel.alive && !sel.exiled && this.insideRoofed(w, sel, opts)) {
      const pos = this.worldPos(sel, prev, alpha);
      g.fillStyle = "#ffe14a";
      g.fillRect(Math.round(pos.x) - 2, Math.round(pos.y) - 10, 4, 4);
    }

    this.drawLight(w, time);
    this.drawWeather(w, cam, vw, vh, time);
    this.drawEffects(time);

    if (opts.names) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.font = "10px 'Silkscreen', monospace";
      g.textAlign = "center";
      for (const p of people) {
        if (this.insideRoofed(w, p, opts)) continue;
        const pos = positions.get(p.id)!;
        const sx = (pos.x - cam.x) * cam.zoom, sy = (pos.y - cam.y - 18) * cam.zoom;
        const name = p.name.split(" ")[0]!;
        g.fillStyle = "rgba(0,0,0,0.65)";
        g.fillText(name, sx + 1, sy + 1);
        g.fillStyle = p.mad ? "#e0a0ff" : "#fff8e8";
        g.fillText(name, sx, sy);
      }
    }
  }

  /** A wolf den: a heap of rocks round a dark hole, with bones scattered in front. */
  private drawDen(tx: number, ty: number): void {
    const g = this.g;
    const x = tx * TILE - 8, y = ty * TILE - 4;
    g.fillStyle = "#4e4a43";
    g.fillRect(x + 2, y + 6, 28, 14);
    g.fillRect(x + 6, y + 2, 20, 6);
    g.fillStyle = "#7a746a";
    g.fillRect(x + 4, y + 5, 8, 5);
    g.fillRect(x + 18, y + 3, 7, 5);
    g.fillRect(x + 23, y + 10, 6, 5);
    g.fillStyle = "#14110d";
    g.fillRect(x + 11, y + 10, 10, 10);
    g.fillRect(x + 13, y + 8, 6, 2);
    g.fillStyle = "#e8e0cc";
    g.fillRect(x + 6, y + 21, 5, 1);
    g.fillRect(x + 22, y + 22, 1, 3);
    g.fillRect(x + 21, y + 22, 3, 1);
  }

  private drawAnimal(a: Animal, px: number, py: number, time: number): void {
    const g = this.g;
    if (a.id === this.selectedAnimal) {
      g.fillStyle = "#ffe14a";
      g.fillRect(Math.round(px) - 7, Math.round(py) + 1, 15, 1);
      g.fillRect(Math.round(px) - 6, Math.round(py) - 1, 1, 2);
      g.fillRect(Math.round(px) + 6, Math.round(py) - 1, 1, 2);
    }
    const flip = hash2(a.id, Math.floor(time * 0.5 + a.id), 3) < 0.5;
    const spr = animalSprite(a.kind, flip);
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(px - spr.width / 2, py, spr.width, 2);
    g.drawImage(spr, Math.round(px - spr.width / 2), Math.round(py - spr.height + 1));
    if (a.kind === "wolf" && a.state === "hunt") {
      g.fillStyle = "#ff3030";
      g.fillRect(Math.round(px + (flip ? -5 : 4)), Math.round(py - spr.height + 2), 1, 1);
    }
  }

  private drawWater(w: World, time: number): void {
    const g = this.g;
    if (this.waterTiles.length === 0) {
      for (let i = 0; i < w.map.terrain.length; i++) if (w.map.terrain[i] === "water") this.waterTiles.push(i);
    }
    const icy = w.env.season === 3 && w.env.temperature < -2;
    for (const i of this.waterTiles) {
      const tx = i % w.map.width, ty = Math.floor(i / w.map.width);
      const x0 = tx * TILE, y0 = ty * TILE;
      g.fillStyle = icy ? "#9cc4e8" : "#3a7bd5";
      g.fillRect(x0, y0, TILE, TILE);
      g.fillStyle = icy ? "#c8e0f4" : "#5c98e8";
      for (let k = 0; k < 2; k++) {
        const off = Math.floor((time * 6 + hash2(tx, ty, k) * 16 + k * 7) % 16);
        g.fillRect(x0 + off, y0 + 4 + k * 7, Math.min(4, 16 - off), 1);
      }
    }
  }

  private drawTrace(t: Trace, w: World): void {
    const g = this.g;
    const x = t.location.x * TILE, y = t.location.y * TILE;
    switch (t.kind) {
      case "footprint":
        g.fillStyle = w.env.season === 3 ? "#9aa4ae" : "rgba(60,40,20,0.8)";
        g.fillRect(x + 4, y + 9, 2, 3);
        g.fillRect(x + 9, y + 5, 2, 3);
        break;
      case "blood":
        g.fillStyle = "#9a1a1a";
        g.fillRect(x + 5, y + 8, 5, 3);
        g.fillRect(x + 7, y + 6, 2, 6);
        g.fillRect(x + 11, y + 11, 1, 1);
        break;
      case "body":
        g.drawImage(BODY, x, y + 6);
        break;
      case "object_left":
        g.fillStyle = "#e0d0a0";
        g.fillRect(x + 6, y + 10, 4, 3);
        break;
      case "item_missing":
        g.fillStyle = "#e04050";
        g.fillRect(x + 7, y + 2, 2, 6);
        g.fillRect(x + 7, y + 10, 2, 2);
        break;
      default:
        break;
    }
  }

  private drawPerson(w: World, p: Person, pos: { x: number; y: number }, prev: Map<number, { x: number; y: number }>, selected: boolean, time: number): void {
    const g = this.g;
    const from = prev.get(p.id);
    const moving = !!from && (from.x !== p.x || from.y !== p.y);
    const walking = moving && Math.floor(time * 8) % 2 === 0;
    const spr = this.sprite(p, w, walking);
    const x = Math.round(pos.x), y = Math.round(pos.y);
    const riding = p.ridingHorseId !== null;
    const lift = riding ? 5 : 0;

    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(x - 3, y, 7, 2);
    if (selected) {
      g.fillStyle = "#ffe14a";
      g.fillRect(x - 6, y + 1, 13, 1);
      g.fillRect(x - 5, y - 1, 1, 2);
      g.fillRect(x + 5, y - 1, 1, 2);
    }
    if (riding) {
      const horse = animalSprite("horse", from ? p.x < from.x : false);
      g.drawImage(horse, x - Math.floor(horse.width / 2), y - horse.height + 1);
    }
    const downed = !p.asleep && cannotWalk(p) && p.carriedById === null;
    if (p.asleep || downed) {
      g.save();
      g.translate(x, y);
      g.rotate(-Math.PI / 2);
      g.drawImage(spr, -spr.width / 2, -spr.height + 3);
      g.restore();
    } else {
      const limp = moving && mobility(p) < 0.75;
      const bob = moving ? (walking ? 0 : -1) - (limp && !walking ? 1 : 0) : 0;
      g.drawImage(spr, x - Math.floor(spr.width / 2), y - spr.height + bob - lift);
      if (p.crutch) {
        g.fillStyle = "#8a6a3a";
        g.fillRect(x - 5, y - Math.round(spr.height * 0.55) - lift, 1, Math.round(spr.height * 0.55));
        g.fillRect(x - 6, y - Math.round(spr.height * 0.55) - lift, 3, 1);
      }
      if (p.bloodyClothes) {
        g.fillStyle = "#b01818";
        g.fillRect(x - 2, y - spr.height + 6 - lift, 2, 2);
        g.fillRect(x + 1, y - spr.height + 8 - lift, 1, 2);
      }
      if (p.bloodyTool || p.inventory.musket > 0) {
        g.fillStyle = p.inventory.musket > 0 ? "#3a2a1a" : "#8a8f98";
        g.fillRect(x + 4, y - spr.height + 3 - lift, 1, 8);
        if (p.bloodyTool) {
          g.fillStyle = "#c01818";
          g.fillRect(x + 4, y - spr.height + 3 - lift, 1, 3);
        }
      }
    }
    // Someone carried over the shoulder: laid across the carrier's back.
    const burden = p.carryingId !== null ? w.maybePerson(p.carryingId) : null;
    if (burden && !p.asleep) {
      const bs = this.sprite(burden, w, false);
      g.save();
      g.translate(x + 2, y - Math.round(spr.height * 0.6) - lift);
      g.rotate(-Math.PI / 2 + 0.25);
      g.drawImage(bs, -bs.width / 2, -bs.height + 2);
      g.restore();
    }
    // Carried infant.
    const baby = burden ? null : w.people.find((c) => c.alive && !c.exiled && w.carriedBy(c)?.id === p.id);
    if (baby && !p.asleep) {
      g.fillStyle = "#f2c9a0";
      g.fillRect(x - 5, y - 8 - lift, 3, 3);
    }

    const plan = p.plan;
    let kind = plan ? (plan.cand.kind === "idle" && plan.cand.key === "idle:home" ? "" : plan.cand.kind) : "";
    if (p.mad) kind = plan && ["attack", "kidnap", "hide"].includes(plan.cand.kind) ? plan.cand.kind : "mad";
    if (p.captorId !== null) kind = "captive";
    const ic = kind === "sleep" ? (p.asleep ? icon("sleep") : null) : icon(kind);
    if (downed && Math.floor(time * 2) % 2 === 0) {
      g.fillStyle = "#e03030";
      g.fillRect(x - 1, y - spr.height - 14, 2, 5);
      g.fillRect(x - 1, y - spr.height - 8, 2, 2);
    }
    if (ic && !downed) {
      const floatY = Math.round(Math.sin(time * 3 + p.id) * 1.5);
      const ix = x - 3, iy = y - spr.height - 9 + floatY - lift;
      g.globalAlpha = plan?.phase === "travel" && !p.mad ? 0.55 : 1;
      g.fillStyle = p.mad ? "rgba(60,20,80,0.75)" : "rgba(20,16,10,0.55)";
      g.fillRect(ix - 1, iy - 1, 9, 9);
      g.drawImage(ic, ix, iy);
      g.globalAlpha = 1;
    }
    if (p.detainedUntil !== null && w.tick < p.detainedUntil) {
      g.fillStyle = "#3a3a3a";
      for (let i = -4; i <= 4; i += 3) g.fillRect(x + i, y - spr.height - 1, 1, spr.height + 1);
    }
  }

  private drawBuilding(w: World, b: Building, opts: ViewOptions, time: number): void {
    const g = this.g;
    const x0 = b.x0 * TILE, y0 = b.y0 * TILE;
    const wpx = (b.x1 - b.x0 + 1) * TILE, hpx = (b.y1 - b.y0 + 1) * TILE;
    const occupants = w.active().filter((p) => w.isInside(p, b) && !w.isCarried(p)).length;
    const hh = b.householdId;
    if (this.roofHidden(b, opts)) {
      if (b.hearth) {
        const hx = b.hearthSpot.x * TILE, hy = b.hearthSpot.y * TILE;
        g.fillStyle = "#6a6a70";
        g.fillRect(hx + 3, hy + 6, 10, 8);
        if (b.lit) {
          const f = Math.floor(time * 10) % 2;
          g.fillStyle = "#f08a2a";
          g.fillRect(hx + 5, hy + 7 - f, 6, 5 + f);
          g.fillStyle = "#f2d84a";
          g.fillRect(hx + 7, hy + 8, 2, 3);
        }
      }
      if (b.kind === "store") this.drawSacks(w, b);
      if (b.kind === "hall") {
        // Benches and the council table.
        g.fillStyle = "#5e4430";
        g.fillRect(x0 + 3 * TILE, y0 + TILE + 4, wpx - 6 * TILE, 6);
        for (let r = 3; r < b.y1 - b.y0; r += 2) g.fillRect(x0 + 2 * TILE, y0 + r * TILE + 6, wpx - 4 * TILE, 3);
      }
      return;
    }
    const roof = b.kind === "hall" ? "#6e695f" : hh === null ? "#7a5230" : HOUSEHOLD_COLORS[hh % HOUSEHOLD_COLORS.length]!;
    const roofDark = b.kind === "hall" ? "#4e4a43" : hh === null ? "#553820" : HOUSEHOLD_DARK[hh % HOUSEHOLD_DARK.length]!;
    const winter = w.env.season === 3;
    const rx = x0 - 2, ry = y0 - 4, rw = wpx + 4, rh = hpx + 2;
    g.fillStyle = roofDark;
    g.fillRect(rx, ry, rw, rh);
    for (let y = 0; y < rh - 2; y += 3) {
      g.fillStyle = (y / 3) % 2 === 0 ? roof : roofDark;
      g.fillRect(rx + 1, ry + y + 1, rw - 2, 2);
      g.fillStyle = roofDark;
      for (let x = ((y / 3) % 2) * 3; x < rw - 2; x += 6) g.fillRect(rx + 1 + x, ry + y + 1, 1, 2);
    }
    g.fillStyle = "#3a2a1a";
    g.fillRect(rx, ry + Math.floor(rh / 2), rw, 1);
    if (winter) {
      g.fillStyle = "#f2f6f8";
      g.fillRect(rx, ry, rw, 3);
      for (let x = 0; x < rw; x += 5) g.fillRect(rx + x, ry + 3, 2, 1 + (x % 3));
    }
    g.fillStyle = b.kind === "hall" ? "#8a8478" : "#7a5a3c";
    g.fillRect(x0, y0 + hpx - 6, wpx, 6);
    if (b.kind === "hall") {
      // Columns, steps and a banner: the courthouse.
      g.fillStyle = "#c8c2b4";
      for (let x = 8; x < wpx - 4; x += 20) g.fillRect(x0 + x, y0 + hpx - 14, 3, 14);
      g.fillStyle = "#a8a296";
      g.fillRect(x0 + wpx / 2 - 14, y0 + hpx - 2, 28, 4);
      g.fillStyle = "#b03a3a";
      g.fillRect(x0 + wpx / 2 - 3, ry - 12, 6, 9);
      g.fillStyle = "#5e4430";
      g.fillRect(x0 + wpx / 2 - 4, ry - 14, 1, 14);
      const convened = w.hearings.some((h) => h.status === "scheduled" && Math.abs(h.scheduledTick - w.tick) <= 2);
      if (convened) {
        g.fillStyle = Math.floor(time * 2) % 2 ? "#f2c84a" : "#c89a2a";
        g.fillRect(x0 + wpx / 2 - 8, ry + 4, 16, 6);
      }
    }
    const dx = b.door.x * TILE;
    g.fillStyle = "#4a2e16";
    if (b.door.y === b.y1) g.fillRect(dx + 4, y0 + hpx - 8, 8, 8);
    g.fillStyle = b.lit ? "#ffd86a" : "#2a2a34";
    g.fillRect(x0 + 6, y0 + hpx - 5, 4, 3);
    g.fillRect(x0 + wpx - 10, y0 + hpx - 5, 4, 3);

    if (b.hearth && b.kind !== "hall") {
      const cx = x0 + wpx - 18, cy = ry - 4;
      g.fillStyle = "#6a6a70";
      g.fillRect(cx, cy, 6, 8);
      g.fillStyle = "#4a4a50";
      g.fillRect(cx, cy, 6, 2);
      if (b.lit) {
        for (let i = 0; i < 4; i++) {
          const t = (time * 0.8 + i * 0.25) % 1;
          g.fillStyle = `rgba(200,200,210,${0.6 * (1 - t)})`;
          const s = 2 + Math.floor(t * 3);
          g.fillRect(cx + 2 + Math.round(Math.sin(t * 6 + i) * 3), cy - 2 - Math.round(t * 18), s, s);
        }
      }
    } else if (b.kind === "store") {
      g.fillStyle = "#e0c890";
      g.fillRect(x0 + wpx / 2 - 5, y0 + hpx / 2 - 8, 10, 10);
      g.fillStyle = "#b09860";
      g.fillRect(x0 + wpx / 2 - 3, y0 + hpx / 2 - 10, 6, 3);
    }
    if (occupants > 0) {
      const bx = x0 + 3, by = ry + 2;
      g.fillStyle = "rgba(20,16,10,0.75)";
      g.fillRect(bx, by, occupants >= 10 ? 13 : 9, 8);
      g.fillStyle = "#fff8e8";
      g.font = "7px monospace";
      g.textAlign = "left";
      g.fillText(String(occupants), bx + 2, by + 7);
    }
  }

  private drawSacks(w: World, b: Building): void {
    const g = this.g;
    const sacks = Math.min(b.interior.length, Math.ceil(w.communal.grain / 40));
    for (let i = 0; i < sacks; i++) {
      const t = b.interior[i]!;
      g.fillStyle = "#e0c890";
      g.fillRect(t.x * TILE + 4, t.y * TILE + 5, 8, 9);
      g.fillStyle = "#b09860";
      g.fillRect(t.x * TILE + 6, t.y * TILE + 3, 4, 3);
    }
  }

  private drawLight(w: World, time: number): void {
    const g = this.g;
    const dark = Math.max(0, 1 - w.env.light);
    const weatherDim = w.env.weather === "storm" ? 0.25 : w.env.weather === "rain" ? 0.12 : 0;
    const a = Math.min(0.78, dark * 0.72 + weatherDim);
    if (a <= 0.01) return;
    const W = w.map.width * TILE, H = w.map.height * TILE;
    g.fillStyle = `rgba(14,20,52,${a})`;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "lighter";
    for (const b of w.buildings) {
      if (!b.lit) continue;
      const cx = ((b.x0 + b.x1 + 1) * TILE) / 2, cy = ((b.y0 + b.y1 + 1) * TILE) / 2;
      const r = 70 * (1 + Math.sin(time * 7 + b.id) * 0.05);
      const grad = g.createRadialGradient(cx, cy, 4, cx, cy, r);
      grad.addColorStop(0, `rgba(255,170,70,${0.35 * a})`);
      grad.addColorStop(1, "rgba(255,170,70,0)");
      g.fillStyle = grad;
      g.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = "source-over";
  }

  private drawWeather(w: World, cam: Camera, vw: number, vh: number, time: number): void {
    const g = this.g;
    const kind = w.env.weather;
    const want = kind === "storm" ? 420 : kind === "rain" ? 220 : kind === "snow" ? 260 : 0;
    while (this.particles.length < want) this.particles.push({ x: Math.random(), y: Math.random(), v: 0.6 + Math.random() * 0.8, s: Math.random() });
    if (this.particles.length > want) this.particles.length = want;
    if (want === 0) return;
    // Particles live in the visible part of the world, so they look the same at any zoom.
    const snow = kind === "snow";
    g.fillStyle = snow ? "rgba(255,255,255,0.9)" : "rgba(170,200,255,0.55)";
    const px = 1 / cam.zoom;
    for (const p of this.particles) {
      if (snow) {
        p.y += 0.002 * p.v;
        p.x += Math.sin(time * 2 + p.s * 10) * 0.0004;
      } else {
        p.y += 0.012 * p.v;
        p.x -= 0.003 * p.v;
      }
      if (p.y > 1) { p.y = 0; p.x = Math.random(); }
      if (p.x < 0) p.x += 1;
      const x = cam.x + p.x * vw, y = cam.y + p.y * vh;
      if (snow) g.fillRect(x, y, (p.s > 0.7 ? 2 : 1.4) * px, (p.s > 0.7 ? 2 : 1.4) * px);
      else g.fillRect(x, y, 1.2 * px, 6 * px);
    }
    if (kind === "storm") {
      if (this.flash <= 0 && Math.random() < 0.004) this.flash = 1;
      if (this.flash > 0) {
        g.fillStyle = `rgba(230,235,255,${this.flash * 0.45})`;
        g.fillRect(cam.x, cam.y, vw, vh);
        this.flash -= 0.08;
      }
    }
  }

  private drawEffects(time: number): void {
    const g = this.g;
    this.effects = this.effects.filter((e) => time - e.born - (e.delay ?? 0) < e.dur);
    for (const e of this.effects) {
      const t = (time - e.born - (e.delay ?? 0)) / e.dur;
      if (t < 0) continue;
      if (e.kind === "flash") {
        g.fillStyle = `rgba(255,230,120,${1 - t})`;
        const r = 6 + t * 10;
        g.beginPath();
        g.arc(e.x, e.y, r, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = `rgba(200,200,200,${0.6 * (1 - t)})`;
        g.fillRect(e.x - 3 + t * 8, e.y - 6 - t * 10, 4, 4);
      } else if (e.kind === "ring") {
        g.strokeStyle = e.color ?? "#ffe14a";
        g.globalAlpha = 1 - t;
        g.lineWidth = 1;
        g.beginPath();
        g.arc(e.x, e.y, 4 + t * 30, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      } else {
        g.font = "bold 8px monospace";
        g.textAlign = "center";
        g.fillStyle = "rgba(0,0,0,0.7)";
        g.fillText(e.text ?? "", e.x + 1, e.y - t * 14 + 1);
        g.fillStyle = e.color ?? "#ff4040";
        g.fillText(e.text ?? "", e.x, e.y - t * 14);
      }
    }
  }
}

/** Each pack's den, while any of its wolves live. */
export function wolfDens(w: World): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const a of w.animals) {
    if (a.kind !== "wolf" || !a.alive || out.some((d) => d.x === a.home.x && d.y === a.home.y)) continue;
    out.push({ x: a.home.x, y: a.home.y });
  }
  return out;
}

/** Minimap: one pixel per tile, plus people and wolves, plus the camera's view. */
export function drawMinimap(canvas: HTMLCanvasElement, w: World, cam: Camera, viewW: number, viewH: number, base: { img: ImageData | null; season: number }): void {
  const g = canvas.getContext("2d")!;
  const W = w.map.width, H = w.map.height;
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
    base.img = null;
  }
  if (!base.img || base.season !== w.env.season) {
    const img = g.createImageData(W, H);
    const snow = w.env.season === 3;
    const colors: Record<string, RGB> = {
      ground: rgb(snow ? "#e0e6ea" : "#6aa84a"),
      forest: rgb(snow ? "#3e5a48" : w.env.season === 2 ? "#a8682a" : "#2f6e34"),
      water: rgb("#3a7bd5"),
      path: rgb("#c9a46a"),
      field: rgb("#8e5c2e"),
      floor: rgb("#a07850"),
      wall: rgb("#5e4430"),
      door: rgb("#4a2e16"),
      well: rgb("#9aa0a8"),
    };
    for (let i = 0; i < W * H; i++) {
      const c = colors[w.map.terrain[i]!]!;
      img.data[i * 4] = c[0];
      img.data[i * 4 + 1] = c[1];
      img.data[i * 4 + 2] = c[2];
      img.data[i * 4 + 3] = 255;
    }
    base.img = img;
    base.season = w.env.season;
  }
  g.putImageData(base.img, 0, 0);
  // Dens as dark rings, wolves as red dots: easy to spot in the far corners of the forest.
  g.strokeStyle = "#ff5040";
  g.lineWidth = 1;
  for (const den of wolfDens(w)) g.strokeRect(den.x - 2.5, den.y - 2.5, 5, 5);
  for (const a of w.animals) {
    if (!a.alive || a.kind !== "wolf") continue;
    g.fillStyle = "#ff3030";
    g.fillRect(a.x - 0.5, a.y - 0.5, 2, 2);
  }
  for (const p of w.active()) {
    g.fillStyle = p.mad ? "#e070ff" : HOUSEHOLD_COLORS[p.householdId % HOUSEHOLD_COLORS.length]!;
    g.fillRect(p.x - 0.5, p.y - 0.5, 2, 2);
  }
  g.strokeStyle = "#ffe14a";
  g.lineWidth = 1;
  g.strokeRect(cam.x / TILE + 0.5, cam.y / TILE + 0.5, viewW / cam.zoom / TILE, viewH / cam.zoom / TILE);
}
