// Scenery in a WorldBox-like pixel style: chunky trees and bushes with a lit
// side, a shaded side and a dark rim, and buildings seen at a three-quarter
// angle, with their south wall facing the viewer and the roof above it.
import type { Building } from "../../src/world/layout.ts";
import type { World } from "../../src/world/world.ts";
import { holeStep } from "../../src/world/map.ts";
import { TILE, hash2 } from "./sprites.ts";

/** A sprite with its anchor: where its foot meets the ground. */
export interface Prop {
  img: HTMLCanvasElement;
  ax: number;
  ay: number;
  /** Width of its ground shadow, in pixels. */
  shadow: number;
}

interface Greens {
  light: string;
  mid: string;
  base: string;
  dark: string;
  rim: string;
}

const LEAVES: Greens[] = [
  { light: "#a6d466", mid: "#78b448", base: "#549036", dark: "#346424", rim: "#1c3a16" },
  { light: "#94c85a", mid: "#64a440", base: "#46802e", dark: "#2c5a20", rim: "#183414" },
  { light: "#b4dc6c", mid: "#86ba4a", base: "#5e9636", dark: "#3a6a26", rim: "#203c16" },
  { light: "#82bc54", mid: "#56963a", base: "#3c742a", dark: "#264e1c", rim: "#142e12" },
];
const PINE: Greens = { light: "#5a9a54", mid: "#3e7c40", base: "#2e6634", dark: "#204c28", rim: "#10281a" };
const BARK = { light: "#8a6040", base: "#6a4428", dark: "#432a18" };

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

/**
 * A leafy crown built from rounded clumps, painted back to front so the lower,
 * nearer clumps overlap the ones behind. Each clump is lit on its upper left
 * and falls into shade underneath, so the crown reads as a heap of foliage.
 */
function crown(g: CanvasRenderingContext2D, w: number, h: number, clumps: [number, number, number][], pal: Greens, seed: number, fruit: string | null): void {
  const order = [...clumps].sort((a, b) => a[1] - b[1]);
  const shadeOf: (string | null)[] = new Array(w * h).fill(null);
  const owner: number[] = new Array(w * h).fill(-1);
  order.forEach(([cx, cy, r], k) => {
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(h, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(w, Math.ceil(cx + r)); x++) {
        const nx = (x + 0.5 - cx) / r, ny = (y + 0.5 - cy) / r;
        if (nx * nx + ny * ny > 1) continue;
        const v = -(nx * 0.55 + ny) + (hash2(x, y, seed + k) - 0.5) * 0.3;
        shadeOf[y * w + x] = v > 0.55 ? pal.light : v > 0.05 ? pal.mid : v > -0.5 ? pal.base : pal.dark;
        owner[y * w + x] = k;
      }
    }
  });
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && owner[y * w + x]! >= 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!at(x, y)) {
        // A darker rim, heaviest along the underside.
        if (at(x, y - 1)) {
          g.fillStyle = pal.rim;
          g.fillRect(x, y, 1, 1);
        } else if (at(x - 1, y) || at(x + 1, y) || at(x, y + 1)) {
          g.fillStyle = pal.dark;
          g.fillRect(x, y, 1, 1);
        }
        continue;
      }
      let col = shadeOf[i]!;
      // Where a nearer clump sits on one behind, the one behind is in its shadow.
      if (y + 1 < h && owner[i + w]! > owner[i]! && owner[i + w]! >= 0) col = pal.dark;
      else if (y + 2 < h && owner[i + 2 * w]! > owner[i]! && owner[i + 2 * w]! >= 0 && col !== pal.dark) col = pal.base;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  // A few loose leaves catching the light, and some pockets of shade.
  for (let k = 0; k < Math.floor((w * h) / 28); k++) {
    const x = Math.floor(hash2(seed, k, 1) * w), y = Math.floor(hash2(seed, k, 2) * h);
    if (!at(x, y) || !at(x + 1, y) || !at(x, y + 1) || !at(x, y - 1)) continue;
    const lit = shadeOf[y * w + x] === pal.light || shadeOf[y * w + x] === pal.mid;
    g.fillStyle = lit ? pal.light : pal.dark;
    g.fillRect(x, y, 1, 1);
  }
  if (fruit) {
    for (let k = 0; k < Math.floor((w * h) / 22); k++) {
      const x = Math.floor(hash2(seed, k, 7) * w), y = Math.floor(hash2(seed, k, 8) * h);
      if (!at(x, y) || !at(x, y + 2) || !at(x - 1, y) || !at(x + 1, y)) continue;
      g.fillStyle = fruit;
      g.fillRect(x, y, 1, 1);
    }
  }
}

function trunk(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.fillStyle = BARK.dark;
  g.fillRect(x - 1, y, w + 2, h);
  g.fillStyle = BARK.base;
  g.fillRect(x, y, w, h);
  g.fillStyle = BARK.light;
  g.fillRect(x, y, 1, h - 1);
  g.fillStyle = BARK.dark;
  g.fillRect(x + w - 1, y, 1, h);
  g.fillRect(x, y, w, 2);
  // Roots flare out where it meets the ground.
  g.fillStyle = BARK.dark;
  g.fillRect(x - 1, y + h - 1, w + 2, 1);
}

/** A broadleaf tree: an oak, ash or elm, about one tile across. */
function broadleaf(seed: number, big: boolean): Prop {
  const pal = LEAVES[Math.floor(hash2(seed, 1) * LEAVES.length)]!;
  const W = big ? 22 : 18, H = big ? 27 : 22;
  const [c, g] = canvas(W, H);
  const r = big ? 7.5 : 6;
  const cx = W / 2, top = r + 1.5;
  const j = (k: number) => (hash2(seed, k) - 0.5) * 2;
  const discs: [number, number, number][] = [
    [cx + j(2), top - r * 0.15, r * 0.72],
    [cx - r * 0.55, top + r * 0.5 + j(3), r * 0.66],
    [cx + r * 0.55, top + r * 0.45 + j(4), r * 0.68],
    [cx - r * 0.4 + j(5), top + r * 1.05, r * 0.62],
    [cx + r * 0.45, top + r * 1.1 + j(6), r * 0.6],
  ];
  const crownH = Math.ceil(top + r * 1.75);
  trunk(g, Math.floor(cx) - 1, crownH - 3, big ? 3 : 2, H - crownH + 3);
  crown(g, W, crownH, discs, pal, seed, null);
  return { img: c, ax: Math.floor(cx), ay: H - 1, shadow: big ? 16 : 13 };
}

/** An apple tree, as in every Norman orchard: short, round, red-spotted. */
function appleTree(seed: number): Prop {
  const pal = LEAVES[2 + Math.floor(hash2(seed, 1) * 2)]!;
  const W = 16, H = 17;
  const [c, g] = canvas(W, H);
  const cx = W / 2, r = 5.5;
  const discs: [number, number, number][] = [
    [cx, 4.5, r * 0.75],
    [cx - 3, 7.5, 3.8],
    [cx + 3, 7.5, 3.8],
    [cx, 9, 3.6],
  ];
  trunk(g, Math.floor(cx) - 1, 11, 2, H - 11);
  crown(g, W, 13, discs, pal, seed, hash2(seed, 5) < 0.75 ? "#d8402c" : "#e8c040");
  return { img: c, ax: Math.floor(cx), ay: H - 1, shadow: 11 };
}

/** A fir: stacked tiers, lit on the left. */
function pine(seed: number): Prop {
  const W = 15, H = 26;
  const [c, g] = canvas(W, H);
  const cx = 7;
  trunk(g, cx - 1, H - 5, 2, 5);
  const tiers = 4;
  for (let k = 0; k < tiers; k++) {
    const y0 = 1 + k * 4.5, hh = 7 + k;
    for (let y = 0; y < hh; y++) {
      const half = Math.floor(((y + 1) / hh) * (2.5 + k * 1.2)) + 1;
      for (let x = -half; x <= half; x++) {
        const edge = Math.abs(x) === half || y === hh - 1;
        const n = hash2(seed + k, x * 7 + y, 3);
        const col = edge ? PINE.rim : x < -half / 2 ? (n < 0.6 ? PINE.light : PINE.mid) : x < 1 ? PINE.mid : x < half / 1.5 ? PINE.base : PINE.dark;
        g.fillStyle = col;
        g.fillRect(cx + x, Math.floor(y0 + y), 1, 1);
      }
    }
  }
  return { img: c, ax: cx, ay: H - 1, shadow: 10 };
}

/** A low bush or bramble clump: hedgerow stuff. */
function bush(seed: number, w: number): Prop {
  const pal = LEAVES[Math.floor(hash2(seed, 1) * LEAVES.length)]!;
  const h = Math.round(w * 0.72);
  const [c, g] = canvas(w, h);
  const r = h / 2 - 0.5;
  const discs: [number, number, number][] = [
    [w / 2, r * 0.8 + 0.5, r * 0.8],
    [r * 0.85 + 0.5, h / 2 + 1, r * 0.8],
    [w - r * 0.85 - 0.5, h / 2 + 1, r * 0.8],
  ];
  crown(g, w, h, discs, pal, seed, hash2(seed, 6) < 0.15 ? "#f0e8e0" : null);
  return { img: c, ax: Math.floor(w / 2), ay: h - 2, shadow: w - 2 };
}

/** Variants of each kind of plant, made once. */
export class Flora {
  readonly oaks: Prop[] = [];
  readonly bigOaks: Prop[] = [];
  readonly apples: Prop[] = [];
  readonly pines: Prop[] = [];
  readonly bushes: Prop[] = [];
  readonly shrubs: Prop[] = [];
  readonly hedge: Prop[] = [];

  constructor() {
    for (let k = 0; k < 8; k++) {
      this.oaks.push(broadleaf(100 + k, false));
      this.bigOaks.push(broadleaf(200 + k, true));
      this.apples.push(appleTree(300 + k));
      this.pines.push(pine(400 + k));
      this.bushes.push(bush(500 + k, 12));
      this.hedge.push(bush(700 + k, 15));
      this.shrubs.push(bush(600 + k, 9));
    }
  }
}

export function pick<T>(list: readonly T[], x: number, y: number, salt: number): T {
  return list[Math.floor(hash2(x, y, salt) * list.length)]!;
}

/** A soft pixel shadow on the ground under a plant, cast down and to the right. */
export function groundShadow(g: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  const h = Math.max(2, Math.round(w * 0.35));
  g.fillStyle = "rgba(10,24,8,0.32)";
  for (let yy = 0; yy < h; yy++) {
    const t = (yy + 0.5) / h * 2 - 1;
    const half = Math.round((w / 2) * Math.sqrt(1 - t * t));
    g.fillRect(Math.round(x + 2 - half + yy * 0.5), Math.round(y - h / 2 + yy + 1), half * 2, 1);
  }
}

// ---------- Buildings ----------

interface Look {
  wallH: number;
  wall: string;
  wallDark: string;
  trim: string;
  roof: [string, string, string, string];
  hip: boolean;
}

/** Light slope, front slope, shaded slope, eaves. */
const LOOKS: Record<Building["kind"], Look> = {
  farmhouse: { wallH: 19, wall: "#d8c8a0", wallDark: "#b4a27a", trim: "#5a3a24", roof: ["#b05a40", "#94442e", "#763424", "#4a2016"], hip: true },
  barn: { wallH: 21, wall: "#8a6440", wallDark: "#6a4a2e", trim: "#4a3020", roof: ["#a8905a", "#8c7646", "#6e5c36", "#463a22"], hip: false },
  cottage: { wallH: 17, wall: "#e6dece", wallDark: "#c2b8a4", trim: "#4a3020", roof: ["#78787e", "#606068", "#4c4c54", "#2e2e36"], hip: false },
  church: { wallH: 21, wall: "#b0aca0", wallDark: "#8e8a80", trim: "#3a3a3e", roof: ["#6a6a76", "#54545e", "#42424a", "#26262c"], hip: true },
  house: { wallH: 16, wall: "#c8bca4", wallDark: "#a69a82", trim: "#3a3028", roof: ["#6e7078", "#585a62", "#46484e", "#2a2c30"], hip: false },
  shop: { wallH: 17, wall: "#d8cfb8", wallDark: "#b2a890", trim: "#2e4a5a", roof: ["#a85a44", "#8e4632", "#723626", "#46201a"], hip: false },
};

/** Pixels each storey above the ground floor adds to a front wall. */
const STOREY = 13;

/** Height of a building's front wall in pixels: the ground floor, and a storey for each floor above it. */
export function wallHeight(b: Building): number {
  return LOOKS[b.kind].wallH + (b.kind === "church" ? 0 : (b.floors - 1) * STOREY);
}

/** Pixel bounds of a building's three-quarter sprite, in world pixels. */
export function buildingBounds(b: Building): { x: number; y: number; w: number; h: number } {
  const WH = wallHeight(b);
  const extra = b.kind === "church" ? 64 : 12;
  return { x: b.x * TILE - 3, y: b.y * TILE - WH - extra, w: b.w * TILE + 6, h: b.h * TILE + WH + extra + 1 };
}

/**
 * Draws one building at three-quarter view into its own canvas: the roof over
 * the footprint, lifted by the wall height, and the south wall below it with
 * the real windows and doors of that wall.
 */
export function buildingSprite(w: World, b: Building): HTMLCanvasElement {
  if (b.destroyed) return ruinSprite(w, b);
  const L = LOOKS[b.kind];
  const B = buildingBounds(b);
  const [c, g] = canvas(B.w, B.h);
  const px = (x: number, y: number, col: string, ww = 1, hh = 1) => {
    g.fillStyle = col;
    g.fillRect(x, y, ww, hh);
  };
  const ox = b.x * TILE - B.x, oy = b.y * TILE - B.y;
  const FW = b.w * TILE, FH = b.h * TILE;
  const WH = wallHeight(b);
  const wallTop = oy + FH - WH;
  const south = b.y + b.h - 1;
  const storeys = b.kind === "church" ? 1 : b.floors;
  /** Top of the band of wall belonging to floor f (0 the ground floor, at the bottom). */
  const bandTop = (f: number) => (f === 0 ? wallTop + WH - L.wallH : wallTop + (storeys - 1 - f) * STOREY);

  // The south wall, facing us.
  px(ox, wallTop, L.wall, FW, WH);
  for (let x = 0; x < FW; x++) {
    for (let y = 0; y < WH; y++) {
      const X = ox + x, Y = wallTop + y;
      if (b.kind === "barn") {
        if (x % 4 === 0) px(X, Y, L.wallDark);
        else if (hash2(x, y, b.id + 9) < 0.06) px(X, Y, "#9a7450");
      } else if (b.kind === "cottage") {
        // Norman half-timbering.
        const yy = y % STOREY;
        if (yy === 1 || x % 8 === 0 || (x % 8 === yy % 8 && yy > 1 && yy < STOREY - 2)) px(X, Y, "#5a3a22");
      } else if (b.kind === "house" || b.kind === "shop") {
        // Rendered stone, dressed quoins at the corners.
        if ((x < 3 || x >= FW - 3) && Math.floor(y / 3) % 2 === 0) px(X, Y, L.wallDark);
        else if (hash2(x, y, b.id + 5) < 0.05) px(X, Y, L.wallDark);
      } else {
        const row = Math.floor(y / 3);
        if (y % 3 === 2 || (x + row * 3) % 7 === 0) px(X, Y, L.wallDark);
        else if (hash2(x, y, b.id + 3) < 0.08) px(X, Y, "#ece2c4");
      }
    }
  }
  // A string course between the floors.
  for (let f = 1; f < storeys; f++) px(ox, bandTop(f) + STOREY - 1, L.wallDark, FW, 1);
  // A shop front: an awning over the ground floor.
  if (b.kind === "shop") {
    const ay = bandTop(0) + 1;
    for (let x = 0; x < FW; x++) px(ox + x, ay, Math.floor(x / 4) % 2 ? "#e8e0d0" : "#a83a2a", 1, 3);
    px(ox, ay + 3, "rgba(0,0,0,0.25)", FW, 1);
  }
  // Bullet holes across the front, where rounds struck it.
  for (let tx = b.x; tx < b.x + b.w; tx++) {
    const n = holeStep(w.map.holes[w.map.idx(tx, south)]!) + holeStep(w.map.holes[w.map.idx(tx, south - 1)]!);
    for (let k = 0; k < n * 5; k++) {
      const hx = ox + (tx - b.x) * TILE + 1 + Math.floor(hash2(tx, k, b.id + 40) * 14), hy = wallTop + 2 + Math.floor(hash2(k, tx, b.id + 41) * (WH - 5));
      px(hx, hy, "#1e1a16");
      px(hx + 1, hy, "#f0e8d4");
      if (k % 4 === 0) px(hx, hy + 1, L.wallDark);
    }
  }
  // Shade under the eaves and at the right-hand corner; a plinth along the foot.
  px(ox, wallTop, "rgba(0,0,0,0.28)", FW, 2);
  px(ox + FW - 2, wallTop, "rgba(0,0,0,0.18)", 2, WH);
  px(ox, wallTop + WH - 2, b.kind === "barn" ? "#4a3420" : "#7a7266", FW, 2);

  // Windows and doors where the sim has them in the south wall, a window on every floor above.
  for (let tx = b.x; tx < b.x + b.w; tx++) {
    const t = w.map.at(tx, south);
    const X = ox + (tx - b.x) * TILE;
    const window = (wy: number) => {
      px(X + 4, wy - 1, L.trim, 8, 8);
      px(X + 5, wy, "#2a3644", 6, 6);
      px(X + 5, wy, "#5a7a94", 2, 2);
      px(X + 7, wy, L.trim, 1, 6);
      px(X + 5, wy + 2, L.trim, 6, 1);
      // Shutters.
      px(X + 2, wy - 1, b.kind === "cottage" ? "#3a6a5a" : b.kind === "house" ? "#4a5a6a" : "#6a3a28", 2, 8);
      px(X + 12, wy - 1, b.kind === "cottage" ? "#3a6a5a" : b.kind === "house" ? "#4a5a6a" : "#6a3a28", 2, 8);
      px(X + 4, wy + 7, "#8a8478", 8, 1);
    };
    if (t === "window") {
      window(bandTop(0) + Math.max(2, Math.floor(L.wallH / 2) - 4));
      for (let f = 1; f < storeys; f++) window(bandTop(f) + 3);
    } else if (t === "door") {
      const dw = b.kind === "barn" ? 14 : 8, dh = Math.min(L.wallH - 2, b.kind === "barn" ? 15 : 11);
      const dx = X + Math.floor((TILE - dw) / 2), dy = wallTop + WH - 2 - dh;
      px(dx - 1, dy - 1, L.trim, dw + 2, dh + 1);
      px(dx, dy, b.kind === "barn" ? "#5a3a20" : "#6a4426", dw, dh);
      for (let k = 2; k < dw; k += 3) px(dx + k, dy, "#4a2e18", 1, dh);
      if (b.kind === "barn") {
        px(dx + dw / 2, dy, "#2a1a10", 1, dh);
        for (let k = 0; k < dw; k++) px(dx + k, dy + Math.floor((k * dh) / dw), "#3a2414");
      } else px(dx + dw - 2, dy + Math.floor(dh / 2), "#c8a050");
      // A barn's loft door above, a small window over a house door.
      for (let f = 1; f < storeys; f++) {
        if (b.kind === "barn") {
          px(X + 4, bandTop(f) + 2, L.trim, 8, 9);
          px(X + 5, bandTop(f) + 3, "#3a2414", 6, 8);
        } else window(bandTop(f) + 3);
      }
    } else if (t === "rubble") {
      // A shell has torn a breach in the wall.
      const by = wallTop + 2;
      px(X + 2, by, "#2a2218", 12, WH - 4);
      for (let k = 0; k < 6; k++) px(X + 1 + Math.floor(hash2(tx, k, 4) * 14), by + Math.floor(hash2(tx, k, 5) * (WH - 4)), L.wallDark, 2, 2);
    }
  }

  // The roof, over the footprint and lifted by the wall.
  const RX = ox - 3, RY = oy - WH - 1, RW = FW + 6, RH = FH + 2;
  const horiz = b.w >= b.h;
  const face = (x: number, y: number): number => {
    // 0 light slope, 1 front slope, 2 shaded slope, 3 back hip, -1 gable wall.
    if (horiz) {
      const ridge = Math.round(RH * 0.42), inset = Math.min(RH * 0.5, RW * 0.28);
      const reach = y < ridge ? inset * (y / ridge) : inset * ((RH - y) / (RH - ridge));
      if (L.hip && x < reach) return 0;
      if (L.hip && RW - 1 - x < reach) return 2;
      return y < ridge ? 3 : 1;
    }
    const mid = RW / 2, inset = Math.min(RW * 0.5, RH * 0.3);
    if (y < inset * (1 - Math.abs(x + 0.5 - mid) / mid)) return 3;
    const gable = RW * 0.3;
    if (RH - 1 - y < gable * (1 - Math.abs(x + 0.5 - mid) / mid) - 1) return -1;
    return x < mid ? 0 : 2;
  };
  const colours = [L.roof[0], L.roof[1], L.roof[2], shade(L.roof[0], 1.12)];
  for (let y = 0; y < RH; y++) {
    for (let x = 0; x < RW; x++) {
      const f = face(x, y);
      const X = RX + x, Y = RY + y;
      if (f === -1) {
        // Gable end: wall up to the roof line, with a little vent.
        px(X, Y, (x + y) % 5 === 0 ? L.wallDark : L.wall);
        continue;
      }
      // Rows of tiles (or slates, or thatch) running along the eaves.
      const along = f === 1 || f === 3 ? (horiz ? y : x) : horiz ? x : y;
      const across = f === 1 || f === 3 ? (horiz ? x : y) : horiz ? y : x;
      let col = colours[f]!;
      if (along % 3 === 0) col = shade(col, 0.82);
      else if ((across + Math.floor(along / 3) * 2) % 5 === 0) col = shade(col, 0.9);
      else if (hash2(x, y, b.id + 11) < 0.05) col = shade(col, 1.1);
      px(X, Y, col);
    }
  }
  // Ridge and hip lines, the eave edge and the rim.
  for (let y = 0; y < RH; y++) {
    for (let x = 0; x < RW; x++) {
      const f = face(x, y);
      const r = x + 1 < RW ? face(x + 1, y) : f, d = y + 1 < RH ? face(x, y + 1) : f;
      if (f !== r || f !== d) px(RX + x, RY + y, f === -1 || r === -1 || d === -1 ? L.roof[3] : shade(L.roof[0], 1.25));
    }
  }
  px(RX, RY + RH - 1, L.roof[3], RW, 1);
  px(RX, RY + RH, "rgba(0,0,0,0.3)", RW, 1);
  px(RX, RY, L.roof[3], RW, 1);
  px(RX, RY, L.roof[3], 1, RH);
  px(RX + RW - 1, RY, L.roof[3], 1, RH);
  if (!L.hip && horiz) {
    // Gable verges: the roof's cut ends, with the barge boards showing.
    px(RX + 1, RY + 1, shade(L.roof[1], 0.7), 2, RH - 2);
    px(RX + RW - 3, RY + 1, shade(L.roof[1], 0.6), 2, RH - 2);
  }

  // Shell holes through the roof: over breached walls, and wherever bombs came through.
  for (let yy = b.y; yy < b.y + b.h; yy++) {
    for (let xx = b.x; xx < b.x + b.w; xx++) {
      const hits = w.map.roofHits[w.map.idx(xx, yy)]!;
      if (w.map.at(xx, yy) !== "rubble" && hits === 0) continue;
      const X = ox + (xx - b.x) * TILE, Y = oy + (yy - b.y) * TILE - WH;
      if (hits === 1 && w.map.at(xx, yy) !== "rubble") {
        // A single bomb: a ragged hole and slipped tiles round it.
        px(X + 4, Y + 5, L.roof[3], 8, 6);
        px(X + 5, Y + 6, "#1a140e", 6, 4);
        px(X + 7, Y + 5, "#5a3e24", 1, 6);
        for (let k = 0; k < 5; k++) px(X + 2 + Math.floor(hash2(xx, yy, k) * 12), Y + 3 + Math.floor(hash2(yy, xx, k) * 10), L.roof[2], 2, 1);
        continue;
      }
      px(X + 1, Y + 2, L.roof[3], 14, 12);
      px(X + 2, Y + 3, "#1a140e", 12, 10);
      px(X + 4, Y + 5, "#2e2418", 4, 3);
      px(X + 2, Y + 7, "#5a3e24", 13, 1);
      px(X + 9, Y + 2, "#5a3e24", 1, 12);
      px(X + 4, Y + 3, "#5a3e24", 1, 5);
    }
  }

  // Chimneys on the dwellings.
  if (b.kind === "farmhouse" || b.kind === "cottage") {
    const spots = b.kind === "farmhouse" ? [0.22, 0.8] : [0.7];
    for (const f of spots) {
      const X = RX + Math.round(RW * f), Y = RY + Math.round(RH * 0.18);
      px(X - 1, Y - 9, "#3a2a22", 7, 12);
      px(X, Y - 8, "#9a5a44", 5, 11);
      px(X + 3, Y - 8, "#74402e", 2, 11);
      px(X - 1, Y - 10, "#5a4a42", 7, 2);
      px(X, Y - 9, "#2a1a14", 5, 1);
    }
  }

  // The chapel's tower and spire at the front.
  if (b.kind === "church") {
    const TW = 22, TX = RX + Math.round(RW / 2 - TW / 2), base = oy + FH, TH = L.wallH + 46;
    const top = base - TH;
    px(TX - 1, top - 1, "#2a2a2e", TW + 2, TH + 1);
    px(TX, top, "#c0bcae", TW, TH);
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) if (y % 4 === 3 || (x + Math.floor(y / 4) * 4) % 8 === 0) px(TX + x, top + y, "#9a968a");
    px(TX + TW - 4, top, "rgba(0,0,0,0.2)", 4, TH);
    // The belfry high up: a pair of louvred openings under a string course, a slit window halfway, a door at its foot.
    px(TX, top + 15, "#8a8678", TW, 2);
    for (const ox2 of [4, 13]) {
      px(TX + ox2 - 1, top + 2, "#8a8678", 7, 12);
      px(TX + ox2, top + 3, "#1a1a20", 5, 11);
      px(TX + ox2, top + 3, "#3a3a44", 5, 1);
      for (let k = 5; k < 13; k += 3) px(TX + ox2, top + k, "#4a4a52", 5, 1);
    }
    px(TX + 10, top + 26, "#1a1a20", 2, 7);
    px(TX + 7, base - 13, "#3a2a1a", 8, 12);
    px(TX + 8, base - 12, "#6a4426", 6, 11);
    px(TX + 8, base - 12, "#4a2e18", 6, 1);
    px(TX + 11, base - 12, "#4a2e18", 1, 11);
    // Slate spire.
    const SH = 22;
    for (let y = 0; y < SH; y++) {
      const half = Math.round(((y + 1) / SH) * (TW / 2 + 1));
      for (let x = -half; x < half; x++) px(TX + TW / 2 + x, top - SH + y, x < 0 ? (y % 3 === 0 ? "#5a5a66" : "#6e6e7a") : y % 3 === 0 ? "#3a3a42" : "#4a4a54");
      px(TX + TW / 2 - half - 1, top - SH + y, "#26262c");
      px(TX + TW / 2 + half, top - SH + y, "#26262c");
    }
    px(TX + TW / 2 - 1, top - SH - 9, "#d8c890", 2, 10);
    px(TX + TW / 2 - 3, top - SH - 6, "#d8c890", 6, 2);
  }
  return c;
}

/**
 * What is left of a house that fell in: no roof, the walls broken off at
 * jagged heights, heaps of stone and charred beams at their foot. The rubble
 * inside is the ground itself, drawn by the terrain.
 */
function ruinSprite(w: World, b: Building): HTMLCanvasElement {
  const L = LOOKS[b.kind];
  const B = buildingBounds(b);
  const [c, g] = canvas(B.w, B.h);
  const px = (x: number, y: number, col: string, ww = 1, hh = 1) => {
    g.fillStyle = col;
    g.fillRect(x, y, ww, hh);
  };
  const ox = b.x * TILE - B.x, oy = b.y * TILE - B.y;
  const FW = b.w * TILE, FH = b.h * TILE;
  const base = oy + FH;
  // The front wall, snapped off: higher by the corners, low where the shells came through.
  for (let x = 0; x < FW; x += 2) {
    const tx = b.x + Math.floor(x / TILE);
    const breach = w.map.at(tx, b.y + b.h - 1) === "rubble";
    const corner = Math.min(x, FW - 1 - x) < 10;
    const h = breach ? 2 + Math.floor(hash2(x, b.id, 3) * 3) : Math.round(L.wallH * (corner ? 0.75 : 0.25 + 0.45 * hash2(Math.floor(x / 6), b.id, 4)));
    px(ox + x, base - h, L.wall, 2, h);
    if (hash2(x, b.id, 5) < 0.4) px(ox + x, base - h, L.wallDark, 2, 1);
    for (let y = base - h + 2; y < base; y += 3) if ((x + y) % 7 === 0) px(ox + x, y, L.wallDark, 2, 1);
  }
  px(ox, base - 2, "#5a544a", FW, 2);
  // Scorched beams and heaps of stone.
  for (let k = 0; k < b.w * 2; k++) {
    const x = ox + Math.floor(hash2(b.id, k, 6) * (FW - 10)), y = base - 3 - Math.floor(hash2(b.id, k, 7) * 4);
    if (k % 3 === 0) px(x, y - 1, "#2a1e16", 9, 2);
    else {
      px(x, y, "#8a8478", 5, 3);
      px(x + 1, y, "#a8a294", 2, 1);
      px(x, y + 2, "#5a544a", 5, 1);
    }
  }
  // Charred rafters standing up out of the shell of the back wall.
  for (let k = 0; k < 3; k++) {
    const x = ox + 6 + Math.floor(hash2(b.id, k, 8) * (FW - 12));
    px(x, oy - 6, "#2a1e16", 2, 12 + Math.floor(hash2(b.id, k, 9) * 8));
  }
  // The back wall's stub along the top of the footprint.
  for (let x = 0; x < FW; x += 2) {
    const h = Math.round(6 + 6 * hash2(Math.floor(x / 5), b.id, 10));
    px(ox + x, oy - h + 4, L.wallDark, 2, h);
  }
  return c;
}

/** The shadow a building throws onto the ground, east of it. */
export function buildingShadow(g: CanvasRenderingContext2D, b: Building): void {
  const WH = wallHeight(b);
  const x = (b.x + b.w) * TILE, y0 = b.y * TILE - WH + 6, y1 = (b.y + b.h) * TILE;
  const depth = Math.round(WH * 0.6);
  g.fillStyle = "rgba(12,20,8,0.3)";
  for (let y = y0; y < y1; y++) g.fillRect(x, y, Math.min(depth, Math.max(0, y - y0 + 3)), 1);
}

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f)), gg = Math.min(255, Math.round(((n >> 8) & 255) * f)), b = Math.min(255, Math.round((n & 255) * f));
  return `#${((1 << 24) | (r << 16) | (gg << 8) | b).toString(16).slice(1)}`;
}
