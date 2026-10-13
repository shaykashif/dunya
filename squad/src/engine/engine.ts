// The tick loop. The engine is the sole authority on what happens: decision
// sources only pick among candidates, and every outcome is applied here.
import { generateCandidates, orderFor } from "../ai/candidates.ts";
import { commandStep } from "../ai/command.ts";
import { fireTick, startReload, weaponStep } from "../combat/fire.ts";
import { fireRifleGrenade, missionStep, ordnanceStep, throwGrenade } from "../combat/ordnance.ts";
import { perceptionStep, rebuildExposure } from "../combat/perception.ts";
import { aftermath } from "../battle/aftermath.ts";
import { fightingPain } from "../entities/body.ts";
import { pickUp, setDown, stumbleStep, treat, updateInjuries } from "../entities/injuries.ts";
import { moraleStep, rally } from "../entities/morale.ts";
import { label, note, postureFor, shout, speedOf } from "../entities/soldier.ts";
import type { DecisionRecord } from "../decision/sources.ts";
import type { Decision, DecisionContext, DecisionSource } from "../decision/types.ts";
import { r3 } from "../log/events.ts";
import { cheb, dist } from "../world/map.ts";
import { enemyOf, type Activity, type Candidate, type Pace, type Point, type Side, type Soldier } from "../world/types.ts";
import type { World } from "../world/world.ts";
import { applyIntervention, type Intervention, type ScheduledIntervention } from "./interventions.ts";
import { checkInvariants } from "./invariants.ts";

function isPromise<T>(v: T | Promise<T>): v is Promise<T> {
  return typeof (v as { then?: unknown }).then === "function";
}

export function buildContext(w: World, s: Soldier): DecisionContext {
  const spec = s.weapon ? w.config.weapons[s.weapon] : null;
  return {
    tick: w.tick,
    side: s.side,
    role: s.role,
    status: s.status,
    experience: s.experience,
    traits: s.traits,
    health: s.survival.health,
    pain: fightingPain(s),
    suppression: s.suppression,
    morale: s.morale,
    pinned: s.pinned,
    broken: s.broken,
    order: orderFor(w, s),
    contactsKnown: Object.keys(w.squad(s.squadId).contacts).length,
    enemiesSeen: s.sees.length,
    underFire: s.underFire !== null && w.tick - s.underFire.tick < 6,
    ammoFraction: spec ? Math.min(1, (s.loaded + s.ammo) / (spec.capacity * 4)) : 0,
  };
}

export class Engine {
  readonly world: World;
  readonly decisions: DecisionSource;
  readonly decisionLog: DecisionRecord[] = [];
  /** Player interventions, in the order applied. Replays need these alongside the decision log. */
  readonly interventionLog: ScheduledIntervention[] = [];
  private pending: ScheduledIntervention[] = [];

  constructor(world: World, decisions: DecisionSource) {
    this.world = world;
    this.decisions = decisions;
  }

  /** Queue a player intervention; it takes effect at the start of the next tick. */
  intervene(cmd: Intervention): void {
    this.pending.push({ tick: this.world.tick, cmd });
  }

  /** Pre-load interventions recorded from an earlier run (for replay). */
  schedule(list: readonly ScheduledIntervention[]): void {
    this.pending.push(...list.map((x) => ({ tick: x.tick, cmd: x.cmd })));
  }

  private async decideFor(s: Soldier, candidates: Candidate[]): Promise<Candidate> {
    const w = this.world;
    const view = buildContext(w, s);
    const raw = this.decisions.decide(s, candidates, view);
    const d: Decision = isPromise(raw) ? await raw : raw;
    const index = d.candidateIndex;
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length) throw new Error(`decision source returned invalid index ${index} for ${candidates.length} candidates`);
    const chosen = candidates[index]!;
    const record: DecisionRecord = { tick: w.tick, person: s.id, n: candidates.length, index, key: chosen.key };
    if (d.rationale !== undefined) record.rationale = d.rationale;
    this.decisionLog.push(record);
    w.emit("decision", [s.id], { person: s.id, n: candidates.length, chosen: index, key: chosen.key, ...(d.rationale ? { rationale: d.rationale } : {}) });
    return chosen;
  }

  private start(s: Soldier, c: Candidate): void {
    const w = this.world;
    if (c.kind === "surrender") {
      surrender(w, s);
      return;
    }
    const act: Activity = { cand: c, phase: c.dest ? "travel" : "perform", work: workFor(s, c), stage: 0, path: null, pathIdx: 0, goal: -1, moveAcc: 0, ticks: 0, startTick: w.tick, blocked: 0 };
    s.act = act;
    if (c.kind === "aid" && c.targetId !== undefined) {
      const p = w.soldier(c.targetId);
      p.cooldowns["tending"] = w.tick + 40;
      p.cooldowns["tender"] = s.id;
    }
    if (c.kind === "capture" && c.targetId !== undefined) w.soldier(c.targetId).cooldowns["capturing"] = w.tick + 60;
    if (c.kind === "aid" && c.targetId === s.id) act.phase = "perform";
  }

  // ---------- Movement ----------

  /** Walks a man one tick toward `dest` (or beside it, with `reach` 1), up and down stairs as needed. Returns true on arrival. */
  private travel(s: Soldier, act: Activity, dest: Point, reach: number, pace: Pace): boolean | "fail" {
    const w = this.world;
    const cfg = w.config.movement;
    const destZ = w.floorFor(s, dest);
    if (cheb(s, dest) <= reach && (reach > 0 || (s.x === dest.x && s.y === dest.y && s.z === destZ))) return true;
    const here = w.cellOf(s);
    if (act.goal < 0 || (w.occupancy[act.goal] !== 0 && w.occupancy[act.goal] !== s.id)) {
      const target = { x: dest.x, y: dest.y, z: destZ };
      const spot = reach === 0 && w.isFree(dest.x, dest.y, s.id, destZ) ? target : w.freeTileNear(target, Math.max(1, reach) + 1, s.id, reach > 0 ? (x, y) => cheb({ x, y }, dest) <= reach : undefined) ?? w.freeTileNear(target, 4, s.id);
      if (!spot) return "fail";
      const g = w.map.cell(spot.x, spot.y, spot.z ?? 0);
      if (g !== act.goal) {
        act.goal = g;
        act.path = null;
      }
      if (g === here) return true;
    }
    if (!act.path) {
      const weight = pace === "walk" ? 0 : cfg.exposureWeight;
      act.path = w.path(s, w.map.ptz(act.goal), weight);
      act.pathIdx = 0;
      if (!act.path) return "fail";
    }
    if (act.ticks > cfg.maxTravelTicks) return "fail";
    // Rushing under fire: a few seconds up, then down again.
    const threatened = (s.underFire !== null && w.tick - s.underFire.tick < 10) || w.exposure[s.side][w.map.idx(s.x, s.y)]! > 0.4;
    if (pace === "rush" && threatened && act.ticks % (cfg.rushTicks + 2) >= cfg.rushTicks) {
      s.posture = "prone";
      return false;
    }
    s.posture = postureFor(pace);
    act.moveAcc += speedOf(w, s, pace);
    const path = act.path;
    let idx = act.pathIdx;
    let stopAt = -1;
    let budget = act.moveAcc;
    let prevCell = here;
    while (idx < path.length) {
      const next = path[idx]!;
      if (!Number.isFinite(w.map.cellCost(next))) {
        act.path = null;
        break;
      }
      const cost = w.map.stepCost(prevCell, next);
      if (budget < cost) break;
      budget -= cost;
      idx++;
      prevCell = next;
      const occ = w.occupancy[next]!;
      if (occ === 0 || occ === s.id) stopAt = idx;
    }
    if (stopAt > act.pathIdx) {
      const n = w.map.tiles;
      const trail = w.trails.get(s.id) ?? [];
      let from = here;
      for (let i = act.pathIdx; i < stopAt; i++) {
        const c = path[i]!;
        act.moveAcc -= w.map.stepCost(from, c);
        tire(w, s, from, c, pace);
        trail.push(c % n);
        from = c;
      }
      act.moveAcc = Math.max(0, act.moveAcc);
      w.trails.set(s.id, trail);
      act.pathIdx = stopAt;
      act.blocked = 0;
      const last = w.map.ptz(path[stopAt - 1]!);
      if (last.x !== s.x) s.dir = last.x < s.x ? -1 : 1;
      w.place(s, last.x, last.y, last.z);
      if (w.map.at(s.x, s.y) === "hedge") s.posture = "stand";
      const carried = w.maybe(s.carryingId);
      if (carried) {
        carried.x = s.x;
        carried.y = s.y;
        carried.z = s.z;
      }
    } else if (idx > act.pathIdx || act.pathIdx >= path.length) {
      // Everywhere within reach this tick is taken.
      act.blocked++;
      act.moveAcc = Math.min(act.moveAcc, 3);
      if (act.blocked % (cfg.detourAfterTicks + 1) === cfg.detourAfterTicks) {
        const detour = w.detour(s, w.map.ptz(act.goal), pace === "walk" ? 0 : cfg.exposureWeight);
        if (detour) {
          act.path = detour;
          act.pathIdx = 0;
        } else act.goal = -1;
      }
      if (act.blocked > 40) return "fail";
    }
    return w.cellOf(s) === act.goal || (reach > 0 && cheb(s, dest) <= reach);
  }

  // ---------- Activities ----------

  private runActivity(s: Soldier): void {
    const w = this.world;
    const act = s.act!;
    const c = act.cand;
    act.ticks++;
    const end = () => {
      if (s.act === act) s.act = null;
    };
    const fail = (reason: string) => {
      w.emit("act_failed", [s.id], { person: s.id, kind: c.kind, key: c.key, reason });
      end();
    };
    switch (c.kind) {
      case "fire": {
        const t = w.maybe(c.targetId);
        if (!t || !s.sees.includes(t.id) || t.status === "dead" || t.status === "surrendered" || t.status === "captured") return end();
        restPosture(w, s, true);
        fireTick(w, s, t, t.id, "aimed");
        if (act.ticks >= (c.duration ?? 1) || s.loaded === 0) end();
        return;
      }
      case "suppress": {
        restPosture(w, s, true);
        fireTick(w, s, c.at!, null, "suppress");
        if (act.ticks >= (c.duration ?? 1) || s.loaded === 0) end();
        return;
      }
      case "hold":
      case "hug": {
        if (c.kind === "hug") s.posture = "prone";
        else restPosture(w, s, false);
        if (act.ticks >= (c.duration ?? 1)) end();
        return;
      }
      case "reload": {
        if (act.ticks === 1) startReload(w, s);
        restPosture(w, s, false);
        if (s.reloadLeft === 0 || act.ticks > 12) end();
        return;
      }
      case "grenade":
      case "smoke": {
        s.posture = w.map.besideCover(s.x, s.y) ? "crouch" : "crouch";
        if ((c.kind === "grenade" && s.grenades > 0) || (c.kind === "smoke" && s.smokes > 0)) throwGrenade(w, s, c.at!, c.kind === "smoke");
        if (c.kind === "smoke") s.cooldowns["smoke"] = w.tick + 50;
        else s.cooldowns["grenade"] = w.tick + 12;
        return end();
      }
      case "rifle_grenade": {
        restPosture(w, s, true);
        if (act.ticks >= 2) {
          if (s.rifleGrenades > 0) fireRifleGrenade(w, s, c.at!);
          end();
        }
        return;
      }
      case "rally": {
        s.posture = "crouch";
        if (act.ticks === 1) {
          shout(w, s, s.side === "us" ? pick(w, ["Keep firing! Keep your heads, they can't hit nothing!", "Get up! Return fire!", "Come on, move it!"]) : pick(w, ["Weiterfeuern! Ruhe bewahren!", "Hoch! Feuer erwidern!", "Los, los!"]), null);
          rally(w, s);
          s.cooldowns["rally"] = w.tick + 25;
        }
        if (act.ticks >= (c.duration ?? 2)) end();
        return;
      }
      case "move":
      case "take_cover":
      case "crawl_to_cover":
      case "flee": {
        const r = this.travel(s, act, c.dest!, 0, c.pace ?? "walk");
        if (r === "fail") return fail("no way through");
        if (r) {
          end();
          if (c.kind === "flee" || (orderFor(w, s).kind === "withdraw" && c.ordered)) this.maybeLeave(s);
        }
        return;
      }
      case "aid": {
        const p = w.maybe(c.targetId);
        if (!p || p.status === "dead" || p.carriedById !== null) return end();
        if (act.phase === "travel") {
          const r = this.travel(s, act, p, 1, c.pace ?? "rush");
          if (r === "fail") return fail("could not reach the wounded man");
          if (!r) return;
          act.phase = "perform";
          act.ticks = 0;
        }
        s.posture = p.id === s.id ? "prone" : "crouch";
        if (p.id !== s.id && cheb(s, p) > 1) return end();
        if (act.ticks >= act.work) {
          treat(w, s, p, w.rng.get("injuries"), w.map.indoors(p.x, p.y, p.z) ? "indoors" : "in the field", p.id === s.id ? 0.6 : 1);
          end();
        }
        return;
      }
      case "carry": {
        const p = w.maybe(c.targetId);
        if (act.stage === 0) {
          if (!p || p.status === "dead" || p.carriedById !== null) return end();
          const r = this.travel(s, act, p, 1, "rush");
          if (r === "fail") return fail("could not reach the wounded man");
          if (!r) return;
          pickUp(w, s, p);
          act.stage = 1;
          act.goal = -1;
          act.path = null;
          return;
        }
        if (!p || p.carriedById !== s.id) return end();
        const r = this.travel(s, act, c.dest!, 1, "rush");
        if (r === "fail") {
          setDown(w, s, "could not get through");
          return fail("no way back");
        }
        if (r) {
          setDown(w, s, "brought to safety");
          note(w, s, `carried ${label(p)} to safety`);
          end();
        }
        return;
      }
      case "take_weapon": {
        const g = w.maybe(c.targetId);
        if (!g || g.weapon === null) return end();
        if (act.phase === "travel") {
          const r = this.travel(s, act, g, 1, c.pace ?? "crawl");
          if (r === "fail") return fail("could not reach the gun");
          if (!r) return;
          act.phase = "perform";
          act.ticks = 0;
        }
        s.posture = "prone";
        if (act.ticks >= 3) {
          const weapon = g.weapon;
          s.weapon = weapon;
          s.loaded = g.loaded;
          s.ammo = g.ammo + s.teamAmmo;
          s.teamAmmo = 0;
          s.heat = g.heat;
          s.role = g.role;
          g.weapon = null;
          g.loaded = 0;
          g.ammo = 0;
          w.emit("weapon_taken", [s.id], { by: s.id, from: g.id, weapon });
          shout(w, s, s.side === "us" ? "I got the BAR!" : "Ich hab das MG!", null);
          note(w, s, `took over the ${w.config.weapons[weapon].name} from ${label(g)}`);
          end();
        }
        return;
      }
      case "resupply": {
        const g = w.maybe(c.targetId);
        if (!g || !w.able(g) || s.teamAmmo <= 0) return end();
        if (act.phase === "travel") {
          const r = this.travel(s, act, g, 1, c.pace ?? "crouch");
          if (r === "fail") return fail("could not reach the gunner");
          if (!r) return;
          act.phase = "perform";
          act.ticks = 0;
        }
        if (cheb(s, g) > 1) return end();
        s.posture = "prone";
        if (act.ticks >= 2) {
          const give = Math.min(s.teamAmmo, g.weapon === "mg42" ? 250 : 120);
          s.teamAmmo -= give;
          g.ammo += give;
          w.emit("ammo_passed", [s.id, g.id], { by: s.id, to: g.id, rounds: give });
          note(w, s, `brought ${give} rounds to ${label(g)}`);
          end();
        }
        return;
      }
      case "capture": {
        const p = w.maybe(c.targetId);
        if (!p || p.status !== "surrendered") return end();
        if (act.phase === "travel") {
          const r = this.travel(s, act, p, 1, c.pace ?? "crouch");
          if (r === "fail") return fail("could not reach the prisoner");
          if (!r) return;
          act.phase = "perform";
          act.ticks = 0;
        }
        if (act.ticks >= 2) {
          p.status = "captured";
          p.capturedBy = s.id;
          p.act = null;
          w.emit("captured", [s.id, p.id], { by: s.id, prisoner: p.id });
          note(w, s, `took ${label(p)} prisoner`);
          note(w, p, `taken prisoner by ${label(s)}`);
          end();
        }
        return;
      }
      default:
        end();
    }
  }

  /** A man who reaches his own map edge while running or withdrawing is gone from the field. */
  private maybeLeave(s: Soldier): void {
    const w = this.world;
    const rearY = w.platoons[s.side].rearY;
    if (Math.abs(s.y - rearY) > 2) return;
    if (s.carryingId !== null) setDown(w, s, "reached the rear");
    w.vacate(s);
    const reason = s.broken ? "fled" : s.status === "casualty" ? "walked back wounded" : "withdrew";
    s.status = "routed";
    s.act = null;
    w.emit("left_field", [s.id], { person: s.id, reason });
    note(w, s, reason === "fled" ? "ran from the field" : "left the field");
  }

  /** Prisoners are walked back to the captors' rear. */
  private prisonerStep(): void {
    const w = this.world;
    for (const s of w.soldiers) {
      if (s.status === "surrendered") {
        s.posture = "stand";
        continue;
      }
      if (s.status !== "captured") continue;
      const dest = w.platoons[enemyOf(s.side)].aidPost;
      if (cheb(s, dest) <= 3) {
        s.posture = "crouch";
        s.act = null;
        continue;
      }
      if (!s.act) s.act = { cand: { kind: "move", key: "escorted", description: "walked back as a prisoner", dest, pace: "walk", value: 0, ordered: true, danger: 0, safety: 0, care: 0, offense: 0 }, phase: "travel", work: 0, stage: 0, path: null, pathIdx: 0, goal: -1, moveAcc: 0, ticks: 0, startTick: w.tick, blocked: 0 };
      const act = s.act;
      act.ticks++;
      const r = this.travel(s, act, dest, 2, "walk");
      if (r === true || r === "fail") s.act = null;
    }
  }

  /** Orders change, men get shot at, men break: what they were doing gives way. */
  private interrupts(): void {
    const w = this.world;
    for (const s of w.soldiers) {
      const a = s.act;
      if (!a || s.status !== "active") continue;
      const kind = a.cand.kind;
      const firedOn = s.underFire !== null && s.underFire.tick === w.tick - 1;
      if (s.broken && kind !== "flee") s.act = null;
      else if (firedOn && (kind === "hold" || (kind === "move" && a.cand.pace === "walk") || kind === "resupply" || kind === "capture")) s.act = null;
      else if (s.pinned && (kind === "move" || kind === "take_cover") && a.cand.pace !== "crawl" && a.cand.pace !== "rush") s.act = null;
    }
  }

  async step(): Promise<void> {
    const w = this.world;
    const due = this.pending.filter((x) => x.tick <= w.tick);
    this.pending = this.pending.filter((x) => x.tick > w.tick);
    for (const x of due) {
      this.interventionLog.push({ tick: w.tick, cmd: x.cmd });
      applyIntervention(w, x.cmd);
    }
    w.trails.clear();
    // 1. Rounds land, smoke drifts, mortars fire.
    ordnanceStep(w);
    missionStep(w);
    // 2. Wounds bleed; weapons reload and cool.
    updateInjuries(w);
    weaponStep(w);
    // 3. Eyes and ears.
    perceptionStep(w);
    if (w.tick % w.config.perception.exposureEvery === 0) {
      rebuildExposure(w, "us");
      rebuildExposure(w, "de");
    }
    // 4. Nerve, then orders.
    moraleStep(w);
    commandStep(w);
    this.interrupts();
    // 5. Decisions for everyone without something to do, in id order.
    for (const s of w.soldiers) {
      if (s.act || !s.conscious || s.carriedById !== null) continue;
      if (s.status !== "active" && s.status !== "casualty") continue;
      const cands = generateCandidates(w, s);
      if (cands.length === 0) continue;
      this.start(s, await this.decideFor(s, cands));
    }
    // 6. Everyone acts, in id order.
    for (const s of w.soldiers) {
      if (!s.act || !(s.status === "active" || s.status === "casualty") || s.carriedById !== null) continue;
      this.runActivity(s);
    }
    this.prisonerStep();
    stumbleStep(w);
    restStep(w);
    // 7. Is it over?
    checkBattleEnd(w);
    if (w.config.checkInvariants) checkInvariants(w);
    if (w.tick % w.config.summaryEvery === 0) w.emit("tick_summary", [], summaryData(w));
    w.tick++;
  }

  async runTicks(n: number): Promise<void> {
    for (let i = 0; i < n; i++) await this.step();
  }

  /** Runs until the battle is decided (or the time limit), then a little longer for the medics. */
  async runBattle(extraTicks = 0): Promise<void> {
    const max = this.world.config.time.maxTicks + 10;
    while (this.world.phase === "battle" && this.world.tick < max) await this.step();
    await this.runTicks(extraTicks);
  }
}

/** Each step tires a man: more at a run, more uphill, more on the stairs, more in the mud. */
function tire(w: World, s: Soldier, from: number, to: number, pace: Pace): void {
  const f = w.config.fatigue;
  const n = w.map.tiles;
  let add = f.perTile[pace];
  if (from % n === to % n) add += f.stairs;
  else add += Math.max(0, w.map.elev[to % n]! - w.map.elev[from % n]!) * f.climbPerMetre;
  if (s.carryingId !== null) add *= 2;
  s.fatigue = Math.min(1, s.fatigue + add * w.weather.fatigue * (1.3 - 0.6 * s.traits.fitness));
}

/** Men who are not moving get their breath back. */
function restStep(w: World): void {
  const rec = w.config.fatigue.recover;
  for (const s of w.soldiers) {
    if (s.fatigue <= 0 || (w.trails.get(s.id)?.length ?? 0) > 0) continue;
    s.fatigue = Math.max(0, s.fatigue - rec * (s.posture === "stand" ? 0.7 : 1) * (0.7 + 0.6 * s.traits.fitness));
  }
}

function pick(w: World, xs: readonly string[]): string {
  return xs[w.rng.get("command").int(xs.length)]!;
}

function workFor(s: Soldier, c: Candidate): number {
  if (c.kind === "aid") return c.targetId === s.id ? 8 : s.role === "medic" ? 5 : 9;
  return c.duration ?? 1;
}

/** Gets down appropriately: crouched behind a bank or in a hole, prone in the open when there is fire about. */
function restPosture(w: World, s: Soldier, firing: boolean): void {
  if (s.pinned || w.squad(s.squadId).state === "ambush") {
    s.posture = "prone";
    return;
  }
  const t = w.map.at(s.x, s.y);
  if (t === "foxhole" || t === "ditch" || w.map.besideCover(s.x, s.y) || w.map.indoors(s.x, s.y, s.z)) s.posture = "crouch";
  else if (firing || Object.keys(w.squad(s.squadId).contacts).length > 0 || s.suppression > 0.2) s.posture = "prone";
  else s.posture = "crouch";
}

function surrender(w: World, s: Soldier): void {
  s.status = "surrendered";
  s.act = null;
  s.posture = "stand";
  s.loaded = 0;
  s.ammo = 0;
  s.grenades = 0;
  if (s.carryingId !== null) setDown(w, s, "surrendered");
  w.emit("surrender", [s.id], { person: s.id, at: [s.x, s.y], morale: r3(s.morale) });
  shout(w, s, s.side === "de" ? "Kamerad! Nicht schießen!" : "Don't shoot! I give up!", null);
  note(w, s, "threw down his weapon and surrendered");
}

function summaryData(w: World): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const side of ["us", "de"] as const) {
    const all = w.side(side);
    out[side] = {
      able: all.filter((s) => w.able(s)).length,
      casualties: all.filter((s) => s.status === "casualty").length,
      dead: all.filter((s) => s.status === "dead").length,
      captured: all.filter((s) => s.status === "captured" || s.status === "surrendered").length,
      gone: all.filter((s) => s.status === "routed").length,
      pinned: all.filter((s) => s.status === "active" && s.pinned).length,
    };
  }
  out.smoke = w.clouds.length;
  return out;
}

/** The battle ends when the objective is held, one side is gone, or time runs out. */
export function checkBattleEnd(w: World): void {
  if (w.phase !== "battle") return;
  const att = w.attacker, def: Side = enemyOf(att);
  const attAble = w.side(att).filter((s) => w.able(s));
  const defAble = w.side(def).filter((s) => w.able(s));
  const obj = w.platoons[att].objective;
  const r = w.config.battle.objectiveRadius;
  let winner: Side | null | undefined;
  let reason = "";
  if (defAble.length === 0) {
    winner = att;
    reason = w.side(def).some((s) => s.status === "routed") ? "the defenders were killed, captured or driven off" : "the defenders were wiped out or captured";
  } else if (attAble.length === 0) {
    winner = def;
    reason = "the attack was beaten off";
  } else if (w.platoons[att].withdrawing && w.tick - w.platoons[att].withdrawTick >= w.config.battle.withdrawTicks) {
    winner = def;
    reason = "the attack was called off and the survivors pulled back";
  } else if (w.platoons[def].withdrawing && w.tick - w.platoons[def].withdrawTick >= w.config.battle.withdrawTicks) {
    winner = att;
    reason = `the ${def === "us" ? "Americans" : "Germans"} gave up the position and pulled out`;
  } else {
    const near = attAble.filter((s) => dist(s, obj) <= r).length;
    const held = defAble.some((s) => dist(s, obj) <= r + 6);
    w.objectiveHeld = near >= 2 && !held ? w.objectiveHeld + 1 : 0;
    if (w.objectiveHeld >= w.config.battle.holdTicks) {
      winner = att;
      reason = `${att === "us" ? "the Americans" : "the Germans"} took ${w.layout.objectiveName}`;
    } else if (w.tick >= w.config.time.maxTicks) {
      winner = null;
      reason = "the attack stalled; both sides dug in as the morning wore on";
    }
  }
  if (winner === undefined) return;
  w.phase = "over";
  w.result = { winner, reason, tick: w.tick };
  // The wounded the losers leave behind, and anyone who gave up, fall into the winners' hands.
  if (winner !== null) {
    for (const s of w.side(enemyOf(winner))) {
      if (s.status !== "casualty" && s.status !== "surrendered") continue;
      s.status = "captured";
      s.act = null;
      w.emit("captured", [s.id], { by: null, prisoner: s.id, wounded: true });
    }
  }
  const tally: Record<string, unknown> = {};
  for (const side of ["us", "de"] as const) {
    const all = w.side(side);
    tally[side] = {
      men: all.length,
      killed: all.filter((s) => s.status === "dead").length,
      wounded: all.filter((s) => s.status !== "dead" && s.injuries.some((i) => !i.permanent && i.severity >= 0.1)).length,
      captured: all.filter((s) => s.status === "captured" || s.status === "surrendered").length,
      fled: all.filter((s) => s.status === "routed").length,
    };
  }
  w.emit("battle_end", [], { winner, reason, tally, clock: w.clock() });
  for (const s of w.soldiers) if (s.status === "active") s.act = null;
  aftermath(w);
}
