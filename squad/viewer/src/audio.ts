// Sound for the viewer: a lo-fi bank (built by sfx/build.py) played through Web Audio.
// Everything is placed relative to the middle of the screen: louder and brighter
// the closer to the camera it is, panned by where it sits across the view, and
// dropped entirely once it is out of earshot, so zooming in listens to a smaller
// piece of the field.
import type { Terrain } from "../../src/world/types.ts";

interface Manifest {
  rate: number;
  samples: Record<string, [number, number]>;
  groups: Record<string, string[]>;
}

export interface PlayOptions {
  /** Where it happens, in tiles; omit for a sound with no place (UI, ambience). */
  x?: number;
  y?: number;
  /** Base loudness in [0, 1]. */
  gain?: number;
  /** How far it carries, in view half-widths. */
  reach?: number;
  rate?: number;
  /** Seconds from now. */
  delay?: number;
  /** Seconds into the sample to start from. */
  offset?: number;
  /** Lets a sound through when voices are scarce. */
  priority?: boolean;
  /** With `close`: how many tiles of view width it takes to fade out (default 28; smaller = needs more zoom). */
  closeSpan?: number;
  /** Louder at a distance: multiplies the faint far-off level, and flattens the fall-off with distance. */
  carry?: number;
  /** Carries across the whole map: past its reach it is still heard, faint and distant. */
  anywhere?: boolean;
  /** Quiet, personal sounds (boots, voices, reloads): fade out as the view widens, gone unless zoomed in close. */
  close?: boolean;
  /** Pick the near / mid / far recording by distance and zoom (groups named `name.near` etc.). */
  byDistance?: boolean;
}

const MAX_VOICES = 36;
const STORE = "squad.sound";

/** Which footstep set each kind of ground uses. */
const SURFACE: Record<Terrain, string> = {
  grass: "grass",
  wheat: "grass",
  road: "gravel",
  orchard: "grass",
  woods: "leaves",
  hedge: "leaves",
  wall: "rock",
  building: "wood",
  floor: "wood",
  door: "wood",
  window: "wood",
  water: "water",
  bridge: "wood",
  rubble: "rock",
  crater: "dirt",
  foxhole: "dirt",
  stairs: "wood",
  marsh: "mud",
  brush: "leaves",
  ditch: "dirt",
  deadfall: "leaves",
};

export function surfaceOf(t: Terrain): string {
  return SURFACE[t] ?? "grass";
}

/** What a bullet striking this ground sounds like. */
export function impactOf(t: Terrain): string {
  switch (t) {
    case "wall":
    case "building":
    case "rubble":
      return "stone";
    case "woods":
    case "hedge":
    case "brush":
    case "deadfall":
    case "door":
    case "window":
    case "floor":
    case "stairs":
    case "bridge":
      return "wood";
    case "water":
      return "water";
    default:
      return "dirt";
  }
}

interface Bed {
  src: AudioBufferSourceNode;
  gain: GainNode;
  level: number;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private groups: Record<string, string[]> = {};
  private beds = new Map<string, Bed>();
  private voices = 0;
  private lastPlayed = new Map<string, number>();
  private loading = false;
  private cx = 0;
  private cy = 0;
  private half = 25;
  /** How hot the fighting near the camera is, in [0, 1]; the birds go quiet for it. */
  private intensity = 0;
  /** Wall-clock ms of the last shot or blast anywhere on the field. */
  private lastGunfire = -1e9;
  enabled = true;
  volume = 0.7;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "null") as { on?: boolean; vol?: number } | null;
      if (saved) {
        this.enabled = saved.on !== false;
        if (typeof saved.vol === "number") this.volume = Math.max(0, Math.min(1, saved.vol));
      }
    } catch {
      // No storage: defaults are fine.
    }
  }

  get ready(): boolean {
    return this.ctx !== null && this.buffers.size > 0 && this.enabled;
  }

  /** Browsers only let audio start after a gesture; call this from the first one. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    if (this.loading) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.loading = true;
    const ctx = new AC();
    void this.load(ctx).catch(() => {
      this.loading = false;
    });
  }

  private async load(ctx: AudioContext): Promise<void> {
    const base = new URL("audio/", document.baseURI);
    const [man, bin] = await Promise.all([
      fetch(new URL("bank.json", base)).then((r) => r.json() as Promise<Manifest>),
      fetch(new URL("bank.bin", base)).then((r) => r.arrayBuffer()),
    ]);
    const pcm = new Int16Array(bin);
    for (const [name, [off, len]] of Object.entries(man.samples)) {
      const buf = ctx.createBuffer(1, len, man.rate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = pcm[off + i]! / 32768;
      this.buffers.set(name, buf);
    }
    this.groups = man.groups;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 14;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(comp).connect(ctx.destination);
    this.ctx = ctx;
    for (const key of ["wind", "forest", "birds", "rain", "downpour", "river", "cicadas"]) {
      const buf = this.buffers.get(`amb.${key}`);
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.master);
      src.start(0, Math.random() * buf.duration);
      this.beds.set(key, { src, gain, level: 0 });
    }
  }

  save(): void {
    try {
      localStorage.setItem(STORE, JSON.stringify({ on: this.enabled, vol: this.volume }));
    } catch {
      // Not important.
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.applyVolume();
    this.save();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyVolume();
    this.save();
  }

  private applyVolume(): void {
    if (this.ctx) this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.05);
  }

  /** Where the listener is: the middle of the view, and how many tiles wide half of it is. */
  setListener(x: number, y: number, halfWidthTiles: number): void {
    this.cx = x;
    this.cy = y;
    this.half = Math.max(8, halfWidthTiles);
  }

  /** 0 zoomed right in, 1 zoomed right out. */
  private get wide(): number {
    return Math.max(0, Math.min(1, (this.half - 12) / 60));
  }

  /** Note that guns are firing, wherever they are: the birds go quiet for it. */
  noteGunfire(): void {
    this.lastGunfire = performance.now();
  }

  /** Tiles from the middle of the view, in view half-widths. */
  private spread(x: number, y: number): number {
    return Math.hypot(x - this.cx, y - this.cy) / this.half;
  }

  /** True if something at (x, y) with this reach could be heard at all. */
  audible(x: number, y: number, reach: number): boolean {
    return this.spread(x, y) < reach;
  }

  /** Plays one of a group's sounds. Returns true if it started. */
  play(group: string, o: PlayOptions = {}): boolean {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return false;
    let gain = o.gain ?? 1;
    let pan = 0;
    let cutoff = 0;
    let tier = -1;
    if (o.x !== undefined && o.y !== undefined) {
      const reach = o.reach ?? 1.4;
      let r = this.spread(o.x, o.y) / reach;
      if (r >= 1 && !o.anywhere) return false;
      if (r >= 1) {
        // Far-off fighting: the same distant crump at any zoom, a little fainter the further away.
        const tiles = Math.hypot(o.x - this.cx, o.y - this.cy);
        gain *= Math.max(0.1, 0.34 / (1 + tiles / 70)) * (o.carry ?? 1);
        r = 1;
      } else gain *= (1 - r) ** (o.carry ? 1.7 / o.carry : 1.7);
      if (o.close) gain *= Math.max(0, 1 - (this.half - 8) / (o.closeSpan ?? 28));
      else if (o.byDistance || (o.reach ?? 0) >= 3) gain *= 1 - 0.45 * this.wide;
      if (gain < 0.012) return false;
      pan = Math.max(-0.85, Math.min(0.85, (o.x - this.cx) / (this.half * 1.1)));
      cutoff = 9000 - 7500 * Math.min(1, r * 1.1);
      // Zoomed out, everything is far; zoomed in, only what is well away from the middle is.
      if (o.byDistance) tier = r >= 1 ? 1 : Math.min(1, r * 0.35 + this.wide * 0.8);
    }
    if (this.voices >= MAX_VOICES && !o.priority) return false;
    const rate = (o.rate ?? 1) * (0.95 + Math.random() * 0.1);
    if (tier < 0) {
      const list = this.groups[group];
      if (!list || list.length === 0) return false;
      const buf = this.buffers.get(list[Math.floor(Math.random() * list.length)]!);
      return buf ? this.voice(buf, gain, cutoff, pan, rate, o) : false;
    }
    // Slide between the near, mid and far recordings: two neighbours at once, equal-power crossfaded,
    // so crossing a zoom level swells one in as the other fades out instead of switching.
    const CENTRES = [0, 0.42, 0.85];
    const TIERS = ["near", "mid", "far"];
    const lo = tier <= CENTRES[1]! ? 0 : 1;
    const f = Math.max(0, Math.min(1, (tier - CENTRES[lo]!) / (CENTRES[lo + 1]! - CENTRES[lo]!)));
    let played = false;
    for (const [idx, w] of [[lo, Math.cos(f * Math.PI / 2)], [lo + 1, Math.sin(f * Math.PI / 2)]] as const) {
      if (w < 0.08) continue;
      const list = this.groups[`${group}.${TIERS[idx]}`];
      if (!list || list.length === 0) continue;
      const buf = this.buffers.get(list[Math.floor(Math.random() * list.length)]!);
      if (buf && this.voice(buf, gain * w, cutoff, pan, rate, o)) played = true;
    }
    return played;
  }

  private voice(buf: AudioBuffer, gain: number, cutoff: number, pan: number, rate: number, o: PlayOptions): boolean {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    let node: AudioNode = src;
    if (cutoff > 0) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = cutoff;
      node.connect(f);
      node = f;
    }
    const g = ctx.createGain();
    g.gain.value = gain;
    node.connect(g);
    node = g;
    if (pan !== 0 && typeof ctx.createStereoPanner === "function") {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node.connect(p);
      node = p;
    }
    node.connect(this.master);
    this.voices++;
    src.onended = () => {
      this.voices--;
      src.disconnect();
    };
    const offset = Math.max(0, Math.min(buf.duration - 0.05, o.offset ?? 0));
    src.start(ctx.currentTime + Math.max(0, o.delay ?? 0), offset);
    if (o.x !== undefined && gain > 0.2) this.intensity = Math.min(1, this.intensity + 0.012 * gain);
    return true;
  }

  /**
   * The snap of a round passing the listener: placed at the closest point of its
   * flight (carried on past the aim point) to the middle of the view, so only
   * rounds that go by near the camera are heard.
   */
  bulletPass(fx: number, fy: number, ax: number, ay: number, delay: number, gain = 1): boolean {
    const dx = ax - fx, dy = ay - fy;
    const len = Math.hypot(dx, dy);
    if (len < 6) return false;
    const reachEnd = (len + 25) / len;
    let t = ((this.cx - fx) * dx + (this.cy - fy) * dy) / (len * len);
    t = Math.max(0, Math.min(reachEnd, t));
    const px = fx + dx * t, py = fy + dy * t;
    const d = Math.hypot(px - this.cx, py - this.cy);
    const near = this.half * 0.55 + 2;
    if (d > near || Math.hypot(px - fx, py - fy) < 5) return false;
    const pass = Math.hypot(px - fx, py - fy) / 90; // seconds of flight at a few hundred metres a second, scaled to the field
    return this.playLimited("crack", 45, "crack", { x: px, y: py, gain: gain * (1 - (d / near) ** 2 * 0.6), reach: 1.3, delay: delay + pass, priority: true });
  }

  /** `play`, but no more often than once per `gapMs` for this key. */
  playLimited(key: string, gapMs: number, group: string, o: PlayOptions = {}): boolean {
    const now = performance.now();
    if (now - (this.lastPlayed.get(key) ?? -1e9) < gapMs) return false;
    if (!this.play(group, o)) return false;
    this.lastPlayed.set(key, now);
    return true;
  }

  /** Eases the weather beds toward what the day sounds like. Call once a frame. */
  ambience(dt: number, weather: string): void {
    if (!this.ctx) return;
    this.intensity = Math.max(0, this.intensity - dt * 0.12);
    const w: Record<string, number> = { wind: 0, forest: 0, birds: 0, rain: 0, downpour: 0, river: 0.015, cicadas: 0 };
    const quiet = performance.now() - this.lastGunfire > 15000;
    const calm = quiet ? 1 : 0;
    if (weather === "rain") {
      w.rain = 0.09;
      w.wind = 0.015;
    } else if (weather === "fog") {
      w.wind = 0.025;
      w.birds = 0.03 * calm;
    } else if (weather === "overcast") {
      w.forest = 0.035;
      w.birds = 0.06 * calm;
    } else {
      w.wind = 0.012;
      w.birds = 0.1 * calm;
      w.cicadas = 0.02 * calm;
    }
    for (const [key, bed] of this.beds) {
      // Birds fall silent within a moment of the first shot and come back slowly.
      const rate = key === "birds" || key === "cicadas" ? ((w[key] ?? 0) < bed.level ? 6 : 0.25) : 0.8;
      bed.level += ((w[key] ?? 0) - bed.level) * (1 - Math.exp(-dt * rate));
      // Wind is loudest in the wide view: pull the beds right back when zoomed out.
      bed.gain.gain.value = bed.level * (1 - 0.75 * this.wide);
    }
  }
}
