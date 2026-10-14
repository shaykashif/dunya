// Armour: tanks and anti-tank guns. A vehicle is a soldier of role "tank" or
// "field_gun" (so it holds a tile, is seen and shot at like anything else), with
// a Tank record for what is special: its main gun, tracks, mud, fire, and a
// crew who are soldiers too, aboard or out on the ground. Small arms do
// nothing to it; rockets, shells and guns decide what happens: bounce, a
// broken track, men killed inside, or fire.
import { cannotWalk } from "../entities/body.ts";
import { kill } from "../entities/death.ts";
import { injure, impactHealth } from "../entities/injuries.ts";
import { label, note, shout } from "../entities/soldier.ts";
import { cheb, dist } from "../world/map.ts";
import { enemyOf, type BodyPart, type Ordnance, type OrdnanceKind, type Point, type Soldier, type Tank, type Terrain } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { fireTick } from "./fire.ts";
import { hearShot, sideContacts, updateContact } from "./perception.ts";

// ---------- Ground ----------

const BLOCKED = new Set<Terrain>(["hedge", "woods", "wall", "building", "window", "door", "floor", "water", "foxhole", "deadfall", "stairs"]);

/** Cost to a tank of crossing a tile: roads best; trees, hedges, houses and water stop it. */
function groundCost(t: Terrain): number {
  if (BLOCKED.has(t)) return Infinity;
  switch (t) {
    case "road":
    case "bridge":
      return 1;
    case "grass":
      return 2;
    case "wheat":
      return 2.2;
    case "orchard":
      return 4;
    case "brush":
    case "rubble":
    case "crater":
    case "marsh":
      return 5;
    case "ditch":
      return 6;
    default:
      return 3;
  }
}

/** Can a tank stand here: open enough ground, no house, nobody else on it. */
export function tankCanStand(w: World, x: number, y: number, self: number): boolean {
  if (!w.map.inBounds(x, y) || !Number.isFinite(groundCost(w.map.at(x, y)))) return false;
  if (!w.map.passable(x, y, 0) || w.map.building[w.map.idx(x, y)]! >= 0) return false;
  const o = w.occupancy[w.map.cell(x, y, 0)]!;
  return o === 0 || o === self;
}

class Heap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(k: number, v: number): void {
    let i = this.keys.length;
    this.keys.push(k);
    this.vals.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= this.keys[i]!) break;
      [this.keys[p], this.keys[i]] = [this.keys[i]!, this.keys[p]!];
      [this.vals[p], this.vals[i]] = [this.vals[i]!, this.vals[p]!];
      i = p;
    }
  }
  pop(): number {
    const top = this.vals[0]!;
    const lk = this.keys.pop()!, lv = this.vals.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = lk;
      this.vals[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.keys.length && this.keys[l]! < this.keys[m]!) m = l;
        if (r < this.keys.length && this.keys[r]! < this.keys[m]!) m = r;
        if (m === i) break;
        [this.keys[m], this.keys[i]] = [this.keys[i]!, this.keys[m]!];
        [this.vals[m], this.vals[i]] = [this.vals[i]!, this.vals[m]!];
        i = m;
      }
    }
    return top;
  }
}

/** A path a tank can drive: four-way, by the cheapest ground, through gaps and gates. */
export function findTankPath(w: World, from: Point, to: Point, self: number, maxNodes = 30000): Point[] | null {
  const W = w.map.width, H = w.map.height;
  const n = W * H;
  const g = new Float32Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const start = from.y * W + from.x;
  g[start] = 0;
  const open = new Heap();
  open.push(0, start);
  let goal = -1, count = 0;
  while (open.size > 0 && count++ < maxNodes) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % W, cy = (cur - cx) / W;
    if (cheb({ x: cx, y: cy }, to) <= 1) {
      goal = cur;
      break;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (closed[i]) continue;
      const c = groundCost(w.map.terrain[i]!);
      if (!Number.isFinite(c) || w.map.building[i]! >= 0) continue;
      // Men standing about are in the way for now, but they move.
      const occ = w.occupancy[w.map.cell(x, y, 0)]!;
      const cost = c + (occ !== 0 && occ !== self ? 4 : 0);
      const ng = g[cur]! + cost;
      if (ng < g[i]!) {
        g[i] = ng;
        parent[i] = cur;
        open.push(ng + Math.abs(x - to.x) + Math.abs(y - to.y), i);
      }
    }
  }
  if (goal < 0) return null;
  const path: Point[] = [];
  for (let c = goal; c !== start && c >= 0; c = parent[c]!) path.push({ x: c % W, y: (c - (c % W)) / W });
  return path.reverse();
}

// ---------- Helpers ----------

const rngOf = (w: World) => w.rng.get("armour");

export function tankOf(w: World, s: Soldier): Tank | undefined {
  return w.tanks.get(s.tankId ?? s.id);
}

/** A vehicle that can still do something: not a wreck, not abandoned, not burning. */
export function operational(w: World, t: Tank): boolean {
  const s = w.soldier(t.id);
  return (t.state === "ready" || t.state === "tracked") && s.status === "active" && s.conscious;
}

function isVehicle(s: Soldier): boolean {
  return s.role === "tank" || s.role === "field_gun";
}

function crewOf(w: World, t: Tank): Soldier[] {
  return t.crew.map((id) => w.soldier(id));
}

function aboard(w: World, t: Tank): Soldier[] {
  return crewOf(w, t).filter((c) => c.status === "aboard");
}

function unit(a: Point, b: Point): Point {
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}

function clampMap(w: World, p: Point): Point {
  return { x: Math.max(0, Math.min(w.map.width - 1, Math.round(p.x))), y: Math.max(0, Math.min(w.map.height - 1, Math.round(p.y))) };
}

function randIn(w: World, [lo, hi]: [number, number]): number {
  return lo + rngOf(w).int(hi - lo + 1);
}

function name(t: Tank): string {
  return t.name;
}

// ---------- Hits ----------

type HitKind = "ap" | "rocket" | "he_direct" | "he_near" | "frag";

const HE_TABLES: Record<"he_direct" | "he_near" | "frag", { bounce: number; track: number; crew: number; fire: number }> = {
  he_direct: { bounce: 0.2, track: 0.4, crew: 0.2, fire: 0.1 },
  he_near: { bounce: 0.76, track: 0.17, crew: 0.03, fire: 0.02 },
  frag: { bounce: 0.94, track: 0.05, crew: 0, fire: 0.01 },
};

/** Which face a tank presents to a shot from `from`: front if within sixty degrees of where it points. */
function frontal(t: Tank, at: Point, from: Point): boolean {
  const d = unit(at, from);
  return t.hull.x * d.x + t.hull.y * d.y > 0.5;
}

export function tankHit(w: World, t: Tank, kind: HitKind, byId: number | null, from: Point): void {
  const s = w.soldier(t.id);
  if (t.state === "wrecked" || t.state === "abandoned" || s.status === "dead") return;
  const cfg = w.config.armour;
  const rng = rngOf(w);
  t.threatTick = w.tick;
  const shooter = w.maybe(byId);
  // A gun is knocked out outright, or its shield saves it.
  if (t.kind === "field_gun") {
    const p = kind === "ap" || kind === "rocket" || kind === "he_direct" ? 0.7 : kind === "he_near" ? 0.12 : 0.01;
    if (rng.chance(p)) {
      wreck(w, t, byId, "the gun was knocked out");
      w.emit("tank_hit", [s.id], { tank: s.id, name: name(t), side: t.side, result: "knocked_out", kind, killed: 0, wounded: 0, by: byId, at: [s.x, s.y] });
    } else w.emit("tank_hit", [s.id], { tank: s.id, name: name(t), side: t.side, result: "bounce", kind, killed: 0, wounded: 0, by: byId, at: [s.x, s.y] });
    return;
  }
  const table = kind === "he_direct" || kind === "he_near" || kind === "frag" ? HE_TABLES[kind] : (kind === "rocket" ? cfg.rocket : cfg.ap)[frontal(t, s, from) ? "front" : "side"];
  if (rng.chance(table.bounce)) {
    w.emit("tank_hit", [s.id], { tank: s.id, name: name(t), side: t.side, result: "bounce", kind, killed: 0, wounded: 0, by: byId, at: [s.x, s.y] });
    return;
  }
  const open = 1 - table.bounce;
  let track = rng.chance(table.track / open);
  let crew = rng.chance(table.crew / open);
  const fire = rng.chance(table.fire / open);
  if (!track && !crew && !fire) crew = true;
  const results: string[] = [];
  let killed = 0, wounded = 0;
  if (crew) {
    const heavy = kind === "ap" || kind === "rocket" || kind === "he_direct";
    for (const c of aboard(w, t)) {
      const r = rng.next();
      if (r < cfg.crewKill * (heavy ? 1 : 0.4)) {
        kill(w, c, "killed", byId);
        killed++;
      } else if (r < (cfg.crewKill + cfg.crewWound) * (heavy ? 1 : 0.5)) {
        const part: BodyPart = (["torso", "left leg", "right leg", "left arm", "right arm", "head"] as BodyPart[])[rng.int(6)]!;
        const sev = 0.35 + rng.next() * 0.5;
        injure(w, c, part, "shrapnel", sev, shooter ? `spall when ${label(shooter)}'s round hit the ${t.name}` : `spall when a shell hit the ${t.name}`, byId, impactHealth(w, part, sev));
        wounded++;
      }
    }
    results.push("crew");
  }
  if (track && t.state === "ready") {
    t.state = "tracked";
    t.trackedTick = w.tick;
    t.path = [];
    results.push("tracked");
  } else track = false;
  if (fire && t.state !== "burning") {
    t.state = "burning";
    t.burnTick = w.tick;
    t.cookAt = w.tick + randIn(w, cfg.cookOff);
    t.bailAt = w.tick + randIn(w, cfg.bailTicks);
    t.repair = null;
    results.push("fire");
  }
  w.emit("tank_hit", [s.id], { tank: s.id, name: name(t), side: t.side, result: results.join("+"), kind, killed, wounded, by: byId, at: [s.x, s.y] });
  if (killed > 0 && crewOf(w, t).every((c) => c.status === "dead")) wreck(w, t, byId, "the whole crew was killed");
}

/** A knocked-out vehicle: it stays where it is, blocking the tile, doing nothing. */
function wreck(w: World, t: Tank, byId: number | null, why: string): void {
  const s = w.soldier(t.id);
  if (t.state === "wrecked") return;
  t.state = "wrecked";
  s.status = "casualty";
  s.conscious = false;
  s.act = null;
  s.sees = [];
  s.killedBy = byId;
  s.deathTick = w.tick;
  w.emit("tank_wrecked", [s.id], { tank: s.id, name: name(t), side: t.side, why, at: [s.x, s.y], by: byId });
}

/** Everything that happens when a blast comes down: tanks and guns near it take what they take. */
export function armourBlast(w: World, o: Ordnance): void {
  if (w.tanks.size === 0) return;
  const rng = rngOf(w);
  for (const t of w.tanks.values()) {
    if (t.state === "wrecked") continue;
    const s = w.soldier(t.id);
    const d = dist(s, o);
    if (d > 12) continue;
    if (o.side !== t.side) t.threatTick = Math.max(t.threatTick, d <= 6 ? w.tick : t.threatTick);
    if (o.side === t.side) continue;
    const k: OrdnanceKind = o.kind;
    if (k === "at_rocket") {
      if (d <= 1.4) tankHit(w, t, "rocket", o.byId, o.from);
      else if (d <= 2.6 && rng.chance(0.3)) tankHit(w, t, "he_near", o.byId, o.from);
    } else if (k === "tank_shell" || k === "gun_shell" || k === "mortar" || k === "artillery") {
      if (d <= 1.1) tankHit(w, t, "he_direct", o.byId, o.from);
      else if (d <= 2.2) tankHit(w, t, "he_near", o.byId, o.from);
    } else if (k === "frag" || k === "stick" || k === "rifle_grenade") {
      if (d <= 1.3) tankHit(w, t, "frag", o.byId, o.from);
    }
  }
}

/** Small arms on armour: a ping, and almost nothing more. */
export function smallArmsOnVehicle(w: World, target: Soldier, shooter: Soldier | null): void {
  const t = tankOf(w, target);
  if (!t) return;
  t.threatTick = Math.max(t.threatTick, w.tick - 6);
  if ((target.cooldowns["ping"] ?? 0) <= w.tick) {
    target.cooldowns["ping"] = w.tick + 5;
    w.emit("tank_hit", [target.id], { tank: target.id, name: name(t), side: t.side, result: "ping", kind: "small_arms", killed: 0, wounded: 0, by: shooter?.id ?? null, at: [target.x, target.y] });
  }
  // A lucky round through a vision slit.
  if (t.kind === "tank" && rngOf(w).chance(0.0015)) tankHit(w, t, "frag", shooter?.id ?? null, shooter ?? target);
}

// ---------- Crew ----------

function setCrewOrders(w: World, t: Tank, kind: "hold" | "withdraw", spots: Record<number, Point>): void {
  const sq = w.squad(w.soldier(t.id).squadId);
  for (const el of ["A", "B"] as const) {
    sq.orders[el] = { kind, positions: spots, target: null, pace: kind === "withdraw" ? "rush" : "crouch", fire: "hold", issued: w.tick };
  }
}

function giveSidearm(c: Soldier): void {
  if (c.weapon === null) {
    c.weapon = "pistol";
    c.loaded = 8;
    c.ammo = 24;
  }
}

/** The crew leave the vehicle: wounded ones as casualties, the rest to run for the rear. */
function bail(w: World, t: Tank, why: string, only?: Soldier[]): Soldier[] {
  const s = w.soldier(t.id);
  const out: Soldier[] = [];
  const list = only ?? aboard(w, t);
  for (const c of list) {
    if (c.status !== "aboard") continue;
    const spot = w.freeTileNear({ x: s.x, y: s.y }, 4, c.id) ?? { x: s.x, y: s.y };
    c.status = c.conscious && !cannotWalk(c) ? "active" : "casualty";
    w.place(c, spot.x, spot.y, 0);
    c.posture = "prone";
    c.act = null;
    c.suppression = Math.max(c.suppression, 0.4);
    giveSidearm(c);
    out.push(c);
  }
  if (out.length > 0) {
    w.emit("tank_bail", out.map((c) => c.id), { tank: s.id, name: name(t), side: t.side, why, men: out.map((c) => c.id), at: [s.x, s.y] });
    if (!only) {
      const rear = w.platoons[t.side].aidPost;
      const spots: Record<number, Point> = {};
      for (const c of out) spots[c.id] = w.freeTileNear(rear, 6, c.id) ?? rear;
      setCrewOrders(w, t, "withdraw", spots);
      const lead = out.find((c) => c.status === "active");
      if (lead) shout(w, lead, lead.side === "us" ? "Bail out! Get out!" : "Raus! Aussteigen!", "shout-bail", 20);
      if (t.state !== "burning") t.state = "abandoned";
      t.mode = "emplaced";
      t.path = [];
    }
  }
  return out;
}

// ---------- The tank's turn ----------

const ENEMY_SCORE = (e: Soldier): number => {
  if (e.role === "tank") return 100;
  if (e.role === "field_gun") return 90;
  if (e.role === "at_gunner" && e.rockets > 0) return 70;
  if (e.weapon === "mg42" || e.weapon === "bar" || e.role === "machine_gunner") return 55;
  if (e.role === "sniper") return 45;
  if (e.role === "gun_crew" || e.role.startsWith("tank_")) return 40;
  return 20;
};

function visibleEnemies(w: World, s: Soldier): Soldier[] {
  const out = new Map<number, Soldier>();
  for (const id of s.sees) {
    const e = w.maybe(id);
    if (e && (e.status === "active" || e.status === "casualty") && e.side !== s.side) out.set(e.id, e);
  }
  // What the rest of the side can see, if there is a line to it from here.
  for (const c of sideContacts(w, s.side, 3)) {
    if (!c.visible || out.has(c.id)) continue;
    const e = w.maybe(c.id);
    if (!e || e.side === s.side || e.status !== "active") continue;
    if (w.map.visibility(s.x, s.y, e.x, e.y, w.smoke, 0, e.z) >= 0.35) out.set(e.id, e);
  }
  return [...out.values()];
}

function gunnerReady(w: World, t: Tank): number {
  // 1 with a gunner and a loader, slower with fewer men; 0 with none.
  const c = aboard(w, t);
  const hasGunner = c.some((m) => m.role === "tank_gunner");
  const hasCmd = c.some((m) => m.role === "tank_commander");
  const hasLoader = c.some((m) => m.role === "tank_loader");
  if (!hasGunner && !hasCmd) return 0;
  return (hasGunner ? 1 : 0.6) * (hasLoader ? 1 : 0.55);
}

function fireMain(w: World, t: Tank, s: Soldier, target: Soldier, rate: number): void {
  const cfg = w.config.armour;
  const spec = t.kind === "tank" ? cfg.tank : cfg.field;
  const rng = rngOf(w);
  t.shells--;
  t.reloadLeft = Math.max(2, Math.round(spec.reload / Math.max(0.3, rate)));
  t.turret = unit(s, target);
  t.lastTarget = { x: target.x, y: target.y };
  if (t.kind === "tank") t.hull = t.mode === "emplaced" ? t.turret : t.hull;
  const d = dist(s, target);
  const targetTank = tankOf(w, target);
  const armoured = targetTank !== undefined && targetTank.state !== "wrecked" && targetTank.state !== "abandoned";
  w.emit("tank_fire", [s.id], { by: s.id, name: name(t), side: t.side, kind: t.kind, from: [s.x, s.y], at: [target.x, target.y], target: target.id, armoured });
  s.lastFiredTick = w.tick;
  s.cooldowns["fireNoise"] = w.tick;
  hearShot(w, s, { ...w.config.weapons.mg42, noise: 300, name: name(t) });
  note(w, s, `fired the main gun at ${label(target)}`);
  if (armoured) {
    // Armour-piercing at a tank: a hit or a near miss, and the shell either way bursts there.
    const moving = w.trails.get(target.id)?.length ? 0.7 : 1;
    const p = Math.max(0.05, (cfg.ap.hit - cfg.ap.falloff * d) * moving);
    const hit = rng.chance(p);
    const at = hit ? { x: target.x, y: target.y } : clampMap(w, { x: target.x + (rng.next() * 2 - 1) * 3, y: target.y + (rng.next() * 2 - 1) * 3 });
    const o: Ordnance = { id: w.nextId("ordnance"), kind: "at_rocket", side: t.side, byId: s.id, from: { x: s.x, y: s.y }, x: at.x, y: at.y, z: 0, burstTick: w.tick + 1, thrownTick: w.tick, spotting: false };
    // The explosion is only for show: the AP hit is resolved here.
    o.spotting = true;
    w.ordnance.push(o);
    if (hit && targetTank) tankHit(w, targetTank, "ap", s.id, s);
    return;
  }
  // High explosive: from the barrel to where the target is, a tile of scatter per twenty.
  const scatter = 0.04 * d + 0.3;
  const at = clampMap(w, { x: target.x + (rng.next() * 2 - 1) * scatter, y: target.y + (rng.next() * 2 - 1) * scatter });
  const kind: OrdnanceKind = t.kind === "tank" ? "tank_shell" : "gun_shell";
  const z = w.map.building[w.map.idx(at.x, at.y)]! >= 0 && target.z > 0 ? target.z : 0;
  w.ordnance.push({ id: w.nextId("ordnance"), kind, side: t.side, byId: s.id, from: { x: s.x, y: s.y }, x: at.x, y: at.y, z, burstTick: w.tick + 1 + Math.floor(d / 35), thrownTick: w.tick, spotting: false });
}

/** Is a main-gun shot allowed: defenders hold until the enemy is close, in the open or a tank. */
function mayFire(w: World, t: Tank, target: Soldier, d: number): boolean {
  const pl = w.platoons[t.side];
  if (pl.role !== "defend") return true;
  if (target.role === "tank" || target.role === "field_gun" || target.role === "at_gunner") return true;
  if (w.tick - t.threatTick < 25) return true;
  if (pl.squadIds.some((id) => w.squad(id).orders.A.fire === "free")) return true;
  return d <= 50;
}

function pickTarget(w: World, s: Soldier, range: number, minRange: number, pred: (e: Soldier) => boolean): Soldier | null {
  let best: Soldier | null = null, bs = -Infinity;
  for (const e of visibleEnemies(w, s)) {
    if (!pred(e)) continue;
    const d = dist(s, e);
    if (d > range || d < minRange) continue;
    if (e.role === "tank" || e.role === "field_gun") {
      const et = tankOf(w, e);
      if (!et || et.state === "wrecked" || et.state === "abandoned") continue;
    }
    const score = ENEMY_SCORE(e) - d * 0.15 + (e.status === "casualty" ? -30 : 0);
    if (score > bs) {
      bs = score;
      best = e;
    }
  }
  return best;
}

function setWreckSmoke(w: World, s: Soldier): void {
  if (w.clouds.length < 40) w.clouds.push({ id: w.nextId("cloud"), x: s.x, y: s.y - 1.4, radius: 1.8, born: w.tick, until: w.tick + 45, dark: true });
}

function repairStep(w: World, t: Tank, s: Soldier): void {
  const cfg = w.config.armour;
  const crew = crewOf(w, t).filter((c) => c.status !== "dead");
  if (!t.repair) {
    if (w.tick - t.trackedTick < 5) return;
    const quiet = w.tick - t.threatTick > cfg.repairWait * 0.5 && !visibleEnemies(w, s).some((e) => e.side !== t.side && dist(e, s) < 35 && e.role !== "tank" && e.role !== "field_gun");
    const waited = w.tick - t.trackedTick >= cfg.repairWait * 2;
    const hands = crew.filter((c) => c.status === "aboard" && c.conscious);
    if (!(quiet || waited) || hands.length < 2) return;
    // The driver and the loader get out to work; the commander and gunner stay at their guns.
    const workers = hands.filter((c) => c.role === "tank_driver" || c.role === "tank_loader");
    const crewOut = (workers.length >= 2 ? workers : hands.slice(0, 2)).slice(0, 2);
    const out = bail(w, t, "to repair the track", crewOut);
    if (out.length === 0) return;
    t.repair = { done: 0, need: cfg.repairTicks, started: w.tick };
    const spots: Record<number, Point> = {};
    out.forEach((c, k) => {
      spots[c.id] = w.freeTileNear({ x: s.x + (k % 2 === 0 ? -1 : 1), y: s.y + 1 }, 2, c.id) ?? { x: c.x, y: c.y };
    });
    setCrewOrders(w, t, "hold", spots);
    w.emit("tank_repair", out.map((c) => c.id), { tank: s.id, name: name(t), side: t.side, stage: "start", at: [s.x, s.y] });
    return;
  }
  const workers = crew.filter((c) => c.status === "active" && c.conscious && cheb(c, s) <= 2 && c.role !== "tank_commander" && c.role !== "tank_gunner");
  if (workers.length === 0) {
    // Nobody left out there who can work: the repair is off.
    if (!crew.some((c) => c.status === "active" && c.conscious)) t.repair = null;
    return;
  }
  for (const c of workers) {
    if (c.posture === "prone") c.posture = "crouch";
  }
  t.repair.done += workers.length;
  if (t.repair.done >= t.repair.need) {
    t.state = "ready";
    t.repair = null;
    t.trackedTick = -1;
    for (const c of crew) {
      if (c.status === "active" && c.conscious && c.tankId === t.id) {
        w.vacate(c);
        c.status = "aboard";
        c.x = s.x;
        c.y = s.y;
        c.act = null;
      }
    }
    w.emit("tank_repair", [], { tank: s.id, name: name(t), side: t.side, stage: "done", at: [s.x, s.y] });
    note(w, s, "the track was put back on");
  }
}

function bogCheck(w: World, t: Tank, s: Soldier): void {
  const tile = w.map.at(s.x, s.y);
  const base = w.config.armour.bog[tile] ?? 0;
  if (base <= 0) return;
  // Rain and a churned-up field make everything worse.
  const p = base * w.weather.mud * (1 + 0.5 * t.stuckCount);
  if (rngOf(w).chance(p)) {
    t.stuckUntil = w.tick + Math.round(randIn(w, w.config.armour.bogTicks) * w.weather.mud);
    t.stuckCount++;
    t.moveAcc = 0;
    w.emit("tank_bogged", [s.id], { tank: s.id, name: name(t), side: t.side, at: [s.x, s.y], tile });
    note(w, s, `bogged down in the ${tile === "marsh" ? "mud" : tile}`);
  }
}

function driveTo(w: World, t: Tank, s: Soldier, goal: Point): boolean {
  const cfg = w.config.armour.tank;
  if (t.state !== "ready" || w.tick < t.stuckUntil) return false;
  if (!aboard(w, t).some((c) => c.role === "tank_driver")) return false;
  if (!t.goal || cheb(t.goal, goal) > 2 || t.path.length === 0 || t.pathIdx >= t.path.length || w.tick >= t.replanTick) {
    t.goal = goal;
    t.replanTick = w.tick + 30;
    const p = findTankPath(w, s, goal, s.id);
    t.path = p ?? [];
    t.pathIdx = 0;
    if (!p || p.length === 0) return false;
  }
  const next = t.path[t.pathIdx];
  if (!next) return false;
  const ticks = (() => {
    const c = groundCost(w.map.at(next.x, next.y));
    return c <= 1 ? cfg.step.road : c <= 2.5 ? cfg.step.open : cfg.step.rough;
  })();
  t.moveAcc += 1 / ticks;
  t.hull = unit(s, next);
  if (t.moveAcc < 1) return true;
  if (!tankCanStand(w, next.x, next.y, s.id)) {
    // Somebody is in the way: give it a moment, then find another way round.
    t.moveAcc = 0.9;
    if (w.tick % 6 === 0) t.replanTick = w.tick;
    return true;
  }
  t.moveAcc -= 1;
  w.place(s, next.x, next.y, 0);
  t.pathIdx++;
  t.movedTick = w.tick;
  s.dir = t.hull.x < 0 ? -1 : 1;
  w.trails.set(s.id, [w.map.idx(next.x, next.y)]);
  bogCheck(w, t, s);
  return true;
}

/** Engines are heard long before a tank is seen. */
function engineNoise(w: World, t: Tank, s: Soldier): void {
  if (w.tick % 3 !== 0 || w.tick - t.movedTick > 2) return;
  const range = w.config.armour.tank.heardRange * w.weather.hearing;
  const rng = rngOf(w);
  for (const sq of w.squads) {
    if (sq.side === t.side) continue;
    let nearest = Infinity;
    for (const id of sq.members) {
      const m = w.soldier(id);
      if (!w.onField(m) || !m.conscious) continue;
      nearest = Math.min(nearest, dist(m, s));
    }
    if (nearest > range) continue;
    const off = Math.round(nearest * 0.06);
    const at = clampMap(w, { x: s.x + (rng.int(2 * off + 1) - off), y: s.y + (rng.int(2 * off + 1) - off) });
    updateContact(w, sq, s, at, false);
    const c = sq.contacts[s.id];
    if (c) c.identified = true;
  }
}

function tankStep(w: World, t: Tank, s: Soldier): void {
  const cfg = w.config.armour;
  // The crew inside ride at the tank's tile.
  for (const c of crewOf(w, t)) if (c.status === "aboard") {
    c.x = s.x;
    c.y = s.y;
  }
  if (t.state === "wrecked" || t.state === "abandoned") return;
  const pl = w.platoons[t.side];
  if (t.reloadLeft > 0) t.reloadLeft--;
  // Fire.
  if (t.state === "burning") {
    if (aboard(w, t).length > 0) {
      if (w.tick >= t.bailAt) bail(w, t, "the tank is on fire");
      else {
        for (const c of aboard(w, t)) if (rngOf(w).chance(0.12)) kill(w, c, "killed", null);
      }
    }
    if (w.tick % 8 === 0 && w.tick - t.burnTick < 80) setWreckSmoke(w, s);
    if (w.tick >= t.cookAt) {
      w.ordnance.push({ id: w.nextId("ordnance"), kind: "tank_shell", side: null, byId: null, from: { x: s.x, y: s.y }, x: s.x, y: s.y, z: 0, burstTick: w.tick + 1, thrownTick: w.tick, spotting: false });
      w.emit("tank_explodes", [s.id], { tank: s.id, name: name(t), side: t.side, at: [s.x, s.y] });
      wreck(w, t, null, "burned out and exploded");
    }
    return;
  }
  // Too few men left to fight it: leave.
  const hands = aboard(w, t).filter((c) => c.conscious);
  if (hands.length === 0 && t.repair === null) {
    if (aboard(w, t).length > 0) bail(w, t, "the crew were out of action");
    else if (!crewOf(w, t).some((c) => c.status === "active" && c.conscious)) wreck(w, t, null, "nobody left to work it");
    return;
  }
  if (t.state === "tracked") repairStep(w, t, s);
  if (pl.withdrawing && t.mode !== "fall_back") t.mode = "fall_back";
  engineNoise(w, t, s);

  // Guns: the main gun at the most dangerous thing in sight, the machine gun at men.
  const rate = gunnerReady(w, t);
  let engaged = false;
  if (rate > 0 && t.shells > 0 && t.reloadLeft <= 0 && !(t.state === "tracked" && t.repair !== null && w.tick % 2 === 0)) {
    const target = pickTarget(w, s, cfg.tank.range, cfg.tank.minRange, (e) => e.status === "active");
    if (target && mayFire(w, t, target, dist(s, target))) {
      fireMain(w, t, s, target, rate);
      engaged = true;
    }
  }
  if (aboard(w, t).some((c) => c.role === "tank_gunner" || c.role === "tank_commander") && s.loaded > 0 && s.reloadLeft <= 0) {
    const man = pickTarget(w, s, w.config.weapons.tank_mg.maxRange, 0, (e) => e.status === "active" && e.role !== "tank" && e.role !== "field_gun");
    if (man && mayFire(w, t, man, dist(s, man))) {
      t.turret = unit(s, man);
      fireTick(w, s, man, man.id, "aimed");
      engaged = true;
    }
  }
  const sees = s.sees.length > 0;

  // Moving.
  if (t.state !== "ready") return;
  if (t.mode === "advance") {
    const forward = pl.rearY > s.y ? -1 : 1;
    const men = w.side(t.side).filter((m) => w.able(m) && m.role !== "sniper" && !m.role.startsWith("tank"));
    const lead = men.reduce((best, m) => Math.max(best, forward * m.y), -Infinity);
    const ahead = forward * s.y - lead;
    const stopForFight = engaged || (sees && s.sees.some((id) => {
      const e = w.maybe(id);
      return e !== null && e.side !== t.side && e.status === "active" && dist(e, s) < 60;
    }));
    const wait = ahead > 14 || stopForFight || w.tick < 25;
    if (!wait) {
      if (!driveTo(w, t, s, pl.objective) && t.path.length === 0 && w.tick - t.movedTick > 40) {
        // No road through the hedges: sit where it is and shoot.
        t.mode = "emplaced";
        t.post = { x: s.x, y: s.y };
      }
    }
    if (!stopForFight) t.turret = t.hull;
  } else if (t.mode === "fall_back") {
    const rear = pl.aidPost;
    if (cheb(s, rear) > 4) driveTo(w, t, s, rear);
    if (!engaged) t.turret = t.hull;
  } else if (!engaged && t.lastTarget === null) {
    t.turret = t.hull;
  }
}

function gunStep(w: World, t: Tank, s: Soldier): void {
  if (t.state === "wrecked" || t.state === "abandoned") return;
  const cfg = w.config.armour;
  if (t.reloadLeft > 0) t.reloadLeft--;
  const crew = crewOf(w, t).filter((c) => c.status === "active" && c.conscious && cheb(c, s) <= 4);
  if (crew.length === 0) return;
  if (t.shells <= 0 || t.reloadLeft > 0) return;
  const target = pickTarget(w, s, cfg.field.range, cfg.field.minRange, (e) => e.status === "active");
  if (!target || !mayFire(w, t, target, dist(s, target))) return;
  fireMain(w, t, s, target, Math.min(1, 0.5 + 0.25 * crew.length));
}

/** Engine rule each tick: every tank and gun takes its turn. */
export function armourStep(w: World): void {
  if (w.tanks.size === 0) return;
  for (const t of w.tanks.values()) {
    const s = w.soldier(t.id);
    if (t.kind === "tank") tankStep(w, t, s);
    else gunStep(w, t, s);
  }
}

/** The enemy of this side's vehicles, for readability elsewhere. */
export function opposing(w: World, t: Tank): Tank[] {
  return [...w.tanks.values()].filter((o) => o.side === enemyOf(t.side));
}

export { isVehicle };
