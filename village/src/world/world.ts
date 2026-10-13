import { RngStreams } from "../engine/rng.ts";
import type { EventLog, SimEvent } from "../log/events.ts";
import type { SimConfig } from "../scenario/config.ts";
import type { EnvState } from "./environment.ts";
import type { Chase } from "../plots/plots.ts";
import { findPath, type GameMap } from "./map.ts";
import {
  emptyInventory,
  type Animal,
  type Building,
  type CensusEntry,
  type Compound,
  type Crime,
  type Culture,
  type Furniture,
  type Grave,
  type Inquest,
  type Hearing,
  type Household,
  type Inventory,
  type Obligation,
  type PendingObservation,
  type Person,
  type Plot,
  type Point,
  type Project,
  type Sentence,
  type Trace,
} from "./types.ts";

export interface FieldState {
  crop: Inventory;
  planted: boolean;
  work: number;
}

export interface Ledger {
  initial: Inventory;
  produced: Inventory;
  consumed: Inventory;
}

type IdKind = "trace" | "crime" | "belief" | "obligation" | "case" | "hearing" | "person" | "sentence" | "plot" | "injury" | "furniture" | "project" | "inquest";

/**
 * The world state. Only engine modules (environment, needs, action resolution,
 * perception, bonding, justice scheduling) write to it. Decision sources never do.
 */
export class World {
  readonly config: SimConfig;
  readonly seed: number;
  readonly rng: RngStreams;
  readonly log: EventLog;
  tick = 0;
  map!: GameMap;
  env!: EnvState;
  buildings: Building[] = [];
  households: Household[] = [];
  people: Person[] = [];
  communal: Inventory = emptyInventory();
  /** One farm per household, indexed by household id. */
  farms: FieldState[] = [];
  compounds: Compound[] = [];
  plots: Plot[] = [];
  chases: Chase[] = [];
  /** Tiles each person walked through this tick, in order. Drawn by the viewer; accidents read it to know who walked where. */
  trails: Map<number, number[]> = new Map();
  animals: Animal[] = [];
  /** Tick each house last tended its livestock. */
  livestockTended: Record<number, number> = {};
  /** feuds[a][b]: how much house a resents house b, in [0, 1]. */
  feuds: number[][] = [];
  /** Person id standing on each tile (0 if none). Carried infants don't occupy tiles. */
  occupancy: Int32Array = new Int32Array(0);
  /** How heavily the wild food sites have been worked recently. */
  forageStress: { forest: number; river: number } = { forest: 0, river: 0 };
  /** How closely the communal store is watched, raised by discovered thefts. */
  storeWatch = 0;
  /** Unowned items lying on tiles, keyed by tile index. */
  tileItems: Record<number, Inventory> = {};
  traces: Trace[] = [];
  crimes: Crime[] = [];
  obligations: Obligation[] = [];
  hearings: Hearing[] = [];
  sentences: Sentence[] = [];
  /** The council's inquiries into deaths. */
  inquests: Inquest[] = [];
  /** The burial ground, in order of burial. */
  graves: Grave[] = [];
  /** Furniture in every building, and everything being built. */
  furniture: Furniture[] = [];
  projects: Project[] = [];
  /** Tile indices of wells fitted with a pump. */
  pumps: number[] = [];
  /** Houses whose animal pen has a palisade, and when each last lost an animal to wolves. */
  fenced: number[] = [];
  livestockLost: Record<number, number> = {};
  /** Bumped whenever building changes the map, so the viewer redraws the ground. */
  mapVersion = 0;
  /** The village's values and gods. */
  culture!: Culture;
  /** The festival under way, if any. */
  festival: { name: string; deityId: number; startTick: number; endTick: number; attended: number[] } | null = null;
  census: Record<number, CensusEntry> = {};
  ledger: Ledger = { initial: emptyInventory(), produced: emptyInventory(), consumed: emptyInventory() };
  elderId: number | null = null;
  strainedHouseholdId = 0;
  /** Engine-only map from belief id to true crime id, for logging truth next to verdicts. */
  beliefCrime: Map<number, number> = new Map();
  pendingObservations: PendingObservation[] = [];
  pendingCaseChecks: { personId: number; beliefId: number }[] = [];
  private ids: Record<IdKind, number> = { trace: 1, crime: 1, belief: 1, obligation: 1, case: 1, hearing: 1, person: 1, sentence: 1, plot: 1, injury: 1, furniture: 1, project: 1, inquest: 1 };
  private pathCache = new Map<number, number[] | null>();

  constructor(config: SimConfig, seed: number, log: EventLog) {
    this.config = config;
    this.seed = seed;
    this.rng = new RngStreams(seed);
    this.log = log;
  }

  emit(type: string, actors: readonly number[], data: Record<string, unknown>): SimEvent {
    return this.log.emit(this.tick, type, actors, data);
  }

  nextId(kind: IdKind): number {
    return this.ids[kind]++;
  }

  peekId(kind: IdKind): number {
    return this.ids[kind];
  }

  person(id: number): Person {
    const p = this.people[id - 1];
    if (!p || p.id !== id) throw new Error(`no person ${id}`);
    return p;
  }

  maybePerson(id: number | null | undefined): Person | null {
    if (id === null || id === undefined) return null;
    const p = this.people[id - 1];
    return p && p.id === id ? p : null;
  }

  /** Living people still in the village, in id order. */
  active(): Person[] {
    return this.people.filter((p) => p.alive && !p.exiled);
  }

  isActive(id: number | null | undefined): boolean {
    const p = this.maybePerson(id);
    return !!p && p.alive && !p.exiled;
  }

  ageYears(p: Person): number {
    const ticksPerYear = this.config.time.ticksPerDay * this.config.time.daysPerSeason * 4;
    return (this.tick - p.birthTick) / ticksPerYear;
  }

  house(householdId: number): Building {
    return this.buildings[this.households[householdId]!.buildingId]!;
  }

  store(): Building {
    return this.buildings.find((b) => b.kind === "store")!;
  }

  hall(): Building {
    return this.buildings.find((b) => b.kind === "hall")!;
  }

  compound(householdId: number): Compound {
    return this.compounds[householdId]!;
  }

  /** Carried infants and carried wounded travel with their carrier and take up no tile of their own. */
  isCarried(p: Person): boolean {
    return this.carriedBy(p) !== null;
  }

  carriedBy(p: Person): Person | null {
    if (p.carriedById !== null) {
      const c = this.maybePerson(p.carriedById);
      return c && c.alive && !c.exiled ? c : null;
    }
    return this.infantCarer(p);
  }

  /** Who carries an infant: the mother, or another grown member of the house. */
  infantCarer(p: Person): Person | null {
    if (this.ageYears(p) >= this.config.needs.infantAge) return null;
    for (const id of p.parents) {
      const m = this.maybePerson(id);
      if (m && m.sex === "f" && m.alive && !m.exiled) return m;
    }
    for (const o of this.people) {
      if (o.id !== p.id && o.alive && !o.exiled && o.householdId === p.householdId && this.ageYears(o) >= 14) return o;
    }
    return null;
  }

  occupant(x: number, y: number): number {
    return this.occupancy[this.map.idx(x, y)]!;
  }

  /** A tile someone can stand on: passable, not a doorway, and not taken. */
  isFree(x: number, y: number, forId = 0): boolean {
    if (!this.map.passable(x, y) || this.map.at(x, y) === "door") return false;
    const o = this.occupancy[this.map.idx(x, y)]!;
    return o === 0 || o === forId;
  }

  /** Moves a person to a tile, keeping occupancy in step. */
  place(p: Person, x: number, y: number): void {
    const from = this.map.idx(p.x, p.y);
    if (this.occupancy[from] === p.id) this.occupancy[from] = 0;
    p.x = x;
    p.y = y;
    if (p.alive && !p.exiled && !this.isCarried(p)) this.occupancy[this.map.idx(x, y)] = p.id;
  }

  vacate(p: Person): void {
    const i = this.map.idx(p.x, p.y);
    if (this.occupancy[i] === p.id) this.occupancy[i] = 0;
  }

  /**
   * Nearest free, passable tile to `to` within `radius`, scanning rings outward in a fixed order.
   * `accept` can restrict candidates (for example, inside a given building).
   */
  freeTileNear(to: Point, radius: number, forId = 0, accept?: (x: number, y: number) => boolean): Point | null {
    for (let r = 0; r <= radius; r++) {
      let best: Point | null = null, bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = to.x + dx, y = to.y + dy;
          if (!this.map.inBounds(x, y) || !this.isFree(x, y, forId)) continue;
          if (accept && !accept(x, y)) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = { x, y }; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** Building whose floor the point is on (door counts), or null. */
  buildingOf(pt: Point): Building | null {
    const id = this.map.buildingAt(pt.x, pt.y);
    if (id < 0) return null;
    const t = this.map.at(pt.x, pt.y);
    if (t !== "floor" && t !== "door") return null;
    return this.buildings[id]!;
  }

  isInside(p: Point, b: Building): boolean {
    return p.x >= b.x0 + 1 && p.x <= b.x1 - 1 && p.y >= b.y0 + 1 && p.y <= b.y1 - 1;
  }

  /** Forget cached paths after the map changes. */
  invalidatePaths(): void {
    this.pathCache.clear();
  }

  path(from: Point, to: Point): number[] | null {
    const a = this.map.idx(from.x, from.y);
    const b = this.map.idx(to.x, to.y);
    const key = a * this.map.width * this.map.height + b;
    if (this.pathCache.has(key)) return this.pathCache.get(key)!;
    const p = findPath(this.map, a, b);
    if (this.pathCache.size > 40000) this.pathCache.clear();
    this.pathCache.set(key, p);
    return p;
  }

  /** A path that steps around people currently standing in the way (not cached). */
  detour(from: Point, to: Point, selfId: number): number[] | null {
    const occ = this.occupancy;
    return findPath(this.map, this.map.idx(from.x, from.y), this.map.idx(to.x, to.y), (i) => occ[i] !== 0 && occ[i] !== selfId, 2500);
  }

  feud(a: number, b: number): number {
    return this.feuds[a]?.[b] ?? 0;
  }

  /** Raises how much house `a` resents house `b`, logging the change. */
  addFeud(a: number, b: number, amount: number, reason: string): void {
    if (a === b || !this.feuds[a]) return;
    const before = this.feuds[a]![b]!;
    const after = Math.max(0, Math.min(1, before + amount));
    this.feuds[a]![b] = Math.round(after * 1000) / 1000;
    this.emit("feud_changed", [], { from: a, against: b, level: this.feuds[a]![b], reason });
  }

  days(n: number): number {
    return Math.round(n * this.config.time.ticksPerDay);
  }
}
