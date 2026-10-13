// The world: the battlefield, both forces and everything in flight.
import { RngStreams } from "../engine/rng.ts";
import type { EventLog, SimEvent } from "../log/events.ts";
import type { SimConfig } from "../scenario/config.ts";
import type { Building, Layout } from "./layout.ts";
import { type GameMap, cheb, findPath } from "./map.ts";
import type { BattlePhase, BattleResult, Corpse, Ordnance, Platoon, Point, Side, SmokeCloud, Soldier, Squad } from "./types.ts";

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
  /** Soldier id standing on each tile, 0 if none. Ids start at 1. */
  occupancy: Int32Array;
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
    this.occupancy = new Int32Array(n);
    this.exposure = { us: new Float32Array(n), de: new Float32Array(n) };
    this.platoons = {} as Record<Side, Platoon>;
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

  isFree(x: number, y: number, self = 0): boolean {
    if (!this.map.passable(x, y)) return false;
    const o = this.occupancy[this.map.idx(x, y)]!;
    return o === 0 || o === self;
  }

  place(s: Soldier, x: number, y: number): void {
    this.vacate(s);
    s.x = x;
    s.y = y;
    if (s.carriedById === null && (this.onField(s) || s.status === "surrendered" || s.status === "captured")) this.occupancy[this.map.idx(x, y)] = s.id;
  }

  vacate(s: Soldier): void {
    const i = this.map.idx(s.x, s.y);
    if (this.occupancy[i] === s.id) this.occupancy[i] = 0;
  }

  /** Nearest free passable tile within `radius`, ring by ring, scanning in a fixed order. */
  freeTileNear(p: Point, radius: number, self = 0, accept?: (x: number, y: number) => boolean): Point | null {
    for (let r = 0; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = p.x + dx, y = p.y + dy;
          if (!this.isFree(x, y, self)) continue;
          if (accept && !accept(x, y)) continue;
          if (r > 0 && this.map.passable(p.x, p.y) && !this.map.reachable(p, { x, y })) continue;
          return { x, y };
        }
      }
    }
    return null;
  }

  path(s: Soldier, to: Point, exposureWeight = 0): number[] | null {
    const ex = this.exposure[s.side];
    const wgt = exposureWeight;
    return findPath(this.map, this.map.idx(s.x, s.y), this.map.idx(to.x, to.y), {
      extra: wgt > 0 ? (i) => ex[i]! * wgt : undefined,
      maxExpand: 30000,
    });
  }

  /** A path that steps around anyone standing in the way. */
  detour(s: Soldier, to: Point, exposureWeight = 0): number[] | null {
    const ex = this.exposure[s.side];
    return findPath(this.map, this.map.idx(s.x, s.y), this.map.idx(to.x, to.y), {
      blocked: (i) => this.occupancy[i] !== 0 && this.occupancy[i] !== s.id,
      extra: exposureWeight > 0 ? (i) => ex[i]! * exposureWeight : undefined,
      maxExpand: 12000,
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
