// Pixel-art smoke and explosions. Everything is drawn in square blocks on a
// fixed world grid, and fades by ordered dithering rather than transparency,
// so smoke and fire break up into chunky pixels like the rest of the field.
import type { SmokeCloud } from "../../src/world/types.ts";
import { TILE, hash2 } from "./sprites.ts";

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** Ordered-dither threshold for a block: draw it only if the value beats this. */
export function dither(cx: number, cy: number): number {
  return BAYER[(cy & 3) * 4 + (cx & 3)]!;
}

/** Collects blocks by colour and fills each colour as one path. */
class Blocks {
  private readonly byColour = new Map<string, number[]>();

  add(colour: string, x: number, y: number, w: number, h = w): void {
    let list = this.byColour.get(colour);
    if (!list) this.byColour.set(colour, (list = []));
    list.push(x, y, w, h);
  }

  flush(g: CanvasRenderingContext2D, order?: readonly string[]): void {
    const keys = order ? order.filter((k) => this.byColour.has(k)) : [...this.byColour.keys()];
    for (const k of keys) {
      const list = this.byColour.get(k)!;
      g.fillStyle = k;
      g.beginPath();
      for (let i = 0; i < list.length; i += 4) g.rect(list[i]!, list[i + 1]!, list[i + 2]!, list[i + 3]!);
      g.fill();
    }
    this.byColour.clear();
  }
}

const blocks = new Blocks();

// ---------- Smoke clouds ----------

const SMOKE = ["#8a8882", "#acaaa2", "#cfcdc5", "#efede7"];

/**
 * A smoke screen as a billowing mass of square puffs. The density field is a
 * handful of slowly turning blobs; it is cut into four shades, lit from above,
 * and the thin edges are dithered away.
 */
export function drawSmokeCloud(g: CanvasRenderingContext2D, c: SmokeCloud, tick: number, time: number): void {
  const P = 4;
  const age = tick - c.born;
  const grow = Math.min(1, 0.3 + age / 8);
  const fade = Math.max(0, Math.min(1, (c.until - tick) / 25));
  const cx = (c.x + age * 0.02) * TILE + 8, cy = c.y * TILE + 8;
  const r = c.radius * grow * TILE;
  const n = 9;
  const bx: number[] = [], by: number[] = [], br: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + time * 0.12 * (k % 2 ? 1 : -1) + c.id;
    const d = k === 0 ? 0 : r * 0.5 * (0.55 + 0.45 * hash2(c.id, k));
    bx.push(cx + Math.cos(a) * d);
    by.push(cy + Math.sin(a) * d * 0.75 - (k === 0 ? r * 0.1 : 0));
    br.push(r * (k === 0 ? 0.62 : 0.4 + 0.18 * hash2(c.id, k, 5)));
  }
  const boil = Math.floor(time * 2.5);
  const gx0 = Math.floor((cx - r * 1.15) / P), gx1 = Math.ceil((cx + r * 1.15) / P);
  const gy0 = Math.floor((cy - r * 1.05) / P), gy1 = Math.ceil((cy + r * 1.05) / P);
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const x = gx * P + P / 2, y = gy * P + P / 2;
      let dens = 0, lit = 0;
      for (let k = 0; k < n; k++) {
        const dx = x - bx[k]!, dy = y - by[k]!;
        const q = 1 - (dx * dx + dy * dy) / (br[k]! * br[k]!);
        if (q > dens) {
          dens = q;
          lit = -dy / br[k]!;
        }
      }
      if (dens <= 0) continue;
      dens += (hash2(gx, gy, boil) - 0.5) * 0.18;
      // Thin edges and a dying cloud break up into scattered blocks.
      const solid = Math.min(1, dens * 3.2) * fade;
      if (solid < dither(gx, gy)) continue;
      const v = dens * 0.8 + lit * 0.55;
      const shadeIdx = v > 0.75 ? 3 : v > 0.45 ? 2 : v > 0.15 ? 1 : 0;
      blocks.add(SMOKE[shadeIdx]!, gx * P, gy * P, P);
    }
  }
  g.globalAlpha = 0.88;
  blocks.flush(g, SMOKE);
  g.globalAlpha = 1;
}

// ---------- Explosions ----------

export interface Blast {
  x: number;
  y: number;
  /** 0 a grenade, 1 a mortar bomb, 2 an artillery shell. */
  size: number;
  seed: number;
}

/** How long each kind of blast lasts on screen, in seconds. */
export const BLAST_SECONDS = [1.5, 2.2, 2.8];
const RADIUS = [11, 18, 26];
const FIRE = ["#fffbe0", "#ffe46a", "#ffb02a", "#f0701c", "#c03a18", "#5a2a18"];
const DIRT = ["#4a3a26", "#6a5236", "#3a5a24", "#2e261c"];
const SMUT = ["#2e2a26", "#46403a", "#5e5850", "#7a746a"];

/** Filled disc of blocks; `pick` returns a colour for each block, or null to skip it. */
function disc(cx: number, cy: number, r: number, P: number, squash: number, pick: (d: number, gx: number, gy: number) => string | null): void {
  if (r <= 0) return;
  const gx0 = Math.floor((cx - r) / P), gx1 = Math.ceil((cx + r) / P);
  const gy0 = Math.floor((cy - r * squash) / P), gy1 = Math.ceil((cy + r * squash) / P);
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const dx = (gx * P + P / 2 - cx) / r, dy = (gy * P + P / 2 - cy) / (r * squash);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1) continue;
      const col = pick(d, gx, gy);
      if (col) blocks.add(col, gx * P, gy * P, P);
    }
  }
}

/**
 * One blast at `T` seconds after it went off: a white flash, a pressure ring
 * racing over the ground, a ball of fire that boils up and burns out, clods
 * and sparks thrown out on arcs, and a column of dirty smoke that rises and
 * thins away. Everything is computed from the seed, so nothing is stored.
 */
export function drawBlast(g: CanvasRenderingContext2D, b: Blast, T: number): void {
  const S = b.size, R = RADIUS[S]!, life = BLAST_SECONDS[S]!;
  const P = S === 2 ? 3 : 2;
  const h = (k: number, salt: number) => hash2(b.seed, k, salt);
  const end = Math.max(0, 1 - T / life);

  // Scorched, churned ground.
  disc(b.x, b.y + 1, R * 0.7, P, 0.6, (d, gx, gy) => (Math.min(1, end * 2.5) * (1.15 - d) > dither(gx, gy) ? (d < 0.5 ? "#241c14" : "#3a2e20") : null));

  // Pressure ring, flattened onto the ground.
  if (T < 0.3) {
    const k = T / 0.3, rr = R * (0.5 + k * 1.6);
    disc(b.x, b.y, rr, P, 0.62, (d, gx, gy) => (d > 1 - (P * 1.5) / rr && 1 - k > dither(gx, gy) ? "#fff2c8" : null));
  }

  // Smoke column, under the fire while it lasts.
  const puffs = 5 + S * 4;
  for (let k = 0; k < puffs; k++) {
    const start = 0.08 + h(k, 1) * 0.25;
    const t = T - start;
    if (t < 0) continue;
    const span = life - start;
    const u = t / span;
    if (u >= 1) continue;
    const a = h(k, 2) * Math.PI * 2, out = R * (0.2 + 0.5 * h(k, 3));
    const rise = R * (0.8 + 1.4 * h(k, 4)) * (1 - Math.exp(-t * 1.6));
    const px = b.x + Math.cos(a) * out * (0.4 + u) + t * 3, py = b.y + Math.sin(a) * out * 0.5 - rise;
    const pr = R * (0.28 + 0.2 * h(k, 5)) * (0.7 + u * 0.9);
    const left = Math.min(1, (1 - u) * 2.2);
    const tone = Math.min(3, Math.floor(u * 3.5 + h(k, 6)));
    disc(px, py, pr, P, 0.9, (d, gx, gy) => (left * (1.2 - d * 0.6) > dither(gx, gy) ? SMUT[Math.min(3, tone + (d > 0.7 ? 1 : 0))]! : null));
  }

  // Fireball: a few blobs whose heat drains away.
  const fl = 0.3 + S * 0.15;
  if (T < fl) {
    const k = T / fl;
    const blobs = 4 + S * 2;
    for (let i = 0; i < blobs; i++) {
      const a = h(i, 10) * Math.PI * 2, off = i === 0 ? 0 : R * 0.35 * h(i, 11) * (0.6 + k);
      const fx = b.x + Math.cos(a) * off, fy = b.y + Math.sin(a) * off * 0.6 - R * 0.35 * k;
      const fr = R * (i === 0 ? 0.6 : 0.3 + 0.2 * h(i, 12)) * (0.7 + 0.7 * Math.sqrt(k));
      disc(fx, fy, fr, P, 0.85, (d, gx, gy) => {
        const heat = (1 - k) * 1.1 - d * 0.55 + (hash2(gx, gy, b.seed) - 0.5) * 0.25;
        if (heat < 0.02 && k > 0.6 && (1 - k) * 3 < dither(gx, gy)) return null;
        return FIRE[heat > 0.85 ? 0 : heat > 0.65 ? 1 : heat > 0.45 ? 2 : heat > 0.25 ? 3 : heat > 0.08 ? 4 : 5]!;
      });
    }
  }

  // Clods, stones and sparks thrown up and out, falling back under gravity.
  const bits = 10 + S * 12, G = 260;
  for (let i = 0; i < bits; i++) {
    const a = h(i, 20) * Math.PI * 2, v = R * (1.6 + 2.6 * h(i, 21)), vz = 50 + 90 * h(i, 22) * (1 + S * 0.4);
    const spark = h(i, 23) < 0.3;
    const flight = (2 * vz) / G;
    const tt = Math.min(T, flight);
    const x = b.x + Math.cos(a) * v * tt, y = b.y + Math.sin(a) * v * tt * 0.6;
    const z = vz * tt - 0.5 * G * tt * tt;
    const sz = spark ? 1 : P === 3 ? 3 : h(i, 24) < 0.5 ? 2 : 1;
    if (spark) {
      if (T > flight * 0.8) continue;
      blocks.add(T < 0.2 ? FIRE[0]! : FIRE[2]!, Math.round(x), Math.round(y - z), 1);
    } else {
      if (T > flight && end * 2 < dither(i, 3)) continue;
      blocks.add(DIRT[i % DIRT.length]!, Math.round(x), Math.round(y - z), sz);
    }
  }
  // The first instant: a white-hot flash over everything.
  if (T < 0.09) {
    blocks.flush(g);
    disc(b.x, b.y - 1, R * 0.95, P, 0.8, (d) => (d < 0.6 ? FIRE[0]! : FIRE[1]!));
  }
  blocks.flush(g);
}

/** How hard a blast shakes the view `T` seconds after it, in screen pixels at full zoom. */
export function blastShake(size: number, T: number): number {
  const span = 0.35 + size * 0.15;
  if (T < 0 || T > span) return 0;
  return [3, 6, 9][size]! * (1 - T / span) ** 2;
}

/** The small jolt of a shot going off, in screen pixels at full zoom. */
export function shotShake(automatic: boolean, T: number): number {
  const span = 0.09;
  if (T < 0 || T > span) return 0;
  return (automatic ? 1.8 : 1.4) * (1 - T / span);
}

// ---------- Small stuff ----------

/** A muzzle flash: a tiny star of hot pixels. */
export function muzzleFlash(g: CanvasRenderingContext2D, x: number, y: number, r: number, t: number): void {
  const X = Math.round(x), Y = Math.round(y);
  const arm = Math.max(1, Math.round(r * (1 - t * 0.6)));
  blocks.add(FIRE[0]!, X - 1, Y - 1, 2);
  for (let k = 2; k <= arm; k++) {
    const col = k === arm ? FIRE[2]! : FIRE[1]!;
    blocks.add(col, X - k, Y, 1);
    blocks.add(col, X + k - 1, Y - 1, 1);
    if (k < arm) {
      blocks.add(col, X, Y - k, 1);
      blocks.add(col, X - 1, Y + k - 1, 1);
    }
  }
  blocks.flush(g);
}

/** A bullet striking the ground: a spurt of dust. */
export function dustSpurt(g: CanvasRenderingContext2D, x: number, y: number, seed: number, t: number): void {
  for (let k = 0; k < 5; k++) {
    if (1 - t < dither(k, seed)) continue;
    const a = -Math.PI / 2 + (hash2(seed, k, 1) - 0.5) * 2.4, v = 2 + hash2(seed, k, 2) * 4;
    const px = x + Math.cos(a) * v * t * 1.4, py = y + Math.sin(a) * v * t * 1.4 + t * t * 6;
    blocks.add(k % 2 ? "#c8b48c" : "#9a8460", Math.round(px), Math.round(py), k === 0 && t < 0.4 ? 2 : 1);
  }
  blocks.flush(g);
}

/** A smoke grenade popping: a burst of white puffs. */
export function smokePop(g: CanvasRenderingContext2D, x: number, y: number, seed: number, T: number, life: number): void {
  const u = T / life;
  for (let k = 0; k < 7; k++) {
    const a = hash2(seed, k, 1) * Math.PI * 2, d = 4 + 12 * hash2(seed, k, 2) * Math.sqrt(u);
    const pr = 3 + 5 * u;
    disc(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7 - u * 6, pr, 2, 0.9, (dd, gx, gy) => ((1 - u) * 1.4 - dd * 0.4 > dither(gx, gy) ? (dd < 0.5 ? SMOKE[3]! : SMOKE[2]!) : null));
  }
  blocks.flush(g);
}

/** The shadow of a falling shell, sharpening as it comes down. */
export function shellShadow(g: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  disc(x, y + 2, 2 + 9 * t, 2, 0.5, (d, gx, gy) => ((0.3 + 0.7 * t) * (1.1 - d) > dither(gx, gy) ? "#14100a" : null));
  g.globalAlpha = 0.5;
  blocks.flush(g);
  g.globalAlpha = 1;
}

// ---------- Destruction ----------

/** Plaster and stone dust, darker at the heart. */
const DUST = ["#7a7262", "#948c7c", "#aea696", "#c6beae"];

const STUFF = [
  ["#8a8478", "#a8a294", "#5a544a", "#6e6458"], // stone and plaster
  ["#5a4028", "#c8a878", "#2e2216", "#6a8a3a"], // splintered wood and leaves
  ["#4a7a30", "#6a9a42", "#4a3a26", "#2e5a24"], // a hedge's brush and earth
];

/**
 * A wall, tree or hedge knocked to pieces: chunks of it thrown up and out,
 * falling back, and a puff of dust where it stood.
 */
export function drawDebris(g: CanvasRenderingContext2D, x: number, y: number, seed: number, stuff: number, T: number, life: number): void {
  const pal = STUFF[stuff] ?? STUFF[0]!;
  const end = Math.max(0, 1 - T / life);
  disc(x, y - 4 - T * 6, 6 + T * 7, 2, 0.8, (d, gx, gy) => (end * 1.3 * (1.1 - d) > dither(gx, gy) ? (d < 0.5 ? "#9a9284" : "#b8b2a4") : null));
  const G = 240;
  for (let i = 0; i < 9; i++) {
    const a = hash2(seed, i, 1) * Math.PI * 2, v = 10 + 30 * hash2(seed, i, 2), vz = 40 + 70 * hash2(seed, i, 3);
    const flight = (2 * vz) / G;
    const tt = Math.min(T, flight);
    const px = x + Math.cos(a) * v * tt, py = y + Math.sin(a) * v * tt * 0.6 - (vz * tt - 0.5 * G * tt * tt);
    if (T > flight && end * 2 < dither(i, seed)) continue;
    blocks.add(pal[i % pal.length]!, Math.round(px), Math.round(py), i % 3 === 0 ? 3 : 2);
  }
  blocks.flush(g);
}

/** A house falling in: a great cloud of dust and smoke boiling up over it and drifting off. */
export function drawCollapse(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number, T: number, life: number): void {
  const u = T / life;
  const puffs = Math.max(6, Math.round((w * h) / 400));
  for (let k = 0; k < puffs; k++) {
    const px = x + hash2(seed, k, 1) * w + T * 4, py = y + hash2(seed, k, 2) * h - T * (8 + 10 * hash2(seed, k, 3));
    const r = 10 + 14 * hash2(seed, k, 4) * (0.6 + u);
    const left = Math.min(1, (1 - u) * 1.8);
    disc(px, py, r, 3, 0.85, (d, gx, gy) => (left * (1.25 - d * 0.7) > dither(gx, gy) ? DUST[Math.min(3, Math.floor(u * 2 + d * 1.5))]! : null));
  }
  blocks.flush(g);
}
