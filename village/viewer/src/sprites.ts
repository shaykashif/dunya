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

/** 7x7 activity icons shown above villagers. */
const ICON_ROWS: Record<string, readonly string[]> = {
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
  horse: ["..........MM", ".........MMM", "..BBBBBBBBME", "MBBBBBBBBBB.", "MBBBBBBBBB..", ".BBBBBBBB...", ".B.B..B.B...", ".B.B..B.B...", ".K.K..K.K..."],
};
const ANIMAL_PAL: Palette = { W: "#f2efe6", K: "#3a3a3a", E: "#111111", B: "#7a4a2a", H: "#efe8dc", R: "#d83a2a", Y: "#e8b83a", G: "#7d8590", M: "#4a2e18" };
const animalCache = new Map<string, HTMLCanvasElement>();
export function animalSprite(kind: string, flip: boolean): HTMLCanvasElement {
  const key = `${kind}:${flip ? 1 : 0}`;
  let c = animalCache.get(key);
  if (!c) {
    const rows = ANIMAL_ROWS[kind] ?? ANIMAL_ROWS.sheep!;
    const pal = kind === "cow" ? { ...ANIMAL_PAL, B: "#3a2a20", W: "#f2efe6" } : ANIMAL_PAL;
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
