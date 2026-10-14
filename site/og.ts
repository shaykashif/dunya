// Writes the 1200x630 link-preview images (og.png, og-squad.png, og-civ.png): node --no-warnings site/og.ts
// Pixel art drawn straight into a PNG, so no image tooling is needed.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const W = 1200;
const H = 630;
const dir = fileURLToPath(new URL(".", import.meta.url));

const GLYPHS: Record<string, string> = {
  A: "01110 10001 10001 11111 10001 10001 10001",
  B: "11110 10001 10001 11110 10001 10001 11110",
  C: "01110 10001 10000 10000 10000 10001 01110",
  E: "11111 10000 10000 11110 10000 10000 11111",
  H: "10001 10001 10001 11111 10001 10001 10001",
  I: "11111 00100 00100 00100 00100 00100 11111",
  K: "10001 10010 10100 11000 10100 10010 10001",
  L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001",
  N: "10001 11001 10101 10011 10001 10001 10001",
  O: "01110 10001 10001 10001 10001 10001 01110",
  S: "01111 10000 10000 01110 00001 00001 11110",
  T: "11111 00100 00100 00100 00100 00100 00100",
  U: "10001 10001 10001 10001 10001 10001 01110",
  V: "10001 10001 10001 10001 10001 01010 00100",
  Y: "10001 10001 01010 00100 00100 00100 00100",
  Z: "11111 00001 00010 00100 01000 10000 11111",
  ".": "00000 00000 00000 00000 00000 00000 00100",
};

const SOLDIER = {
  rows: ["..HHHH..", ".HnHHnH.", ".hSSSSh.", "..SESE..", ".cCCCCc.", "SCCCCCCS", "SCbbbbCS", ".cCCCCc.", "..PPPP..", "..P..P..", "..L..L..", "..B..B.."],
  pal: { H: "#5e6c30", h: "#44501f", n: "#7e8a4a", S: "#f2c9a0", E: "#2a1a10", C: "#a08a56", c: "#7a6840", b: "#c4ac70", P: "#76603e", L: "#c8b888", B: "#5a3e24" },
};
const VILLAGER = {
  rows: ["..HHHH..", ".HHHHHH.", ".HSSSSH.", "..SESE..", "..SSSS..", ".cCCCCc.", "SCCCCCCS", "SCCCCCCS", ".cCCCCc.", "..PPPP..", "..P..P..", "..B..B.."],
  pal: { H: "#5a3a1e", S: "#e0b088", E: "#2a1a10", C: "#c8483a", c: "#8a2a22", P: "#4a3a2a", B: "#2a2018" },
};
type Sprite = typeof SOLDIER;

function hex(c: string): [number, number, number] {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

class Canvas {
  px = new Uint8Array(W * H * 3);
  rect(x: number, y: number, w: number, h: number, color: string): void {
    const [r, g, b] = hex(color);
    for (let j = Math.max(0, y); j < Math.min(H, y + h); j++) {
      for (let i = Math.max(0, x); i < Math.min(W, x + w); i++) {
        const o = (j * W + i) * 3;
        this.px[o] = r;
        this.px[o + 1] = g;
        this.px[o + 2] = b;
      }
    }
  }
  sprite(s: Sprite, x: number, y: number, scale: number): void {
    s.rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const c = (s.pal as Record<string, string>)[row[i]!];
        if (c) this.rect(x + i * scale, y + j * scale, scale, scale, c);
      }
    });
  }
  text(str: string, x: number, y: number, scale: number, color: string): void {
    let cx = x;
    for (const ch of str) {
      const g = GLYPHS[ch]?.split(" ");
      if (g) g.forEach((row, j) => [...row].forEach((on, i) => on === "1" && this.rect(cx + i * scale, y + j * scale, scale, scale, color)));
      cx += 6 * scale;
    }
  }
  width(str: string, scale: number): number {
    return str.length * 6 * scale - scale;
  }
  png(): Buffer {
    const raw = Buffer.alloc((W * 3 + 1) * H);
    for (let y = 0; y < H; y++) {
      raw[y * (W * 3 + 1)] = 0;
      Buffer.from(this.px.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
    }
    const crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc = (b: Buffer) => {
      let c = 0xffffffff;
      for (const v of b) c = crcTable[(c ^ v) & 0xff]! ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type), data]);
      const sum = Buffer.alloc(4);
      sum.writeUInt32BE(crc(body));
      return Buffer.concat([len, body, sum]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(W, 0);
    ihdr.writeUInt32BE(H, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  }
}

function card(file: string, bg: string, edge: string, accent: string, sprites: Sprite[], lines: string[], foot: string): void {
  const c = new Canvas();
  c.rect(0, 0, W, H, bg);
  c.rect(0, H - 90, W, 90, edge);
  c.rect(0, H - 94, W, 4, accent);
  // Sprites on the left, each 8x12 at scale 16, standing on the ground band.
  const sc = 16;
  const total = sprites.length * 8 * sc + (sprites.length - 1) * 48;
  let sx = 90 + (340 - total) / 2;
  for (const s of sprites) {
    c.sprite(s, sx, H - 94 - 12 * sc, sc);
    sx += 8 * sc + 48;
  }
  const ts = 9;
  const top = 190;
  lines.forEach((l, i) => c.text(l, 480, top + i * (7 * ts + 36), ts, i === 0 ? "#ece6cc" : accent));
  c.text(foot, 480, H - 62, 6, "#16180f");
  writeFileSync(dir + file, c.png());
  console.log("wrote", file);
}

const LIGHT = "#16180f";
card("og.png", LIGHT, "#e8c84a", "#e8c84a", [SOLDIER, VILLAGER], ["CHOOSE A", "SIMULATION"], "SIM.SHAYKAS.COM");
card("og-squad.png", LIGHT, "#a08a56", "#e8c84a", [SOLDIER], ["BATTLE", "SIMULATION"], "SIM.SHAYKAS.COM");
card("og-civ.png", "#1b1712", "#c8483a", "#f2c84a", [VILLAGER], ["CIVILIZATION", "SIMULATION"], "SIM.SHAYKAS.COM");
