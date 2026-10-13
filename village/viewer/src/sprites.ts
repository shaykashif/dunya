// Pixel-art sprites, drawn from small character grids and procedural tiles.
// Everything is generated in code, so the viewer needs no image assets.

export const TILE = 16;

export type Palette = Record<string, string>;

/** Builds a canvas from rows of palette characters ('.' is transparent). */
export function fromRows(rows: readonly string[], pal: Palette): HTMLCanvasElement {
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
      g.fillRect(x, y, 1, 1);
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

export const HOUSEHOLD_COLORS = ["#c8483a", "#3a72d8", "#3c9a4a", "#b07ad8", "#d89a3a"];
export const HOUSEHOLD_DARK = ["#8a2a22", "#244a94", "#25692f", "#764d99", "#94661f"];

const SKINS = ["#f2c9a0", "#e0b088", "#c98e62", "#a86f48", "#7d4f30"];
const HAIRS = ["#2b1d14", "#5a3a1e", "#8a5a2b", "#c9a050", "#d8d0c0", "#a33a1e", "#1a1a1a"];

export interface Look {
  skin: string;
  hair: string;
  shirt: string;
  shirtDark: string;
  pants: string;
}

export function lookFor(id: number, household: number, age: number): Look {
  const skin = SKINS[Math.floor(hash2(id, 3) * SKINS.length)]!;
  let hair = HAIRS[Math.floor(hash2(id, 7) * (HAIRS.length - 1))]!;
  if (age >= 58) hair = HAIRS[4]!;
  return {
    skin,
    hair,
    shirt: HOUSEHOLD_COLORS[household % HOUSEHOLD_COLORS.length]!,
    shirtDark: HOUSEHOLD_DARK[household % HOUSEHOLD_DARK.length]!,
    pants: hash2(id, 11) < 0.5 ? "#4a3a2a" : "#3a3f55",
  };
}

const ADULT_M = [
  "..HHHH..",
  ".HHHHHH.",
  ".HSSSSH.",
  "..SESE..",
  "..SSSS..",
  ".cCCCCc.",
  "SCCCCCCS",
  "SCCCCCCS",
  ".cCCCCc.",
  "..PPPP..",
  "..P..P..",
  "..B..B..",
];
const ADULT_M_WALK = [...ADULT_M.slice(0, 10), ".P....P.", ".B....B."];
const ADULT_F = [
  "..HHHH..",
  ".HHHHHH.",
  "HHSSSSHH",
  "H.SESE.H",
  "H.SSSS.H",
  ".cCCCCc.",
  "SCCCCCCS",
  "SCCCCCCS",
  ".CCCCCC.",
  ".CCCCCC.",
  "..S..S..",
  "..B..B..",
];
const ADULT_F_WALK = [...ADULT_F.slice(0, 10), ".S....S.", ".B....B."];
const CHILD = [
  "..HHHH..",
  ".HSSSSH.",
  "..SESE..",
  "..SSSS..",
  "..CCCC..",
  ".SCCCCS.",
  "..CCCC..",
  "..P..P..",
];
const CHILD_WALK = [...CHILD.slice(0, 7), ".P....P."];
const BABY = ["..HH..", ".SSSS.", ".SESE.", "..CC..", ".CCCC."];

export function personSprite(look: Look, sex: "f" | "m", age: number, walking: boolean): HTMLCanvasElement {
  const rows = age < 2 ? BABY : age < 12 ? (walking ? CHILD_WALK : CHILD) : sex === "f" ? (walking ? ADULT_F_WALK : ADULT_F) : walking ? ADULT_M_WALK : ADULT_M;
  return fromRows(rows, { H: look.hair, S: look.skin, E: "#2a1a10", C: look.shirt, c: look.shirtDark, P: look.pants, B: "#2a2018" });
}

export const BODY = fromRows(
  [
    "................",
    "..HH..........",
    ".HSSCCCCCCPPBB..",
    ".HSSCCCCCCPPBB..",
    "..HH............",
  ],
  { H: "#5a3a1e", S: "#c9a888", C: "#8a8a8a", P: "#4a3a2a", B: "#2a2018" },
);

export const GRAVE = fromRows(
  ["..GGGG..", ".GGLGGG.", ".GLLLGG.", ".GGLGGG.", ".GGLGGG.", ".GGGGGG.", "DDDDDDDD"],
  { G: "#9aa0a8", L: "#c8ccd2", D: "#5a4632" },
);

export const MOUND = fromRows(["........", "..DDDD..", ".DDEDDD.", "DDDDDDDD", "........"], { D: "#6a4a30", E: "#8a6a48" });

/** 7x7 activity icons shown above villagers. */
const ICON_ROWS: Record<string, readonly string[]> = {
  rescue: ["...R...", "...R...", ".RRRRR.", "...R...", "...R...", ".......", "......."],
  carry: ["..MM...", ".MMMM..", "MMMMMMM", ".WWWW..", ".W..W..", ".W..W..", "......."],
  tend_wounded: ["WWWWWWW", "WWWRWWW", "WWRRRWW", "WWWRWWW", "WWWWWWW", ".......", "......."],
  seek_care: ["WWWWWWW", "WWWRWWW", "WWRRRWW", "WWWRWWW", "WWWWWWW", ".......", "......."],
  craft: ["....DD.", "...DD..", "..DD...", ".SDD...", "SSS....", ".S.....", "......."],
  masonry: [".SSSSS.", ".SSSSS.", "...D...", "...D...", "...D...", ".......", "SSSSSSS"],
  patrol: ["...Y...", "..YOY..", "...D...", "...D...", "...D...", "...D...", "......."],
  intimidate: ["RRR.RRR", "R.R.R.R", "RRR.RRR", ".......", "..RRR..", ".R...R.", "......."],
  commission: [".WWWWW.", ".WKKKW.", ".WWWWW.", ".WKKKW.", ".WWWWW.", ".WKKKW.", ".WWWWW."],
  haul: ["DDDDDDD", "DYDDYDD", "DDDDDDD", ".......", "..WWW..", ".W...W.", "......."],
  construct: ["SSS....", "SSS....", ".D.....", "..D....", "...D.SS", "....DSS", "......."],
  quarry: ["...S...", "..SSS..", ".SSSSS.", "...D...", "...D...", "SSSSSSS", "SKSKSKS"],
  pray: ["...Y...", "..YYY..", "...Y...", ".WWWWW.", ".W...W.", ".WWWWW.", "......."],
  celebrate: ["Y.R.B.Y", ".......", "R.Y.R.B", ".......", "B.R.Y.R", ".......", "Y.B.R.Y"],
  wolf_hunt: ["G.....G", "GG...GG", "GGGGGGG", "GKGGGKG", ".GGGGG.", "..GGG..", "...R..."],
  skin: ["...SS..", "..SS...", ".SS....", "DDDDD..", "DDDDDD.", ".DDDD..", "......."],
  sew: ["......S", ".....S.", "....S..", "...S...", "..S....", "WWW....", "W......"],
  inquest: [".KKK...", "KWWWK..", "KWLWK..", "KWWWK..", ".KKKS..", "....SS.", ".....SS"],
  eat: ["...WW..", "..WWWW.", "..WMMW.", "...MM..", "..BB...", ".BB....", "B......"],
  sleep: ["ZZZZ...", "...Z...", "..Z....", ".Z.....", "ZZZZ...", ".....zz", "......z"],
  drink: ["...B...", "..BBB..", ".BBBBB.", ".BBLBB.", ".BBBBB.", "..BBB..", "......."],
  forage: ["...G...", "..GG...", ".RR.RR.", "RRRRRRR", ".RRRRR.", "..RRR..", "......."],
  gather_wood: ["....SS.", "...SSS.", "..SWS..", ".WW....", "WW.....", "W......", "......."],
  tend_fire: ["...Y...", "..YOY..", "..OYO..", ".ORRRO.", ".ORYRO.", "WWWWWWW", "......."],
  steal: [".......", "KKKKKKK", "KWKKKWK", "KKKKKKK", ".......", "...$$..", "...$$.."],
  attack: ["......S", ".....S.", "....S..", "W..S...", ".WS....", ".BW....", "B......"],
  court: [".R...R.", "RRR.RRR", "RRRRRRR", "RRRRRRR", ".RRRRR.", "..RRR..", "...R..."],
  propose: [".R...R.", "RRR.RRR", "RRRRRRR", ".RRRRR.", "..RYR..", "...Y...", "..YYY.."],
  socialize: ["WWWWWW.", "WKWKWW.", "WWWWWW.", ".WW....", "W......", ".......", "......."],
  examine: [".KKK...", "KWWWK..", "KWLWK..", "KWWWK..", ".KKKS..", "....SS.", ".....SS"],
  interview: ["WWWWWW.", "W?W?WW.", "WWWWWW.", ".WW....", "W......", ".......", "......."],
  accuse: ["...S...", "...S...", "..SSS..", "...S...", "...S...", ".......", "..SSS.."],
  judge: ["SSSSSS.", "SSSSSS.", "..WW...", "..WW...", "..WW...", ".......", "BBBBBBB"],
  testify: ["...Y...", "..YYY..", "Y..Y..Y", "YY.Y.YY", "Y..Y..Y", "...Y...", ".YYYYY."],
  punish: [".SSS...", ".SSS...", ".SSS...", "...W...", "...W...", "...W...", "...W..."],
  give: ["..R.R..", "RRRRRRR", "R..Y..R", "RRRRRRR", "R..Y..R", "RRRRRRR", "......."],
  request_food: ["..WWW..", ".W...W.", "....W..", "...W...", "...W...", ".......", "...W..."],
  comfort: [".......", ".R...R.", "RRR.RRR", ".RRRRR.", "..RRR..", "...R...", "......."],
  break_up: [".R..R..", "RRR.RRR", "RR..RRR", "RRR..RR", ".RR.RR.", "..R.R..", "...R..."],
  harvest: ["...Y...", "..YYY..", ".YYYYY.", "...G...", "...G...", "...G...", "......."],
  plant: [".......", "...G...", "..GGG..", "...G...", "...G...", "DDDDDDD", "DDDDDDD"],
  repair_shelter: ["SSSSS..", "SSSSS..", "..W....", "..W....", "..W....", "..W....", "......."],
  store_goods: [".......", "DDDDDDD", "DYYYYYD", "DYYYYYD", "DDDDDDD", "D.....D", "......."],
  hunt: ["......D", ".....D.", "KKKKD..", "...D...", "..D....", ".D.....", "D......"],
  tend_children: ["..MM...", ".MMMM..", "..MM...", ".WWWW..", "WWWWWW.", ".WWWW..", "......."],
  tend_animals: [".......", ".WWWW..", "WWWWWWK", "WWWWWWK", ".W.W...", ".W.W...", "......."],
  wash: ["...R...", "..RRR..", ".BBBBB.", ".BBLBB.", ".BBBBB.", "..BBB..", "......."],
  defend: [".SSSSS.", ".SWWWS.", ".SWWWS.", ".SSWSS.", "..SSS..", "...S...", "......."],
  investigate: [".......", ".WWWWW.", "WWKKKWW", "WKKLKKW", "WWKKKWW", ".WWWWW.", "......."],
  plot: [".WWWWW.", ".W...W.", ".WKKKW.", ".W...W.", ".WKKKW.", ".WWWWW.", "......."],
  stalk: [".......", "WW..WW.", "WK..WK.", "WW..WW.", ".......", "..KK...", "......."],
  lie_in_wait: [".......", "GG.GG..", "GWKWKG.", "GGGGGG.", ".GGGG..", "...D...", "...D..."],
  raid: ["..O....", ".OYO...", ".OYO...", "..D....", "..D....", "..D....", "..D...."],
  flee: ["...WW..", "..WW...", ".WWWW..", "W.WW.W.", "..W.W..", ".W...W.", "W......"],
  chase: ["...R...", "...R...", "...R...", "...R...", "...R...", ".......", "...R..."],
  kidnap: ["MM.....", "MMMM...", ".MMMMM.", "..MMMM.", "....MM.", ".......", "......."],
  search: ["...K...", "..YYY..", ".YOYOY.", ".YYYYY.", "..KKK..", "...K...", "......."],
  hide: ["..GGG..", ".GGGGG.", "GGGGGGG", ".GGGGG.", "...D...", "...D...", "..DDD.."],
  slaughter: [".......", "SSSSD..", "SSSSDD.", ".....DD", ".......", "...R...", "..RRR.."],
  elope: [".R...R.", "RRR.RRR", "RRRRRRR", ".RRRRR.", "..RRR..", "...R..Y", "....YYY"],
  investigate_shot: [".......", ".WWWWW.", "WWKKKWW", "WKKLKKW", "WWKKKWW", ".WWWWW.", "......."],
  mad: [".PPPP..", "P....P.", "P.PP.P.", "P.P..P.", "P.PPP..", "P......", ".PPPPP."],
  captive: ["DD.DD..", ".DDD...", "..D....", ".DDD...", "DD.DD..", ".......", "......."],
};

const ICON_PAL: Palette = {
  W: "#f4f0e6", B: "#4aa0f0", L: "#bfe6ff", G: "#3c9a4a", R: "#e04050", K: "#222222", S: "#c8ccd2",
  Y: "#f2c84a", O: "#f08a2a", M: "#c88a5a", Z: "#bfe6ff", z: "#8fbfe6", D: "#7a5230", "$": "#f2c84a", "?": "#222222", P: "#c070f0",
};

/** Animal sprites, facing right. */
const ANIMAL_ROWS: Record<string, readonly string[]> = {
  sheep: [".WWWWWW...", "WWWWWWWWKK", "WWWWWWWWKE", "WWWWWWWWKK", ".WWWWWW...", ".K.K.K.K..", ".K.K.K.K.."],
  cow: ["..........HH", ".BWWBBWWBBHH", "BBWWBBBWWBHE", "BWWBBWWBBBHH", "BBBWWBBBWWB.", ".B.B....B.B.", ".B.B....B.B."],
  chicken: ["...RR.", "..WWWY", ".WWWE.", "WWWWW.", ".WWW..", "..Y.Y."],
  wolf: ["..........GG", "G.GGGGGGGGGE", "GGGGGGGGGGGG", ".GGGGGGGGG..", ".G.G...G.G..", ".G.G...G.G.."],
  deer: ["..T.T.....", "...TT...EE", "........BB", ".BBBBBBBBB", "WBBBBBBBB.", ".BBBBBBB..", ".B.B..B.B.", ".B.B..B.B.", ".K.K..K.K."],
  rabbit: ["..WW.", "...WW", ".GGGE", "GGGGG", ".G.G."],
  fox: ["........OO", "W......OOE", "OOOOOOOOO.", ".OOOOOOO..", ".K.K..K.K."],
  horse: ["..........MM", ".........MMM", "..BBBBBBBBME", "MBBBBBBBBBB.", "MBBBBBBBBB..", ".BBBBBBBB...", ".B.B..B.B...", ".B.B..B.B...", ".K.K..K.K..."],
};
const ANIMAL_PAL: Palette = { W: "#f2efe6", K: "#3a3a3a", E: "#111111", B: "#7a4a2a", H: "#efe8dc", R: "#d83a2a", Y: "#e8b83a", G: "#7d8590", M: "#4a2e18", T: "#c8b090", O: "#d8702a" };
const animalCache = new Map<string, HTMLCanvasElement>();
export function animalSprite(kind: string, flip: boolean): HTMLCanvasElement {
  const key = `${kind}:${flip ? 1 : 0}`;
  let c = animalCache.get(key);
  if (!c) {
    const rows = ANIMAL_ROWS[kind] ?? ANIMAL_ROWS.sheep!;
    const pal = kind === "cow" ? { ...ANIMAL_PAL, B: "#3a2a20", W: "#f2efe6" } : kind === "rabbit" ? { ...ANIMAL_PAL, G: "#9a7a5a" } : ANIMAL_PAL;
    c = fromRows(flip ? rows.map((r) => [...r].reverse().join("")) : rows, pal);
    animalCache.set(key, c);
  }
  return c;
}

/** A few pre-drawn trees per season, stamped onto forest tiles. */
const treeCache = new Map<string, HTMLCanvasElement>();
export function treeSprite(season: number, variant: number): HTMLCanvasElement {
  const key = `${season}:${variant}`;
  let c = treeCache.get(key);
  if (c) return c;
  const pal = SEASON_PALETTES[season]!;
  c = document.createElement("canvas");
  c.width = TILE;
  c.height = TILE;
  const g = c.getContext("2d")!;
  const pine = variant >= (pal.snow ? 2 : 4);
  const r = 5 + (variant % 3) * 0.8;
  const cx = 7.5 + ((variant % 2) - 0.5) * 1.5, cy = 6.5;
  g.fillStyle = pal.trunk;
  g.fillRect(7, 11, 2, 5);
  for (let y = 0; y < 13; y++) {
    for (let x = 0; x < TILE; x++) {
      let inside: boolean;
      if (pine) inside = y >= 1 && Math.abs(x + 0.5 - cx) <= (y + 1) * 0.55 && y <= 12;
      else inside = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r + (hash2(x, y, variant + 4) - 0.5) * 1.2;
      if (!inside) continue;
      const light = (x - cx) + (y - cy) * 1.2;
      let col = light < -4 ? pal.canopy[3]! : light < 1 ? pal.canopy[1]! : light < 5 ? pal.canopy[0]! : pal.canopy[2]!;
      if (pine) col = light < 0 ? pal.canopy[1]! : pal.canopy[2]!;
      if (pal.snow && (y < 4 || (pine && y % 4 === 0))) col = "#f2f6f8";
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  treeCache.set(key, c);
  return c;
}

const iconCache = new Map<string, HTMLCanvasElement>();
export function icon(kind: string): HTMLCanvasElement | null {
  const rows = ICON_ROWS[kind];
  if (!rows) return null;
  let c = iconCache.get(kind);
  if (!c) {
    c = fromRows(rows, ICON_PAL);
    iconCache.set(kind, c);
  }
  return c;
}

export interface SeasonPalette {
  grass: string[];
  canopy: string[];
  trunk: string;
  ground: string;
  snow: boolean;
}

export const SEASON_PALETTES: SeasonPalette[] = [
  { grass: ["#5fb043", "#55a33b", "#6bbd4c", "#4f9a36"], canopy: ["#2f8a3a", "#3fa34a", "#256f2e", "#58b85a"], trunk: "#6b4423", ground: "#8a6a44", snow: false },
  { grass: ["#6cbc45", "#62b03c", "#79c851", "#58a336"], canopy: ["#2a7d30", "#37943c", "#1f6626", "#4aa84c"], trunk: "#6b4423", ground: "#8a6a44", snow: false },
  { grass: ["#9aa845", "#8c9a3c", "#a8b452", "#7f8e36"], canopy: ["#d0782a", "#e0a03a", "#b5552a", "#c8a02a"], trunk: "#5e3c20", ground: "#7d5c3a", snow: false },
  { grass: ["#e8eef2", "#dce4ea", "#f2f6f8", "#cfd8e0"], canopy: ["#2a5a3a", "#356a45", "#20482e", "#e8eef2"], trunk: "#4e3420", ground: "#b8b0a8", snow: true },
];

// ---------- Faces, body diagram and descriptions (for the person panel) ----------

const SKIN_NAMES = ["fair", "light", "tanned", "brown", "dark brown"];
const HAIR_NAMES = ["black", "dark brown", "brown", "golden", "grey", "red", "jet black"];

export function appearance(id: number, age: number): { skin: string; hair: string } {
  const skin = SKIN_NAMES[Math.floor(hash2(id, 3) * SKINS.length)]!;
  const hair = age >= 58 ? "white" : HAIR_NAMES[Math.floor(hash2(id, 7) * (HAIRS.length - 1))]!;
  return { skin, hair };
}

export interface FaceInfo {
  id: number;
  sex: "f" | "m";
  age: number;
  household: number;
  /** Mood in [-1, 1]. */
  mood: number;
  pain: number;
  lostEyes: ("left" | "right")[];
  /** Fresh wounds to the face or eyes: bruises, cuts. */
  bruised: boolean;
  cut: boolean;
  /** Healed-badly marks. */
  scar: boolean;
  deepScar: boolean;
  ruined: boolean;
  dead: boolean;
}

/** A 16x16 pixel portrait, scaled up by CSS. */
export function faceCanvas(f: FaceInfo): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 16;
  const g = c.getContext("2d")!;
  const look = lookFor(f.id, f.household, f.age);
  const px = (x: number, y: number, col: string, w = 1, h = 1) => {
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
  };
  const rect = (x: number, y: number, w: number, h: number, col: string) => px(x, y, col, w, h);
  px(0, 0, f.dead ? "#2a2a2e" : "#3a3028", 16, 16);
  // Shoulders in the house colour.
  rect(2, 13, 12, 3, look.shirt);
  rect(2, 13, 12, 1, look.shirtDark);
  // Neck and head.
  rect(6, 11, 4, 3, look.skin);
  const child = f.age < 12;
  const top = child ? 4 : 2;
  rect(4, top + 1, 8, 9 - (child ? 1 : 0), look.skin);
  rect(5, top, 6, 1, look.skin);
  // Hair.
  if (f.sex === "f") {
    rect(3, top - 0, 10, 3, look.hair);
    rect(3, top + 2, 1, 9, look.hair);
    rect(12, top + 2, 1, 9, look.hair);
    rect(4, top + 3, 8, 1, look.skin);
  } else {
    rect(3, top, 10, 2, look.hair);
    rect(3, top + 2, 1, 3, look.hair);
    rect(12, top + 2, 1, 3, look.hair);
    if (f.age >= 18 && hash2(f.id, 19) < 0.55) {
      rect(4, top + 7, 8, 2, look.hair);
      rect(6, top + 6, 4, 1, look.skin);
    }
  }
  if (f.age >= 58) rect(4, top + 1, 8, 1, "#d8d0c0");
  // Eyes.
  const ey = top + 4;
  const eyeAt = (x: number, lost: boolean) => {
    if (lost) {
      px(x, ey, "#6a2020", 2, 2);
      px(x, ey, "#1a0c0c");
    } else {
      px(x, ey, "#f4f0e8", 2, 1);
      px(x + (hash2(f.id, 23) < 0.5 ? 0 : 1), ey, f.dead ? "#444" : "#2a1a10");
    }
  };
  // The portrait faces us: its left is the person's right.
  eyeAt(5, f.lostEyes.includes("right"));
  eyeAt(9, f.lostEyes.includes("left"));
  if (f.lostEyes.length === 1) {
    // A scar through the lost eye.
    const x = f.lostEyes[0] === "right" ? 5 : 9;
    px(x + 1, ey - 1, "#8a3a30", 1, 4);
  }
  // Brows.
  px(5, ey - 1, "#2a1a10", 2);
  px(9, ey - 1, "#2a1a10", 2);
  // Nose and mouth.
  px(7, ey + 1, shade(look.skin, 0.85), 2, 2);
  const my = ey + 4;
  const sad = f.mood < -0.25 || f.pain > 0.5;
  const happy = f.mood > 0.3 && f.pain < 0.3;
  if (f.dead) rect(6, my, 4, 1, "#5a3a30");
  else if (happy) {
    rect(6, my, 4, 1, "#7a3a30");
    px(5, my - 1, "#7a3a30");
    px(10, my - 1, "#7a3a30");
  } else if (sad) {
    rect(6, my, 4, 1, "#7a3a30");
    px(5, my + 1, "#7a3a30");
    px(10, my + 1, "#7a3a30");
  } else rect(6, my, 4, 1, "#7a3a30");
  if (f.age >= 50) {
    px(4, ey + 2, shade(look.skin, 0.8), 1, 2);
    px(11, ey + 2, shade(look.skin, 0.8), 1, 2);
  }
  // Marks.
  if (f.ruined) {
    rect(4, top + 2, 4, 6, "#b05a58");
    rect(5, top + 3, 1, 5, "#7a2020");
    rect(7, top + 6, 3, 1, "#7a2020");
  } else if (f.deepScar) {
    for (let i = 0; i < 6; i++) px(4 + i, top + 2 + i, "#c88a80");
  } else if (f.scar) {
    px(10, top + 5, "#d09a90", 1, 3);
  }
  if (f.bruised) {
    px(4, ey + 1, "#6a4a8a", 2, 2);
    px(10, top + 5, "#6a4a8a", 2, 2);
  }
  if (f.cut) {
    px(6, top + 1, "#b02020", 1, 4);
    px(7, top + 4, "#b02020");
  }
  return c;
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), gg = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return `rgb(${r},${gg},${b})`;
}

/** Rectangles of a 40x84 body diagram, front view: the person's left is on the viewer's right. */
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
