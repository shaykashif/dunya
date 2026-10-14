// Pixel-art icons for the interface, drawn from small text bitmaps so they
// stay crisp at any size and match the pixel look of the battlefield.
// Each row is a string; `.` is empty and other letters pick a colour below.

const PALETTE: Record<string, string> = {
  k: "#1a1a14",
  w: "#f4f0e8",
  a: "#a8a89c",
  d: "#5a5a52",
  g: "#e8c040",
  y: "#ffe070",
  o: "#f0963a",
  r: "#d84a3a",
  b: "#5a8ad8",
  n: "#7a8a50",
  t: "#b8884a",
  p: "#9a7ad8",
};

const ART: Record<string, string[]> = {
  pause: [".........", ".www.www.", ".www.www.", ".www.www.", ".www.www.", ".www.www.", ".www.www.", ".www.www.", "........."],
  play: [".w.......", ".ww......", ".www.....", ".wwww....", ".wwwww...", ".wwww....", ".www.....", ".ww......", ".w......."],
  step: [".w....w..", ".ww...w..", ".www..w..", ".wwww.w..", ".wwwwww..", ".wwww.w..", ".www..w..", ".ww...w..", ".w....w.."],
  sound: [".........", "....w..w.", "...ww...w", ".wwww.w.w", ".wwww.w.w", ".wwww.w.w", "...ww...w", "....w..w.", "........."],
  mute: [".........", "....w....", "...ww.r.r", ".wwww..r.", ".wwww.r.r", ".wwww....", "...ww....", "....w....", "........."],
  inspect: ["..www....", ".w...w...", "w.....w..", "w.....w..", "w.....w..", ".w...w...", "..wwwt...", ".....tt..", "......tt."],
  barrage: ["....o....", ".o..o..o.", "..o.y.o..", "...oyo...", "ooyyryyoo", "...oyo...", "..o.y.o..", ".o..o..o.", "....o...."],
  smoke: [".........", "...aaa...", ".aaawwa..", ".awwwwwaa", "aawwwwwwa", "awwwwwwwa", ".aaaaaaa.", ".........", "........."],
  sniper: ["....r....", "..rrrrr..", ".r..r..r.", ".r..r..r.", "rrrrwrrrr", ".r..r..r.", ".r..r..r.", "..rrrrr..", "....r...."],
  swords: ["a.......a", ".a.....a.", "..a...a..", "...a.a...", "....g....", "...g.g...", "..g...g..", ".t.....t.", "........."],
  dice: [".........", ".aaaaaaa.", ".awkwkwa.", ".awwwwwa.", ".awwkwwa.", ".awwwwwa.", ".awkwkwa.", ".aaaaaaa.", "........."],
  book: [".........", ".ttttttt.", ".twwwwwt.", ".twkkkwt.", ".twwwwwt.", ".twkkkwt.", ".twwwwwt.", ".ttttttt.", "........."],
  report: ["...aaa...", ".ttaaatt.", ".twwwwwt.", ".twkkkwt.", ".twwwwwt.", ".twkkkwt.", ".twwwwwt.", ".ttttttt.", "........."],
  helmet: [".........", "...nnn...", "..nnnnn..", ".nnnnnnn.", ".nnnnnnn.", "nnnnnnnnn", "ddddddddd", ".........", "........."],
  map: [".........", "nnkttkwwa", "nnkttkwwa", "nnkttkwwa", "nnkttkwwa", "nnkttkwwa", "nnkttkwwa", "nnkttkwwa", "........."],
  scroll: [".........", ".ttttttt.", ".twwwwwt.", "..wkkkw..", "..wwwww..", "..wkkkw..", ".twwwwwt.", ".ttttttt.", "........."],
  close: [".........", ".r.....r.", "..r...r..", "...r.r...", "....r....", "...r.r...", "..r...r..", ".r.....r.", "........."],
  dead: ["....w....", "....w....", ".wwwwwww.", "....w....", "....w....", "....w....", "....w....", "....w....", "........."],
  medic: ["...rrr...", "...rrr...", "rrrrrrrrr", "rrrrrrrrr", "rrrrrrrrr", "...rrr...", "...rrr..."],
  flag: [".t.......", ".twwwww..", ".twwwwww.", ".twwwww..", ".t.......", ".t.......", ".t.......", ".t.......", ".t......."],
  back: ["...a.....", "..aa.....", ".aaaaaaa.", "..aa....a", "...a....a", ".......a.", "........."],
  pinned: ["ooooooo", ".ooooo.", "..ooo..", "...o..."],
  flagus: ["bbbbrrrrr", "bwbbwwwww", "bbbbrrrrr", "wwwwwwwww", "rrrrrrrrr", "wwwwwwwww", "rrrrrrrrr"],
  flagde: ["...kkk...", "...kwk...", "kkkkwkkkk", "kwwwwwwwk", "kkkkwkkkk", "...kwk...", "...kkk..."],
};

const cache = new Map<string, string>();

/** An inline SVG of the named icon, one rect per horizontal run of same-coloured pixels. */
export function icon(name: string): string {
  let svg = cache.get(name);
  if (svg) return svg;
  const rows = ART[name];
  if (!rows) return "";
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  let rects = "";
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x]!;
      if (c === "." || !PALETTE[c]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < row.length && row[x + run] === c) run++;
      rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${PALETTE[c]}"/>`;
      x += run;
    }
  });
  svg = `<svg class="px" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
  cache.set(name, svg);
  return svg;
}

/** Fills every `<i data-icon="name">` in the page with its pixel art. */
export function hydrateIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("i[data-icon]").forEach((el) => {
    el.innerHTML = icon(el.dataset.icon!);
    el.classList.add("pxi");
  });
}
