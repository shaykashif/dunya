// Pixel-art sprites, drawn from small character grids. Everything is generated
// in code, so the viewer needs no image assets.
import type { Posture, Side } from "../../src/world/types.ts";

export const TILE = 16;

export type Palette = Record<string, string>;

/** Builds a canvas from rows of palette characters ('.' is transparent). */
export function fromRows(rows: readonly string[], pal: Palette, flip = false): HTMLCanvasElement {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  for (let y = 0; y < h; y++) {
    const row = rows[y]!;
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]!];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(flip ? w - 1 - x : x, y, 1, 1);
    }
  }
  return c;
}

/** Small deterministic hash for per-tile variation. */
export function hash2(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const SIDE_COLORS: Record<Side, { coat: string; coatDark: string; trousers: string; helmet: string; helmetDark: string; boots: string; tracer: string; name: string }> = {
  // Americans in warm khaki and olive drab, with canvas leggings and a netted M1 helmet;
  // Germans in cool field grey, with a dark flared helmet, black straps and jackboots.
  us: { coat: "#a08a56", coatDark: "#7a6840", trousers: "#76603e", helmet: "#5e6c30", helmetDark: "#44501f", boots: "#5a3e24", tracer: "#ffb040", name: "#e8d890" },
  de: { coat: "#5e6e6c", coatDark: "#435250", trousers: "#6c7470", helmet: "#3c4644", helmetDark: "#262e2e", boots: "#16161a", tracer: "#c8ff70", name: "#c8d8c0" },
};

/**
 * Winter dress, the Ardennes in December. The Americans in the long olive drab
 * wool overcoat, a knitted scarf and rubber overshoes; the Germans in the
 * field-grey Mantel, double-breasted and buttoned to the throat, with a wool
 * toque under the helmet. Some helmets are daubed white with lime.
 */
export const WINTER_COLORS: Record<Side, { coat: string; coatDark: string; trousers: string; boots: string; scarf: string; scarfDark: string; button: string; glove: string; whitewash: string; whitewashDark: string }> = {
  us: { coat: "#6a6242", coatDark: "#4c462e", trousers: "#5c5038", boots: "#24221e", scarf: "#bcae84", scarfDark: "#8e8260", button: "#2e2a1c", glove: "#3a3022", whitewash: "#d6dad4", whitewashDark: "#a8aca6" },
  de: { coat: "#4c5a50", coatDark: "#34403a", trousers: "#5a625e", boots: "#16161a", scarf: "#8a8e86", scarfDark: "#666a62", button: "#c8c4a8", glove: "#26282a", whitewash: "#dadcd6", whitewashDark: "#acb0a8" },
};

const SKINS = ["#f2c9a0", "#e8b890", "#d9a57a", "#c98e62", "#a86f48"];

export function skinOf(id: number): string {
  return SKINS[Math.floor(hash2(id, 3) * SKINS.length)]!;
}

const US_STAND = [
  "..HHHH..",
  ".HnHHnH.",
  ".hSSSSh.",
  "..SESE..",
  ".cCCCCc.",
  "SCCCCCCS",
  "SCbbbbCS",
  ".cCCCCc.",
  "..PPPP..",
  "..P..P..",
  "..L..L..",
  "..B..B..",
];
const DE_STAND = [
  "..HHHH..",
  ".HHHHHH.",
  "hhSSSShh",
  ".hSESEh.",
  ".cyCCyc.",
  "SCyCCyCS",
  "SCbbbbCS",
  ".cCCCCc.",
  "..PPPP..",
  "..P..P..",
  "..B..B..",
  "..B..B..",
];
// The greatcoat: collar and scarf up round the chin, and the skirts down past the knee, split at the back.
const US_WINTER = [
  "..WWWH..",
  ".HnHHnH.",
  ".hSSSSh.",
  "..SESE..",
  ".kKKKKk.",
  "GCCCCCCG",
  "GCbbbbCG",
  ".CCoCCC.",
  ".cCCCCc.",
  ".cC..Cc.",
  "..P..P..",
  "..B..B..",
];
const DE_WINTER = [
  "..WWWH..",
  ".HHHHHH.",
  "hhKSSKhh",
  ".hSESEh.",
  ".kKKKKk.",
  "GCoCCoCG",
  "GCbbbbCG",
  ".CoCCoC.",
  ".cCCCCc.",
  ".cC..Cc.",
  "..P..P..",
  "..B..B..",
];
const winterWalk = (rows: readonly string[]) => [...rows.slice(0, 9), ".C....C.", ".P....P.", ".B....B."];
const WINTER_CROUCH = (rows: readonly string[]) => [rows[0]!, rows[1]!, rows[2]!, rows[3]!, rows[4]!, rows[5]!, rows[6]!, ".CCCCCC.", "CC....CC", "B......B"];
const WINTER_PRONE = ["....cCCCCWW.", "BPCCCbCCCKHH", "BPCCCCCCCSSH", "..P...c..G.."];
const walkRows = (rows: readonly string[]) => [...rows.slice(0, 9), ".P....P.", rows[10]!.includes("L") ? ".L....L." : ".B....B.", ".B....B."];
const CROUCH = (rows: readonly string[]) => [rows[0]!, rows[1]!, rows[2]!, rows[3]!, rows[4]!, rows[5]!, rows[6]!, ".PPPPPP.", "PP....PP", "B......B"];
const PRONE = ["......cCCHH.", "BPPPPbCCCSHH", "BPPPPCCCCSSH", "..P...c....."];
const SURRENDER = (rows: readonly string[]) => ["S.HHHH.S", "SHHHHHHS", "C" + rows[2]!.slice(1, 7) + "C", "c.SESE.c", ".cCCCCc.", "..CCCC..", "..bbbb..", ".cCCCCc.", ...rows.slice(8)];

export interface SoldierLook {
  side: Side;
  posture: Posture;
  walking: boolean;
  medic: boolean;
  surrendered: boolean;
  flip: boolean;
  dead: boolean;
  id: number;
  /** Greatcoats and scarves for the snow. */
  winter?: boolean;
}

/** A soldier sprite for his side, posture and state. */
export function soldierSprite(l: SoldierLook): HTMLCanvasElement {
  const c = SIDE_COLORS[l.side];
  const wc = WINTER_COLORS[l.side];
  const winter = l.winter === true;
  const base = winter ? (l.side === "us" ? US_WINTER : DE_WINTER) : l.side === "us" ? US_STAND : DE_STAND;
  let rows: readonly string[];
  if (l.dead || l.posture === "prone") rows = winter ? WINTER_PRONE : PRONE;
  else if (l.surrendered) rows = SURRENDER(base);
  else if (l.posture === "crouch") rows = winter ? WINTER_CROUCH(base) : CROUCH(base);
  else rows = l.walking ? (winter ? winterWalk(base) : walkRows(base)) : base;
  const pal: Palette = {
    H: c.helmet,
    h: c.helmetDark,
    S: skinOf(l.id),
    E: "#2a1a10",
    C: c.coat,
    c: c.coatDark,
    b: l.side === "us" ? "#c4ac70" : "#1e1e1c",
    P: c.trousers,
    L: "#c8b888",
    B: c.boots,
    n: "#7e8a4a",
    y: "#1e1e1c",
  };
  if (winter) {
    // A helmet daubed white, on about one man in three; the rest wear it as issued, with a dusting of snow.
    const white = hash2(l.id, 41) < 0.35;
    Object.assign(pal, {
      H: white ? wc.whitewash : c.helmet,
      h: white ? wc.whitewashDark : c.helmetDark,
      n: white ? wc.whitewashDark : "#c8ccc4",
      C: wc.coat,
      c: wc.coatDark,
      b: l.side === "us" ? "#8a7a50" : "#1e1e1c",
      P: wc.trousers,
      B: wc.boots,
      K: wc.scarf,
      k: wc.scarfDark,
      o: wc.button,
      G: wc.glove,
      W: "#f2f6fa",
    });
  }
  if (l.dead) {
    pal.C = shade(winter ? wc.coat : c.coat, 0.75);
    pal.c = shade(winter ? wc.coatDark : c.coatDark, 0.75);
    pal.S = "#b0a090";
  }
  const spr = fromRows(rows, pal, l.flip);
  if (l.medic && !l.dead) {
    // The red cross: on the helmet for an American aidman, on the armband for a German Sanitäter.
    const g = spr.getContext("2d")!;
    if (l.posture === "prone") {
      const x = l.flip ? 0 : 9;
      g.fillStyle = "#f4f0e8";
      g.fillRect(x + 1, 0, 2, 2);
      g.fillStyle = "#d02020";
      g.fillRect(x + 1, 0, 1, 1);
    } else if (l.side === "us") {
      g.fillStyle = "#f4f0e8";
      g.fillRect(3, 0, 2, 2);
      g.fillStyle = "#d02020";
      g.fillRect(3, 0, 2, 1);
      g.fillRect(4, 0, 1, 2);
    } else {
      g.fillStyle = "#f4f0e8";
      g.fillRect(l.flip ? 7 : 0, 5, 1, 2);
      g.fillStyle = "#d02020";
      g.fillRect(l.flip ? 7 : 0, 5, 1, 1);
    }
  }
  return outlined(spr);
}

/** The sprite with a one-pixel dark rim, so men stand out from busy ground. */
function outlined(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width + 2;
  c.height = src.height + 2;
  const g = c.getContext("2d")!;
  const data = src.getContext("2d")!.getImageData(0, 0, src.width, src.height).data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < src.width && y < src.height && data[(y * src.width + x) * 4 + 3]! > 0;
  g.fillStyle = "rgba(16,16,12,0.7)";
  for (let y = -1; y <= src.height; y++) {
    for (let x = -1; x <= src.width; x++) {
      if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) g.fillRect(x + 1, y + 1, 1, 1);
    }
  }
  g.drawImage(src, 1, 1);
  return c;
}

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f)), gg = Math.min(255, Math.round(((n >> 8) & 255) * f)), b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${gg},${b})`;
}

// ---------- Portraits ----------

const HAIRS = ["#2b1d14", "#5a3a1e", "#8a5a2b", "#c9a050", "#a33a1e", "#1a1a1a"];
const HAIR_NAMES = ["black", "dark brown", "brown", "fair", "red", "jet black"];
const SKIN_NAMES = ["fair", "pale", "light", "tanned", "olive"];

export function appearance(id: number): { skin: string; hair: string } {
  return { skin: SKIN_NAMES[Math.floor(hash2(id, 3) * SKIN_NAMES.length)]!, hair: HAIR_NAMES[Math.floor(hash2(id, 7) * HAIRS.length)]! };
}

export interface FaceInfo {
  id: number;
  side: Side;
  medic: boolean;
  pain: number;
  morale: number;
  lostEyes: ("left" | "right")[];
  bruised: boolean;
  cut: boolean;
  scar: boolean;
  deepScar: boolean;
  ruined: boolean;
  bloody: boolean;
  dead: boolean;
}

/** A 16x16 portrait under a helmet, scaled up by CSS. */
export function faceCanvas(f: FaceInfo): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 16;
  const g = c.getContext("2d")!;
  const col = SIDE_COLORS[f.side];
  const skin = skinOf(f.id);
  const hair = HAIRS[Math.floor(hash2(f.id, 7) * HAIRS.length)]!;
  const px = (x: number, y: number, cl: string, w = 1, h = 1) => {
    g.fillStyle = cl;
    g.fillRect(x, y, w, h);
  };
  px(0, 0, f.dead ? "#2a2a2e" : "#3a3a2c", 16, 16);
  // Collar and tunic.
  px(1, 13, col.coat, 14, 3);
  px(1, 13, col.coatDark, 14, 1);
  px(6, 13, f.side === "us" ? "#8a7a4a" : "#2e3a2a", 4, 1);
  // Neck and face.
  px(6, 11, skin, 4, 2);
  px(4, 4, skin, 8, 8);
  px(5, 12, skin, 6, 1);
  px(4, 4, hair, 1, 3);
  px(11, 4, hair, 1, 3);
  // Helmet.
  if (f.side === "us") {
    px(3, 1, col.helmet, 10, 3);
    px(4, 0, col.helmet, 8, 1);
    px(2, 3, col.helmetDark, 12, 1);
    px(3, 4, "#6a5a3a", 1, 4);
    px(12, 4, "#6a5a3a", 1, 4);
  } else {
    px(4, 0, col.helmet, 8, 1);
    px(3, 1, col.helmet, 10, 3);
    px(2, 4, col.helmet, 2, 3);
    px(12, 4, col.helmet, 2, 3);
    px(1, 6, col.helmetDark, 3, 1);
    px(12, 6, col.helmetDark, 3, 1);
    px(3, 3, col.helmetDark, 10, 1);
  }
  if (f.medic) {
    px(6, 1, "#f4f0e8", 4, 2);
    px(7, 1, "#d02020", 2, 2);
    px(6, 1, "#d02020", 4, 1);
    px(6, 1, "#f4f0e8", 1, 1);
    px(9, 1, "#f4f0e8", 1, 1);
  }
  const ey = 6;
  const eyeAt = (x: number, lost: boolean) => {
    if (lost) {
      px(x, ey, "#6a2020", 2, 2);
      px(x, ey, "#1a0c0c");
    } else {
      px(x, ey, "#f4f0e8", 2, 1);
      px(x + (hash2(f.id, 23) < 0.5 ? 0 : 1), ey, f.dead ? "#444" : "#2a1a10");
    }
  };
  eyeAt(5, f.lostEyes.includes("right"));
  eyeAt(9, f.lostEyes.includes("left"));
  px(5, ey - 1, "#2a1a10", 2);
  px(9, ey - 1, "#2a1a10", 2);
  px(7, ey + 1, shade(skin, 0.85), 2, 2);
  const my = ey + 4;
  if (f.dead) px(6, my, "#5a3a30", 4);
  else if (f.pain > 0.5 || f.morale < 0.25) {
    px(6, my, "#7a3a30", 4);
    px(5, my + 1, "#7a3a30");
    px(10, my + 1, "#7a3a30");
  } else px(6, my, "#7a3a30", 4);
  if (hash2(f.id, 19) < 0.4) px(5, ey + 3, shade(skin, 0.8), 6, 1);
  if (f.ruined) {
    px(4, 5, "#b05a58", 4, 6);
    px(5, 6, "#7a2020", 1, 5);
  } else if (f.deepScar) {
    for (let i = 0; i < 6; i++) px(4 + i, 5 + i, "#c88a80");
  } else if (f.scar) px(10, 8, "#d09a90", 1, 3);
  if (f.bruised) {
    px(4, ey + 1, "#6a4a8a", 2, 2);
    px(10, ey + 2, "#6a4a8a", 2, 2);
  }
  if (f.cut) {
    px(6, 4, "#b02020", 1, 4);
    px(7, 7, "#b02020");
  }
  if (f.bloody) {
    px(11, 9, "#902020", 1, 3);
    px(3, 14, "#902020", 3, 2);
  }
  return c;
}

/** Rectangles of a 40x74 body diagram, front view: the soldier's left is on the viewer's right. */
export const BODY_RECTS: Record<string, [number, number, number, number]> = {
  head: [14, 0, 12, 7],
  face: [15, 7, 10, 7],
  "left eye": [21, 8, 3, 2],
  "right eye": [16, 8, 3, 2],
  torso: [12, 16, 16, 24],
  "left arm": [29, 17, 5, 18],
  "right arm": [6, 17, 5, 18],
  "left hand": [29, 36, 5, 6],
  "right hand": [6, 36, 5, 6],
  "left leg": [21, 41, 7, 24],
  "right leg": [12, 41, 7, 24],
  "left foot": [21, 66, 8, 6],
  "right foot": [11, 66, 8, 6],
};
