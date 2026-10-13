// Seeded PRNG (sfc32) with named, independent streams derived from the seed.
// Never use Math.random anywhere in the engine.

export function hash32(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  draws = 0;

  constructor(seed: number, stream = "") {
    const sm = splitmix32(hash32(`${seed >>> 0}/${stream}`));
    this.a = sm();
    this.b = sm();
    this.c = sm();
    this.d = sm();
    for (let i = 0; i < 12; i++) this.nextU32();
    this.draws = 0;
  }

  nextU32(): number {
    let a = this.a, b = this.b, c = this.c, d = this.d;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.a = a; this.b = b; this.c = c; this.d = d;
    this.draws++;
    return t >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("Rng.pick on empty array");
    return arr[this.int(arr.length)]!;
  }

  /** Index drawn proportionally to non-negative weights. */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return 0;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i]!);
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  state(): [number, number, number, number] {
    return [this.a, this.b, this.c, this.d];
  }
}

/** One stream per subsystem so a new draw in one place does not shift others. */
export type StreamName =
  | "scenario"
  | "weather"
  | "environment"
  | "actions"
  | "perception"
  | "testimony"
  | "investigation"
  | "justice"
  | "bonding"
  | "animals"
  | "injuries"
  | "culture"
  | "decision";

export class RngStreams {
  readonly seed: number;
  private readonly streams = new Map<string, Rng>();

  constructor(seed: number) {
    this.seed = seed;
  }

  get(name: StreamName): Rng {
    let r = this.streams.get(name);
    if (!r) {
      r = new Rng(this.seed, name);
      this.streams.set(name, r);
    }
    return r;
  }
}
