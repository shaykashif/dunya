// The world: the battlefield, both forces and everything in flight.
import { RngStreams } from "../engine/rng.ts";
import type { EventLog, SimEvent } from "../log/events.ts";
import type { SimConfig } from "../scenario/config.ts";
import type { Building, Layout } from "./layout.ts";
import { type GameMap, cheb, findPath } from "./map.ts";
import { MAX_FLOORS, type Weather, type BattlePhase, type BattleResult, type Corpse, type Impact, type Ordnance, type Platoon, type Point, type Side, type SmokeCloud, type Soldier, type Squad } from "./types.ts";

export class World {
  readonly config: SimConfig;
  readonly seed: number;
  readonly rng: RngStreams;
  readonly log: EventLog;
  readonly map: GameMap;
  readonly layout: Layout;
  readonly buildings: Building[];
  tick = 0;
  soldiers: Soldier[] = [];
  squads: Squad[] = [];
  platoons: Record<Side, Platoon>;
  ordnance: Ordnance[] = [];
  clouds: SmokeCloud[] = [];
  corpses: Corpse[] = [];
  /** Visibility left on each tile after smoke, in [0, 1]. */
  smoke: Float32Array;
  /** Soldier id standing in each cell (a tile on a floor), 0 if none. Ids start at 1. */
  occupancy: Int32Array;
  /** The day's weather. */
  weather: Weather;
  /** Mortar and artillery rounds that came down lately, so men can react to shelling. */
  impacts: Impact[] = [];
  /** How exposed each tile is to the enemies each side knows of, in [0, 1+]. */
  exposure: Record<Side, Float32Array>;
  phase: BattlePhase = "battle";
  result: BattleResult | null = null;
  /** Tiles walked this tick, per soldier (for stumbles and the viewer). */
  trails = new Map<number, number[]>();
  /** Who attacks. */
  attacker: Side;
  /** Ticks the attackers have held the objective unopposed. */
  objectiveHeld = 0;
  /** Outcomes thirty days on, for the after-action report. */
  aftermath: Record<number, { outcome: string; lasting: string[]; died: boolean }> | null = null;
  private ids: Record<string, number> = {};
  private byId = new Map<number, Soldier>();

  constructor(config: SimConfig, seed: number, log: EventLog, layout: Layout, attacker: Side) {
    this.config = config;
    this.seed = seed;
    this.rng = new RngStreams(seed);
    this.log = log;
    this.layout = layout;
    this.map = layout.map;
    this.buildings = layout.buildings;
    this.attacker = attacker;
    const n = this.map.width * this.map.height;
    this.smoke = new Float32Array(n).fill(1);
    this.occupancy = new Int32Array(n * MAX_FLOORS);
    this.exposure = { us: new Float32Array(n), de: new Float32Array(n) };
    this.platoons = {} as Record<Side, Platoon>;
    this.weather = config.weather.kinds.clear;
  }

  nextId(kind: string): number {
    this.ids[kind] = (this.ids[kind] ?? 0) + 1;
    return this.ids[kind]!;
  }

  emit(type: string, actors: readonly number[], data: Record<string, unknown>): SimEvent {
    return this.log.emit(this.tick, type, actors, data);
  }

  addSoldier(s: Soldier): void {
    this.soldiers.push(s);
    this.byId.set(s.id, s);
  }

  soldier(id: number): Soldier {
    const s = this.byId.get(id);
    if (!s) throw new Error(`no soldier ${id}`);
    return s;
  }

  maybe(id: number | null | undefined): Soldier | null {
    if (id === null || id === undefined) return null;
    return this.byId.get(id) ?? null;
  }

  squad(id: number): Squad {
    return this.squads[id]!;
  }

  /** Alive and on the field (fighting or wounded), not captured, routed or surrendered. */
  onField(s: Soldier): boolean {
    return s.status === "active" || s.status === "casualty";
  }

  /** Can fight: active, conscious, not carried. */
  able(s: Soldier): boolean {
    return s.status === "active" && s.conscious && s.carriedById === null;
  }

  side(side: Side): Soldier[] {
    return this.soldiers.filter((s) => s.side === side);
  }

  /** Share of a side still able to fight. */
  strength(side: Side): number {
    const all = this.soldiers.filter((s) => s.side === side);
    if (all.length === 0) return 0;
    return all.filter((s) => this.able(s)).length / all.length;
  }

  // ---------- Tiles and occupancy ----------

  isFree(x: number, y: number, self = 0, z = 0): boolean {
    if (!this.map.passable(x, y, z)) return false;
    const o = this.occupancy[this.map.cell(x, y, z)]!;
    return o === 0 || o === self;
  }

  /** The cell a man stands in. */
  cellOf(s: Point & { z?: number }): number {
    return this.map.cell(s.x, s.y, s.z ?? 0);
  }

  /** Puts a man on a tile, on floor `z` (by default the floor he is on, if there is one there). */
  place(s: Soldier, x: number, y: number, z?: number): void {
    this.vacate(s);
    s.x = x;
    s.y = y;
    s.z = z ?? (this.map.passable(x, y, s.z) ? s.z : 0);
    if (s.carriedById === null && (this.onField(s) || s.status === "surrendered" || s.status === "captured")) this.occupancy[this.map.cell(x, y, s.z)] = s.id;
  }

  vacate(s: Soldier): void {
    const i = this.map.cell(s.x, s.y, s.z);
    if (this.occupancy[i] === s.id) this.occupancy[i] = 0;
  }

  /**
   * Nearest free passable tile within `radius` on the point's floor, ring by
   * ring, scanning in a fixed order. Upstairs, if the floor is full, it looks
   * on the ground instead.
   */
  freeTileNear(p: Point, radius: number, self = 0, accept?: (x: number, y: number) => boolean): Point | null {
    const z = p.z ?? 0;
    for (let r = 0; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = p.x + dx, y = p.y + dy;
          if (!this.isFree(x, y, self, z)) continue;
          if (accept && !accept(x, y)) continue;
          if (r > 0 && this.map.passable(p.x, p.y, z) && !this.map.reachable({ x: p.x, y: p.y, z }, { x, y, z })) continue;
          return z > 0 ? { x, y, z } : { x, y };
        }
      }
    }
    if (z > 0) return this.freeTileNear({ x: p.x, y: p.y }, radius, self, accept);
    return null;
  }

  /** The floor a destination means: its own, or the man's floor if it is in the same building, else the ground. */
  floorFor(s: Soldier, to: Point): number {
    if (to.z !== undefined) return to.z;
    if (s.z > 0 && this.map.passable(to.x, to.y, s.z)) return s.z;
    return 0;
  }

  path(s: Soldier, to: Point, exposureWeight = 0): number[] | null {
    const ex = this.exposure[s.side];
    const n = this.map.tiles;
    const wgt = exposureWeight;
    return findPath(this.map, this.cellOf(s), this.map.cell(to.x, to.y, this.floorFor(s, to)), {
      extra: wgt > 0 ? (c) => ex[c % n]! * wgt : undefined,
      maxExpand: 30000,
    });
  }

  /** A path that steps around anyone standing in the way. */
  detour(s: Soldier, to: Point, exposureWeight = 0): number[] | null {
    const ex = this.exposure[s.side];
    const n = this.map.tiles;
    return findPath(this.map, this.cellOf(s), this.map.cell(to.x, to.y, this.floorFor(s, to)), {
      blocked: (c) => this.occupancy[c] !== 0 && this.occupancy[c] !== s.id,
      extra: exposureWeight > 0 ? (c) => ex[c % n]! * exposureWeight : undefined,
      maxExpand: 5000,
    });
  }

  // ---------- Time ----------

  /** "06:52:14". */
  clock(tick = this.tick): string {
    const secs = this.config.time.startMinute * 60 + tick * this.config.time.secondsPerTick;
    const h = Math.floor(secs / 3600) % 24, m = Math.floor(secs / 60) % 60, s = secs % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  ticksPerMinute(): number {
    return 60 / this.config.time.secondsPerTick;
  }

  // ---------- Who is near ----------

  friendsNear(s: Point & { side: Side; id: number }, radius: number): Soldier[] {
    return this.soldiers.filter((o) => o.id !== s.id && o.side === s.side && this.onField(o) && cheb(o, s) <= radius);
  }

  enemiesNear(s: Point & { side: Side }, radius: number): Soldier[] {
    return this.soldiers.filter((o) => o.side !== s.side && this.able(o) && cheb(o, s) <= radius);
  }

  leaderOf(s: Soldier): Soldier | null {
    return this.maybe(this.squad(s.squadId).leaderId);
  }
}
